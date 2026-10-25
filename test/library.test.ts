import { env, exports } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { catalogCards } from "@/lib/catalog.server";
import { playlistPage, playlistQueue, playlists } from "@/lib/library.server";
import { settings } from "@/lib/settings.server";
import { login, member, request } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";

const runtime = { ...env, APP_ENV: "development" };
let cookie: string, userId: string, other: string, otherId: string;
beforeAll(async () => { await send(request("/robots.txt")); }, 60000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    userId = (await member("Kepler")).id; cookie = await login("Kepler");
    otherId = (await member("Tessel")).id; other = await login("Tessel");
  } finally { vi.unstubAllGlobals(); }
  await seedCatalog(env.DB);
  // Series E1 and E2 and the movie can play; E3 has no source.
  await env.DB.batch([
    ...[["episode-two", 2, 930002], ["episode-three", 3, 930003]].map(([id, number, tmdb]) => env.DB.prepare(`INSERT INTO playable_units
      (id, kind, work_id, season_id, episode_number, tmdb_id, duration_seconds, title_zh) VALUES (?, 'episode', 'series', 'season', ?, ?, 4, ?)`).bind(id, number, tmdb, `虚构第 ${number} 集`)),
    ...["episode-unit", "episode-two", "movie-unit"].map(id => env.DB.prepare("INSERT INTO media_files VALUES (?, ?, 'mp4', 'original', ?, 4, 'hash', 4, 'h264', 'aac', 100, 'fictional-version')")
      .bind(`media-${id}`, id, `fictional-private-${id}`)),
  ]);
});

async function send(input: Request) {
  const ctx = createExecutionContext(), response = await worker.fetch(input, runtime, ctx);
  await waitOnExecutionContext(ctx); return response;
}
const call = (method: string, path: string, body?: object, as = cookie, headers: Record<string, string> = {}) =>
  send(new Request(request(path, method === "GET" ? undefined : body ?? {}, as, headers), { method }));
async function json(response: Response) { return await response.json() as { data?: Record<string, unknown> & { id?: string; item?: string; revision?: number }; error?: { code: string; revision?: number } }; }
const create = async (visibility = "private", as = cookie) => (await json(await call("POST", "/me/playlists", { title: "虚构片单", visibility }, as))).data!.id!;
const add = async (id: string, item: object, as = cookie) => (await json(await call("POST", `/me/playlists/${id}/items`, item, as))).data?.item;
const stored = async (id: string) => (await env.DB.prepare("SELECT id, coalesce(work_id, playable_unit_id) AS target FROM playlist_items WHERE playlist_id = ? ORDER BY position")
  .bind(id).all<{ id: string; target: string }>()).results;
const revision = (id: string) => env.DB.prepare("SELECT revision FROM playlists WHERE id = ?").bind(id).first<number>("revision");
const favorites = async (user = userId) => (await catalogCards(env.DB, user)).works.filter(work => work.favorite).map(work => work.slug);
const watched = (user: string, unit: string) => env.DB.prepare("INSERT INTO watch_progress VALUES (?, ?, 4, 1, 1, 1)").bind(user, unit).run();

it("keeps favorites per member, idempotent and for works only", async () => {
  for (const favorite of [true, true]) expect((await json(await call("PUT", "/me/favorites/series", { favorite }))).data).toEqual({ favorite: true });
  expect((await call("PUT", "/me/favorites/movie", { favorite: true }, other)).status).toBe(200);
  expect(await favorites()).toEqual(["series"]); expect(await favorites(otherId)).toEqual(["movie"]);
  expect((await json(await call("PUT", "/me/favorites/episode-unit", { favorite: true }))).error?.code).toBe("NOT_FOUND");
  for (const body of [{}, { favorite: "true" }, { favorite: 1 }]) expect((await call("PUT", "/me/favorites/series", body)).status, JSON.stringify(body)).toBe(400);
  for (const favorite of [false, false]) expect((await json(await call("PUT", "/me/favorites/series", { favorite }))).data).toEqual({ favorite: false });
  expect(await favorites()).toEqual([]); expect(await favorites(otherId)).toEqual(["movie"]);
}, 60000);

