import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { twoFactor, username } from "better-auth/plugins";
import { symmetricEncrypt, symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { createAuth, SPIKE_SECRET, TEST_ORIGIN } from "../src/auth.ts";

const password = "Fictional_1701";
const seed = "fictional-totp-seed-for-poc";
const cookies = (response: Response) => response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");

async function setup() {
  let transientSessions = 0;
  const auth = createAuth(env.DB, {
    plugins: [username(), twoFactor({ twoFactorCookieMaxAge: 300 })],
    databaseHooks: { session: { create: { after: async () => { transientSessions++; } } } },
  });
  const member = await auth.api.signUpEmail({ body: { name: "Nova", username: "Nova", email: "nova@example.test", password } });
  await env.DB.prepare('UPDATE "user" SET twoFactorEnabled = 1 WHERE id = ?').bind(member.user.id).run();
  await env.DB.prepare('INSERT INTO "twoFactor" (id, secret, backupCodes, userId, verified) VALUES (?, ?, ?, ?, 1)')
    .bind("fictional-factor", await symmetricEncrypt({ key: SPIKE_SECRET, data: seed }), "[]", member.user.id).run();
  const post = (path: string, body: unknown, cookie = "") => auth.handler(new Request(`${TEST_ORIGIN}/api/auth${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
  }));
  const login = () => post("/sign-in/username", { username: "Nova", password });
  return { auth, post, login, transientSessions: () => transientSessions };
}

it("allows the same TOTP time step on distinct login challenges and first creates transient sessions", async () => {
  const { post, login, transientSessions } = await setup();
  const first = await login();
  const second = await login();
  expect(await first.clone().json()).toMatchObject({ twoFactorRedirect: true });
  expect(transientSessions()).toBe(2);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM "session"').first<number>("n")).toBe(0);
  const code = await createOTP(seed).totp();
  const results = await Promise.all([
    post("/two-factor/verify-totp", { code }, cookies(first)),
    post("/two-factor/verify-totp", { code }, cookies(second)),
  ]);
  expect(results.map((response) => response.status)).toEqual([200, 200]);
  expect((await post("/two-factor/verify-totp", { code }, cookies(first))).status).not.toBe(200);
});

it("uses a five-attempt challenge, keeps account failures across new password stages, and permits trusted devices", async () => {
  const { post, login } = await setup();
  const first = await login();
  const validCode = await createOTP(seed).totp();
  const invalidCode = validCode === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++) expect((await post("/two-factor/verify-totp", { code: invalidCode }, cookies(first))).status).toBe(401);
  expect(await env.DB.prepare('SELECT failedVerificationCount FROM "twoFactor"').first<number>("failedVerificationCount")).toBe(5);
  const exhausted = await post("/two-factor/verify-totp", { code: validCode }, cookies(first));
  expect(exhausted.status).toBe(400);
  const fresh = await login();
  expect(await env.DB.prepare('SELECT failedVerificationCount FROM "twoFactor"').first<number>("failedVerificationCount")).toBe(5);
  const verified = await post("/two-factor/verify-totp", { code: validCode, trustDevice: true }, cookies(fresh));
  expect(verified.status).toBe(200);
  expect(verified.headers.getSetCookie().some((value) => value.includes("trust_device="))).toBe(true);
});

it("stores ten recoverable encrypted backup codes, replaces the group, and issues no bound admin proof", async () => {
  const { post, login } = await setup();
  const pending = await login();
  const code = await createOTP(seed).totp();
  const verified = await post("/two-factor/verify-totp", { code }, cookies(pending));
  const cookie = cookies(verified);
  const generated = await post("/two-factor/generate-backup-codes", { password }, cookie);
  const body = await generated.json() as { backupCodes: string[] };
  expect(body.backupCodes).toHaveLength(10);
  const stored = await env.DB.prepare('SELECT backupCodes FROM "twoFactor"').first<string>("backupCodes");
  expect(JSON.parse(await symmetricDecrypt({ key: SPIKE_SECRET, data: stored! }))).toEqual(body.backupCodes);
  await post("/two-factor/generate-backup-codes", { password }, cookie);
  const replaced = await env.DB.prepare('SELECT backupCodes FROM "twoFactor"').first<string>("backupCodes");
  expect(JSON.parse(await symmetricDecrypt({ key: SPIKE_SECRET, data: replaced! }))).not.toEqual(body.backupCodes);
  const reverified = await post("/two-factor/verify-totp", { code, operation: "ban", targetUserId: "quinn" }, cookie);
  expect(reverified.status).toBe(200);
  expect(Object.keys(await reverified.json() as object).sort()).toEqual(["token", "user"]);
});
