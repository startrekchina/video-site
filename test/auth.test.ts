import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { createEmailVerificationToken } from "better-auth/api";
import { symmetricEncrypt, symmetricDecrypt } from "better-auth/crypto";
import { getMigrations } from "better-auth/db/migration";
import { createOTP } from "@better-auth/utils/otp";
import { createAuth } from "@/lib/auth.server";

const password = "Ｆｉｃｔｉｏｎａｌ 1701🚀";
const signupBody = { name: "Nova", username: "Nova.Test", email: "NOVA@example.test", password };
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const count = (table: "user" | "account" | "session") => env.DB.prepare(`SELECT count(*) AS n FROM "${table}"`).first<number>("n");

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unconfigured external request"); })); });
afterEach(() => { vi.unstubAllGlobals(); });

function siteverify(result: object = { success: true, hostname: "localhost", action: "auth" }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    return Response.json(result);
  }));
}

function post(auth: { handler: (request: Request) => Promise<Response>; options: { baseURL?: unknown } }, path: string, body: unknown, cookie = "", captchaToken = "fictional-captcha") {
  return auth.handler(new Request(`${auth.options.baseURL}/api/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Origin: String(auth.options.baseURL),
      "cf-connecting-ip": "192.0.2.10", "x-captcha-response": captchaToken, Cookie: cookie,
    },
    body: JSON.stringify(body),
  }));
}

async function signup(auth = createAuth(env), verified = true) {
  const result = await auth.api.signUpEmail({ body: signupBody });
  if (verified) await env.DB.prepare('UPDATE "user" SET emailVerified = 1 WHERE id = ?').bind(result.user.id).run();
  return result;
}

it("matches the locked native schema without automatic runtime migrations", async () => {
  const plan = await getMigrations(createAuth(env).options);
  expect(plan.toBeCreated).toEqual([]);
  expect(plan.toBeAdded).toEqual([]);
  expect(plan.toBeAddedIndexes).toEqual([]);
  expect(plan.schemaProblems).toEqual([]);
});

it("uses native username, Unicode password normalization, dates and no automatic session", async () => {
  const auth = createAuth(env);
  const result = await signup(auth, false);
  expect(result.user).toMatchObject({ username: "nova.test", displayUsername: "Nova.Test", email: "nova@example.test", emailVerified: false });
  expect(result.token).toBeNull();
  expect(await count("session")).toBe(0);
  const context = await auth.$context;
  const stored = await env.DB.prepare('SELECT password FROM account WHERE userId = ?').bind(result.user.id).first<string>("password");
  expect(stored).not.toContain(password);
  expect(await context.password.verify({ hash: stored!, password: "Fictional 1701🚀" })).toBe(true);
  const raw = await env.DB.prepare('SELECT createdAt, typeof(createdAt) AS storageType FROM "user"').first<{ createdAt: string; storageType: string }>();
  expect(raw?.storageType).toBe("text");
  expect(new Date(raw!.createdAt).toISOString()).toBe(result.user.createdAt.toISOString());
  siteverify();
  expect((await post(auth, "/sign-in/username", { username: "Nova.Test", password })).status).toBe(403);
});

it.each(["1234567", "x".repeat(129)])("rejects password lengths outside the native 8–128 range", async (invalidPassword) => {
  await expect(createAuth(env).api.signUpEmail({ body: { ...signupBody, password: invalidPassword } })).rejects.toBeDefined();
  expect(await count("user")).toBe(0);
});

it("accepts 30-character usernames with dots and rejects hyphens and case duplicates", async () => {
  const auth = createAuth(env);
  await signup(auth);
  await expect(auth.api.signUpEmail({ body: { ...signupBody, email: "other@example.test", username: "NOVA.TEST" } })).rejects.toBeDefined();
  await expect(auth.api.signUpEmail({ body: { ...signupBody, email: "other@example.test", username: "nova-test" } })).rejects.toBeDefined();
  expect((await auth.api.signUpEmail({ body: { ...signupBody, email: "other@example.test", username: "n.".repeat(15) } })).user.username).toHaveLength(30);
});

it("sets the deployed Host cookie, stores its native token and rolls sessions after a day", async () => {
  const auth = createAuth({ ...env, APP_ORIGIN: "https://localhost:6120", APP_ENV: "staging" });
  await signup(auth);
  siteverify();
  const login = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().find(value => value.startsWith("__Host-session="))!;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("Max-Age=2592000");
  expect(cookie).not.toMatch(/Domain=|__Secure-/i);
  const body = await login.json() as { token: string };
  expect(await env.DB.prepare('SELECT token FROM "session"').first<string>("token")).toBe(body.token);
  await env.DB.prepare('UPDATE "session" SET createdAt = ?, updatedAt = ?, expiresAt = ?')
    .bind(new Date(Date.now() - 200 * 86400000).toISOString(), new Date(Date.now() - 2 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString()).run();
  const refreshed = await auth.handler(new Request(`${auth.options.baseURL}/api/auth/get-session`, { headers: { Cookie: cookies(login), "cf-connecting-ip": "192.0.2.10" } }));
  const fresh = await refreshed.json() as { session: { expiresAt: string } };
  expect(new Date(fresh.session.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
  expect(refreshed.headers.getSetCookie().some(value => value.startsWith("__Host-session="))).toBe(true);
  await env.DB.prepare('UPDATE "session" SET expiresAt = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
  const expired = await auth.handler(new Request(`${auth.options.baseURL}/api/auth/get-session`, { headers: { Cookie: cookies(login) } }));
  expect(await expired.json()).toBeNull();
});

it("changes password with a new current session and revokes every old session", async () => {
  const auth = createAuth(env);
  await signup(auth);
  siteverify();
  const first = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  const second = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  const old = await first.clone().json() as { token: string };
  const changed = await post(auth, "/change-password", { currentPassword: password, newPassword: "Replacement 1701", revokeOtherSessions: true }, cookies(second));
  expect(changed.status).toBe(200);
  expect(await count("session")).toBe(1);
  expect(await env.DB.prepare('SELECT token FROM "session"').first<string>("token")).not.toBe(old.token);
  const revoked = await auth.handler(new Request(`${env.APP_ORIGIN}/api/auth/get-session`, { headers: { Cookie: cookies(first) } }));
  expect(await revoked.json()).toBeNull();
});

it("verifies one-hour email JWTs idempotently without logging in", async () => {
  const auth = createAuth(env);
  await signup(auth, false);
  const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, signupBody.email, undefined, 3600);
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp: number; iat: number };
  expect(payload.exp - payload.iat).toBe(3600);
  for (let i = 0; i < 2; i++) {
    const response = await auth.handler(new Request(`${env.APP_ORIGIN}/api/auth/verify-email?token=${token}`));
    expect(response.status).toBe(200);
  }
  expect(await env.DB.prepare('SELECT emailVerified FROM "user"').first<number>("emailVerified")).toBe(1);
  expect(await count("session")).toBe(0);
  const expired = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, signupBody.email, undefined, -1);
  for (const invalid of [expired, `${token.slice(0, -12)}invalidtoken`]) {
    expect((await auth.handler(new Request(`${env.APP_ORIGIN}/api/auth/verify-email?token=${invalid}`))).status).not.toBe(200);
  }
});

it("retains concurrent one-hour reset links and consumes only POST while revoking sessions", async () => {
  const links: string[] = [];
  const options = createAuth(env).options;
  const auth = betterAuth({ ...options, emailAndPassword: { ...options.emailAndPassword, sendResetPassword: async ({ url }) => { links.push(url); } } });
  const member = await auth.api.signUpEmail({ body: signupBody });
  await env.DB.prepare('UPDATE "user" SET emailVerified = 1 WHERE id = ?').bind(member.user.id).run();
  siteverify();
  await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  const known = await auth.api.requestPasswordReset({ body: { email: signupBody.email, redirectTo: `${env.APP_ORIGIN}/reset-password` } });
  const unknown = await auth.api.requestPasswordReset({ body: { email: "missing@example.test", redirectTo: `${env.APP_ORIGIN}/reset-password` } });
  expect(unknown).toEqual(known);
  await auth.api.requestPasswordReset({ body: { email: signupBody.email, redirectTo: `${env.APP_ORIGIN}/reset-password` } });
  expect(links).toHaveLength(2);
  const records = await env.DB.prepare('SELECT createdAt, expiresAt FROM verification WHERE identifier LIKE ?').bind("reset-password:%").all<{ createdAt: string; expiresAt: string }>();
  expect(records.results).toHaveLength(2);
  for (const row of records.results) expect(new Date(row.expiresAt).getTime() - new Date(row.createdAt).getTime()).toBeCloseTo(3600000, -2);
  const preview = await auth.handler(new Request(links[0]));
  expect(preview.status).toBe(302);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM verification WHERE identifier LIKE ?').bind("reset-password:%").first<number>("n"))).toBe(2);
  const token = new URL(links[0]).pathname.split("/").pop()!;
  expect((await post(auth, "/reset-password", { token, newPassword: "Replacement 1701" })).status).toBe(200);
  expect(await count("session")).toBe(0);
  expect((await post(auth, "/reset-password", { token, newPassword: "Replacement 1702" })).status).not.toBe(200);
  await env.DB.prepare('UPDATE verification SET expiresAt = ? WHERE identifier LIKE ?').bind(new Date(Date.now() - 1000).toISOString(), "reset-password:%").run();
  const expiredToken = new URL(links[1]).pathname.split("/").pop()!;
  expect((await post(auth, "/reset-password", { token: expiredToken, newPassword: "Replacement 1703" })).status).not.toBe(200);
});

it("persists IP/path limits across auth instances and ignores untrusted forwarding headers", async () => {
  for (let i = 0; i < 3; i++) expect((await post(createAuth(env), "/sign-in/username", {}, "", "")).status).toBe(400);
  const blocked = await post(createAuth(env), "/sign-in/username", {}, "", "");
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("X-Retry-After"))).toBeGreaterThan(0);
  const different = await createAuth(env).handler(new Request(`${env.APP_ORIGIN}/api/auth/sign-in/username`, { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "192.0.2.11", "x-forwarded-for": "192.0.2.10" }, body: "{}" }));
  expect(different.status).toBe(400);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM rateLimit').first<number>("n"))).toBe(2);
});

it.each([
  { success: true, hostname: "evil.example", action: "auth" },
  { success: true, hostname: "localhost", action: "other" },
  { success: false, "error-codes": ["timeout-or-duplicate"] },
])("rejects captcha from the wrong hostname/action or a reused token", async (verification) => {
  siteverify(verification);
  expect((await post(createAuth(env), "/sign-in/username", {})).status).toBe(403);
});

it("fails closed when captcha verification is unavailable", async () => {
  expect((await post(createAuth(env), "/sign-in/username", {})).status).toBe(500);
  expect(await count("session")).toBe(0);
});

it("keeps direct registration, email sign-in and extra OTP routes closed", async () => {
  for (const path of ["/sign-up/email", "/sign-in/email", "/two-factor/send-otp", "/two-factor/verify-otp", "/update-user", "/delete-user"]) {
    expect((await post(createAuth(env), path, {})).status).toBe(404);
  }
  expect((await post(createAuth(env), "/two-factor/verify-totp", { code: "123456", trustDevice: true })).status).toBe(400);
});

it("uses encrypted ten-code backup groups and consumes a backup code only once", async () => {
  const auth = createAuth(env);
  const member = await signup(auth);
  const seed = "fictional-totp-seed-for-test";
  await env.DB.prepare('UPDATE "user" SET twoFactorEnabled = 1 WHERE id = ?').bind(member.user.id).run();
  await (await auth.$context).adapter.create({ model: "twoFactor", data: {
    secret: await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: seed }), backupCodes: "[]", userId: member.user.id, verified: true,
  } });
  siteverify();
  const pending = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  expect(await pending.clone().json()).toMatchObject({ twoFactorRedirect: true });
  expect(await count("session")).toBe(0);
  const verified = await post(auth, "/two-factor/verify-totp", { code: await createOTP(seed).totp() }, cookies(pending));
  expect(verified.status).toBe(200);
  const generated = await post(auth, "/two-factor/generate-backup-codes", { password }, cookies(verified));
  const codes = (await generated.json() as { backupCodes: string[] }).backupCodes;
  expect(codes).toHaveLength(10);
  const stored = await env.DB.prepare('SELECT backupCodes FROM twoFactor').first<string>("backupCodes");
  expect(stored).not.toContain(codes[0]);
  expect(JSON.parse(await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: stored! }))).toEqual(codes);
  const second = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  expect((await post(auth, "/two-factor/verify-backup-code", { code: codes[0] }, cookies(second))).status).toBe(200);
  const third = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  expect((await post(auth, "/two-factor/verify-backup-code", { code: codes[0] }, cookies(third))).status).not.toBe(200);
});

it("retains account failure counts across five-attempt challenges and locks after ten", async () => {
  const auth = createAuth(env);
  const member = await signup(auth);
  await env.DB.prepare('UPDATE "user" SET twoFactorEnabled = 1 WHERE id = ?').bind(member.user.id).run();
  await (await auth.$context).adapter.create({ model: "twoFactor", data: {
    secret: await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: "fictional-totp-seed" }), backupCodes: "[]", userId: member.user.id, verified: true,
  } });
  siteverify();
  for (let challenge = 0; challenge < 2; challenge++) {
    const pending = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await post(auth, "/two-factor/verify-totp", { code: "xxxxxx" }, cookies(pending))).status).toBe(401);
      // Avoid the independent 3/10s endpoint limit while exercising the account/challenge limits.
      await env.DB.prepare('DELETE FROM rateLimit').run();
    }
    expect((await post(auth, "/two-factor/verify-totp", { code: "xxxxxx" }, cookies(pending))).status).not.toBe(200);
    await env.DB.prepare('DELETE FROM rateLimit').run();
  }
  const row = await env.DB.prepare('SELECT failedVerificationCount, lockedUntil FROM twoFactor').first<{ failedVerificationCount: number; lockedUntil: string }>();
  expect(row?.failedVerificationCount).toBe(10);
  expect(new Date(row!.lockedUntil).getTime() - Date.now()).toBeGreaterThan(14 * 60000);
});

it("observes partial D1 signup failure without reporting atomic success", async () => {
  await env.DB.exec("CREATE TRIGGER reject_native_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'Injected account failure'); END;");
  await expect(createAuth(env).api.signUpEmail({ body: signupBody })).rejects.toBeDefined();
  expect(await count("user")).toBe(1);
  expect(await count("account")).toBe(0);
  expect(await count("session")).toBe(0);
});

it("rejects cross-origin writes without revoking the valid session", async () => {
  const auth = createAuth(env);
  await signup(auth);
  siteverify();
  const login = await post(auth, "/sign-in/username", { username: "Nova.Test", password });
  const response = await auth.handler(new Request(`${env.APP_ORIGIN}/api/auth/sign-out`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: cookies(login), "Sec-Fetch-Site": "cross-site" }, body: "{}",
  }));
  expect(response.status).toBe(403);
  expect(await count("session")).toBe(1);
});

it("requires unique credential IDs and an existing native user", async () => {
  const member = await signup();
  const insert = (id: string, userId: string) => env.DB.prepare('INSERT INTO passkey (id, publicKey, userId, credentialID, counter, deviceType, backedUp) VALUES (?, ?, ?, ?, 0, ?, 0)')
    .bind(id, "fictional-public-key", userId, "fictional-credential", "singleDevice").run();
  await expect(insert("unknown", "missing")).rejects.toBeDefined();
  await insert("first", member.user.id);
  await expect(insert("duplicate", member.user.id)).rejects.toBeDefined();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM passkey').first<number>("n")).toBe(1);
});

it("rejects invalid or reused secrets, HTTP deployments and mismatched RP IDs", () => {
  for (const invalid of [
    { BETTER_AUTH_SECRET: "" }, { BETTER_AUTH_SECRET: "short" },
    { PLAYBACK_HMAC_KEY: env.BETTER_AUTH_SECRET }, { BACKUP_ENCRYPTION_KEY: env.BETTER_AUTH_SECRET },
    { APP_ENV: "production" }, { WEBAUTHN_RP_ID: "wrong.example" }, { TURNSTILE_SECRET_KEY: "" },
  ]) expect(() => createAuth({ ...env, ...invalid })).toThrow();
});
