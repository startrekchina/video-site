import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmailVerificationToken } from "better-auth/api";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricDecrypt } from "better-auth/crypto";
import { createAuth } from "@/lib/auth.server";
import { sha256 } from "@/lib/registration.server";
import { reserveMail, deliverMail, finishUnsentMail } from "@/lib/mail.server";
import { authHttp } from "@/lib/auth-http.server";
import { cookies, http, login, member, password, request } from "./fixtures/auth";

let links: string[];
let postalStatus: "success" | "error" | "timeout";
beforeEach(() => {
  links = []; postalStatus = "success";
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/siteverify")) return Response.json({ success: true, hostname: "localhost", action: "auth" });
    const body = JSON.parse(String(init?.body)) as { plain_body: string };
    const link = body.plain_body.match(/https?:\/\/[^\s]+/); if (link) links.push(link[0]);
    if (postalStatus === "timeout") throw new Error("Fictional connection failure");
    return Response.json(postalStatus === "success" ? { status: "success", data: { message_id: "fictional-message" } } : { status: "error", data: { code: "AccessDenied" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const count = (table: string) => env.DB.prepare(`SELECT count(*) AS n FROM "${table}"`).first<number>("n");

it("shares a 60-second change-email cooldown across target addresses while keeping recipient quotas", async () => {
  const user = await member("Sender"), cookie = await login("Sender"), now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const change = (newEmail: string) => http("/change-email", { newEmail, callbackURL: `${env.APP_ORIGIN}/verify-email` }, cookie);
  const responses = await Promise.all([change("alias-one@example.test"), change("alias-two@example.test")]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 429]);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM email_deliveries WHERE user_id = ? AND purpose = 'email_change_verification'").bind(user.id).first<number>("n")).toBe(1);
  clock.mockReturnValue(now + 60000); expect((await change("alias-three@example.test")).status).toBe(200);
  const another = await member("Another");
  expect(await reserveMail(env, "independent@example.test", "email_change_verification", another.id)).toMatchObject({ purpose: "email_change_verification" });
  await expect(reserveMail(env, "alias-three@example.test", "email_change_verification", another.id)).rejects.toMatchObject({ statusCode: 429 });
});

it("limits a member to 30 change-email reservations per rolling hour, including failed sends", async () => {
  const user = await member("Sender"), now = Date.now();
  await env.DB.batch(Array.from({ length: 30 }, (_, index) => env.DB.prepare(`INSERT INTO email_deliveries
    (id, user_id, to_email_key, purpose, status, error_code, created_at) VALUES (?, ?, ?, 'email_change_verification', 'failed', 'EMAIL_SEND_FAILED', ?)`)
    .bind(crypto.randomUUID(), user.id, `fictional-${index}`, now - (index + 1) * 61000)));
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  await expect(reserveMail(env, "fresh@example.test", "email_change_verification", user.id)).rejects.toMatchObject({ statusCode: 429 });
  expect(await count("email_deliveries")).toBe(30);
  clock.mockReturnValue(now + 3600000 - 30 * 61000);
  expect(await reserveMail(env, "fresh@example.test", "email_change_verification", user.id)).toMatchObject({ purpose: "email_change_verification" });
  expect(await count("email_deliveries")).toBe(31);
});
async function invite(code = "fictional-invitation") {
  await env.DB.prepare("INSERT INTO invitations (id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), await sha256(code), Date.now(), Date.now() + 86400000).run();
  return code;
}

it("protects both registration paths with origin, JSON-only bodies, captcha and persistent IP limits", async () => {
  const code = await invite(); const anti = { cookie: "" };
  const body = { username: "Nova", email: "nova@example.test", password, invitationCode: code };
  expect((await http("/register", body, anti.cookie, { Origin: "https://evil.invalid" })).status).toBe(403);
  expect((await http("/register", body, anti.cookie, { "Sec-Fetch-Site": "same-site" })).status).toBe(403);
  for (const type of ["text/plain", "application/x-www-form-urlencoded"]) expect((await http("/register", body, anti.cookie, { "Content-Type": type })).status).toBe(415);
  expect((await http("/register", body, anti.cookie, { "x-captcha-response": "" })).status).toBe(400);
  expect(await count("registration_attempts")).toBe(0);
  for (let i = 0; i < 3; i++) {
    expect((await http("/register", {}, anti.cookie, { "cf-connecting-ip": "192.0.2.250", "x-captcha-response": "" })).status).toBe(400);
  }
  const blocked = await authHttp(request("/auth/register", body, anti.cookie, { "cf-connecting-ip": "192.0.2.250" }), env);
  expect(blocked.status).toBe(429); expect(Number(blocked.headers.get("X-Retry-After"))).toBeGreaterThan(0);
  for (const path of ["/sign-up/email", "/sign-in/email", "/update-user", "/list-sessions", "/revoke-session", "/delete-user", "/two-factor/send-otp"]) expect((await http(path, body)).status).toBe(404);
});

it.each(["success", "error", "timeout"] as const)("retains completed registration after Postal %s and grants access only after verification", async status => {
  postalStatus = status;
  const anti = { cookie: "" };
  const response = await http("/register", { username: "Nova", email: "NOVA@example.test", password, invitationCode: await invite() }, anti.cookie);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "pending_verification", delivery: status === "success" ? "accepted" : status === "error" ? "failed" : "unknown" });
  expect(cookies(response)).not.toContain("session="); expect(await count("member_profiles")).toBe(1);
  expect(await count("session")).toBe(0);
  expect((await http("/sign-in/username", { username: "Nova", password })).status).toBe(403);
  expect(links).toHaveLength(1);
  for (let i = 0; i < 2; i++) expect((await authHttp(new Request(links[0], { headers: { "Sec-Fetch-Site": "cross-site" } }), env)).status).toBe(302);
  expect(await count("session")).toBe(0);
  expect((await http("/sign-in/username", { username: "Nova", password })).status).toBe(200);
});

it("does not verify or log in orphaned or banned identities through any auth entry", async () => {
  const orphan = (await createAuth(env).api.signUpEmail({ body: { name: "Orphan", username: "Orphan", email: "orphan@example.test", password } })).user;
  await env.DB.prepare('UPDATE "user" SET emailVerified = 1 WHERE id = ?').bind(orphan.id).run();
  expect((await http("/sign-in/username", { username: "Orphan", password })).status).toBe(403);
  const user = await member(); const cookie = await login();
  await env.DB.prepare("UPDATE member_profiles SET status = 'banned' WHERE user_id = ?").bind(user.id).run();
  expect(await count("session")).toBe(0);
  expect((await http("/sign-in/username", { username: "Nova", password })).status).toBe(403);
  expect(await (await http("/get-session", undefined, cookie)).json()).toBeNull();
  const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, user.email, undefined, 3600);
  const refused = await http(`/verify-email?token=${token}`);
  expect(refused.status).toBe(302); expect(refused.headers.get("Location")).toBe(`${env.APP_ORIGIN}/verify-email?error=INVALID_TOKEN`);
  expect((await http("/two-factor/enable", { password }, cookie)).status).toBe(401);
  expect((await http("/passkey/generate-register-options", undefined, cookie)).status).toBe(401);
  expect((await http("/request-password-reset", { email: orphan.email, redirectTo: `${env.APP_ORIGIN}/reset-password` })).status).toBe(200);
  expect(links).toHaveLength(0);
});

it("shares exact verification quotas, counts failures and unknown email, and admits one concurrent send", async () => {
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => reserveMail(env, "NOVA@example.test", "verification_resend")));
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  await expect(reserveMail(env, "nova@example.test", "email_change_verification")).rejects.toMatchObject({ statusCode: 429 });
  const reset = await reserveMail(env, "nova@example.test", "password_reset"); await finishUnsentMail(env, reset);
  expect(await env.DB.prepare("SELECT status FROM email_deliveries WHERE id = ?").bind(reset.id).first<string>("status")).toBe("failed");
  for (let i = 1; i < 5; i++) {
    await env.DB.prepare("UPDATE email_deliveries SET created_at = created_at - 61000").run();
    await finishUnsentMail(env, await reserveMail(env, "nova@example.test", "registration_verification"));
  }
  await env.DB.prepare("UPDATE email_deliveries SET created_at = created_at - 61000").run();
  await expect(reserveMail(env, "nova@example.test", "verification_resend")).rejects.toMatchObject({ statusCode: 429 });
  const unknown = { email: "unknown@example.test", redirectTo: `${env.APP_ORIGIN}/reset-password` };
  const first = await http("/request-password-reset", unknown); expect(first.status).toBe(200);
  const limited = await http("/request-password-reset", unknown); expect(limited.status).toBe(429); expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  const notification = await reserveMail(env, "nova@example.test", "admin_notification");
  await deliverMail(env, notification, "Fictional notification"); await deliverMail(env, notification, "Fictional duplicate");
  expect(fetch).toHaveBeenCalledTimes(3); // Two captcha validations and one actual notification.
});