it("adds each work or episode once, in order, even when repeated or concurrent", async () => {
  const id = await create(), series = await add(id, { workId: "series" }), episode = await add(id, { unitId: "episode-unit" }), movie = await add(id, { workId: "movie" });
  expect(await stored(id)).toEqual([{ id: series, target: "series" }, { id: episode, target: "episode-unit" }, { id: movie, target: "movie" }]);
  expect(await revision(id)).toBe(3);
  // A repeat returns the existing item without a new row, a new place or a new revision.
  expect(await add(id, { workId: "series" })).toBe(series); expect(await add(id, { unitId: "episode-unit" })).toBe(episode);
  expect(await stored(id)).toHaveLength(3); expect(await revision(id)).toBe(3);
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => add(id, { workId: "other-series" })));
  expect(new Set(concurrent).size).toBe(1);
  expect((await stored(id)).map(item => item.target)).toEqual(["series", "episode-unit", "movie", "other-series"]); expect(await revision(id)).toBe(4);
  // Movies join as works, an item names exactly one target, and the target must exist.
  for (const [item, status] of [[{ unitId: "movie-unit" }, 404], [{ workId: "missing" }, 404], [{ workId: "series", unitId: "episode-two" }, 400], [{}, 400], [{ workId: 1 }, 400]] as const) {
    expect((await call("POST", `/me/playlists/${id}/items`, item)).status, JSON.stringify(item)).toBe(status);
  }
  const limit = settings.playlistItemsMax;
  Object.assign(settings, { playlistItemsMax: 4 });
  try {
    expect((await json(await call("POST", `/me/playlists/${id}/items`, { unitId: "episode-two" }))).error?.code).toBe("PLAYLIST_FULL");
    expect(await add(id, { workId: "series" })).toBe(series);
  } finally { Object.assign(settings, { playlistItemsMax: limit }); }
  expect(await stored(id)).toHaveLength(4);
}, 60000);

it("reorders a playlist as a whole by revision and removes single items", async () => {
  const id = await create(), [a, b, c] = [await add(id, { workId: "series" }), await add(id, { workId: "movie" }), await add(id, { unitId: "episode-two" })];
  const reorder = (itemIds: unknown, expectedRevision: unknown = 3) => call("PUT", `/me/playlists/${id}/items`, { itemIds, expectedRevision });
  expect((await json(await reorder([c, a, b]))).data).toEqual({ revision: 4 });
  expect((await stored(id)).map(item => item.id)).toEqual([c, a, b]);
  const stale = await reorder([a, b, c]);
  expect(stale.status).toBe(409); expect((await json(stale)).error).toMatchObject({ code: "REVISION_CONFLICT", revision: 4 });
  for (const [itemIds, expected] of [[[c, a], 4], [[c, a, a], 4], [[c, a, "missing"], 4], [[c, a, 1], 4], ["c", 4], [[c, a, b], "4"], [[c, a, b], 1.5]]) {
    expect((await reorder(itemIds, expected)).status, JSON.stringify(itemIds)).toBe(400);
  }
  expect((await stored(id)).map(item => item.id)).toEqual([c, a, b]);
  // Two devices with the same revision: one order wins whole, the other is refused.
  const orders = [[a, b, c], [b, c, a]], results = await Promise.all(orders.map(order => reorder(order, 4)));
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect((await stored(id)).map(item => item.id)).toEqual(orders[results.findIndex(result => result.status === 200)]);
  expect((await json(await call("DELETE", `/me/playlists/${id}/items/${b}`))).data).toEqual({ revision: 6 });
  expect((await json(await call("DELETE", `/me/playlists/${id}/items/${b}`))).data).toEqual({ revision: 6 });
  expect((await stored(id)).map(item => item.id)).not.toContain(b);
}, 60000);

