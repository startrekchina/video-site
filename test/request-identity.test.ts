import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { createRequestIdentity, currentMember, requireMember } from "@/lib/member.server";
import { accountHttp } from "@/lib/account.server";
import { adminHttp } from "@/lib/admin.server";
import { csrf, login, member, request } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";
import { probeD1 } from "./fixtures/d1-probe";

const runtime = { ...env, APP_ENV: "development" };
let cookie: string, userId: string;
beforeAll(async () => { await send(request("/robots.txt")); }, 60000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try { userId = (await member("Kepler")).id; cookie = await login("Kepler"); } finally { vi.unstubAllGlobals(); }
});

async function send(input: Request, bindings = runtime) {
  const ctx = createExecutionContext(), response = await worker.fetch(input, bindings, ctx);
  await waitOnExecutionContext(ctx); return response;
}
async function media() {
  await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-object',20,'hash',4,'h264','aac',100,NULL)"),
    env.DB.prepare("INSERT INTO subtitle_tracks VALUES ('zh','episode-unit','zh','vtt','中文','zh','fictional-subtitle',8,'hash',NULL)"),
  ]);
  const video = await env.MEDIA_BUCKET.put("fictional-object", "0123456789abcdefghij");
  const subtitle = await env.MEDIA_BUCKET.put("fictional-subtitle", "WEBVTT\n\n");
  await env.DB.batch([
    env.DB.prepare("UPDATE media_files SET r2_etag = ? WHERE id = 'source'").bind(video!.etag),
    env.DB.prepare("UPDATE subtitle_tracks SET r2_etag = ? WHERE id = 'zh'").bind(subtitle!.etag),
  ]);
}

it("shares a pending identity across parallel callers and clones without sharing mutable response headers", async () => {
  const probe = probeD1(env.DB), bindings = { ...runtime, DB: probe.db }, input = request("/series", undefined, cookie);
  const identity = createRequestIdentity(input, bindings);
  expect(identity.current()).toBe(identity.current());
  const [a, b] = await Promise.all([requireMember(input, bindings, identity), requireMember(new Request(input), bindings, identity)]);
  expect(a.member.user_id).toBe(userId); expect(b.member.user_id).toBe(userId);
  a.headers.append("Set-Cookie", "unrelated=one"); expect(b.headers.has("Set-Cookie")).toBe(false);
  expect(probe.calls).toHaveLength(3); expect(probe.calls.flatMap(call => call.statements).filter(kind => kind === "session")).toHaveLength(1);
});

it("shares anonymous and failed resolutions and never turns a database failure into a guest page", async () => {
  const anonymous = createRequestIdentity(request("/"), runtime);
  const spy = vi.spyOn(anonymous.auth().api, "getSession");
  expect(await Promise.all([anonymous.current(), anonymous.current()])).toEqual([null, null]); expect(spy).toHaveBeenCalledOnce();
  const probe = probeD1(env.DB, async call => { if (call.statements.includes("session")) throw new Error("Fictional database outage"); });
  const bindings = { ...runtime, DB: probe.db }, input = request("/", undefined, cookie), identity = createRequestIdentity(input, bindings);
  const failed = identity.current(); expect(identity.current()).toBe(failed);
  const outcomes = await Promise.allSettled([failed, currentMember(input, bindings, identity)]);
  expect(outcomes.map(result => result.status)).toEqual(["rejected", "rejected"]); expect(probe.calls).toHaveLength(1);
  expect((await send(input, bindings)).status).toBe(500);
});

it("isolates members and independent requests, including the same Request object after revocation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  let other: string;
  try { await member("Tessel"); other = await login("Tessel"); } finally { vi.unstubAllGlobals(); }
  const input = request("/series", undefined, cookie), identity = createRequestIdentity(input, runtime);
  const [a, b] = await Promise.all([currentMember(input, runtime, identity), currentMember(request("/series", undefined, other), runtime)]);
  expect(a?.member.user_id).toBe(userId); expect(b?.member.user_id).not.toBe(userId);
  await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(userId).run();
  expect(await currentMember(input, runtime, createRequestIdentity(input, runtime))).toBeNull();
  identity.invalidate(); expect(await currentMember(input, runtime, identity)).toBeNull();
  expect((await send(input)).status).toBe(302);
  expect((await send(request("/account", undefined, other))).status).toBe(200);
}, 60000);

it("rejects a session revoked between native lookup and the unified member query", async () => {
  const probe = probeD1(env.DB, async call => { if (call.statements.includes("session")) await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(userId).run(); });
  expect(await currentMember(request("/series", undefined, cookie), { ...runtime, DB: probe.db })).toBeNull();
});

it.each(["video", "subtitle"])("rejects a session revoked between native lookup and the %s authorization query without metadata", async target => {
  await media(); let changed = false;
  const probe = probeD1(env.DB, async call => {
    if (!changed && call.statements.includes("session")) { changed = true; await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(userId).run(); }
  });
  const input = request(target === "video" ? "/media/source" : "/subtitles/zh", undefined, cookie, { Range: "bytes=2-5" });
  const response = await send(input, { ...runtime, DB: probe.db });
  expect(changed).toBe(true); expect(response.status).toBe(401);
  expect(response.headers.has("Content-Length")).toBe(false); expect(response.headers.has("Content-Range")).toBe(false);
  expect(await response.text()).not.toContain("fictional-object");
});

