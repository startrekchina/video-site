import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import uniqueMigration from "../migrations/0020_two_factor_user_unique.sql?raw";
import { authHttp } from "@/lib/auth-http.server";
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