it("requires the original member session to replace email and preserves the old address until verification", async () => {
  const nova = await member(); await member("Quinn"); const cookie = await login(); const other = await login("Quinn");
  const changed = await http("/change-email", { newEmail: "replacement@example.test", callbackURL: `${env.APP_ORIGIN}/verify-email` }, cookie);
  expect(changed.status).toBe(200); expect(links).toHaveLength(1);
  expect(await env.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(nova.id).first<string>("email")).toBe(nova.email);
  const needsLogin = await authHttp(new Request(links[0]), env);
  expect(needsLogin.status).toBe(302); expect(needsLogin.headers.get("Location")).toBe(`${env.APP_ORIGIN}/login?next=/account/email-confirm`);
  expect(needsLogin.headers.get("Location")).not.toContain("token="); expect(needsLogin.headers.getSetCookie()[0]).toContain("HttpOnly");
  const wrongAccount = `${env.APP_ORIGIN}/verify-email?error=EMAIL_CHANGE_ACCOUNT`;
  const foreign = await authHttp(new Request(links[0], { headers: { Cookie: other } }), env);
  expect(foreign.status).toBe(302); expect(foreign.headers.get("Location")).toBe(wrongAccount);
  const missing = await authHttp(request("/account/email-confirm"), env);
  expect(missing.status).toBe(303); expect(missing.headers.get("Location")).toBe(`${env.APP_ORIGIN}/verify-email?error=INVALID_TOKEN`);
  const resumed = await authHttp(request("/account/email-confirm", undefined, cookies(needsLogin, cookie)), env);
  expect(resumed.status).toBe(302); expect(resumed.headers.getSetCookie().join(";")).toContain("Max-Age=0");
  expect(await env.DB.prepare('SELECT email, emailVerified FROM "user" WHERE id = ?').bind(nova.id).first()).toEqual({ email: "replacement@example.test", emailVerified: 1 });
  const reused = await authHttp(new Request(links[0], { headers: { Cookie: cookie } }), env);
  expect(reused.status).toBe(302); expect(reused.headers.get("Location")).toBe(wrongAccount);
});