it("keeps rolling cookies on HTML, data and errors and keeps unrelated cookies separate", async () => {
  for (const [path, status] of [["/account", 200], ["/account.data", 200], ["/admin", 403], ["/missing", 404]] as const) {
    await env.DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ? WHERE userId = ?")
      .bind(new Date(Date.now() - 2 * 86400000).toISOString(), new Date(Date.now() + 28 * 86400000).toISOString(), userId).run();
    const response = await send(request(path, undefined, cookie)); expect(response.status).toBe(status);
    const cookies = response.headers.getSetCookie(); expect(cookies.filter(value => value.startsWith("session="))).toHaveLength(1);
    expect(cookies.find(value => value.startsWith("session="))).not.toContain("Max-Age=0");
    if (path.startsWith("/account")) expect(cookies.some(value => value.startsWith("csrf="))).toBe(true);
    const token = await env.DB.prepare("SELECT token FROM session WHERE userId = ?").bind(userId).first<string>("token");
    expect(await response.text()).not.toContain(token!);
  }
  await env.DB.prepare("UPDATE session SET expiresAt = ? WHERE userId = ?").bind(new Date(Date.now() - 1000).toISOString(), userId).run();
  const denied = await send(request("/account", undefined, cookie)); expect(denied.status).toBe(302);
  expect(denied.headers.getSetCookie().filter(value => value.startsWith("session="))).toHaveLength(1);
  expect(denied.headers.get("Set-Cookie")).toContain("Max-Age=0");
}, 60000);

it("clears the current session instead of returning its earlier renewal after self revocation", async () => {
  const anti = await csrf(cookie), sessionId = await env.DB.prepare("SELECT id FROM session WHERE userId = ?").bind(userId).first<string>("id");
  await env.DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ? WHERE userId = ?")
    .bind(new Date(Date.now() - 2 * 86400000).toISOString(), new Date(Date.now() + 28 * 86400000).toISOString(), userId).run();
  const input = request(`/account/sessions/${sessionId}/revoke`, { csrfToken: anti.token }, anti.cookie), identity = createRequestIdentity(input, runtime);
  const response = await accountHttp(input, runtime, identity);
  expect(response.status).toBe(200); expect(response.headers.getSetCookie().filter(value => value.startsWith("session="))).toHaveLength(1);
  expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  expect(await currentMember(input, runtime, identity)).toBeNull(); expect((await send(request("/account", undefined, cookie))).status).toBe(302);
});

it("keeps administrator SQL gates effective after the request identity has been resolved", async () => {
  const target = await member("Target");
  await env.DB.batch([
    env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(userId),
    env.DB.prepare('UPDATE "user" SET twoFactorEnabled = 1 WHERE id = ?').bind(userId),
    env.DB.prepare('INSERT INTO twoFactor (id, secret, backupCodes, userId, verified) VALUES (?, ?, ?, ?, 1)').bind("fictional-factor", "fictional-encrypted", "fictional-codes", userId),
  ]);
  const anti = await csrf(cookie), input = request(`/admin/members/${target.id}/quota`, { total: 9, csrfToken: anti.token }, anti.cookie);
  const identity = createRequestIdentity(input, runtime); await requireMember(input, runtime, identity);
  await env.DB.prepare("UPDATE member_profiles SET role = 'member' WHERE user_id = ?").bind(userId).run();
  await expect(adminHttp(input, runtime, identity)).rejects.toMatchObject({ statusCode: 409 });
  expect(await env.DB.prepare("SELECT invite_quota FROM member_profiles WHERE user_id = ?").bind(target.id).first<number>("invite_quota")).toBe(2);
});

it("preserves D1 binding, statement, batch, bookmark and exception behavior in the probe", async () => {
  const probe = probeD1(env.DB), db = probe.db.withSession("first-primary");
  expect(await db.prepare("SELECT ? AS n").bind(4).first<number>("n")).toBe(4);
  expect(await db.prepare("SELECT 5 AS n").raw()).toEqual([[5]]);
  const rows = await db.batch([db.prepare("SELECT ? AS n").bind(6), db.prepare("SELECT 7 AS n")]);
  expect(rows.map(row => row.results)).toEqual([[{ n: 6 }], [{ n: 7 }]]);
  expect(db.getBookmark()).not.toBeNull();
  await expect(db.prepare("SELECT missing_column FROM member_profiles").all()).rejects.toThrow();
  expect(probe.calls).toHaveLength(4); expect(probe.calls.flatMap(call => call.statements)).toHaveLength(5); expect(probe.calls[3].failed).toBe(true);
  expect(JSON.stringify(probe.calls)).not.toMatch(/missing_column|SELECT|kepler|example.test/);
});
