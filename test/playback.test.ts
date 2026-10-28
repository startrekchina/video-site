import { env, exports } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { asVp9 } from "./fixtures/media";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { playbackHttp, playbackSource } from "@/lib/playback.server";
import { syncMedia } from "@/lib/media-sync.server";
import { episodeKey, fixtureKeys, seedCatalog } from "./fixtures/catalog";
import { login, member, request } from "./fixtures/auth";

const video = "/media/source", subtitle = "/subtitles/zh";
let cookie: string;
// Load the Worker module graph once so per-test time measures requests, not the cold start.
beforeAll(async () => { await exports.default.fetch("http://localhost:6120/robots.txt"); }, 60000);
beforeEach(async () => {
  await seedCatalog(env.DB);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try { await member("Kepler"); cookie = await login("Kepler"); } finally { vi.unstubAllGlobals(); }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',20,'hash',4,'vp9','aac',100,NULL)"),
    env.DB.prepare("INSERT INTO subtitle_tracks VALUES ('zh','episode-unit','zh','vtt','中文','zh','fictional-private-subtitle',8,'hash',NULL)"),
    env.DB.prepare("INSERT INTO subtitle_tracks VALUES ('foreign','movie-unit','en','vtt','English','en','fictional-foreign-subtitle',8,'hash',NULL)"),
  ]);
  const object = await env.MEDIA_BUCKET.put("fictional-private-object", "0123456789abcdefghij", { httpMetadata: { contentType: "video/mp4", cacheControl: "public" } });
  const track = await env.MEDIA_BUCKET.put("fictional-private-subtitle", "WEBVTT\n\n");
  await env.DB.batch([
    env.DB.prepare("UPDATE media_files SET r2_etag = ? WHERE id = 'source'").bind(object.etag),
    env.DB.prepare("UPDATE subtitle_tracks SET r2_etag = ? WHERE id = 'zh'").bind(track!.etag),
  ]);
});
const http = (url: string, options: RequestInit = {}, session = cookie) => {
  const headers = new Headers(session ? { Cookie: session } : {}); new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return exports.default.fetch(`http://localhost:6120${url}`, { ...options, headers });
};
const bytesText = async (response: Response) => new TextDecoder().decode(await response.arrayBuffer());
const userId = () => env.DB.prepare('SELECT id FROM "user" WHERE username = ?').bind("kepler").first<string>("id");
async function expectHidden(response: Response, status: number) {
  expect(response.status).toBe(status);
  for (const header of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) expect(response.headers.has(header), header).toBe(false);
  expect(await response.text()).not.toMatch(/fictional-private|object_key|r2_etag|storage failure|"stack"/u);
}

