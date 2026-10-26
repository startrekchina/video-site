import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWithInvitation, sha256 } from "@/lib/registration.server";
import { http } from "./fixtures/auth";
import { memberStatements } from "./fixtures/catalog";

const input = { username: "Recovering", email: "recovering@example.test", password: "Fictional 1701 password", invitationCode: "fictional-original-invitation" };
const replacement = "fictional-replacement-invitation";
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => Response.json(String(url).includes("/siteverify")
    ? { success: true, hostname: "localhost", action: "auth" } : { status: "success", data: { message_id: "fictional-message" } })));
  await env.DB.batch([...memberStatements(env.DB, "original-issuer", "Original"), ...memberStatements(env.DB, "new-issuer", "Replacement")]);
  const now = Date.now();
  for (const [id, issuer, code] of [["original", "original-issuer", input.invitationCode], ["replacement", "new-issuer", replacement]]) {
    await env.DB.prepare("INSERT INTO invitations (id, code_hash, issuer_user_id, operation_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, await sha256(code), issuer, crypto.randomUUID(), now - 86400000, now + 86400000).run();
  }
});

it("keeps the original attempt when recovery fails and permits only one concurrent replacement", async () => {
  await env.DB.exec("CREATE TRIGGER interrupt_registration AFTER INSERT ON account BEGIN UPDATE invitations SET revoked_at = created_at + 1 WHERE id = 'original'; END;");
  const first = await registerWithInvitation(env, input);
  expect(first.status).toBe("retry");
  await env.DB.exec("DROP TRIGGER interrupt_registration");
  const before = await env.DB.prepare("SELECT * FROM registration_attempts").all();
  await env.DB.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON registration_attempts WHEN NEW.invitation_id = 'replacement' BEGIN SELECT RAISE(ABORT, 'Injected recovery failure'); END;");
  const resumedInput = { ...input, invitationCode: replacement };
  await expect(registerWithInvitation(env, resumedInput, first.attemptToken)).rejects.toThrow(/Injected recovery failure/);
  expect((await env.DB.prepare("SELECT * FROM registration_attempts").all()).results).toEqual(before.results);
  await env.DB.exec("DROP TRIGGER reject_recovery");
  const results = await Promise.all([registerWithInvitation(env, resumedInput, first.attemptToken), registerWithInvitation(env, resumedInput)]);
  expect(results.filter(result => result.status === "registered")).toHaveLength(1);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM registration_attempts").first("n")).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM "user" WHERE username = ?').bind("recovering").first("n")).toBe(1);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("resumes with the old cookie when the response carrying the replacement cookie was lost", async () => {
  await env.DB.exec("CREATE TRIGGER interrupt_registration AFTER INSERT ON account BEGIN UPDATE invitations SET revoked_at = created_at + 1 WHERE id = 'original'; END;");
  const first = await registerWithInvitation(env, input);
  expect(first.status).toBe("retry");
  await env.DB.exec("DROP TRIGGER interrupt_registration");
  const original = await env.DB.prepare('SELECT id FROM "user" WHERE username = ?').bind("recovering").first<string>("id");
  const cookie = `registration=${first.attemptToken}`, resumedInput = { ...input, invitationCode: replacement };
  // The recovery batch commits, then the request fails; its Set-Cookie never reaches the browser.
  await env.DB.exec(`CREATE TRIGGER interrupt_completion BEFORE INSERT ON member_profiles WHEN NEW.user_id = '${original}' BEGIN SELECT RAISE(ABORT, 'Injected completion failure'); END;`);
  expect((await http("/register", resumedInput, cookie)).status).not.toBe(200);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM registration_attempts WHERE id = ?").bind(await sha256(first.attemptToken!)).first("n")).toBe(0);
  await env.DB.exec("DROP TRIGGER interrupt_completion");
  const resumed = await http("/register", resumedInput, cookie);
  expect(resumed.status).toBe(200);
  expect(await resumed.json()).toMatchObject({ status: "pending_verification", alreadyCompleted: false });
  expect(await env.DB.prepare("SELECT used_by_user_id FROM invitations WHERE id = 'replacement'").first("used_by_user_id")).toBe(original);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM registration_attempts").first("n")).toBe(1);
});

describe.each([
  ["revoked", "UPDATE invitations SET revoked_at = created_at + 1 WHERE id = 'original'"],
  ["expired", "UPDATE invitations SET expires_at = created_at + 1 WHERE id = 'original'"],
  ["issuer banned", "UPDATE member_profiles SET status = 'banned' WHERE user_id = 'original-issuer'"],
])("recovery when the original invitation is %s", (_, invalidate) => {
  it.each([false, true])("resumes the same native identity with a valid new invitation (cookie lost: %s)", async lost => {
    await env.DB.exec(`CREATE TRIGGER interrupt_registration AFTER INSERT ON account BEGIN ${invalidate}; END;`);
    const first = await registerWithInvitation(env, input);
    expect(first.status).toBe("retry");
    await env.DB.exec("DROP TRIGGER interrupt_registration");
    const original = await env.DB.prepare('SELECT id FROM "user" WHERE username = ?').bind("recovering").first<string>("id");
    const credential = await env.DB.prepare("SELECT password FROM account WHERE userId = ?").bind(original).first<string>("password");
    const cookie = lost ? "" : `registration=${first.attemptToken}`;
    const before = await env.DB.prepare("SELECT * FROM registration_attempts ORDER BY id").all();
    expect((await http("/register", { ...input, invitationCode: replacement, password: "Wrong password" }, cookie)).status).not.toBe(200);
    expect((await env.DB.prepare("SELECT * FROM registration_attempts ORDER BY id").all()).results).toEqual(before.results);
    const resumed = await http("/register", { ...input, invitationCode: replacement }, cookie);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ status: "pending_verification", alreadyCompleted: false });
    expect(await env.DB.prepare('SELECT id, emailVerified FROM "user" WHERE username = ?').bind("recovering").first()).toEqual({ id: original, emailVerified: 0 });
    expect(await env.DB.prepare("SELECT password FROM account WHERE userId = ?").bind(original).first("password")).toBe(credential);
    expect(await env.DB.prepare("SELECT invited_by_user_id, registration_state FROM member_profiles WHERE user_id = ?").bind(original).first())
      .toEqual({ invited_by_user_id: "new-issuer", registration_state: "completed" });
    expect(await env.DB.prepare("SELECT used_by_user_id FROM invitations WHERE id = 'replacement'").first("used_by_user_id")).toBe(original);
    expect(await env.DB.prepare("SELECT used_by_user_id FROM invitations WHERE id = 'original'").first("used_by_user_id")).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE userId = ?").bind(original).first("n")).toBe(0);
  });
});
