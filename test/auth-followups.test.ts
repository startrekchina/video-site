import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import uniqueMigration from "../migrations/0020_two_factor_user_unique.sql?raw";
import { authHttp } from "@/lib/auth-http.server";
import { createAuth } from "@/lib/auth.server";
import { cookies, http, login, member, password, request, uncached } from "./fixtures/auth";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).includes("/siteverify")
  ? { success: true, hostname: "localhost", action: "auth" } : { status: "success", data: { message_id: "fictional-message" } }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("stops the TOTP uniqueness migration without deleting existing duplicate credentials", async () => {
  await member(); const cookie = await login();
  expect((await http("/two-factor/enable", { password }, cookie)).status).toBe(200);
  await env.DB.exec("DROP INDEX two_factor_user_unique");
  await env.DB.exec("INSERT INTO twoFactor (id, secret, backupCodes, userId, verified) SELECT 'fictional-duplicate', secret, backupCodes, userId, verified FROM twoFactor");
  await expect(env.DB.batch(uniqueMigration.split(";").filter(sql => sql.trim()).map(sql => env.DB.prepare(sql)))).rejects.toThrow(/UNIQUE/);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM twoFactor").first("n")).toBe(2);
});

it.each(["/change-email", "/passkey/delete-passkey"])("requires a fresh session for %s before changing data", async path => {
  const user = await member(), cookie = await login();
  await env.DB.prepare(`INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
    VALUES ('fictional-passkey', 'Fictional key', 'fictional-public-key', ?, 'fictional-credential', 0, 'singleDevice', 0, ?)`)
    .bind(user.id, new Date().toISOString()).run();
  const body = path === "/change-email" ? { newEmail: "new@example.test", callbackURL: `${env.APP_ORIGIN}/verify-email` } : { id: "fictional-passkey" };
  await env.DB.prepare("UPDATE session SET createdAt = ? WHERE userId = ?").bind(new Date(Date.now() - 301000).toISOString(), user.id).run();
  const denied = await http(path, body, uncached(cookie));
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM passkey WHERE userId = ?").bind(user.id).first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM email_deliveries").first("n")).toBe(0);
  const fresh = await login();
  expect((await http(path, body, fresh)).status).toBe(200);
});

it("reopens the same pending TOTP configuration only after checking the current password", async () => {
  await member(); const cookie = await login();
  const first = await http("/two-factor/enable", { password }, cookie);
  expect(first.status).toBe(200);
  const setup = await first.json() as { totpURI: string; backupCodes: string[] };
  expect((await http("/two-factor/enable", { password: "Wrong password" }, cookie)).status).toBe(400);
  const reopened = await http("/two-factor/enable", { password }, cookie);
  expect(reopened.status).toBe(200);
  expect(await reopened.json()).toMatchObject(setup);
  const code = await createOTP(new TextDecoder().decode(base32.decode(new URL(setup.totpURI).searchParams.get("secret")!)), { digits: 6, period: 30 }).totp();
  expect((await http("/two-factor/verify-totp", { code, trustDevice: false }, cookie)).status).toBe(200);
});

