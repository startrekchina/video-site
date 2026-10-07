import { env, exports } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { catalog, catalogCards, homeStages, singleParameter } from "@/lib/catalog.server";
import { currentMember } from "@/lib/member.server";
import { seedCatalog } from "./fixtures/catalog";
import { member, login } from "./fixtures/auth";

it("keeps episode details out of browsing payloads while preserving them on the selected title", async () => {
  await seedCatalog(env.DB);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    await member("Kepler"); const cookie = await login("Kepler");
    for (const path of ["/series.data", "/movies.data", "/search.data", "/.data"]) {
      const response = await exports.default.fetch(`http://localhost:6120${path}`, { headers: { Cookie: cookie } });
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("A Fictional First Episode");
    }
    const title = await exports.default.fetch("http://localhost:6120/title/series.data", { headers: { Cookie: cookie } });
    expect(title.status).toBe(200); expect(await title.text()).toContain("A Fictional First Episode");
  } finally { vi.unstubAllGlobals(); }
}, 60000);

it("returns compact cards with exact member-owned counts and scopes details to a selected work or unit", async () => {
  await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',4,1,100,1)"),
    env.DB.prepare("INSERT INTO watch_progress VALUES ('quinn','movie-unit',4,1,100,1)"),
    env.DB.prepare("INSERT INTO favorites (user_id, work_id) VALUES ('nova','series')"),
  ]);
  const cards = await catalogCards(env.DB, "nova", "survey", "series");
  expect(cards.totals).toEqual({ movie: 1, series: 2 });
  expect(cards.works).toMatchObject([{ slug: "series", seasonCount: 1, episodeCount: 1, watchedCount: 1, favorite: true }]);
  expect(cards.works[0]).not.toHaveProperty("units"); expect(cards.works[0]).not.toHaveProperty("seasons");
  expect((await catalogCards(env.DB, "quinn", "survey")).works[0]).toMatchObject({ watchedCount: 0, favorite: false });
  expect((await catalogCards(env.DB, "nova", "", "movie")).works).toMatchObject([{ slug: "movie", runtimeMin: 4 / 60, watchedCount: 0 }]);
  expect((await catalog(env.DB, "nova", "", { workId: "series" })).map(work => work.slug)).toEqual(["series"]);
  expect((await catalog(env.DB, "nova", "", { unitId: "episode-unit" })).map(work => work.slug)).toEqual(["series"]);
  expect(await catalog(env.DB, "nova", "", { unitId: "missing-unit" })).toEqual([]);
  expect((await catalogCards(env.DB, "nova", "%")).works).toEqual([]);
  await expect(catalogCards(env.DB, "nova", "x".repeat(101))).rejects.toThrow();
});

it("still refreshes sessions and immediately rejects bans and revocation without runtime schema introspection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    const user = await member("Kepler"), cookie = await login("Kepler");
    const runtimeEnv = { ...env, APP_ENV: "development" }, request = new Request("http://localhost:6120/series", { headers: { Cookie: cookie } });
    const past = new Date(Date.now() - 2 * 86400000).toISOString(), expiry = new Date(Date.now() + 28 * 86400000).toISOString();
    await env.DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ? WHERE userId = ?").bind(past, expiry, user.id).run();
    const current = await currentMember(request, runtimeEnv);
    expect(current?.member.user_id).toBe(user.id); expect(current?.headers.get("Set-Cookie")).toContain("session=");
    expect(current!.session.expiresAt.getTime()).toBeGreaterThan(Date.parse(expiry));
    await env.DB.prepare("UPDATE member_profiles SET status = 'banned' WHERE user_id = ?").bind(user.id).run();
    expect(await currentMember(request, runtimeEnv)).toBeNull();
    await env.DB.prepare("UPDATE member_profiles SET status = 'active' WHERE user_id = ?").bind(user.id).run();
    // Unbanning never revives the sessions revoked by the ban trigger.
    expect(await currentMember(request, runtimeEnv)).toBeNull();
    const renewed = new Request(request, { headers: { Cookie: await login("Kepler") } });
    expect(await currentMember(renewed, runtimeEnv)).not.toBeNull();
    await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(user.id).run();
    expect(await currentMember(renewed, runtimeEnv)).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});

