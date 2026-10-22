import { env, exports } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { catalog, catalogCards, homeStages, singleParameter } from "@/lib/catalog.server";
import { resumeTarget } from "@/lib/catalog";
import { currentMember } from "@/lib/member.server";
import { seedCatalog } from "./fixtures/catalog";
import { member, login, uncached } from "./fixtures/auth";

async function seedContinuations(userId = "nova") {
  await seedCatalog(env.DB);
  await env.DB.batch([
    ...[
      ["episode-two", "series", "season", 2, 930002],
      ["episode-completed", "series", "season", 3, 930003],
      ["episode-unverified", "series", "season", 4, 930004],
      ["episode-zero", "series", "season", 5, 930005],
      ["outpost-unit", "other-series", "other-season", 1, 930006],
    ].map(([id, work, season, number, tmdb]) => env.DB.prepare(`INSERT INTO playable_units
      (id,kind,work_id,season_id,episode_number,tmdb_id,duration_seconds,title_en)
      VALUES (?,'episode',?,?,?,?,4,?)`).bind(id, work, season, number, tmdb, `Fictional ${id}`)),
    ...["episode-unit", "episode-two", "episode-completed", "episode-unverified", "episode-zero", "outpost-unit", "movie-unit"].map(id =>
      env.DB.prepare("INSERT INTO media_files VALUES (?,?,'mp4','original',?,4,'hash',4,'h264','aac',100,?)")
        .bind(`media-${id}`, id, `fictional-private-${id}`, id === "episode-unverified" ? null : "fictional-verified-version")),
    ...[
      ["episode-unit", 2, 0, 100], ["episode-two", 1, 0, 300], ["episode-completed", 4, 1, 600],
      ["episode-unverified", 1, 0, 500], ["episode-zero", 0, 0, 700], ["outpost-unit", 2, 0, 400], ["movie-unit", 2, 0, 200],
    ].map(([id, position, completed, updated]) => env.DB.prepare("INSERT INTO watch_progress VALUES (?,?,?,?,?,1)").bind(userId, id, position, completed, updated)),
  ]);
}

it("keeps the latest playable unfinished unit per work and preserves older unfinished history", async () => {
  await seedContinuations();
  const works = await catalog(env.DB, "nova", "", { home: true }), stage = homeStages(works);
  expect(stage.label).toBe("继续观看");
  expect(stage.items.map(({ work, unit }) => [work.slug, unit.id])).toEqual([
    ["other-series", "outpost-unit"], ["series", "episode-two"], ["movie", "movie-unit"],
  ]);
  for (const item of stage.items) {
    const detail = (await catalog(env.DB, "nova", "", { workId: item.work.slug }))[0];
    expect(resumeTarget(detail)?.id).toBe(item.unit.id);
  }
  await env.DB.prepare("UPDATE watch_progress SET completed = 1 WHERE user_id = 'nova' AND playable_unit_id = 'episode-two'").run();
  expect(homeStages(await catalog(env.DB, "nova", "", { home: true })).items.map(item => item.unit.id))
    .toEqual(["outpost-unit", "movie-unit", "episode-unit"]);
  await env.DB.prepare("UPDATE media_files SET r2_etag = NULL WHERE playable_unit_id = 'episode-unit'").run();
  expect(homeStages(await catalog(env.DB, "nova", "", { home: true })).items.map(item => item.unit.id)).toEqual(["outpost-unit", "movie-unit"]);
});

it("selects continuation history independently for each member", async () => {
  await seedContinuations();
  await env.DB.prepare("INSERT INTO watch_progress VALUES ('quinn','episode-unit',3,0,800,1)").run();
  expect(homeStages(await catalog(env.DB, "quinn", "", { home: true })).items.map(item => item.unit.id)).toEqual(["episode-unit"]);
  expect(homeStages(await catalog(env.DB, "nova", "", { home: true })).items.map(item => item.unit.id)).toEqual(["outpost-unit", "episode-two", "movie-unit"]);
});

