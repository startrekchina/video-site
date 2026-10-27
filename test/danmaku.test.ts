import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import type { AdminDanmaku, Danmaku } from "@/lib/danmaku.server";
import { settings } from "@/lib/settings.server";
import { login, member, request } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";

const runtime = { ...env, APP_ENV: "development" };
const unit = "/units/episode-unit/danmaku";
const { minInterval, perHour } = settings.rateLimits.danmaku;
let cookie: string, userId: string, other: string, otherId: string, admin: string;
beforeAll(async () => { await send(request("/robots.txt")); }, 60000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    userId = (await member("Kepler")).id; cookie = await login("Kepler");
    otherId = (await member("Tessel")).id; other = await login("Tessel");
    const vega = await member("Vega");
    await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(vega.id).run();
    admin = await login("Vega");
  } finally { vi.unstubAllGlobals(); }
  await seedCatalog(env.DB);
  // Only the episode has media (100 s); the movie has none.
  await env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4', 'original','fictional-object',20,'hash',100,'vp9','aac',100,'fictional-version')").run();
});
afterEach(() => { vi.restoreAllMocks(); });

async function send(input: Request) {
  const ctx = createExecutionContext(), response = await worker.fetch(input, runtime, ctx);
  await waitOnExecutionContext(ctx); return response;
}
const call = (method: string, path: string, body?: object, as = cookie, headers: Record<string, string> = {}) =>
  send(new Request(request(path, method === "GET" ? undefined : body ?? {}, as, headers), { method }));
type Body<T> = { data?: T; error?: { code: string; message: string } };
const json = async <T = Record<string, unknown>>(response: Response) => await response.json() as Body<T>;
const draft = (extra: object = {}) => ({ text: "虚构弹幕", time: 12.345, mode: 0, color: "#FFFFFF", ...extra });
const emit = (extra: object = {}, as = cookie) => call("POST", unit, draft(extra), as);
const list = async (as = cookie, path = unit) => (await json<{ items: Danmaku[] }>(await call("GET", path, undefined, as))).data!.items;
const count = (sql: string, ...values: unknown[]) => env.DB.prepare(`SELECT count(*) AS n FROM ${sql}`).bind(...values).first<number>("n");
const counters = (user: string, times: number[]) => env.DB.batch(times.map(at =>
  env.DB.prepare("INSERT INTO rate_limit_counters VALUES (?, 'danmaku', ?, 1, ?)").bind(`danmaku:${user}`, at, at + 3600000)));
// Moves the server clock; sessions and their caches stay valid because only Date.now is replaced.
const at = (time: number) => vi.spyOn(Date, "now").mockReturnValue(time);

it("rejects an ordinary member before reading the administrator danmaku list", async () => {
  const queries: string[] = [];
  const db = new Proxy(env.DB, { get: (real, key) => key !== "withSession" ? (value => typeof value === "function" ? value.bind(real) : value)(Reflect.get(real, key))
    : (...args: Parameters<D1Database["withSession"]>) => {
      const session = real.withSession(...args);
      return new Proxy(session, { get: (reader, method) => method !== "prepare" ? (value => typeof value === "function" ? value.bind(reader) : value)(Reflect.get(reader, method))
        : (sql: string) => { if (/FROM danmaku\b/.test(sql)) queries.push(sql); return reader.prepare(sql); } });
    } });
  const read = async (as: string) => {
    const ctx = createExecutionContext(), response = await worker.fetch(request(`${unit}/admin`, undefined, as), { ...runtime, DB: db }, ctx);
    await waitOnExecutionContext(ctx); return response;
  };
  expect((await read(cookie)).status).toBe(403); expect(queries).toEqual([]);
  expect((await read(admin)).status).toBe(200); expect(queries).toHaveLength(2);
});

it("sends and reads danmaku as a member without any sender details", async () => {
  const response = await emit({ text: "  <b>好看</b>  ", color: "#f2c14e", mode: 1 });
  expect(response.status).toBe(200);
  const { item } = (await json<{ item: Danmaku }>(response)).data!;
  expect(item).toEqual({ id: expect.any(String), time: 12.3, text: "<b>好看</b>", mode: 1, color: "#F2C14E" });
  const seen = await list(other);
  expect(seen).toEqual([item]);
  expect(Object.keys(seen[0]).sort()).toEqual(["color", "id", "mode", "text", "time"]);
  expect(await env.DB.prepare("SELECT author_user_id, position_seconds FROM danmaku").first()).toEqual({ author_user_id: userId, position_seconds: 12.3 });
  // Each unit has its own danmaku; a unit without media reads empty and takes no new ones, a missing unit is 404.
  expect(await list(cookie, "/units/movie-unit/danmaku")).toEqual([]);
  expect((await json(await call("POST", "/units/movie-unit/danmaku", draft(), other))).error?.code).toBe("MEDIA_MISSING");
  expect((await call("GET", "/units/missing/danmaku")).status).toBe(404);
  expect((await call("POST", "/units/missing/danmaku", draft(), other)).status).toBe(404);
});