it("implements full GET/HEAD/Range/If-Range and private headers over real R2 bytes", async () => {
  const response = await http(video); expect(response.status).toBe(200); expect(await bytesText(response)).toBe("0123456789abcdefghij");
  expect(response.headers.get("Content-Length")).toBe("20"); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Type")).toBe("video/mp4"); expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff"); expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  const etag = response.headers.get("ETag")!; expect(etag).toMatch(/^".+"$/u); expect(response.headers.get("Last-Modified")).toBeTruthy();
  const head = await http(video, { method: "HEAD", headers: { Range: "bytes=1-2" } }); expect(head.status).toBe(200); expect(await bytesText(head)).toBe("");
  expect(head.headers.get("Content-Length")).toBe("20"); expect(head.headers.get("ETag")).toBe(etag);
  for (const [range, body, contentRange] of [["bytes=2-5", "2345", "bytes 2-5/20"], ["bytes=18-99", "ij", "bytes 18-19/20"], ["bytes=17-", "hij", "bytes 17-19/20"], ["bytes=-3", "hij", "bytes 17-19/20"]]) {
    const partial = await http(video, { headers: { Range: range } }); expect(partial.status).toBe(206); expect(await bytesText(partial)).toBe(body);
    expect(partial.headers.get("Content-Range")).toBe(contentRange); expect(partial.headers.get("Content-Length")).toBe(String(body.length));
  }
  for (const range of ["bytes=20-", "bytes=3-1", "bytes=-0"]) { const result = await http(video, { headers: { Range: range } }); expect(result.status).toBe(416); expect(result.headers.get("Content-Range")).toBe("bytes */20"); }
  expect((await http(video, { headers: { Range: "bytes=a-b" } })).status).toBe(400);
  for (const range of ["bytes=0-1,3-4", "items=0-1"]) { const result = await http(video, { headers: { Range: range } }); expect(result.status).toBe(200); expect(await bytesText(result)).toHaveLength(20); }
  expect((await http(video, { headers: { Range: "bytes=0-1", "If-Range": etag } })).status).toBe(206);
  for (const condition of ['"wrong"', response.headers.get("Last-Modified")!]) {
    const full = await http(video, { headers: { Range: "bytes=0-1", "If-Range": condition } }); expect(full.status).toBe(200); expect(await bytesText(full)).toHaveLength(20);
  }
  expect((await http(video, { method: "POST" })).status).toBe(405);
  // Stale links from token-era pages still resolve; the query never authorizes anything.
  expect(await bytesText(await http(`${video}?token=fictional-old-token`))).toBe("0123456789abcdefghij");
  const text = await http(subtitle); expect(text.status).toBe(200); expect(await bytesText(text)).toBe("WEBVTT\n\n");
  const vtt = await http(subtitle, { method: "HEAD" }); expect(vtt.headers.get("Content-Type")).toBe("text/vtt; charset=utf-8"); expect((await vtt.arrayBuffer()).byteLength).toBe(0);
  await expectHidden(await http("/media/unknown"), 404);
  await expectHidden(await http("/subtitles/source"), 404);
}, 60000);

it("reads R2 once per GET or Range with the recorded version and uses metadata only for HEAD", async () => {
  const head = vi.spyOn(env.MEDIA_BUCKET, "head"), get = vi.spyOn(env.MEDIA_BUCKET, "get");
  try {
    for (const options of [{}, { headers: { Range: "bytes=2-5" } }]) {
      head.mockClear(); get.mockClear();
      await (await http(video, options)).arrayBuffer();
      expect(head).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledOnce();
      expect(get.mock.calls[0][1]).toMatchObject({ onlyIf: { etagMatches: (await env.DB.prepare("SELECT r2_etag FROM media_files").first<string>("r2_etag"))! } });
    }
    head.mockClear(); get.mockClear();
    await (await http(video, { method: "HEAD" })).arrayBuffer();
    expect(head).toHaveBeenCalledOnce(); expect(get).not.toHaveBeenCalled();
  } finally { head.mockRestore(); get.mockRestore(); }
});

it("authorizes every request from the live session and hides metadata from anyone else", async () => {
  for (const url of [video, subtitle]) {
    // Cross-site embeds arrive without the SameSite=Lax session cookie.
    for (const method of ["GET", "HEAD"]) await expectHidden(await http(url, { method }, ""), 401);
    await expectHidden(await http(url, {}, "session=fictional-invalid"), 401);
  }
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  let other: string;
  try { await member("Tessel"); other = await login("Tessel"); } finally { vi.unstubAllGlobals(); }
  expect((await http(video, {}, other)).status).toBe(200);
  const id = await userId();
  for (const [change, restore] of [
    ['UPDATE "user" SET emailVerified = 0 WHERE id = ?', 'UPDATE "user" SET emailVerified = 1 WHERE id = ?'],
    ["UPDATE member_profiles SET registration_state = 'pending' WHERE user_id = ?", "UPDATE member_profiles SET registration_state = 'completed' WHERE user_id = ?"],
  ]) {
    await env.DB.prepare(change).bind(id).run();
    for (const url of [video, subtitle]) await expectHidden(await http(url, { headers: { Range: "bytes=0-1" } }), 401);
    await env.DB.prepare(restore).bind(id).run();
    expect((await http(video)).status).toBe(200);
  }
  await env.DB.prepare("UPDATE member_profiles SET status = 'banned' WHERE user_id = ?").bind(id).run();
  for (const url of [video, subtitle]) await expectHidden(await http(url, { headers: { Range: "bytes=0-1" } }), 401);
  // Banning revokes the sessions, so reactivation alone does not revive the old cookie.
  await env.DB.prepare("UPDATE member_profiles SET status = 'active' WHERE user_id = ?").bind(id).run();
  await expectHidden(await http(video), 401);
  expect((await http(video, {}, other)).status).toBe(200);
  await env.DB.prepare('DELETE FROM session WHERE userId <> ?').bind(id).run();
  await expectHidden(await http(subtitle, {}, other), 401);
}, 60000);