it("renders one continuation entry per work on the authenticated homepage", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    const user = await member("Kepler"), cookie = await login("Kepler");
    await seedContinuations(user.id);
    const response = await exports.default.fetch("http://localhost:6120/", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const html = (await response.text()).replace(/<!--[\s\S]*?-->/gu, "");
    expect(html).toContain("继续观看 · 3");
    expect(html).toContain('href="/watch/outpost-unit"');
    expect(html).not.toContain("fictional-private-");
  } finally { vi.unstubAllGlobals(); }
}, 60000);

it.each(["html", "data"])("returns input errors as HTTP 400 for %s catalog requests", async transport => {
  await seedCatalog(env.DB);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    await member("Kepler"); const cookie = await login("Kepler");
    const cases: [string, number][] = [
      ["/search?q=a&q=b", 400], ["/search?q=a&q=a", 400], ["/search?q=&q=", 400],
      ["/series?q=a&q=b", 400], ["/movies?q=a&q=b", 400], ["/title/series?season=1&season=2", 400],
      ...["/search", "/series", "/movies"].map(path => [`${path}?q=${"x".repeat(101)}`, 400] as [string, number]),
      ["/title/series?season=nope", 400], ["/title/series?season=9", 400], ["/title/missing?season=1&season=2", 404],
      ["/search?q=Survey", 200], ["/search?q=a", 200], ["/search?q=", 200], ["/search", 200],
      ["/series?q=", 200], ["/movies?q=", 200], [`/search?q=${"x".repeat(100)}`, 200], ["/title/series?season=1", 200],
    ];
    for (const [path, status] of cases) {
      const url = new URL(path, "http://localhost:6120");
      if (transport === "data") url.pathname += ".data";
      const response = await exports.default.fetch(url.href, { headers: { Cookie: cookie } });
      expect(response.status, path).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
      expect(await response.text(), path).not.toMatch(/fictional-private-|object_key|SELECT |APIError|"stack"/u);
    }
  } finally { vi.unstubAllGlobals(); }
}, 60000);

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
  await expect(catalogCards(env.DB, "nova", "x".repeat(101))).rejects.toMatchObject({ status: 400 });
});

it("still refreshes sessions and immediately rejects bans and revocation without runtime schema introspection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    // Rolling renewal happens on the authoritative read once the cookie cache has expired; the renewed login keeps its cache.
    const user = await member("Kepler"), cookie = uncached(await login("Kepler"));
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
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100,'fictional-verified-version')"),
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
  await expect(catalog(env.DB, "nova", "x".repeat(101))).rejects.toMatchObject({ status: 400 });
  expect(() => singleParameter(new URL("http://example.test/?q=a&q=b"), "q")).toThrow(expect.objectContaining({ status: 400 }));
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
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100,'fictional-verified-version')"),
  ]);
  expect(homeStages(await catalog(env.DB, "nova", "", { home: true }))).toMatchObject({ label: "推荐起点", items: [{ unit: { id: "episode-unit" } }] });
});

it.each([null, ""])("keeps a video with verified version %s out of play links and home recommendations", async version => {
  await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("UPDATE works SET tmdb_id = 103516 WHERE id = 'series'"),
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100,?)").bind(version),
    env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',2,0,100,1)"),
  ]);
  for (const target of [undefined, { workId: "series" }, { unitId: "episode-unit" }] as const) {
    const work = (await catalog(env.DB, "nova", "", target)).find(work => work.slug === "series")!;
    expect(work.units[0]).toMatchObject({ playable: false, positionSeconds: 2 });
    expect(homeStages([work]).items).toEqual([]);
  }
  const home = await catalog(env.DB, "nova", "", { home: true });
  expect(home.find(work => work.slug === "series")!.units).toEqual([]);
  expect(homeStages(home).items).toEqual([]);
  await env.DB.prepare("UPDATE media_files SET r2_etag = 'fictional-verified-version' WHERE id = 'source'").run();
  expect(homeStages(await catalog(env.DB, "nova", "", { home: true })).items.map(item => item.unit.id)).toEqual(["episode-unit"]);
});