it("checks reset GET without consumption and revokes old sessions in the password write even if native cleanup later fails", async () => {
  const user = await member(); const cookie = await login();
  expect((await http("/request-password-reset", { email: user.email, redirectTo: `${env.APP_ORIGIN}/reset-password` })).status).toBe(200);
  const token = new URL(links[0]).pathname.split("/").pop()!;
  expect((await authHttp(new Request(links[0], { headers: { "Sec-Fetch-Site": "cross-site" } }), env)).status).toBe(302);
  expect(await count("verification")).toBe(1);
  const original = env.DB.prepare.bind(env.DB);
  let injected = false;
  vi.spyOn(env.DB, "prepare").mockImplementation(sql => {
    if (!injected && /^delete\s+from\s+["`]?session["`]?\s/i.test(sql)) { injected = true; throw new Error("Fictional cleanup failure"); }
    return original(sql);
  });
  const reset = await http("/reset-password", { token, newPassword: "Replacement 1701" });
  expect(injected).toBe(true); expect(reset.status).toBe(500); expect(await count("session")).toBe(0);
  const hash = await env.DB.prepare("SELECT password FROM account WHERE userId = ?").bind(user.id).first<string>("password");
  expect(await (await createAuth(env).$context).password.verify({ hash: hash!, password: "Replacement 1701" })).toBe(true);
  expect(await (await http("/get-session", undefined, cookie)).json()).toBeNull();
  expect((await http("/reset-password", { token, newPassword: "Replacement 1702" })).status).not.toBe(200);
});

it("reports a consumed reset link after a failed password write without claiming rollback", async () => {
  const user = await member(); await login();
  await http("/request-password-reset", { email: user.email, redirectTo: `${env.APP_ORIGIN}/reset-password` });
  const token = new URL(links[0]).pathname.split("/").pop()!;
  await env.DB.prepare("CREATE TRIGGER fictional_password_failure BEFORE UPDATE OF password ON account BEGIN SELECT RAISE(ABORT, 'Fictional password failure'); END").run();
  expect((await http("/reset-password", { token, newPassword: "Replacement 1701" })).status).toBe(500);
  expect(await count("verification")).toBe(0); expect(await count("session")).toBe(1);
  await env.DB.prepare("DROP TRIGGER fictional_password_failure").run();
  expect((await http("/reset-password", { token, newPassword: "Replacement 1701" })).status).toBe(400);
  const hash = await env.DB.prepare("SELECT password FROM account WHERE userId = ?").bind(user.id).first<string>("password");
  expect(await (await createAuth(env).$context).password.verify({ hash: hash!, password })).toBe(true);
});

it("rejects malformed redirects, cross-site option requests and oversized chunked payloads", async () => {
  expect((await http("/request-password-reset", { email: "nova@example.test", redirectTo: "https://evil.invalid" })).status).toBe(403);
  expect((await http("/request-password-reset", { email: "nova@example.test", redirectTo: "http://[" })).status).toBeGreaterThanOrEqual(400);
  expect((await http("/passkey/generate-authenticate-options", undefined, "", { "Sec-Fetch-Site": "same-site" })).status).toBe(403);
  expect((await http("/register", { huge: "x".repeat(70000) })).status).toBe(413);
  expect(await count("email_deliveries")).toBe(0);
});

it("requests required UV on native passkey authentication options", async () => {
  const result = await http("/passkey/generate-authenticate-options");
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ userVerification: "required", rpId: "localhost" });
});

it("preserves the rolling session cookie when membership checks read the native session first", async () => {
  const user = await member(); const cookie = await login();
  const old = Date.now() - 2 * 86400000;
  await env.DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ? WHERE userId = ?")
    .bind(new Date(old).toISOString(), new Date(old + 30 * 86400000).toISOString(), user.id).run();
  const result = await http("/get-session", undefined, cookie);
  expect(result.status).toBe(200);
  expect(result.headers.getSetCookie().join(";")).toContain("Max-Age=2592000");
  const session = await result.json() as { session: { expiresAt: string } };
  expect(new Date(session.session.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
});

it("never lets a pre-hook renewal replace the fresh cookie issued by a password change", async () => {
  const user = await member(); const cookie = await login();
  const oldId = await env.DB.prepare("SELECT id FROM session WHERE userId = ?").bind(user.id).first<string>("id");
  const old = Date.now() - 2 * 86400000;
  await env.DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ? WHERE userId = ?")
    .bind(new Date(old).toISOString(), new Date(old + 30 * 86400000).toISOString(), user.id).run();
  const changed = await http("/change-password", { currentPassword: password, newPassword: "Replacement 1701", revokeOtherSessions: true }, cookie);
  expect(changed.status).toBe(200);
  const result = await (await http("/get-session", undefined, cookies(changed, cookie))).json() as { session: { id: string; createdAt: string } };
  expect(result.session.id).not.toBe(oldId); expect(Date.now() - new Date(result.session.createdAt).getTime()).toBeLessThan(10000);
  expect(await count("session")).toBe(1);
});

it("lets a failed registration correct input and retry without claiming an existing identity", async () => {
  await member(); const anti = { cookie: "" }; const invitationCode = await invite();
  const body = { username: "Nova", email: "other@example.test", password, invitationCode };
  const failed = await http("/register", body, anti.cookie); expect(failed.status).toBe(400);
  const result = await http("/register", { ...body, username: "Other" }, cookies(failed, anti.cookie));
  expect(result.status).toBe(200);
  const completed = await result.clone().json();
  const replay = await http("/register", { ...body, username: "Other" }, cookies(result, anti.cookie));
  expect(await replay.json()).toMatchObject({ alreadyCompleted: true }); expect(completed).not.toHaveProperty("attemptToken");
  expect(links).toHaveLength(1); expect(await count("member_profiles")).toBe(2);
});

it("starts a new attempt with a replacement invitation after native user creation fails", async () => {
  const anti = { cookie: "" };
  const body = { username: "Nova", email: "nova@example.test", password, invitationCode: await invite() };
  await env.DB.exec('CREATE TRIGGER reject_registration BEFORE INSERT ON "user" BEGIN SELECT RAISE(ABORT, \'Injected user creation failure\'); END;');
  const failed = await http("/register", body, anti.cookie); expect(failed.status).toBeGreaterThanOrEqual(400);
  const failedCookie = cookies(failed, anti.cookie); expect(failedCookie).not.toBe(anti.cookie);
  expect(await env.DB.prepare("SELECT state FROM registration_attempts").first<string>("state")).toBe("failed");
  expect(await count("user")).toBe(0);
  await env.DB.exec("DROP TRIGGER reject_registration;");
  const nextBody = { ...body, invitationCode: await invite("fictional-replacement-invitation") };
  const next = await http("/register", nextBody, failedCookie);
  expect(next.status).toBe(200); expect(await next.json()).toMatchObject({ status: "pending_verification", alreadyCompleted: false });
  expect(cookies(next, failedCookie)).not.toBe(failedCookie);
  expect(await count("registration_attempts")).toBe(2); expect(await count("member_profiles")).toBe(1); expect(links).toHaveLength(1);
  expect(await env.DB.prepare("SELECT used_by_user_id FROM invitations WHERE code_hash = ?").bind(await sha256(body.invitationCode)).first())
    .toEqual({ used_by_user_id: null });
  expect(await env.DB.prepare("SELECT used_by_user_id FROM invitations WHERE code_hash = ?").bind(await sha256(nextBody.invitationCode)).first<string>("used_by_user_id"))
    .toBe(await env.DB.prepare('SELECT id FROM "user"').first<string>("id"));
});

it("starts another registration after a completed attempt in the same browser and preserves replay", async () => {
  const anti = { cookie: "" };
  const firstBody = { username: "Nova", email: "nova@example.test", password, invitationCode: await invite() };
  const first = await http("/register", firstBody, anti.cookie); expect(first.status).toBe(200);
  const firstCookie = cookies(first, anti.cookie);
  const nextBody = { ...firstBody, username: "Quinn", email: "quinn@example.test", invitationCode: await invite("fictional-next-invitation") };
  const next = await http("/register", nextBody, firstCookie); expect(next.status).toBe(200);
  const nextCookie = cookies(next, firstCookie); expect(nextCookie).not.toBe(firstCookie);
  const replay = await http("/register", nextBody, nextCookie);
  expect(await replay.json()).toMatchObject({ alreadyCompleted: true });
  expect(await count("member_profiles")).toBe(2); expect(await count("registration_attempts")).toBe(2); expect(links).toHaveLength(2);
});

it("validates a changed invitation independently of the completed registration cookie", async () => {
  const anti = { cookie: "" };
  const body = { username: "Nova", email: "nova@example.test", password, invitationCode: await invite() };
  const first = await http("/register", body, anti.cookie); expect(first.status).toBe(200);
  const invitationCode = await invite("fictional-next-invitation");
  const next = await http("/register", { ...body, invitationCode }, cookies(first, anti.cookie));
  expect(next.status).toBe(400); expect(await next.json()).not.toMatchObject({ code: "REGISTRATION_ATTEMPT_INVALID" });
  expect(await count("registration_attempts")).toBe(2); expect(await count("member_profiles")).toBe(1);
  expect(await env.DB.prepare("SELECT used_by_user_id FROM invitations WHERE code_hash = ?").bind(await sha256(invitationCode)).first())
    .toEqual({ used_by_user_id: null });
});

it("binds and verifies TOTP, requires the second factor and consumes backup codes exactly once", async () => {
  await member(); const cookie = await login();
  expect((await http("/two-factor/enable", { password: "Wrong password" }, cookie)).status).not.toBe(200);
  const enabled = await http("/two-factor/enable", { password }, cookie);
  expect(enabled.status).toBe(200);
  const setup = await enabled.json() as { totpURI: string; backupCodes: string[] };
  expect(setup.backupCodes).toHaveLength(10);
  const encrypted = await env.DB.prepare("SELECT secret FROM twoFactor").first<string>("secret");
  const secret = await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: encrypted! });
  const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
  const verified = await http("/two-factor/verify-totp", { code, trustDevice: false }, cookies(enabled, cookie));
  const verificationResult = await verified.clone().json() as { code?: string; message?: string };
  expect(verificationResult.code).toBeUndefined(); expect(verified.status).toBe(200);
  await http("/sign-out", {}, cookies(verified, cookie));
  const pending = await http("/sign-in/username", { username: "Nova", password });
  expect(await pending.clone().json()).toMatchObject({ twoFactorRedirect: true });
  expect(await count("session")).toBe(0);
  const complete = await http("/two-factor/verify-backup-code", { code: setup.backupCodes[0], trustDevice: false }, cookies(pending));
  expect(complete.status).toBe(200); expect(await count("session")).toBe(1);
  const owner = await env.DB.prepare('SELECT id FROM "user" WHERE username = ?').bind("nova").first<string>("id");
  expect((await createAuth(env).api.viewBackupCodes({ body: { userId: owner! } })).backupCodes).toHaveLength(9);
  expect((await http("/two-factor/view-backup-codes", { userId: owner }, cookies(complete))).status).toBe(404);
  const another = await http("/sign-in/username", { username: "Nova", password });
  expect((await http("/two-factor/verify-backup-code", { code: setup.backupCodes[0] }, cookies(another))).status).not.toBe(200);
  expect((await http("/two-factor/verify-backup-code", { code: setup.backupCodes[1], trustDevice: true }, cookies(another))).status).toBe(400);
  await env.DB.prepare("UPDATE member_profiles SET status = 'banned'").run();
  expect((await http("/two-factor/verify-backup-code", { code: setup.backupCodes[1] }, cookies(another))).status).toBe(403);
  expect(await count("session")).toBe(0);
});

async function enableTotp(cookie: string) {
  const enabled = await http("/two-factor/enable", { password }, cookie);
  const { backupCodes } = await enabled.json() as { backupCodes: string[] };
  const secret = await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: (await env.DB.prepare("SELECT secret FROM twoFactor").first<string>("secret"))! });
  const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
  const verified = await http("/two-factor/verify-totp", { code, trustDevice: false }, cookies(enabled, cookie));
  expect(verified.status).toBe(200);
  // Enabling replaces the session, so later member requests need the reissued cookie.
  return { codes: backupCodes, cookie: cookies(verified, cookies(enabled, cookie)) };
}

it("keeps a backup code consumed when the session write fails and admits a new sign-in with another code", async () => {
  const user = await member(); const { codes } = await enableTotp(await login());
  const pending = await http("/sign-in/username", { username: "Nova", password });
  await env.DB.prepare("CREATE TRIGGER fictional_session_failure BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'Fictional session failure'); END").run();
  const failed = await http("/two-factor/verify-backup-code", { code: codes[0] }, cookies(pending));
  expect(failed.status).toBe(500); expect(await count("session")).toBe(1);
  expect((await createAuth(env).api.viewBackupCodes({ body: { userId: user.id } })).backupCodes).toEqual(codes.slice(1));
  await env.DB.prepare("DROP TRIGGER fictional_session_failure").run();
  expect((await http("/two-factor/verify-backup-code", { code: codes[1] }, cookies(failed, cookies(pending)))).status).not.toBe(200);
  const again = await http("/sign-in/username", { username: "Nova", password });
  expect((await http("/two-factor/verify-backup-code", { code: codes[0] }, cookies(again))).status).not.toBe(200);
  expect((await http("/two-factor/verify-backup-code", { code: codes[1] }, cookies(again))).status).toBe(200);
  expect(await count("session")).toBe(2);
});

it("keeps TOTP, passkeys and unused backup codes after an email password reset", async () => {
  const user = await member(); const { codes } = await enableTotp(await login());
  await env.DB.prepare(`INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
    VALUES ('fictional-passkey', 'Fictional key', 'fictional-public-key', ?, 'fictional-credential', 0, 'singleDevice', 0, ?)`).bind(user.id, new Date().toISOString()).run();
  expect((await http("/request-password-reset", { email: user.email, redirectTo: `${env.APP_ORIGIN}/reset-password` })).status).toBe(200);
  expect((await http("/reset-password", { token: new URL(links[0]).pathname.split("/").pop()!, newPassword: "Replacement 1701" })).status).toBe(200);
  expect(await count("session")).toBe(0); expect(await count("passkey")).toBe(1);
  expect(await env.DB.prepare('SELECT twoFactorEnabled FROM "user" WHERE id = ?').bind(user.id).first("twoFactorEnabled")).toBe(1);
  expect((await createAuth(env).api.viewBackupCodes({ body: { userId: user.id } })).backupCodes).toEqual(codes);
  const pending = await http("/sign-in/username", { username: "Nova", password: "Replacement 1701" });
  expect(await pending.clone().json()).toMatchObject({ twoFactorRedirect: true }); expect(await count("session")).toBe(0);
  expect((await http("/two-factor/verify-backup-code", { code: codes[0] }, cookies(pending))).status).toBe(200);
});

it("replaces the whole backup code group when regenerated with the current password", async () => {
  await member(); const { codes: old, cookie } = await enableTotp(await login());
  expect((await http("/two-factor/generate-backup-codes", { password: "Wrong password" }, cookie)).status).not.toBe(200);
  const regenerated = await http("/two-factor/generate-backup-codes", { password }, cookie);
  expect(regenerated.status).toBe(200);
  const { backupCodes } = await regenerated.json() as { backupCodes: string[] };
  expect(backupCodes).toHaveLength(10); expect(backupCodes.filter(code => old.includes(code))).toEqual([]);
  const pending = await http("/sign-in/username", { username: "Nova", password });
  for (const code of [old[0], old[9]]) expect((await http("/two-factor/verify-backup-code", { code }, cookies(pending))).status).toBe(401);
  expect((await http("/two-factor/verify-backup-code", { code: backupCodes[0] }, cookies(pending))).status).toBe(200);
});

it("resends verification over HTTP once within the shared verification quota", async () => {
  const user = await member("Nova", false);
  const resend = () => http("/send-verification-email", { email: user.email, callbackURL: `${env.APP_ORIGIN}/verify-email` });
  await reserveMail(env, user.email, "registration_verification");
  const shared = await resend(); expect(shared.status).toBe(429); expect(Number(shared.headers.get("Retry-After"))).toBeGreaterThan(0);
  await env.DB.prepare("UPDATE email_deliveries SET created_at = created_at - 61000").run();
  expect((await resend()).status).toBe(200); expect(links).toHaveLength(1);
  expect((await resend()).status).toBe(429); expect(links).toHaveLength(1);
  expect((await env.DB.prepare("SELECT status FROM email_deliveries WHERE purpose = 'verification_resend'").all()).results).toEqual([{ status: "accepted" }]);
  expect((await authHttp(new Request(links[0]), env)).status).toBe(302);
  expect(await env.DB.prepare('SELECT emailVerified FROM "user" WHERE id = ?').bind(user.id).first("emailVerified")).toBe(1);
});

const changeEmail = (newEmail: string, cookie: string) => http("/change-email", { newEmail, callbackURL: `${env.APP_ORIGIN}/verify-email` }, cookie);
const emailOf = (id: string) => env.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(id).first<string>("email");

it("keeps current emails unique without letting a pending change reserve the address", async () => {
  const nova = await member(), quinn = await member("Quinn"); const cookie = await login(), other = await login("Quinn"), now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  expect((await changeEmail(quinn.email, cookie)).status).toBe(200); expect(links).toHaveLength(0);
  expect((await changeEmail("shared@example.test", other)).status).toBe(200);
  clock.mockReturnValue(now + 61000);
  expect((await changeEmail("shared@example.test", cookie)).status).toBe(200); expect(links).toHaveLength(2);
  expect((await authHttp(new Request(links[0], { headers: { Cookie: other } }), env)).status).toBe(302);
  expect(await emailOf(quinn.id)).toBe("shared@example.test");
  const conflict = await authHttp(new Request(links[1], { headers: { Cookie: cookie } }), env);
  expect(conflict.headers.get("Location")).not.toBe(`${env.APP_ORIGIN}/verify-email`);
  expect(await emailOf(nova.id)).toBe(nova.email); expect(await emailOf(quinn.id)).toBe("shared@example.test");
});

it("invalidates the other pending email changes once the first one completes", async () => {
  const nova = await member(); const cookie = await login(), now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  expect((await changeEmail("first@example.test", cookie)).status).toBe(200);
  clock.mockReturnValue(now + 61000);
  expect((await changeEmail("second@example.test", cookie)).status).toBe(200); expect(links).toHaveLength(2);
  const completed = await authHttp(new Request(links[1], { headers: { Cookie: cookie } }), env);
  expect(completed.status).toBe(302); expect(await emailOf(nova.id)).toBe("second@example.test");
  const stale = await authHttp(new Request(links[0], { headers: { Cookie: cookies(completed, cookie) } }), env);
  expect(stale.status).toBe(302); expect(stale.headers.get("Location")).toBe(`${env.APP_ORIGIN}/verify-email?error=EMAIL_CHANGE_ACCOUNT`);
  expect(await emailOf(nova.id)).toBe("second@example.test");
});
