import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuth } from "@/lib/auth.server";
import { registerWithInvitation, sha256 } from "@/lib/registration.server";
import { settings } from "@/lib/settings.server";
import { memberStatements } from "./fixtures/catalog";

const input = { username: "Nova.Test", email: "NOVA@example.test", password: "Ｆｉｃｔｉｏｎａｌ 1701🚀", invitationCode: "fictional-invitation-with-entropy-1701" };
const count = (table: string) => env.DB.prepare(`SELECT count(*) AS n FROM "${table}"`).first<number>("n");
const invitation = () => env.DB.prepare("SELECT * FROM invitations WHERE id = 'invite'").first<{ used_by_user_id: string | null; used_at: number | null }>();
const attempt = () => env.DB.prepare("SELECT * FROM registration_attempts ORDER BY created_at LIMIT 1")
  .first<{ id: string; state: string; expected_user_id: string; user_id: string | null; expires_at: number; identity_key: string }>();

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External requests are disabled"); })); });
afterEach(() => { vi.unstubAllGlobals(); });

async function seed(issuer: string | null = null) {
  if (issuer) await env.DB.batch(memberStatements(env.DB, issuer, "Quinn"));
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO invitations (id, code_hash, issuer_user_id, operation_id, created_at, expires_at)
    VALUES ('invite', ?, ?, ?, ?, ?)`)
    .bind(await sha256(input.invitationCode), issuer, issuer ? "operation" : null, now - 86400000, now + 86400000).run();
}

it.each([null, "quinn"])("completes a native registration and invitation atomically (issuer %s), without sessions or mail", async issuer => {
  await seed(issuer);
  const untrustedInput = { ...input, role: "admin", userId: issuer ?? "another-user", emailVerified: true };
  const result = await registerWithInvitation(env, untrustedInput);
  expect(result).toMatchObject({ status: "registered", alreadyCompleted: false });
  expect(result.attemptToken).toMatch(/^[a-f0-9]{64}$/);
  const stored = (await attempt())!;
  expect(stored).toMatchObject({ id: await sha256(result.attemptToken!), state: "completed", user_id: stored.expected_user_id });
  expect(stored.user_id).not.toBe(untrustedInput.userId);
  expect(stored.expires_at - Date.now()).toBeGreaterThan((settings.registrationReservationTtl - 30) * 1000);
  expect(stored.identity_key).not.toContain(input.email);
  expect(await env.DB.prepare("SELECT * FROM member_profiles WHERE user_id = ?").bind(stored.user_id).first())
    .toMatchObject({ role: "member", status: "active", registration_state: "completed", invited_by_user_id: issuer, invite_quota: 2 });
  expect(await invitation()).toMatchObject({ used_by_user_id: stored.user_id });
  expect(await env.DB.prepare('SELECT username, email, emailVerified FROM "user" WHERE id = ?').bind(stored.user_id).first())
    .toEqual({ username: "nova.test", email: "nova@example.test", emailVerified: 0 });
  expect(await count("session")).toBe(0);
  expect(await count("verification")).toBe(0);
  expect(await count("twoFactor")).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("replays only the owned completed attempt, without consuming another invitation or changing its password", async () => {
  await seed();
  const first = await registerWithInvitation(env, input);
  const original = await env.DB.prepare("SELECT password FROM account").first<string>("password");
  expect(await registerWithInvitation(env, { ...input, password: "Wrong password" }, first.attemptToken))
    .toMatchObject({ status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID" });
  expect(await registerWithInvitation(env, { ...input, email: "other@example.test" }, first.attemptToken))
    .toEqual({ status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID" });
  expect(await registerWithInvitation(env, { ...input, password: "Fictional 1701🚀" }, first.attemptToken))
    .toMatchObject({ status: "registered", alreadyCompleted: true });
  expect(await env.DB.prepare("SELECT password FROM account").first<string>("password")).toBe(original);
  expect(await count("member_profiles")).toBe(1);
  expect(await count("account")).toBe(1);
  expect(await registerWithInvitation(env, input, "0".repeat(64)))
    .toEqual({ status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID" });
  expect(await registerWithInvitation(env, input)).toEqual({ status: "rejected", code: "INVITATION_USED" });
});

it.each(["username", "email"] as const)("does not claim an existing native identity on %s conflict, including synthetic success", async field => {
  await seed();
  const existing = await createAuth(env).api.signUpEmail({ body: {
    name: "Quinn", username: field === "username" ? input.username : "Quinn.Test",
    email: field === "email" ? input.email : "quinn@example.test", password: "Existing password",
  } });
  const result = await registerWithInvitation(env, input);
  expect(result.status).toBe("rejected");
  expect((await attempt())?.state).toBe("failed");
  expect((await attempt())?.expected_user_id).not.toBe(existing.user.id);
  expect(await count("member_profiles")).toBe(0);
  expect((await invitation())?.used_by_user_id).toBeNull();
  const corrected = await registerWithInvitation(env, { ...input, username: "Other.Test", email: "other@example.test" });
  expect(corrected.status).toBe("registered");
  expect((await invitation())?.used_by_user_id).not.toBe(existing.user.id);
});

it("allows only one parallel claim of an invitation", async () => {
  await seed();
  const results = await Promise.all([
    registerWithInvitation(env, input),
    registerWithInvitation(env, { ...input, username: "Quinn.Test", email: "quinn@example.test" }),
  ]);
  expect(results.filter(result => result.status === "registered")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ code: "INVITATION_RESERVED" });
  expect(await count("member_profiles")).toBe(1);
  expect(await count("user")).toBe(1);
  expect(await count("account")).toBe(1);
});

it("repairs only its persisted native user after credential creation fails", async () => {
  await seed();
  await env.DB.exec("CREATE TRIGGER reject_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'Injected account failure'); END;");
  const first = await registerWithInvitation(env, input);
  expect(first.status).toBe("retry");
  const stored = (await attempt())!;
  expect(stored).toMatchObject({ state: "reserved", user_id: null });
  expect(await env.DB.prepare('SELECT id FROM "user"').first<string>("id")).toBe(stored.expected_user_id);
  expect(await count("account")).toBe(0);
  expect(await count("member_profiles")).toBe(0);
  expect((await invitation())?.used_by_user_id).toBeNull();
  expect(await registerWithInvitation(env, input)).toEqual({ status: "rejected", code: "INVITATION_RESERVED" });
  expect(await registerWithInvitation(env, input, "0".repeat(64))).toEqual({ status: "rejected", code: "REGISTRATION_ATTEMPT_INVALID" });
  await env.DB.exec("DROP TRIGGER reject_account;");
  expect(await registerWithInvitation(env, { ...input, password: "x" }, first.attemptToken)).toMatchObject({ status: "rejected", code: "INVALID_PASSWORD" });
  expect(await count("account")).toBe(0);
  const retries = await Promise.all([registerWithInvitation(env, input, first.attemptToken), registerWithInvitation(env, input, first.attemptToken)]);
  expect(retries.some(result => result.status === "registered")).toBe(true);
  expect((await invitation())?.used_by_user_id).toBe(stored.expected_user_id);
  expect(await count("user")).toBe(1);
  expect(await count("account")).toBe(1);
});

it("rolls back all business activation on a late invitation-write failure and resumes without another native account", async () => {
  await seed();
  await env.DB.exec("CREATE TRIGGER reject_consumption BEFORE UPDATE OF used_by_user_id ON invitations BEGIN SELECT RAISE(ABORT, 'Injected consumption failure'); END;");
  const first = await registerWithInvitation(env, input);
  expect(first.status).toBe("retry");
  expect((await attempt())?.state).toBe("created");
  expect(await count("member_profiles")).toBe(0);
  expect((await invitation())?.used_by_user_id).toBeNull();
  await expect(env.DB.prepare("UPDATE registration_attempts SET expected_user_id = 'another-user'").run()).rejects.toThrow(/immutable/);
  await expect(env.DB.prepare("UPDATE registration_attempts SET id = 'another-attempt'").run()).rejects.toThrow(/immutable/);
  await expect(env.DB.prepare("INSERT OR REPLACE INTO registration_attempts SELECT * FROM registration_attempts").run()).rejects.toThrow(/replacement is forbidden/);
  await expect(env.DB.prepare("UPDATE registration_attempts SET user_id = 'another-user'").run()).rejects.toThrow(/does not match/);
  await env.DB.exec("DROP TRIGGER reject_consumption;");
  const retries = await Promise.all([registerWithInvitation(env, input, first.attemptToken), registerWithInvitation(env, input, first.attemptToken)]);
  expect(retries.every(result => result.status === "registered")).toBe(true);
  expect(retries.filter(result => result.status === "registered" && !result.alreadyCompleted)).toHaveLength(1);
  expect(await count("member_profiles")).toBe(1);
  expect(await count("user")).toBe(1);
  expect(await count("account")).toBe(1);
});

it.each([
  ["issuer ban", "UPDATE member_profiles SET status = 'banned' WHERE user_id = 'quinn'", "INVITATION_INVALID"],
  ["revocation", "UPDATE invitations SET revoked_at = created_at + 1", "INVITATION_REVOKED"],
  ["expiry", "UPDATE invitations SET expires_at = created_at + 1", "INVITATION_EXPIRED"],
])("rechecks %s at the atomic completion boundary", async (_name, statement, code) => {
  await seed("quinn");
  await env.DB.exec(`CREATE TRIGGER change_invitation AFTER INSERT ON account BEGIN ${statement}; END;`);
  const first = await registerWithInvitation(env, input);
  expect(first.status).toBe("retry");
  expect((await invitation())?.used_by_user_id).toBeNull();
  expect(await count("member_profiles")).toBe(1);
  expect(await registerWithInvitation(env, input, first.attemptToken)).toMatchObject({ status: "rejected", code });
});

it("renews an expired owned reservation without duplicating its partial native account", async () => {
  await seed();
  await env.DB.exec("CREATE TRIGGER expire_attempt AFTER INSERT ON account BEGIN UPDATE registration_attempts SET expires_at = created_at + 1; END;");
  const first = await registerWithInvitation(env, input);
  expect(first.status).toBe("retry");
  const owned = (await attempt())!.expected_user_id;
  expect((await invitation())?.used_by_user_id).toBeNull();
  expect((await registerWithInvitation(env, input, first.attemptToken)).status).toBe("registered");
  expect((await invitation())?.used_by_user_id).toBe(owned);
  expect(await count("user")).toBe(1);
  expect(await count("account")).toBe(1);
});

it.each([
  ["revoked", "UPDATE invitations SET revoked_at = created_at + 1", "INVITATION_REVOKED"],
  ["expired", "UPDATE invitations SET expires_at = created_at + 1", "INVITATION_EXPIRED"],
  ["banned issuer", "UPDATE member_profiles SET status = 'banned' WHERE user_id = 'quinn'", "INVITATION_INVALID"],
])("rejects an already %s invitation before creating native data", async (_name, statement, code) => {
  await seed("quinn");
  await env.DB.exec(statement);
  expect(await registerWithInvitation(env, input)).toEqual({ status: "rejected", code });
  expect(await count("registration_attempts")).toBe(0);
  expect(await count("account")).toBe(0);
  expect(await count("member_profiles")).toBe(1);
});

it("releases a native validation failure and allows a new valid claim", async () => {
  await seed();
  expect((await registerWithInvitation(env, { ...input, username: "invalid-name" })).status).toBe("rejected");
  expect((await attempt())?.state).toBe("failed");
  expect(await count("user")).toBe(0);
  expect((await registerWithInvitation(env, input)).status).toBe("registered");
});