it("checks text, position, color and time on the server", async () => {
  for (const extra of [{ text: "" }, { text: "   " }, { text: "字".repeat(settings.danmaku.maxLength + 1) }, { text: "a\nb" }, { text: "a\tb" }, { text: 1 }, { text: null },
    { mode: 3 }, { mode: "0" }, { color: "#123456" }, { color: "white" }, { color: null }, { time: -1 }, { time: "1" }, { time: 100.1 }, { time: null }]) {
    expect((await emit(extra)).status, JSON.stringify(extra)).toBe(400);
  }
  expect(await count("rate_limit_counters")).toBe(0);
  // Fifty emoji are fifty characters even though they are a hundred UTF-16 units.
  expect((await emit({ text: "😀".repeat(settings.danmaku.maxLength), time: 100 })).status).toBe(200);
  expect((await call("POST", unit, draft(), cookie, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  expect((await call("POST", unit, draft(), cookie, { "Content-Type": "text/plain" })).status).toBe(400);
});

it("rejects Unicode line separators and invisible-only text without rejecting emoji joiners", async () => {
  for (const text of ["a\u2028b", "a\u2029b", "\u200B", " \u200D\uFE0F "]) {
    expect((await emit({ text })).status, JSON.stringify(text)).toBe(400);
  }
  expect(await count("danmaku")).toBe(0);
  expect(await count("rate_limit_counters")).toBe(0);
  expect((await emit({ text: "👩‍💻" })).status).toBe(200);
});

it("keeps a fractional-end timestamp within the original duration at tenth-second precision", async () => {
  await env.DB.prepare("UPDATE media_files SET duration_seconds = 100.08 WHERE id = 'source'").run();
  const response = await emit({ time: 100.08 });
  expect(response.status).toBe(200);
  const { item } = (await json<{ item: Danmaku }>(response)).data!;
  expect(item.time).toBe(100);
  expect(await env.DB.prepare("SELECT position_seconds FROM danmaku WHERE id = ?").bind(item.id).first("position_seconds")).toBe(100);
});

it("refuses guests, unverified and banned members", async () => {
  expect((await call("GET", unit, undefined, "")).status).toBe(401);
  expect((await emit({}, "")).status).toBe(401);
  await env.DB.prepare('UPDATE "user" SET emailVerified = 0 WHERE id = ?').bind(otherId).run();
  expect((await call("GET", unit, undefined, other)).status).toBe(401);
  expect((await emit({}, other)).status).toBe(401);
  await emit();
  await env.DB.prepare("UPDATE member_profiles SET status = 'banned' WHERE user_id = ?").bind(userId).run();
  expect((await call("GET", unit, undefined, cookie)).status).toBe(401);
  expect((await emit()).status).toBe(401);
  // A ban keeps what the member already sent (B 6.17).
  expect(await list(admin)).toHaveLength(1);
});

it("keeps five seconds between sends and sixty an hour per member, refunding nothing on deletion", async () => {
  await env.DB.prepare("INSERT INTO media_files VALUES ('movie-source','movie-unit','mp4', 'original','fictional-movie',20,'hash',100,'vp9','aac',100,'fictional-version')").run();
  const start = Date.now(), gap = minInterval * 1000;
  at(start);
  expect((await emit()).status).toBe(200);
  let response = await emit();
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe(String(minInterval));
  expect((await json(response)).error).toEqual({ code: "DANMAKU_RATE_LIMITED", message: `发送太快，请 ${minInterval} 秒后再试。` });
  // Another member is limited separately; changing episodes does not reset the gap.
  expect((await emit({}, other)).status).toBe(200);
  expect((await call("POST", "/units/movie-unit/danmaku", draft())).status).toBe(429);
  at(start + gap - 1);
  expect((await emit()).status).toBe(429);
  // With 58 earlier sends in the window the send at start + 5 s is the sixtieth; the deletion that follows refunds nothing.
  await counters(userId, Array.from({ length: perHour - 2 }, (_, index) => start - 3580000 + index * 10));
  at(start + gap);
  const sixtieth = await emit();
  expect(sixtieth.status).toBe(200);
  expect((await call("DELETE", `${unit}/${(await json<{ item: Danmaku }>(sixtieth)).data!.item.id}`, {}, admin)).status).toBe(200);
  at(start + 2 * gap);
  response = await emit();
  expect(response.status).toBe(429);
  expect((await json(response)).error?.message).toBe(`每小时最多发送 ${perHour} 条弹幕，请稍后再试。`);
  // The earliest counted send leaves the rolling hour at start + 20 s.
  expect(response.headers.get("Retry-After")).toBe(String((20000 - 2 * gap) / 1000));
  at(start + 20000 - 1);
  expect((await emit()).status).toBe(429);
  at(start + 20000);
  expect((await emit()).status).toBe(200);
  expect(await count("danmaku WHERE author_user_id = ?", userId)).toBe(2);
});

it("never lets concurrent sends exceed the limit and clears the sender's expired counters", async () => {
  const now = Date.now();
  await counters(userId, [now - 7200000]);
  await counters(otherId, [now - 7200000]);
  const responses = await Promise.all(Array.from({ length: 6 }, () => emit()));
  expect(responses.map(response => response.status).sort()).toEqual([200, 429, 429, 429, 429, 429]);
  expect(await count("danmaku")).toBe(1);
  expect(await count("rate_limit_counters WHERE key = ?", `danmaku:${userId}`)).toBe(1);
  // Cleanup touches only the sender's own expired rows.
  expect(await count("rate_limit_counters WHERE key = ?", `danmaku:${otherId}`)).toBe(1);
});

it("reads only the newest danmaku up to the limit", async () => {
  const limit = settings.danmaku.readLimit;
  await env.DB.prepare(`INSERT INTO danmaku WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    SELECT 'd' || i, 'episode-unit', ?, i % 100, '虚构 ' || i, 0, '#FFFFFF', i FROM n`).bind(limit + 1, otherId).run();
  const items = await list();
  expect(items).toHaveLength(limit);
  expect(items.map(item => item.id)).not.toContain("d1");
  expect(items[0].id).toBe(`d${limit + 1}`);
});

it("lists senders for admins page by page and deletes within the unit", async () => {
  const size = settings.danmaku.adminPageSize;
  await env.DB.batch([
    ...Array.from({ length: size + 1 }, (_, index) => env.DB.prepare("INSERT INTO danmaku VALUES (?, 'episode-unit', ?, ?, ?, 0, '#FFFFFF', ?)")
      .bind(`d${index}`, index % 2 ? userId : otherId, size + 1 - index, `虚构 ${index}`, 1000 + index)),
    env.DB.prepare("INSERT INTO danmaku VALUES ('elsewhere', 'movie-unit', ?, 1, '别处', 0, '#FFFFFF', 1)").bind(userId),
  ]);
  const page = async (query: string, as = admin) => call("GET", `${unit}/admin${query}`, undefined, as);
  const first = (await json<{ items: AdminDanmaku[]; total: number; pageSize: number }>(await page(""))).data!;
  expect(first).toMatchObject({ total: size + 1, pageSize: size });
  expect(first.items).toHaveLength(size);
  expect(first.items[0]).toEqual({ id: `d${size}`, time: 1, text: `虚构 ${size}`, mode: 0, color: "#FFFFFF", author: "Tessel", createdAt: 1000 + size });
  expect(first.items.map(item => item.time)).toEqual([...first.items.map(item => item.time)].sort((a, b) => a - b));
  expect((await json<{ items: AdminDanmaku[] }>(await page("?page=2"))).data!.items.map(item => [item.id, item.author])).toEqual([["d0", "Tessel"]]);
  for (const query of ["?page=0", "?page=x", "?page=-1"]) expect((await page(query)).status, query).toBe(400);
  expect((await page("", cookie)).status).toBe(403);
  expect((await page("", "")).status).toBe(401);

  expect((await call("DELETE", `${unit}/d1`, {}, cookie)).status).toBe(403);
  expect((await call("DELETE", `${unit}/d1`, {}, admin, { "Content-Type": "text/plain" })).status).toBe(400);
  expect((await call("DELETE", `${unit}/d1`, {}, admin, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  expect((await call("DELETE", `${unit}/d1`, {}, admin)).status).toBe(200);
  expect(await count("danmaku WHERE id = 'd1'")).toBe(0);
  expect((await list()).map(item => item.id)).not.toContain("d1");
  // Already deleted, or under another unit: both are missing, and the other unit's danmaku stays.
  expect((await call("DELETE", `${unit}/d1`, {}, admin)).status).toBe(404);
  expect((await call("DELETE", `${unit}/elsewhere`, {}, admin)).status).toBe(404);
  expect(await count("danmaku WHERE id = 'elsewhere'")).toBe(1);
  expect((await call("PUT", `${unit}/d2`, {}, admin)).status).toBe(404);
});
