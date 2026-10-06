import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { fixtureTime as now } from "./fixtures/catalog";

const migration = env.TEST_MIGRATIONS.slice(-1);
const businesses = ["invitations", "email_deliveries", "watch_progress", "favorites", "playlists", "playlist_items", "comments", "comment_replies", "discussion_votes"];
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword("Fictional 1701"); });

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, -1));
  const legacy = (id: string, inviter: string | null, role: string, status: string) => env.DB.prepare(`INSERT INTO users
    (id, username, username_key, email, email_key, email_verified_at, password_hash,
     role, status, invited_by_user_id, invite_quota, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 7, ?)`).bind(
    id, id, id, `${id}@example.test`, `${id}@example.test`, now, passwordHash, role, status, inviter, now,
  );
  await env.DB.batch([
    legacy("nova", null, "admin", "active"), legacy("quinn", "nova", "member", "banned"),
    env.DB.prepare(`INSERT INTO "user" (id, name, username, displayUsername, email, emailVerified, createdAt, updatedAt)
      SELECT id, username, username_key, username, email_key, 1, ?, ? FROM users`)
      .bind(new Date(now).toISOString(), new Date(now).toISOString()),
    env.DB.prepare(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      SELECT id || '-credential', id, 'credential', id, password_hash, ?, ? FROM users`)
      .bind(new Date(now).toISOString(), new Date(now).toISOString()),
    env.DB.prepare("INSERT INTO works (id, kind, tmdb_id) VALUES ('movie', 'movie', 910001)"),
    env.DB.prepare("INSERT INTO playable_units (id, kind, work_id, tmdb_id, duration_seconds) VALUES ('unit', 'movie', 'movie', 910001, 4)"),
    env.DB.prepare("INSERT INTO invitations (id, code_hash, used_by_user_id, created_at, expires_at, used_at) VALUES ('invite', 'fictional-digest', 'quinn', ?, ?, ?)")
      .bind(now, now + 1000, now),
    env.DB.prepare("INSERT INTO email_deliveries (id, user_id, to_email_key, purpose, status, created_at) VALUES ('mail', 'nova', 'fictional-digest', 'password_reset', 'unknown', ?)").bind(now),
    env.DB.prepare("INSERT INTO watch_progress (user_id, playable_unit_id, position_seconds, completed, updated_at, revision) VALUES ('nova', 'unit', 3, 0, ?, 5)").bind(now),
    env.DB.prepare("INSERT INTO favorites (user_id, work_id) VALUES ('nova', 'movie')"),
    env.DB.prepare("INSERT INTO playlists (id, owner_user_id, title, visibility, created_at, updated_at) VALUES ('playlist', 'nova', 'Fictional flight', 'private', ?, ?)").bind(now, now),
    env.DB.prepare("INSERT INTO playlist_items (id, playlist_id, work_id, position) VALUES ('item', 'playlist', 'movie', 0)"),
    env.DB.prepare("INSERT INTO comments (id, playable_unit_id, author_user_id, body_markdown, created_at) VALUES ('comment', 'unit', 'nova', 'Fictional signal', ?)").bind(now),
    env.DB.prepare("INSERT INTO comment_replies (id, comment_id, author_user_id, reply_to_user_id, body_markdown, created_at) VALUES ('reply', 'comment', 'quinn', 'nova', 'Received', ?)").bind(now),
    env.DB.prepare("INSERT INTO discussion_votes (user_id, comment_id, value) VALUES ('quinn', 'comment', 1)"),
    env.DB.prepare("INSERT INTO discussion_votes (user_id, reply_id, value) VALUES ('nova', 'reply', -1)"),
  ]);
});

const rows = async (table: string) => (await env.DB.prepare(`SELECT * FROM "${table}"`).all()).results;

it("preserves every business relation, stable ID, role and ban while retiring reviewed legacy tables", async () => {
  const before = await Promise.all(businesses.map(rows));
  const credentials = await rows("account");
  await applyD1Migrations(env.DB, migration);
  expect(await Promise.all(businesses.map(rows))).toEqual(before);
  expect(await rows("account")).toEqual(credentials);
  expect(await env.DB.prepare("SELECT user_id, role, status, registration_state, invited_by_user_id, invite_quota FROM member_profiles ORDER BY user_id").all())
    .toMatchObject({ results: [
      { user_id: "nova", role: "admin", status: "active", registration_state: "completed", invited_by_user_id: null, invite_quota: 7 },
      { user_id: "quinn", role: "member", status: "banned", registration_state: "completed", invited_by_user_id: "nova", invite_quota: 7 },
    ] });
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'email_claims', 'sessions', 'passkeys', 'reset_links', 'recovery_codes')").all())
    .toMatchObject({ results: [] });
  await env.DB.prepare("DELETE FROM comments WHERE id = 'comment'").run();
  expect(await rows("comment_replies")).toEqual([]);
  expect(await rows("discussion_votes")).toEqual([]);
  expect(await rows("playlist_items")).toHaveLength(1);
});

it.each([
  'DELETE FROM account',
  'UPDATE account SET password = NULL',
  'UPDATE "user" SET email = \'other@example.test\' WHERE id = \'nova\'',
  'UPDATE users SET pending_email = \'pending@example.test\', pending_email_key = \'pending@example.test\' WHERE id = \'nova\'',
  `INSERT INTO sessions (id, token_hash, user_id, credential_version, created_at, last_active_at, expires_at) VALUES ('old', 'fictional-hash', 'nova', 0, ${now}, ${now}, ${now + 1000})`,
  `INSERT INTO totp_credentials (user_id, encrypted_secret, nonce, key_version, created_at) VALUES ('nova', X'00', X'01', 1, ${now})`,
  `INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, created_at) VALUES ('old', 'nova', 'fictional-credential', X'00', 0, 'single_device', 0, ${now})`,
])("rejects unreviewed legacy authentication and rolls back the migration (%s)", async (change) => {
  await env.DB.prepare(change).run();
  const members = await rows("users");
  const discussions = await rows("discussion_votes");
  await expect(applyD1Migrations(env.DB, migration)).rejects.toThrow(/legacy_auth_requires_review/);
  expect(await rows("users")).toEqual(members);
  expect(await rows("discussion_votes")).toEqual(discussions);
  expect((await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'member_profiles'").all()).results).toEqual([]);
});

it("restores every old relation when migration fails after copying and replacing business tables", async () => {
  await env.DB.prepare("CREATE TABLE registration_attempts (injected_failure TEXT)").run();
  const before = await Promise.all(businesses.map(rows));
  const members = await rows("users");
  await expect(applyD1Migrations(env.DB, migration)).rejects.toThrow(/already exists/);
  expect(await Promise.all(businesses.map(rows))).toEqual(before);
  expect(await rows("users")).toEqual(members);
  expect((await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'member_profiles'").all()).results).toEqual([]);
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