it.each(["video", "subtitle"])("returns sanitized 404 for unverified, stale, replaced, resized or missing %s objects", async target => {
  const isVideo = target === "video", url = isVideo ? video : subtitle, table = isVideo ? "media_files" : "subtitle_tracks";
  const key = isVideo ? "fictional-private-object" : "fictional-private-subtitle", original = isVideo ? "0123456789abcdefghij" : "WEBVTT\n\n";
  const etag = (await env.MEDIA_BUCKET.head(key))!.etag;
  const states: [string, () => Promise<unknown>][] = [
    ["unverified", () => env.DB.prepare(`UPDATE ${table} SET r2_etag = NULL`).run()],
    ["empty-version", () => env.DB.prepare(`UPDATE ${table} SET r2_etag = ''`).run()],
    ["stale-version", () => env.DB.prepare(`UPDATE ${table} SET r2_etag = 'fictional-stale-version'`).run()],
    ["replaced", () => env.MEDIA_BUCKET.put(key, isVideo ? "same-length-change!!" : "WEBVTT\n!")],
    ["resized", () => env.DB.prepare(`UPDATE ${table} SET byte_length = byte_length - 1`).run()],
    ["missing", () => env.MEDIA_BUCKET.delete(key)],
  ];
  for (const [state, apply] of states) {
    await apply();
    for (const options of [{}, { method: "HEAD" }, { headers: { Range: "bytes=0-1" } }, { headers: { Range: "bytes=99-" } }]) await expectHidden(await http(url, options), 404);
    const current = await env.MEDIA_BUCKET.put(key, original);
    await env.DB.prepare(`UPDATE ${table} SET r2_etag = ?, byte_length = ?`).bind(current!.etag, original.length).run();
    expect((await http(url)).status, state).toBe(200);
  }
  expect(etag).toBeTruthy();
});

it.each(["video", "subtitle"])("returns sanitized 503 for %s storage failures and recovers on the next request", async target => {
  const url = target === "video" ? video : subtitle, size = target === "video" ? 20 : 8;
  const head = vi.spyOn(env.MEDIA_BUCKET, "head").mockRejectedValue(new Error("fictional-private-object storage failure"));
  const get = vi.spyOn(env.MEDIA_BUCKET, "get").mockRejectedValue(new Error("fictional-private-object storage failure"));
  try {
    for (const options of [{}, { method: "HEAD" }, { headers: { Range: "bytes=0-1" } }]) {
      const response = await http(url, options);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Request-Id")).toBeTruthy();
      expect(response.headers.has("ETag")).toBe(false); expect(response.headers.has("Content-Range")).toBe(false);
      expect(response.status).toBe(503);
      if (options.method !== "HEAD") expect(await response.json()).toMatchObject({ error: { code: "MEDIA_UNAVAILABLE", message: "媒体服务暂时不可用，请稍后重试。" } });
    }
  } finally { head.mockRestore(); get.mockRestore(); }
  const recovered = await http(url); expect(recovered.status).toBe(200); expect((await recovered.arrayBuffer()).byteLength).toBe(size);
  const partial = await http(url, { headers: { Range: "bytes=0-1" } }); expect(partial.status).toBe(206); expect(partial.headers.get("Content-Range")).toBe(`bytes 0-1/${size}`);
});