it("protects all catalog pages and their loader requests independently and keeps guest landing free of catalog data", async () => {
  await seedCatalog(env.DB);
  for (const path of ["/series", "/movies", "/search?q=Survey", "/title/series", "/watch/episode-unit", "/series.data", "/search.data?q=Survey",
    "/search?q=a&q=b", "/search.data?q=a&q=b", "/title/series?season=1&season=2", "/title/series.data?season=1&season=2"]) {
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

// Five episodes; the third has no source. Progress rows are [unit, position, completed, updatedAt].
async function seedSeason(userId: string, progress: [string, number, number, number][]) {
  await seedCatalog(env.DB);
  const units = ["episode-unit", "episode-two", "episode-three", "episode-four", "episode-five"];
  await env.DB.batch([
    ...units.slice(1).map((id, index) => env.DB.prepare(`INSERT INTO playable_units (id,kind,work_id,season_id,episode_number,tmdb_id,duration_seconds,title_en)
      VALUES (?,'episode','series','season',?,?,4,?)`).bind(id, index + 2, 930102 + index, `Fictional ${id}`)),
    ...[...units.filter(id => id !== "episode-three"), "movie-unit"].map(id => env.DB.prepare("INSERT INTO media_files VALUES (?,?,'mp4','original',?,4,'hash',4,'h264','aac',100,'fictional-verified-version')")
      .bind(`media-${id}`, id, `fictional-private-${id}`)),
  ]);
  await setProgress(userId, progress);
}
const setProgress = (userId: string, rows: [string, number, number, number][]) => env.DB.batch(rows.map(([unit, position, completed, updated]) =>
  env.DB.prepare("INSERT OR REPLACE INTO watch_progress VALUES (?,?,?,?,?,1)").bind(userId, unit, position, completed, updated)));
async function continued(userId = "nova") {
  const items = homeStages(await catalog(env.DB, userId, "", { home: true })).items as { work: { slug: string }; unit: { id: string }; next?: boolean }[];
  // The home page reads only the units it needs; the title page reads them all and must agree.
  for (const item of items) expect(resumeTarget((await catalog(env.DB, userId, "", { workId: item.work.slug }))[0])?.id).toBe(item.unit.id);
  return items.map(item => [item.unit.id, Boolean(item.next)]);
}

it("continues with the first unfinished episode after the latest finished one, never past a missing source", async () => {
  await seedSeason("nova", [["episode-unit", 4, 1, 100], ["movie-unit", 2, 0, 50]]);
  expect(await continued()).toEqual([["episode-two", true], ["movie-unit", false]]);
  // The next episode has no source: nothing to offer rather than skipping it.
  await setProgress("nova", [["episode-two", 4, 1, 300]]);
  expect(await continued()).toEqual([["movie-unit", false]]);
  // A manual mark on the sourceless episode counts; episodes already finished are passed over.
  await setProgress("nova", [["episode-three", 4, 1, 400], ["episode-four", 4, 1, 200]]);
  expect(await continued()).toEqual([["episode-five", true], ["movie-unit", false]]);
  // Unfinished viewing outranks a newer finished episode, and a finished movie leaves the list.
  await setProgress("nova", [["episode-unit", 2, 0, 10], ["movie-unit", 4, 1, 500]]);
  expect(await continued()).toEqual([["episode-unit", false]]);
  expect(await continued("quinn")).toEqual([]);
});

it("links a watch page to the playable neighbours in episode order and labels the home next episode", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    const user = await member("Kepler"), cookie = await login("Kepler");
    await seedSeason(user.id, [["episode-unit", 4, 1, 100]]);
    const page = async (path: string) => {
      const response = await exports.default.fetch(`http://localhost:6120${path}`, { headers: { Cookie: cookie } });
      expect(response.status).toBe(200); return (await response.text()).replace(/<!--[sS]*?-->/gu, "");
    };
    const missing = await page("/watch/episode-three");
    expect(missing).toContain("这一集片源暂缺"); expect(missing).toContain('aria-label="上一集 · S01E02"'); expect(missing).toContain('aria-label="下一集 · S01E04"');
    const second = await page("/watch/episode-two");
    expect(second).toContain('aria-label="上一集 · S01E01"'); expect(second).toContain('aria-label="下一集 · S01E04"');
    expect(await page("/watch/episode-unit")).not.toContain('aria-label="上一集');
    const home = await page("/");
    expect(home).toContain("播放下一集"); expect(home).toContain('href="/watch/episode-two"');
  } finally { vi.unstubAllGlobals(); }
}, 60000);