it("lets only the owner write, shares playlists with members and keeps private ones hidden", async () => {
  const id = await create(), item = await add(id, { workId: "series" });
  expect(await playlistPage(env.DB, otherId, id)).toBeNull();
  expect((await exports.default.fetch(`http://localhost:6120/playlists/${id}`, { headers: { Cookie: other } })).status).toBe(404);
  const writes = () => Promise.all([call("PATCH", `/me/playlists/${id}`, { visibility: "members" }, other), call("DELETE", `/me/playlists/${id}`, {}, other),
    call("POST", `/me/playlists/${id}/items`, { workId: "movie" }, other), call("PUT", `/me/playlists/${id}/items`, { itemIds: [item], expectedRevision: 1 }, other),
    call("DELETE", `/me/playlists/${id}/items/${item}`, {}, other)]);
  expect((await writes()).map(response => response.status)).toEqual([404, 404, 404, 404, 404]);
  expect((await json(await call("PATCH", `/me/playlists/${id}`, { visibility: "members" }))).data).toEqual({ visibility: "members" });
  expect((await playlistPage(env.DB, otherId, id))?.playlist).toMatchObject({ visibility: "members", own: false, owner: "Kepler" });
  expect((await playlists(env.DB, otherId, "members")).map(list => list.id)).toEqual([id]);
  expect(await playlists(env.DB, otherId, "mine")).toEqual([]);
  expect((await writes()).map(response => response.status)).toEqual([404, 404, 404, 404, 404]);
  expect(await stored(id)).toEqual([{ id: item, target: "series" }]);
  for (const body of [{ title: "", visibility: "private" }, { title: "   ", visibility: "private" }, { title: "片".repeat(settings.playlistTitleMax + 1), visibility: "private" },
    { title: "响\u0007铃", visibility: "private" }, { title: "虚构", visibility: "public" }, { title: "虚构" }, { title: "虚构", visibility: "private", item: "series" }]) {
    expect((await call("POST", "/me/playlists", body)).status, JSON.stringify(body)).toBe(400);
  }
  expect((await call("POST", "/me/playlists", { title: "虚构", visibility: "private" }, "")).status).toBe(401);
  expect((await call("GET", "/me/playlists?workId=series", undefined, "")).status).toBe(401);
  expect((await json(await call("POST", "/me/playlists", { title: "虚构", visibility: "private" }, cookie, { Origin: "https://evil.invalid" }))).error?.code).toBe("CSRF_INVALID");
  // The add menu lists only the member's own playlists and marks the ones holding the target.
  const created = (await json(await call("POST", "/me/playlists", { title: "  看完再说  ", visibility: "private", item: { unitId: "episode-two" } }))).data!.id;
  expect((await json(await call("GET", "/me/playlists?unitId=episode-two"))).data).toEqual([{ id: created, title: "看完再说", count: 1, has: true }, { id, title: "虚构片单", count: 1, has: false }]);
  expect((await json(await call("GET", "/me/playlists?workId=series", undefined, other))).data).toEqual([]);
  expect((await json(await call("DELETE", `/me/playlists/${id}`))).data).toEqual({ deleted: true });
  expect(await stored(id)).toEqual([]); expect(await playlistPage(env.DB, userId, id)).toBeNull();
}, 60000);

it("expands the queue in item order, keeps first appearances and skips finished or sourceless units without exposing the owner's progress", async () => {
  const id = await create("members");
  for (const item of [{ unitId: "episode-two" }, { workId: "series" }, { workId: "movie" }]) await add(id, item);
  await watched(userId, "episode-two");
  let page = await playlistPage(env.DB, userId, id);
  expect(page).toMatchObject({ start: "episode-unit", queued: 3 });
  expect(page?.items.map(item => [item.kicker, item.watched])).toEqual([["S01E02", true], ["整部剧集 · 1 季", false], ["电影 · —", false]]);
  // Queue order is E2, E1, movie: E2's later copy and the sourceless E3 drop out.
  expect((await playlistQueue(env.DB, userId, id, "episode-two"))?.next?.id).toBe("episode-unit");
  expect((await playlistQueue(env.DB, userId, id, "episode-unit"))?.next).toMatchObject({ id: "movie-unit", label: "电影", title: "测试信号" });
  expect(await playlistQueue(env.DB, userId, id, "movie-unit")).toMatchObject({ id, title: "虚构片单", next: null });
  expect(await playlistQueue(env.DB, userId, id, "episode-three")).toBeNull();
  // Another member follows their own progress.
  page = await playlistPage(env.DB, otherId, id);
  expect(page).toMatchObject({ start: "episode-two", queued: 3 }); expect(page?.items.map(item => item.watched)).toEqual([false, false, false]);
  await watched(userId, "episode-unit"); await watched(userId, "movie-unit");
  expect(await playlistPage(env.DB, userId, id)).toMatchObject({ start: null, queued: 3 });
  expect((await playlistQueue(env.DB, userId, id, "episode-two"))?.next).toBeNull();
  await call("PATCH", `/me/playlists/${id}`, { visibility: "private" });
  expect(await playlistQueue(env.DB, otherId, id, "episode-two")).toBeNull();
  const html = await (await exports.default.fetch(`http://localhost:6120/watch/episode-unit?playlist=${id}`, { headers: { Cookie: cookie } })).text();
  expect(html).toContain(`href="/playlists/${id}"`);
}, 60000);