it.each(["video", "subtitle"])("rejects a %s replaced while the request is being authorized", async target => {
  const isVideo = target === "video", read = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET);
  const get = vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementationOnce(async (key, options) => {
    await env.MEDIA_BUCKET.put(key, isVideo ? "same-length-change!!" : "WEBVTT\n!");
    return read(key, options);
  });
  try {
    await expect(playbackHttp(request(isVideo ? video : subtitle, undefined, cookie), env)).rejects.toMatchObject({ statusCode: 404, body: { code: "MEDIA_MISSING" } });
  } finally { get.mockRestore(); }
});

it("serves a same-name replacement at the same address only after the scan validates it", async () => {
  const key = "library/series/85948/S01/E01.mp4";
  const original = asVp9(Uint8Array.from(atob(env.TEST_MEDIA_BASE64), char => char.charCodeAt(0)));
  await env.DB.prepare("UPDATE media_files SET object_key = ?, byte_length = ?, checksum_sha256 = ?, r2_etag = NULL WHERE id = 'source'")
    .bind(key, original.length, createHash("sha256").update(original).digest("hex")).run();
  const changed = original.slice(); changed[changed.length - 1] ^= 1;
  for (const bytes of [changed, original]) {
    await env.MEDIA_BUCKET.put(key, bytes);
    expect((await http(video)).status).toBe(404);
    expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 1, failed: 0 });
    const response = await http(video);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  }
});

it("lists only verified sources for a unit from D1 without touching R2", async () => {
  const english = await env.MEDIA_BUCKET.put("fictional-foreign-subtitle", "WEBVTT\n\n");
  await env.DB.prepare("UPDATE subtitle_tracks SET playable_unit_id = 'episode-unit', r2_etag = ? WHERE id = 'foreign'").bind(english!.etag).run();
  const head = vi.spyOn(env.MEDIA_BUCKET, "head"), get = vi.spyOn(env.MEDIA_BUCKET, "get");
  try {
    expect(await playbackSource(env.DB, episodeKey(1))).toEqual({ qualities: [{ label: "原画", url: video }], tracks: [
      { id: "foreign", language: "en", displayName: "English", url: "/subtitles/foreign" },
      { id: "zh", language: "zh", displayName: "中文", url: subtitle },
    ] });
    await env.DB.prepare("UPDATE subtitle_tracks SET r2_etag = '' WHERE id = 'foreign'").run();
    expect((await playbackSource(env.DB, episodeKey(1)))?.tracks.map(track => track.id)).toEqual(["zh"]);
    expect(await playbackSource(env.DB, fixtureKeys.movie)).toBeNull();
    await env.DB.prepare("UPDATE media_files SET r2_etag = NULL").run();
    expect(await playbackSource(env.DB, episodeKey(1))).toBeNull();
    expect(head).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  } finally { head.mockRestore(); get.mockRestore(); }
});

it("lists the required original before verified tiers and authorizes each tier per request", async () => {
  const tier = await env.MEDIA_BUCKET.put("fictional-private-tier", "tier-bytes");
  await env.DB.batch([["p480", "480p", tier!.etag], ["p2160", "2160p", tier!.etag], ["p1080", "1080p", null]].map(([id, variant, etag]) => env.DB.prepare(
    "INSERT INTO media_files VALUES (?,'episode-unit','mp4',?,?,10,'hash',4,?,'aac',20,?)").bind(id, variant, id === "p480" ? "fictional-private-tier" : `fictional-private-${id}`, variant === "480p" ? "h264" : "vp9", etag)));
  expect((await playbackSource(env.DB, episodeKey(1)))?.qualities).toEqual([{ label: "原画", url: video }, { label: "2160p", url: "/media/p2160" }, { label: "480p", url: "/media/p480" }]);
  const response = await http("/media/p480", { headers: { Range: "bytes=0-3" } });
  expect(response.status).toBe(206); expect(await bytesText(response)).toBe("tier");
  await expectHidden(await http("/media/p480", {}, ""), 401);
  await expectHidden(await http("/media/p480", { method: "HEAD" }, ""), 401);
  // Optional tiers cannot replace an unverified original.
  await env.DB.prepare("UPDATE media_files SET r2_etag = NULL WHERE id IN ('source', 'p2160')").run();
  expect(await playbackSource(env.DB, episodeKey(1))).toBeNull();
  await env.DB.prepare("UPDATE media_files SET r2_etag = NULL").run();
  expect(await playbackSource(env.DB, episodeKey(1))).toBeNull();
});