it.each(["insert", "update"])("keeps one usable TOTP configuration through a concurrent %s", async mode => {
  const user = await member(), sessions = [await login(), await login()];
  let reads = 0, release!: () => void, releaseNative!: () => void, releaseCreated!: () => void;
  const bothRead = new Promise<void>(resolve => { release = resolve; });
  const bothNativeRead = new Promise<void>(resolve => { releaseNative = resolve; });
  const created = new Promise<void>(resolve => { releaseCreated = resolve; });
  const wrap = (statement: D1PreparedStatement, inserting: boolean): D1PreparedStatement => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), inserting);
    if (key === "all") return async () => {
      if (inserting) { const result = await target.all(); releaseCreated(); return result; }
      const ordinal = ++reads;
      if (ordinal === 4 && mode === "update") await created;
      const result = await target.all();
      if (ordinal <= 2) { if (ordinal === 2) release(); await bothRead; }
      else if (ordinal <= 4 && mode === "insert") { if (ordinal === 4) releaseNative(); await bothNativeRead; }
      return result;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const db = new Proxy(env.DB, { get(target, key) {
    if (key === "prepare") return (sql: string) => {
      const statement = target.prepare(sql);
      const inserting = /\binsert\s+into\s+"?twoFactor"?/i.test(sql);
      return inserting || /\bfrom\s+"?twoFactor"?\s/i.test(sql) ? wrap(statement, inserting) : statement;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const responses = await Promise.all(sessions.map(cookie => authHttp(request("/api/auth/two-factor/enable", { password }, cookie), { ...env, DB: db })));
  expect(reads).toBe(4);
  expect.soft(await env.DB.prepare("SELECT count(*) AS n FROM twoFactor WHERE userId = ?").bind(user.id).first("n")).toBe(1);
  expect(responses.some(response => response.status === 200)).toBe(true);
  for (const [index, response] of responses.entries()) {
    if (response.status !== 200) { expect(response.status).toBe(409); continue; }
    const setup = await response.json() as { totpURI: string; backupCodes: string[] };
    const code = await createOTP(new TextDecoder().decode(base32.decode(new URL(setup.totpURI).searchParams.get("secret")!)), { digits: 6, period: 30 }).totp();
    expect.soft((await http("/two-factor/verify-totp", { code, trustDevice: false }, cookies(response, sessions[index]))).status).toBe(200);
  }
});

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const concat = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap(part => Array.from(part)));
const sha256 = async (data: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
// Minimal CBOR for the WebAuthn structures below; every length stays under 256 bytes.
function cbor(value: unknown): number[] {
  const head = (major: number, length: number) => length < 24 ? [major << 5 | length] : [major << 5 | 24, length];
  if (typeof value === "number") return value < 0 ? head(1, -1 - value) : head(0, value);
  if (typeof value === "string") return [...head(3, value.length), ...new TextEncoder().encode(value)];
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  const entries: [unknown, unknown][] = value instanceof Map ? [...value] : Object.entries(value as object);
  return [...head(5, entries.length), ...entries.flatMap(([key, item]) => [...cbor(key), ...cbor(item)])];
}
// A software Ed25519 authenticator with "none" attestation, so the real WebAuthn verification runs and only the UV flag varies.
async function authenticator() {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const x = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey) as ArrayBuffer);
  const id = crypto.getRandomValues(new Uint8Array(16)), rpIdHash = await sha256(new TextEncoder().encode(env.WEBAUTHN_RP_ID));
  const clientData = (type: string, challenge: string) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin: new URL(env.APP_ORIGIN).origin }));
  const flags = (uv: boolean) => uv ? 0x05 : 0x01;
  const credential = (response: object) => ({ id: b64url(id), rawId: b64url(id), type: "public-key", clientExtensionResults: {}, response });
  return {
    register: (challenge: string, uv: boolean) => credential({
      clientDataJSON: b64url(clientData("webauthn.create", challenge)), transports: ["internal"],
      attestationObject: b64url(Uint8Array.from(cbor({ fmt: "none", attStmt: {}, authData: concat(rpIdHash, [flags(uv) | 0x40, 0, 0, 0, 0],
        new Uint8Array(16), [0, id.length], id, cbor(new Map<number, unknown>([[1, 1], [3, -8], [-1, 6], [-2, x]]))) }))),
    }),
    authenticate: async (challenge: string, uv: boolean, counter: number) => {
      const authData = concat(rpIdHash, [flags(uv), 0, 0, 0, counter]), data = clientData("webauthn.get", challenge);
      const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, concat(authData, await sha256(data))));
      return credential({ clientDataJSON: b64url(data), authenticatorData: b64url(authData), signature: b64url(signature) });
    },
  };
}