it("keeps the playlist queue on the episode step links", async () => {
  const id = await create(); await add(id, { workId: "series" });
  const page = async (search: string) => (await exports.default.fetch(`http://localhost:6120/watch/episode-unit${search}`, { headers: { Cookie: cookie } })).text();
  expect(await page(`?playlist=${id}`)).toContain(`href="/watch/episode-two?playlist=${id}"`);
  expect(await page("")).not.toContain("?playlist=");
}, 60000);

const watchPage = async (path: string, as = cookie) => (await exports.default.fetch(`http://localhost:6120${path}`, { headers: { Cookie: as } })).text();
const segments = (html: string) => [...html.matchAll(/<li class="h-1 flex-1 ([^"]+)"/gu)].map(match => match[1]);

it("shows the queue bar with the viewer's own place among all playable units, finished ones included", async () => {
  const id = await create("members");
  for (const item of [{ unitId: "episode-two" }, { workId: "series" }, { workId: "movie" }]) await add(id, item);
  await watched(userId, "episode-two");
  await env.DB.prepare("UPDATE works SET year = 1996 WHERE id = 'movie'").run();
  // Queue E2, E1, movie: the finished E2 still counts, and another member sees only their own progress.
  expect(await playlistQueue(env.DB, userId, id, "episode-two")).toMatchObject({ position: 0, watched: [true, false, false], next: { id: "episode-unit" } });
  expect(await playlistQueue(env.DB, userId, id, "episode-unit")).toMatchObject({ position: 1, next: { id: "movie-unit", label: "电影", year: 1996 } });
  expect(await playlistQueue(env.DB, otherId, id, "movie-unit")).toMatchObject({ position: 2, watched: [false, false, false], next: null });
  let html = await watchPage(`/watch/episode-unit?playlist=${id}`);
  expect(html).toContain("按顺序播放 · 02 / 03"); expect(segments(html)).toEqual(["bg-foreground/40", "bg-foreground", "bg-foreground/10"]);
  expect(html).toContain(`href="/watch/movie-unit?playlist=${id}"`); expect(html).toContain("下一项 · 电影 · 1996"); expect(html).toContain("测试信号");
  html = await watchPage(`/watch/movie-unit?playlist=${id}`);
  expect(html).toContain("按顺序播放 · 03 / 03 · 最后一项"); expect(html).not.toContain("下一项 ·");
  // Outside queue mode, or when the playlist is not readable, the page has no queue bar.
  expect(await watchPage("/watch/episode-unit")).not.toContain("按顺序播放");
  await call("PATCH", `/me/playlists/${id}`, { visibility: "private" });
  expect(await watchPage(`/watch/episode-unit?playlist=${id}`, other)).not.toContain("按顺序播放");
}, 60000);

it("shows a plain progress bar instead of segments for queues over 24 units", async () => {
  await env.DB.batch(Array.from({ length: 23 }, (_, index) => [`extra-${index + 4}`, index + 4] as const).flatMap(([unit, number]) => [
    env.DB.prepare(`INSERT INTO playable_units (id, kind, work_id, season_id, episode_number, tmdb_id, duration_seconds) VALUES (?, 'episode', 'series', 'season', ?, ?, 4)`)
      .bind(unit, number, 930100 + number),
    env.DB.prepare("INSERT INTO media_files VALUES (?, ?, 'mp4', 'original', ?, 4, 'hash', 4, 'h264', 'aac', 100, 'fictional-version')").bind(`media-${unit}`, unit, `fictional-private-${unit}`)]));
  const id = await create(); await add(id, { workId: "series" });
  // E1, E2 and the 23 extra episodes play; E3 has no source and does not count.
  const html = await watchPage(`/watch/episode-unit?playlist=${id}`);
  expect(html).toContain("按顺序播放 · 01 / 25"); expect(html).toContain('aria-valuenow="4"'); expect(segments(html)).toEqual([]);
}, 60000);

it("offers the add menu on the watch page of an episode without a source", async () => {
  const html = await (await exports.default.fetch("http://localhost:6120/watch/episode-three", { headers: { Cookie: cookie } })).text();
  expect(html).toContain("这一集片源暂缺"); expect(html).toContain("加入片单");
}, 60000);