it("offers only tiers within the duration tolerance of the original", async () => {
  const tier = await env.MEDIA_BUCKET.put("fictional-private-tier", "tier-bytes");
  await env.DB.batch(([["p2160", "2160p", 5], ["p1080", "1080p", 4.9], ["p480", "480p", 2.9]] as const).map(([id, variant, duration]) => env.DB.prepare(
    "INSERT INTO media_files VALUES (?,'episode-unit','mp4',?,?,10,'hash',?,?,'aac',20,?)").bind(id, variant, `fictional-private-${id}`, duration, variant === "480p" ? "h264" : "vp9", tier!.etag)));
  expect((await playbackSource(env.DB, episodeKey(1)))?.qualities).toEqual([{ label: "原画", url: video }, { label: "2160p", url: "/media/p2160" }, { label: "1080p", url: "/media/p1080" }]);
  await expectHidden(await http("/media/p480", {}, ""), 401);
});

it("refuses a tier by its direct address while the original is unverified, not VP9 or of another duration", async () => {
  const tier = await env.MEDIA_BUCKET.put("fictional-private-tier", "tier-bytes");
  await env.DB.prepare("INSERT INTO media_files VALUES ('p480','episode-unit','mp4','480p','fictional-private-tier',10,'hash',4,'h264','aac',20,?)").bind(tier!.etag).run();
  const source = await env.DB.prepare("SELECT r2_etag FROM media_files WHERE id = 'source'").first<string>("r2_etag");
  expect((await http("/media/p480")).status).toBe(200);
  for (const change of ["r2_etag = NULL", "video_codec = 'h264'", "duration_seconds = 6"]) {
    await env.DB.prepare(`UPDATE media_files SET ${change} WHERE id = 'source'`).run();
    for (const options of [{}, { method: "HEAD" }, { headers: { Range: "bytes=0-3" } }]) await expectHidden(await http("/media/p480", options), 404);
    await env.DB.prepare("UPDATE media_files SET r2_etag = ?, video_codec = 'vp9', duration_seconds = 4 WHERE id = 'source'").bind(source).run();
    expect((await http("/media/p480")).status, change).toBe(200);
  }
});

it("rejects a previously verified H.264 original in both the loader and media endpoint without reading R2", async () => {
  await env.DB.prepare("UPDATE media_files SET video_codec = 'h264' WHERE id = 'source'").run();
  expect(await playbackSource(env.DB, episodeKey(1))).toBeNull();
  const get = vi.spyOn(env.MEDIA_BUCKET, "get"), head = vi.spyOn(env.MEDIA_BUCKET, "head");
  await expectHidden(await http(video), 404);
  await expectHidden(await http(video, { method: "HEAD" }), 404);
  expect(get).not.toHaveBeenCalled(); expect(head).not.toHaveBeenCalled();
});

it("renders the watch page from D1 and leaves missing objects to the media request", async () => {
  const page = async (path: string) => { const response = await http(path); expect(response.status, path).toBe(200); return response.text(); };
  const html = await page("/series/ld/s1/e1");
  expect(html).toContain(video); expect(html).toContain(subtitle); expect(html).not.toMatch(/token=|csrf|fictional-private/u);
  expect(await page("/series/ld/s1/e1.data")).toContain(video);
  await env.MEDIA_BUCKET.delete("fictional-private-object");
  expect(await page("/series/ld/s1/e1")).toContain(video);
  expect((await http(video)).status).toBe(404);
  const moviePage = await page("/movies/the-motion-picture/watch");
  expect(moviePage).toContain("片源暂缺。"); expect(moviePage).toContain("<title>测试信号 · 星际舰队档案馆</title>");
}, 60000);
