import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createAuth, TEST_ORIGIN } from "../src/auth.ts";

const signupBody = { name: "Nova", username: "Nova", email: "nova@example.test", password: "Fictional_1701" };
const signup = (auth: ReturnType<typeof createAuth>) => auth.api.signUpEmail({ body: signupBody });
const count = (table: string) => env.DB.prepare(`SELECT count(*) AS n FROM "${table}"`).first<number>("n");

it("leaves a user behind when D1 account creation fails during signup", async () => {
  await env.DB.exec(`CREATE TRIGGER reject_account BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'Injected account failure'); END;`);
  await expect(signup(createAuth(env.DB))).rejects.toBeDefined();
  expect(await count("user")).toBe(1);
  expect(await count("account")).toBe(0);
});

it("can set exact host-cookie attributes but stores the bearer token in cleartext", async () => {
  const auth = createAuth(env.DB);
  await signup(auth);
  const response = await auth.api.signInUsername({ body: { username: "Nova", password: signupBody.password }, asResponse: true });
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("__Host-session="))!;
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).toMatch(/Path=\//i);
  expect(cookie).not.toMatch(/Domain=/i);
  const body = await response.json() as { token: string };
  expect(await env.DB.prepare('SELECT token FROM "session"').first<string>("token")).toBe(body.token);
});

it("consumes a reset token before a failing password write, leaving old sessions", async () => {
  const auth = createAuth(env.DB);
  const member = await signup(auth);
  await auth.api.signInUsername({ body: { username: "Nova", password: signupBody.password } });
  const context = await auth.$context;
  await context.internalAdapter.createVerificationValue({ identifier: "reset-password:fictional-reset", value: member.user.id, expiresAt: new Date(Date.now() + 60000) });
  const oldHash = await env.DB.prepare('SELECT password FROM "account"').first<string>("password");
  await env.DB.exec(`CREATE TRIGGER reject_password BEFORE UPDATE OF password ON account BEGIN SELECT RAISE(ABORT, 'Injected password failure'); END;`);
  await expect(auth.api.resetPassword({ body: { token: "fictional-reset", newPassword: "Replacement_1701" } })).rejects.toBeDefined();
  expect(await count("verification")).toBe(0);
  expect(await count("session")).toBe(1);
  expect(await env.DB.prepare('SELECT password FROM "account"').first<string>("password")).toBe(oldHash);
});

it("atomically consumes one D1 verification value across concurrent calls", async () => {
  const context = await createAuth(env.DB).$context;
  await context.internalAdapter.createVerificationValue({ identifier: "fictional-challenge", value: "authentication:nova", expiresAt: new Date(Date.now() + 60000) });
  const results = await Promise.all([context.internalAdapter.consumeVerificationValue("fictional-challenge"), context.internalAdapter.consumeVerificationValue("fictional-challenge")]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await count("verification")).toBe(0);
});

it("rejects cross-origin cookie requests but does not require an anonymous CSRF token", async () => {
  const auth = createAuth(env.DB);
  const response = await auth.handler(new Request(`${TEST_ORIGIN}/api/auth/sign-up/email`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.example.test", Cookie: "fictional=1" }, body: JSON.stringify(signupBody),
  }));
  expect(response.status).toBe(403);
  const anonymous = await auth.handler(new Request(`${TEST_ORIGIN}/api/auth/sign-up/email`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN }, body: JSON.stringify(signupBody),
  }));
  expect(anonymous.status).toBe(200);
  expect((await auth.$context).options.rateLimit?.enabled).toBe(false);
});

it("refreshes a 179-day-old session beyond the absolute 180-day ceiling", async () => {
  const auth = createAuth(env.DB, { session: { expiresIn: 180 * 86400, updateAge: 86400 } });
  const member = await signup(auth);
  const context = await auth.$context;
  const old = Date.now() - 179 * 86400000;
  const session = await context.internalAdapter.createSession(member.user.id, false, { createdAt: new Date(old), updatedAt: new Date(old), expiresAt: new Date(Date.now() + 86400000) }, true);
  const headers = new Headers({ Origin: TEST_ORIGIN });
  // Use the cookie emitted by the library for this existing session.
  const login = await auth.api.signInUsername({ body: { username: "Nova", password: signupBody.password }, asResponse: true });
  const freshToken = (await login.json() as { token: string }).token;
  await context.internalAdapter.updateSession(freshToken, { createdAt: session!.createdAt, updatedAt: session!.updatedAt, expiresAt: session!.expiresAt });
  headers.set("Cookie", login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "));
  await auth.api.getSession({ headers });
  const refreshed = await context.internalAdapter.findSession(freshToken);
  expect(refreshed!.session.expiresAt.getTime()).toBeGreaterThan(old + 180 * 86400000);
});
