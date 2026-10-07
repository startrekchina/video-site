import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmailVerificationToken } from "better-auth/api";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricDecrypt } from "better-auth/crypto";
import { createAuth } from "@/lib/auth.server";
import { sha256 } from "@/lib/registration.server";
import { reserveMail, deliverMail, finishUnsentMail } from "@/lib/mail.server";
import { authHttp } from "@/lib/auth-http.server";
import { cookies, csrf, http, login, member, password, request } from "./fixtures/auth";

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
async function invite(code = "fictional-invitation") {
  await env.DB.prepare("INSERT INTO invitations (id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), await sha256(code), Date.now(), Date.now() + 86400000).run();
  return code;
}

it("protects both registration paths with origin, CSRF, captcha and persistent IP limits", async () => {
  const code = await invite(); const anti = await csrf();
  const body = { username: "Nova", email: "nova@example.test", password, invitationCode: code, csrfToken: anti.token };
  expect((await http("/register", body, anti.cookie, { Origin: "https://evil.invalid" })).status).toBe(403);
  expect((await http("/register", { ...body, csrfToken: "0".repeat(64) }, anti.cookie)).status).toBe(403);
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
  const anti = await csrf();
  const response = await http("/register", { username: "Nova", email: "NOVA@example.test", password, invitationCode: await invite(), csrfToken: anti.token }, anti.cookie);
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
  expect((await http(`/verify-email?token=${token}`)).status).toBe(403);
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
  await expect(authHttp(new Request(links[0], { headers: { Cookie: other } }), env)).resolves.toHaveProperty("status", 403);
  const resumed = await authHttp(request("/account/email-confirm", undefined, cookies(needsLogin, cookie)), env);
  expect(resumed.status).toBe(302); expect(resumed.headers.getSetCookie().join(";")).toContain("Max-Age=0");
  expect(await env.DB.prepare('SELECT email, emailVerified FROM "user" WHERE id = ?').bind(nova.id).first()).toEqual({ email: "replacement@example.test", emailVerified: 1 });
  expect((await authHttp(new Request(links[0], { headers: { Cookie: cookie } }), env)).status).toBe(403);
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
  await member(); const anti = await csrf(); const invitationCode = await invite();
  const body = { username: "Nova", email: "other@example.test", password, invitationCode, csrfToken: anti.token };
  const failed = await http("/register", body, anti.cookie); expect(failed.status).toBe(400);
  const result = await http("/register", { ...body, username: "Other" }, cookies(failed, anti.cookie));
  expect(result.status).toBe(200);
  const completed = await result.clone().json();
  const replay = await http("/register", { ...body, username: "Other" }, cookies(result, anti.cookie));
  expect(await replay.json()).toMatchObject({ alreadyCompleted: true }); expect(completed).not.toHaveProperty("attemptToken");
  expect(links).toHaveLength(1); expect(await count("member_profiles")).toBe(2);
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