it("rejects passkey registration and sign-in on the server when the authenticator did not verify the user", async () => {
  const user = await member(); const cookie = await login(), device = await authenticator();
  const sessions = () => env.DB.prepare("SELECT count(*) AS n FROM session").first("n");
  const register = async (uv: boolean) => {
    const options = await http("/passkey/generate-register-options", undefined, cookie);
    const { challenge } = await options.json() as { challenge: string };
    return http("/passkey/verify-registration", { response: device.register(challenge, uv), name: "Fictional key" }, cookies(options, cookie));
  };
  const unverified = await register(false);
  expect(unverified.status).toBe(403); expect(await unverified.json()).toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM passkey").first("n")).toBe(0);
  expect((await register(true)).status).toBe(200);
  const authenticate = async (uv: boolean, counter: number) => {
    const options = await http("/passkey/generate-authenticate-options");
    const { challenge } = await options.json() as { challenge: string };
    return http("/passkey/verify-authentication", { response: await device.authenticate(challenge, uv, counter) }, cookies(options));
  };
  const denied = await authenticate(false, 1);
  expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });
  expect(await sessions()).toBe(1);
  expect(await env.DB.prepare("SELECT counter FROM passkey WHERE userId = ?").bind(user.id).first("counter")).toBe(0);
  expect((await authenticate(true, 2)).status).toBe(200);
  expect(await sessions()).toBe(2);
});

const changePassword = (cookie: string) => http("/change-password", { currentPassword: password, newPassword: "Replacement 1701", revokeOtherSessions: true }, cookie);
const passwordAccepts = async (userId: string, candidate: string) => (await createAuth(env).$context).password.verify({
  hash: (await env.DB.prepare("SELECT password FROM account WHERE userId = ?").bind(userId).first<string>("password"))!, password: candidate });

it("keeps the old password and sessions when an ordinary password write fails, then accepts a retry", async () => {
  const user = await member(); const cookie = await login(), other = await login();
  await env.DB.prepare("CREATE TRIGGER fictional_password_failure BEFORE UPDATE OF password ON account BEGIN SELECT RAISE(ABORT, 'Fictional password failure'); END").run();
  expect((await changePassword(cookie)).status).toBe(500);
  expect(await passwordAccepts(user.id, password)).toBe(true);
  for (const session of [cookie, other]) expect(await (await http("/get-session", undefined, session)).json()).not.toBeNull();
  await env.DB.prepare("DROP TRIGGER fictional_password_failure").run();
  const changed = await changePassword(cookie);
  expect(changed.status).toBe(200); expect(await passwordAccepts(user.id, "Replacement 1701")).toBe(true);
  expect(await (await http("/get-session", undefined, other)).json()).toBeNull();
  expect(await (await http("/get-session", undefined, cookies(changed, cookie))).json()).not.toBeNull();
});

it.each([["revoking", /^delete\s+from\s+["`]?session["`]?\s/i], ["creating", /^insert\s+into\s+["`]?session["`]?\s/i]] as const)(
  "reports a changed password with every old session revoked when %s the session fails after the password write", async (_, statement) => {
    const user = await member(); const cookie = await login(), other = await login();
    const original = env.DB.prepare.bind(env.DB);
    let injected = false;
    vi.spyOn(env.DB, "prepare").mockImplementation(sql => {
      if (!injected && statement.test(sql)) { injected = true; throw new Error("Fictional session write failure"); }
      return original(sql);
    });
    expect((await changePassword(cookie)).status).toBe(500); expect(injected).toBe(true);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM session").first("n")).toBe(0);
    expect(await passwordAccepts(user.id, "Replacement 1701")).toBe(true);
    for (const session of [cookie, other]) expect(await (await http("/get-session", undefined, session)).json()).toBeNull();
    expect((await http("/sign-in/username", { username: "Nova", password: "Replacement 1701" })).status).toBe(200);
  });
