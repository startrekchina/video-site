import { env, exports } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { catalog, homeStages, singleParameter } from "@/lib/catalog.server";
import { seedCatalog } from "./fixtures/catalog";
import { member, login } from "./fixtures/auth";

it("maps named public data, literal bilingual search, seasons, unavailable media and member-owned progress", async () => {
  await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("UPDATE works SET title_zh = NULL, poster_asset = '/private/file' WHERE id = 'series'"),
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100)"),
    env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',2,0,100,1)"),
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
});

it("returns only configured first episodes with actual MP4 sources for a member without history", async () => {
  await seedCatalog(env.DB);
  expect(homeStages(await catalog(env.DB, "nova")).items).toEqual([]);
  await env.DB.batch([
    env.DB.prepare("UPDATE works SET tmdb_id = 103516 WHERE id = 'series'"),
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100)"),
  ]);
  expect(homeStages(await catalog(env.DB, "nova"))).toMatchObject({ label: "推荐起点", items: [{ unit: { id: "episode-unit" } }] });
});

it("protects all catalog pages and their loader requests independently and keeps guest landing free of catalog data", async () => {
  await seedCatalog(env.DB);
  for (const path of ["/series", "/movies", "/title/series", "/watch/episode-unit", "/series.data"]) {
    const response = await exports.default.fetch(`http://localhost:6120${path}`, { redirect: "manual" });
    expect(path.endsWith(".data") ? [202] : [302]).toContain(response.status);
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
  } finally { vi.unstubAllGlobals(); }
}, 60000);
