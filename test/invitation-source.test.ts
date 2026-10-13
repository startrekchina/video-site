import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { fixtureTime as now } from "./fixtures/catalog";

const mismatch = /Invitation issuer does not match member inviter/;
const invalidSources = [
  ["another issuer", "river", "quinn"],
  ["root member with an issuer", "quinn", "nova"],
  ["bootstrap with an invited member", "river", null],
] as const;

const nativeUser = (id: string) => env.DB.prepare(`INSERT INTO "user"
  (id, name, username, displayUsername, email, emailVerified, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).bind(
  id, id, id, id, `${id}@example.test`, new Date(now).toISOString(), new Date(now).toISOString(),
);
const profile = (id: string, inviter: string | null) => env.DB.prepare(`INSERT INTO member_profiles
  (user_id, role, status, registration_state, invited_by_user_id, invite_quota, created_at)
  VALUES (?, 'member', 'active', 'completed', ?, 2, ?)`).bind(id, inviter, now);
const invitation = (consumer: string | null, issuer: string | null, verb = "INSERT") =>
  env.DB.prepare(`${verb} INTO invitations
    (id, code_hash, issuer_user_id, used_by_user_id, operation_id, created_at, expires_at, used_at)
    VALUES ('invite', 'fictional-invitation-digest', ?, ?, ?, ?, ?, ?)`)
    .bind(issuer, consumer, issuer === null ? null : "fictional-operation", now, now + 86400000, consumer === null ? null : now);
const consume = (consumer: string) => env.DB.prepare(
  "UPDATE invitations SET used_by_user_id = ?, used_at = ? WHERE id = 'invite'",
).bind(consumer, now);
const storedInvitation = () => env.DB.prepare(
  "SELECT issuer_user_id, used_by_user_id, used_at FROM invitations WHERE id = 'invite'",
).first();

async function seedMembers() {
  await env.DB.batch([
    nativeUser("nova"), profile("nova", null),
    nativeUser("quinn"), profile("quinn", null),
    nativeUser("river"), profile("river", "nova"),
  ]);
}

describe("invitation source constraints", () => {
  beforeEach(seedMembers);

  it.each(invalidSources)("rejects inconsistent INSERT: %s", async (_name, consumer, issuer) => {
    await expect(invitation(consumer, issuer).run()).rejects.toThrow(mismatch);
    expect(await storedInvitation()).toBeNull();
  });

  it.each(invalidSources)("rejects inconsistent consumption: %s", async (_name, consumer, issuer) => {
    await invitation(null, issuer).run();
    await expect(consume(consumer).run()).rejects.toThrow(mismatch);
    expect(await storedInvitation()).toEqual({ issuer_user_id: issuer, used_by_user_id: null, used_at: null });
  });

  it.each(["INSERT OR REPLACE", "REPLACE"])("rejects inconsistent %s and preserves the consumed record", async verb => {
    await invitation("river", "nova").run();
    const original = await storedInvitation();
    await expect(invitation("river", "quinn", verb).run()).rejects.toThrow(mismatch);
    expect(await storedInvitation()).toEqual(original);
  });

  it.each(["quinn", null])("rejects a consumed invitation's changed issuer (%s)", async issuer => {
    await invitation("river", "nova").run();
    await expect(env.DB.prepare("UPDATE invitations SET issuer_user_id = ? WHERE id = 'invite'")
      .bind(issuer).run()).rejects.toThrow(mismatch);
    expect(await storedInvitation()).toEqual({ issuer_user_id: "nova", used_by_user_id: "river", used_at: now });
  });

  it("rejects replacing a consumed member with a different invitation source", async () => {
    await invitation("river", "nova").run();
    await expect(consume("quinn").run()).rejects.toThrow(mismatch);
    expect(await storedInvitation()).toEqual({ issuer_user_id: "nova", used_by_user_id: "river", used_at: now });
  });

  it.each([["river", "nova"], ["quinn", null]] as const)(
    "allows matching direct INSERT and consumption (%s, %s)", async (consumer, issuer) => {
      await invitation(consumer, issuer).run();
      expect(await storedInvitation()).toEqual({ issuer_user_id: issuer, used_by_user_id: consumer, used_at: now });
      await env.DB.prepare("DELETE FROM invitations WHERE id = 'invite'").run();
      await invitation(null, issuer).run();
      await consume(consumer).run();
      expect(await storedInvitation()).toEqual({ issuer_user_id: issuer, used_by_user_id: consumer, used_at: now });
    },
  );

  it.each([["nova", "quinn"], ["nova", null], [null, "nova"]] as const)(
    "rolls back a member-first registration batch with mismatched source (%s, %s)", async (issuer, inviter) => {
      await invitation(null, issuer).run();
      await expect(env.DB.batch([nativeUser("sky"), profile("sky", inviter), consume("sky")]))
        .rejects.toThrow(mismatch);
      expect(await env.DB.prepare('SELECT id FROM "user" WHERE id = \'sky\'').first()).toBeNull();
      expect(await env.DB.prepare("SELECT user_id FROM member_profiles WHERE user_id = 'sky'").first()).toBeNull();
      expect(await storedInvitation()).toEqual({ issuer_user_id: issuer, used_by_user_id: null, used_at: null });
    },
  );

  it.each([["nova", "quinn"], ["nova", null], [null, "nova"]] as const)(
    "rejects deferred consumption before a mismatched profile (%s, %s)", async (issuer, inviter) => {
      await invitation(null, issuer).run();
      await expect(env.DB.batch([
        env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
        consume("sky"), nativeUser("sky"), profile("sky", inviter),
        env.DB.prepare("PRAGMA defer_foreign_keys = OFF"),
      ])).rejects.toThrow(mismatch);
      expect(await env.DB.prepare('SELECT id FROM "user" WHERE id = \'sky\'').first()).toBeNull();
      expect(await env.DB.prepare("SELECT user_id FROM member_profiles WHERE user_id = 'sky'").first()).toBeNull();
      expect(await storedInvitation()).toEqual({ issuer_user_id: issuer, used_by_user_id: null, used_at: null });
      expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    },
  );

  it.each(["nova", null])("allows matching deferred consumption before profile creation (%s)", async issuer => {
    await invitation(null, issuer).run();
    await env.DB.batch([
      env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
      consume("sky"), nativeUser("sky"), profile("sky", issuer),
      env.DB.prepare("PRAGMA defer_foreign_keys = OFF"),
    ]);
    expect(await storedInvitation()).toEqual({ issuer_user_id: issuer, used_by_user_id: "sky", used_at: now });
    expect(await env.DB.prepare("SELECT invited_by_user_id FROM member_profiles WHERE user_id = 'sky'").first())
      .toEqual({ invited_by_user_id: issuer });
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});

describe("invitation source migration", () => {
  beforeEach(async () => {
    await reset();
    const index = env.TEST_MIGRATIONS.findIndex(item => item.name === "0009_member_profiles_invitation_guard.sql");
    expect(index).toBeGreaterThan(0);
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, index));
    await seedMembers();
  });

  const migrate = () => applyD1Migrations(env.DB, env.TEST_MIGRATIONS.filter(
    item => item.name === "0009_member_profiles_invitation_guard.sql",
  ));

  it.each(invalidSources)("preserves existing records and refuses inconsistent data: %s", async (_name, consumer, issuer) => {
    await invitation(consumer, issuer).run();
    const original = await storedInvitation();
    await expect(migrate()).rejects.toThrow(/invitation_source_requires_review/);
    expect(await storedInvitation()).toEqual(original);
    expect((await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'invitation_source_migration_guard'").all()).results)
      .toEqual([]);
  });

  it.each([["river", "nova"], ["quinn", null]] as const)(
    "preserves a valid consumed invitation during upgrade (%s, %s)", async (consumer, issuer) => {
      await invitation(consumer, issuer).run();
      const original = await storedInvitation();
      await migrate();
      expect(await storedInvitation()).toEqual(original);
      await expect(invitation("river", "quinn", "REPLACE").run()).rejects.toThrow(mismatch);
      expect(await storedInvitation()).toEqual(original);
    },
  );
});

// PR #21's guarded legacy schema is the input to the membership-table rebuild.

it.each(["nova", null])("upgrades the guarded legacy schema without losing invitation relations (%s)", async issuer => {
  await reset();
  const index = env.TEST_MIGRATIONS.findIndex(item => item.name === "0009_member_profiles.sql");
  const preceding = env.TEST_MIGRATIONS.slice(0, index).filter(
    item => item.name !== "0008_legacy_invitation_guard_retirement.sql",
  );
  await applyD1Migrations(env.DB, preceding);
  const legacyUser = (id: string, inviter: string | null) => env.DB.prepare(`INSERT INTO users
    (id, username, username_key, email, email_key, email_verified_at, password_hash,
     role, status, invited_by_user_id, invite_quota, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'fictional-legacy-hash', 'member', 'active', ?, 2, ?)`)
    .bind(id, id, id, `${id}@example.test`, `${id}@example.test`, now, inviter, now);
  await env.DB.batch([
    legacyUser("nova", null), legacyUser("river", issuer),
    nativeUser("nova"), nativeUser("river"),
    env.DB.prepare(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      SELECT id || '-credential', id, 'credential', id, password_hash, ?, ? FROM users`)
      .bind(new Date(now).toISOString(), new Date(now).toISOString()),
    invitation("river", issuer),
  ]);
  const original = await storedInvitation();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.filter(
    item => item.name === "0008_legacy_invitation_guard_retirement.sql" || env.TEST_MIGRATIONS.indexOf(item) >= index,
  ));
  expect(await storedInvitation()).toEqual(original);
  expect(await env.DB.prepare("SELECT invited_by_user_id FROM member_profiles WHERE user_id = 'river'").first())
    .toEqual({ invited_by_user_id: issuer });
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").first()).toBeNull();
  await expect(env.DB.prepare("UPDATE invitations SET issuer_user_id = ?, operation_id = 'changed' WHERE id = 'invite'")
    .bind(issuer === null ? "nova" : null).run()).rejects.toThrow(mismatch);
  expect(await storedInvitation()).toEqual(original);
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