it("maps named public data, literal bilingual search, seasons, unavailable media and member-owned progress", async () => {
  await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("UPDATE works SET title_zh = NULL, poster_asset = '/private/file' WHERE id = 'series'"),
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100,NULL)"),
    env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',2,0,100,1)"),
    env.DB.prepare("INSERT INTO playable_units (id,kind,work_id,season_id,episode_number,tmdb_id,duration_seconds,title_en) VALUES ('episode-two','episode','series','season',2,930002,4,'Unused Detail')"),
  ]);
  const list = await catalog(env.DB, "nova"), work = list.find(work => work.slug === "series")!;
  expect(work.titleZh).toBe("Fictional Survey"); expect(work.poster).toBe(""); expect(work.seasons[0].episodes[0]).toMatchObject({ positionSeconds: 2, playable: true, revision: 1 });
  expect(JSON.stringify(list)).not.toMatch(/fictional-private-object|object_key|checksum_sha256/);
  expect((await catalog(env.DB, "quinn")).find(work => work.slug === "series")!.units[0].positionSeconds).toBe(0);
  expect((await catalog(env.DB, "nova", "survey")).map(work => work.slug)).toEqual(["series"]);
  expect(await catalog(env.DB, "nova", "%")).toEqual([]);
  expect(await catalog(env.DB, "nova", "星".repeat(30))).toEqual([]);
  await expect(catalog(env.DB, "nova", "x".repeat(101))).rejects.toThrow();
  expect(() => singleParameter(new URL("http://example.test/?q=a&q=b"), "q")).toThrow();
  expect(homeStages(list).items[0].unit.id).toBe("episode-unit");
  const home = await catalog(env.DB, "nova", "", { home: true }), homeWork = home.find(work => work.slug === "series")!;
  expect(homeWork.units.map(unit => unit.id)).toEqual(["episode-unit"]);
  expect(homeWork.episodeCount).toBe(2); expect(homeStages(home).items[0].unit.id).toBe("episode-unit");
  expect(home.find(work => work.slug === "movie")?.runtimeMin).toBe(4 / 60);
});

it("returns only configured first episodes with actual MP4 sources for a member without history", async () => {
  await seedCatalog(env.DB);
  expect(homeStages(await catalog(env.DB, "nova")).items).toEqual([]);
  await env.DB.batch([
    env.DB.prepare("UPDATE works SET tmdb_id = 103516 WHERE id = 'series'"),
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100,NULL)"),
  ]);
  expect(homeStages(await catalog(env.DB, "nova", "", { home: true }))).toMatchObject({ label: "推荐起点", items: [{ unit: { id: "episode-unit" } }] });
});

it("protects all catalog pages and their loader requests independently and keeps guest landing free of catalog data", async () => {
  await seedCatalog(env.DB);
  for (const path of ["/series", "/movies", "/search?q=Survey", "/title/series", "/watch/episode-unit", "/series.data", "/search.data?q=Survey"]) {
    const response = await exports.default.fetch(`http://localhost:6120${path}`, { redirect: "manual" });
    expect(path.includes(".data") ? [202] : [302]).toContain(response.status);
    if (response.status === 302) expect(response.headers.get("Location")).toContain("/login?next=");
    expect(await response.text()).not.toContain("Fictional Survey");
  }
  const html = await (await exports.default.fetch("http://localhost:6120/")).text();
  expect(html).toContain("欢迎登舰"); expect(html).toContain("星际舰队档案馆"); expect(html).not.toMatch(/Fictional Survey|fictional-private-object/);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    await member("Kepler"); const cookie = await login("Kepler");
    const response = await exports.default.fetch("http://localhost:6120/title/series", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200); expect(await response.text()).toContain("虚构勘测队");
    const results = await exports.default.fetch("http://localhost:6120/search", { headers: { Cookie: cookie } });
    expect(results.status).toBe(200); expect(await results.text()).toContain("Signal Test");
    const search = await exports.default.fetch("http://localhost:6120/search?q=Survey", { headers: { Cookie: cookie } });
    const content = await search.text(); expect(search.status).toBe(200);
    const main = content.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? "";
    expect(main).toContain("虚构勘测队"); expect(main).not.toContain("Signal Test");
    // The authenticated global palette also carries other public work summaries.
    expect(content).toContain("Signal Test"); expect(content).not.toMatch(/fictional-private-object|object_key/);
  } finally { vi.unstubAllGlobals(); }
}, 60000);
