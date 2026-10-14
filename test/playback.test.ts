import { env, exports } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { authorizePlayback, deadlineStream, playbackHttp, signPlayback, verifyPlayback } from "@/lib/playback.server";
import { renewalDelay, retryDelay } from "@/lib/playback-client";
import { syncMedia } from "@/lib/media-sync.server";
import { seedCatalog } from "./fixtures/catalog";
import { csrf, login, member, request } from "./fixtures/auth";

let cookie: string, csrfToken: string;
beforeEach(async () => {
  await seedCatalog(env.DB);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try { await member("Kepler"); cookie = await login("Kepler"); } finally { vi.unstubAllGlobals(); }
  const protection = await csrf(cookie); cookie = protection.cookie; csrfToken = protection.token;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',20,'hash',4,'h264','aac',100,NULL)"),
    env.DB.prepare("INSERT INTO subtitle_tracks VALUES ('zh','episode-unit','zh','vtt','中文','zh','fictional-private-subtitle',8,'hash',NULL)"),
    env.DB.prepare("INSERT INTO subtitle_tracks VALUES ('foreign','movie-unit','en','vtt','English','en','fictional-foreign-subtitle',8,'hash',NULL)"),
  ]);
  const video = await env.MEDIA_BUCKET.put("fictional-private-object", "0123456789abcdefghij", { httpMetadata: { contentType: "video/mp4", cacheControl: "public" } });
  const subtitle = await env.MEDIA_BUCKET.put("fictional-private-subtitle", "WEBVTT\n\n");
  await env.DB.batch([
    env.DB.prepare("UPDATE media_files SET r2_etag = ? WHERE id = 'source'").bind(video.etag),
    env.DB.prepare("UPDATE subtitle_tracks SET r2_etag = ? WHERE id = 'zh'").bind(subtitle!.etag),
  ]);
});
const http = (url: string, options: RequestInit = {}) => {
  const headers = new Headers({ Cookie: cookie }); new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return exports.default.fetch(`http://localhost:6120${url}`, { ...options, headers });
};
const bytesText = async (response: Response) => new TextDecoder().decode(await response.arrayBuffer());
const auth = () => authorizePlayback(request("/watch/episode-unit", undefined, cookie), env, "episode-unit");

it.each(["initial", "renewal"])("returns sanitized 503 for a video metadata failure during %s signing without charging quota", async phase => {
  if (phase === "renewal") await auth();
  const before = await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n");
  const head = vi.spyOn(env.MEDIA_BUCKET, "head").mockRejectedValue(new Error("fictional-private-object storage failure"));
  try {
    await expect(auth()).rejects.toMatchObject({ statusCode: 503, body: { code: "MEDIA_UNAVAILABLE" } });
    const response = await http("/playback/episode-unit/authorize", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: JSON.stringify({ csrfToken }) });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "MEDIA_UNAVAILABLE" } });
    expect(JSON.stringify(body)).not.toMatch(/fictional-private|object_key|r2_etag|storage failure|"stack"/u);
    expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n")).toBe(before);
  } finally { head.mockRestore(); }
  const recovered = await http("/playback/episode-unit/authorize", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: JSON.stringify({ csrfToken }) });
  expect(recovered.status).toBe(200);
  expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n")).toBe((before ?? 0) + 1);
});

it.each(["missing", "replaced", "limited", "outage", "unexpected"])("preserves %s playback errors in document and data loaders", async state => {
  if (state === "missing") await env.MEDIA_BUCKET.delete("fictional-private-object");
  if (state === "replaced") await env.MEDIA_BUCKET.put("fictional-private-object", "same-length-change!!");
  if (state === "limited") {
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO rate_limit_counters (key, operation, occurred_at, count, expires_at)
      SELECT 'playback:' || id, 'playback', ?, 30, ? FROM "user" WHERE lower(username) = 'kepler'`).bind(now, now + 60000).run();
  }
  const read = env.MEDIA_BUCKET.head.bind(env.MEDIA_BUCKET);
  const head = vi.spyOn(env.MEDIA_BUCKET, "head").mockImplementation(async key => {
    if (state === "outage") throw new Error("fictional-private-object storage failure");
    const object = await read(key);
    return state === "unexpected" && object ? { ...object, writeHttpMetadata: object.writeHttpMetadata.bind(object), get etag(): string { throw new Error("Fictional unexpected metadata error"); } } : object;
  });
  const status = state === "limited" ? 429 : state === "outage" ? 503 : state === "unexpected" ? 500 : 404;
  const before = await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n");
  try {
    for (const path of ["/watch/episode-unit", "/watch/episode-unit.data", "/watch/episode-unit.data?_routes=routes/watch"]) {
      const response = await http(path);
      if (state === "outage" || state === "unexpected") expect(head).toHaveBeenCalledWith("fictional-private-object");
      expect(response.status, path).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
      if (state === "limited") expect(Number(response.headers.get("Retry-After")), path).toBeGreaterThan(0);
      const body = await response.text();
      if (state !== "unexpected") expect(body).not.toMatch(/fictional-private|object_key|r2_etag|APIError|storage failure|"stack"/u);
      if (state === "missing" || state === "replaced") {
        expect(body).toContain("404");
        if (path === "/watch/episode-unit") expect(body).toContain("这片星域还没有被探索过。");
      }
    }
    expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n")).toBe(before);
  } finally { head.mockRestore(); }
}, 60000);

it("returns sanitized 503 for resource metadata failures without charging signing quota", async () => {
  const authorization = await auth();
  const before = await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n");
  const head = vi.spyOn(env.MEDIA_BUCKET, "head").mockRejectedValue(new Error("fictional-private-object storage failure"));
  try {
    for (const url of [authorization.url, authorization.tracks[0].url]) {
      for (const options of [{}, { method: "HEAD" }, { headers: { Range: "bytes=0-1" } }]) {
        const response = await http(url, options);
        expect(response.status).toBe(503);
        expect(response.headers.has("ETag")).toBe(false);
        expect(response.headers.has("Content-Range")).toBe(false);
        expect(await response.text()).not.toMatch(/fictional-private|object_key|r2_etag|storage failure|\?token=/u);
      }
    }
    expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n")).toBe(before);
  } finally { head.mockRestore(); }
});

it.each(["unverified", "empty-version", "missing", "replaced", "wrong-length"])("rejects %s video before initial or renewal signing without charging quota", async state => {
  await auth();
  const before = await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n");
  if (state === "unverified" || state === "empty-version") await env.DB.prepare("UPDATE media_files SET r2_etag = ? WHERE id = 'source'").bind(state === "unverified" ? null : "").run();
  if (state === "missing") await env.MEDIA_BUCKET.delete("fictional-private-object");
  if (state === "replaced") await env.MEDIA_BUCKET.put("fictional-private-object", "same-length-change!!");
  if (state === "wrong-length") await env.DB.prepare("UPDATE media_files SET byte_length = 19 WHERE id = 'source'").run();
  await expect(auth()).rejects.toMatchObject({ statusCode: 404, body: { code: "MEDIA_MISSING" } });
  const response = await http("/playback/episode-unit/authorize", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: JSON.stringify({ csrfToken }) });
  expect(response.status).toBe(404);
  expect(await response.text()).not.toMatch(/fictional-private|object_key|r2_etag|\?token=/);
  expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n")).toBe(before);
});

it.each(["unverified", "empty-version", "missing", "replaced", "wrong-length"])("omits %s subtitles without blocking video authorization or renewal", async state => {
  const first = await auth();
  expect(first.tracks.map(track => track.id)).toEqual(["zh"]);
  if (state === "unverified" || state === "empty-version") await env.DB.prepare("UPDATE subtitle_tracks SET r2_etag = ? WHERE id = 'zh'").bind(state === "unverified" ? null : "").run();
  if (state === "missing") await env.MEDIA_BUCKET.delete("fictional-private-subtitle");
  if (state === "replaced") await env.MEDIA_BUCKET.put("fictional-private-subtitle", "WEBVTT\n!");
  if (state === "wrong-length") await env.DB.prepare("UPDATE subtitle_tracks SET byte_length = 7 WHERE id = 'zh'").run();
  const next = await auth();
  expect(next.tracks).toEqual([]);
  expect((await http(next.url, { method: "HEAD" })).status).toBe(200);
  const response = await http("/playback/episode-unit/authorize", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: JSON.stringify({ csrfToken }) });
  expect(response.status).toBe(200);
  expect((await response.json() as { tracks: unknown[] }).tracks).toEqual([]);
  expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n")).toBe(3);
});

it("keeps video authorization available when optional subtitle metadata cannot be read", async () => {
  const read = env.MEDIA_BUCKET.head.bind(env.MEDIA_BUCKET);
  const head = vi.spyOn(env.MEDIA_BUCKET, "head").mockImplementation(async key => {
    if (key === "fictional-private-subtitle") throw new Error("Fictional subtitle storage outage");
    return read(key);
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const authorization = await auth();
    expect(authorization.tracks).toEqual([]);
    expect((await http(authorization.url, { method: "HEAD" })).status).toBe(200);
    expect(warning).toHaveBeenCalledWith(JSON.stringify({ event: "subtitle_unavailable", resourceId: "zh" }));
  } finally { head.mockRestore(); warning.mockRestore(); }
});

it.each(["r2_etag", "object_key", "byte_length"])("rejects a %s change between object verification and the signing write without charging quota", async column => {
  await auth();
  const before = await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n");
  const read = env.MEDIA_BUCKET.head.bind(env.MEDIA_BUCKET);
  const head = vi.spyOn(env.MEDIA_BUCKET, "head").mockImplementationOnce(async key => {
    const object = await read(key);
    await env.DB.prepare(`UPDATE media_files SET ${column} = ? WHERE id = 'source'`).bind(column === "byte_length" ? 19 : "fictional-changed-value").run();
    return object;
  });
  try {
    await expect(auth()).rejects.toMatchObject({ statusCode: 404, body: { code: "MEDIA_MISSING" } });
    expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE operation = 'playback'").first<number>("n")).toBe(before);
  } finally { head.mockRestore(); }
});

it.each(["video", "subtitle"])("rejects a %s replacement between HEAD and GET as unavailable", async target => {
  const authorization = await auth(), video = target === "video", ctx = createExecutionContext();
  const read = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET);
  const get = vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementationOnce(async (key, options) => {
    await env.MEDIA_BUCKET.put(key, video ? "same-length-change!!" : "WEBVTT\n!");
    return read(key, options);
  });
  try {
    await expect(playbackHttp(request(video ? authorization.url : authorization.tracks[0].url, undefined, cookie), env, ctx))
      .rejects.toMatchObject({ statusCode: 404, body: { code: "MEDIA_MISSING" } });
  } finally { get.mockRestore(); await waitOnExecutionContext(ctx); }
});

it.each(["video", "subtitle"])("rejects missing or mismatched %s versions for GET, HEAD and Range without metadata", async target => {
  const authorization = await auth(), video = target === "video";
  const url = video ? authorization.url : authorization.tracks[0].url;
  for (const version of [null, "fictional-stale-version"]) {
    await env.DB.prepare(`UPDATE ${video ? "media_files" : "subtitle_tracks"} SET r2_etag = ?`).bind(version).run();
    for (const options of [{}, { method: "HEAD" }, { headers: { Range: "bytes=0-1" } }]) {
      const response = await http(url, options);
      expect(response.status).toBe(404);
      expect(response.headers.has("Content-Length")).toBe(false);
      expect(response.headers.has("Content-Range")).toBe(false);
      expect(response.headers.has("ETag")).toBe(false);
      expect(await response.text()).not.toContain("fictional-private");
    }
  }
});

it("keeps legacy media unavailable after a scan conflict and restores it only after validation", async () => {
  const { url } = await auth();
  const key = "library/series/920001/S01/E01.mp4";
  const original = Uint8Array.from(atob(env.TEST_MEDIA_BASE64), char => char.charCodeAt(0));
  await env.DB.prepare("UPDATE media_files SET object_key = ?, byte_length = ?, checksum_sha256 = ?, r2_etag = NULL WHERE id = 'source'")
    .bind(key, original.length, createHash("sha256").update(original).digest("hex")).run();
  const changed = original.slice(); changed[changed.length - 1] ^= 1;
  await env.MEDIA_BUCKET.put(key, changed);
  expect(await syncMedia(env)).toMatchObject({ linked: 0, conflicts: 1 });
  expect(await env.DB.prepare("SELECT r2_etag FROM media_files WHERE id = 'source'").first("r2_etag")).toBeNull();
  expect((await http(url)).status).toBe(404);
  await env.MEDIA_BUCKET.put(key, original);
  expect(await syncMedia(env)).toMatchObject({ conflicts: 0, failed: 0 });
  const response = await http(url);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
});

it("binds token to environment, member/session/unit/media, verifies raw bytes and rejects invalid times", async () => {
  const authorization = await auth(), token = new URL(authorization.url, env.APP_ORIGIN).searchParams.get("token")!;
  const payload = await verifyPlayback(env, token);
  expect(payload).toMatchObject({ environment: "test", playableUnitId: "episode-unit", mediaFileId: "source" });
  expect(payload.exp - payload.iat).toBe(1800); expect(JSON.stringify(payload)).not.toContain("fictional-private-object");
  const rawText = JSON.stringify(payload, null, 1), raw = btoa(rawText).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PLAYBACK_HMAC_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode("video-site:playback\0" + rawText)));
  const signed = btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  expect(await verifyPlayback(env, `${raw}.${signed}`)).toEqual(payload);
  await expect(verifyPlayback(env, `${btoa(rawText.trim() + " ").replace(/=+$/u, "")}.${signed}`)).rejects.toThrow();
  await expect(verifyPlayback(env, token.slice(0, -3) + "abc")).rejects.toThrow();
  for (const invalid of [{ purpose: "other" }, { environment: "production" }, { exp: payload.iat }, { iat: payload.iat + 60 }, { exp: payload.exp + 1 }, { v: 2 }, { kid: "unknown" }]) await expect(verifyPlayback(env, await signPlayback(env, { ...payload, ...invalid }))).rejects.toThrow();
  expect((await http(authorization.tracks[0].url)).status).toBe(200);
  const subtitles = await http(authorization.tracks[0].url, { method: "HEAD" }); expect(subtitles.headers.get("Content-Type")).toBe("text/vtt; charset=utf-8"); expect((await subtitles.arrayBuffer()).byteLength).toBe(0);
  expect((await http(authorization.url.replace("/source?", "/unknown?"))).status).toBe(403);
  expect((await http(authorization.tracks[0].url.replace("/zh?", "/foreign?"))).status).toBe(403);
  expect((await http(authorization.url + "&token=" + token)).status).toBe(403);
  const expired = await signPlayback(env, { ...payload, iat: payload.iat - 1800, exp: payload.iat });
  expect((await http(authorization.url.replace(token, expired))).status).toBe(403);
  await env.DB.prepare('UPDATE "user" SET emailVerified = 0 WHERE id = ?').bind(payload.userId).run();
  expect((await http(authorization.url)).status).toBe(401);
  await env.DB.prepare('UPDATE "user" SET emailVerified = 1 WHERE id = ?').bind(payload.userId).run();
  await env.DB.prepare("UPDATE member_profiles SET status = 'banned' WHERE user_id = ?").bind(payload.userId).run();
  expect((await http(authorization.url)).status).toBe(401);
  await env.DB.prepare("UPDATE member_profiles SET status = 'active' WHERE user_id = ?").bind(payload.userId).run();
  await env.DB.prepare("DELETE FROM session WHERE id = ?").bind(payload.sessionId).run();
  expect((await http(authorization.url)).status).toBe(401);
});

it("cannot reuse another member or another session's token and does not reveal missing object metadata", async () => {
  const authorization = await auth(), token = new URL(authorization.url, env.APP_ORIGIN).searchParams.get("token")!, payload = await verifyPlayback(env, token);
  for (const change of [{ userId: "nova" }, { sessionId: "other-session" }, { playableUnitId: "movie-unit" }, { mediaFileId: "unknown" }]) {
    const forged = await signPlayback(env, { ...payload, ...change });
    expect((await http(authorization.url.replace(token, forged))).status).toBe(403);
  }
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    await member("Tessel"); const otherCookie = await login("Tessel");
    expect((await http(authorization.url, { headers: { Cookie: otherCookie } })).status).toBe(403);
  } finally { vi.unstubAllGlobals(); }
  await env.MEDIA_BUCKET.delete("fictional-private-object");
  const missing = await http(authorization.url); expect(missing.status).toBe(404); expect(await missing.text()).not.toContain("fictional-private-object");
});

it("implements full GET/HEAD/Range/If-Range and private headers over real R2 bytes", async () => {
  const { url } = await auth();
  const response = await http(url); expect(response.status).toBe(200); expect(await bytesText(response)).toBe("0123456789abcdefghij");
  expect(response.headers.get("Content-Length")).toBe("20"); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Type")).toBe("video/mp4"); expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  const head = await http(url, { method: "HEAD", headers: { Range: "bytes=1-2" } }); expect(head.status).toBe(200); expect(await bytesText(head)).toBe(""); expect(head.headers.get("Content-Length")).toBe("20");
  for (const [range, body, contentRange] of [["bytes=2-5", "2345", "bytes 2-5/20"], ["bytes=18-99", "ij", "bytes 18-19/20"], ["bytes=17-", "hij", "bytes 17-19/20"], ["bytes=-3", "hij", "bytes 17-19/20"]]) {
    const partial = await http(url, { headers: { Range: range } }); expect(partial.status).toBe(206); expect(await bytesText(partial)).toBe(body); expect(partial.headers.get("Content-Range")).toBe(contentRange); expect(partial.headers.get("Content-Length")).toBe(String(body.length));
  }
  for (const range of ["bytes=20-", "bytes=3-1", "bytes=-0"]) { const result = await http(url, { headers: { Range: range } }); expect(result.status).toBe(416); expect(result.headers.get("Content-Range")).toBe("bytes */20"); }
  expect((await http(url, { headers: { Range: "bytes=a-b" } })).status).toBe(400);
  for (const range of ["bytes=0-1,3-4", "items=0-1"]) { const result = await http(url, { headers: { Range: range } }); expect(result.status).toBe(200); expect(await bytesText(result)).toHaveLength(20); }
  expect((await http(url, { headers: { Range: "bytes=0-1", "If-Range": response.headers.get("ETag")! } })).status).toBe(206);
  const mismatch = await http(url, { headers: { Range: "bytes=0-1", "If-Range": '"wrong"' } }); expect(mismatch.status).toBe(200); expect(await bytesText(mismatch)).toHaveLength(20);
  expect((await http(url, { method: "POST" })).status).toBe(405);
  const denied = await exports.default.fetch(`http://localhost:6120${url}`, { method: "HEAD" }); expect(denied.status).toBe(401); expect(denied.headers.has("Content-Length")).toBe(false);
  const version = (await env.MEDIA_BUCKET.head("fictional-private-object"))!.etag;
  await env.DB.prepare("UPDATE media_files SET r2_etag = ?").bind(version).run();
  await env.MEDIA_BUCKET.put("fictional-private-object", "same-length-change!!");
  expect((await http(url)).status).toBe(404);
});

it("enforces exact concurrent signing quota and CSRF without charging media requests", async () => {
  const first = await auth();
  for (let i = 0; i < 3; i++) await (await http(first.url)).arrayBuffer();
  const statuses = await Promise.all(Array.from({ length: 30 }, () => http("/playback/episode-unit/authorize", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: JSON.stringify({ csrfToken }) }).then(result => result.status)));
  expect(statuses.filter(status => status === 200)).toHaveLength(29); expect(statuses.filter(status => status === 429)).toHaveLength(1);
  const missing = await http("/playback/episode-unit/authorize", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: "{}" }); expect(missing.status).toBe(403);
  const over = await http("/playback/episode-unit/authorize", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: JSON.stringify({ csrfToken }) }); expect(over.status).toBe(429); expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
});

it("stops the upstream at token deadline and consumer cancellation", async () => {
  const waits: Promise<unknown>[] = [], ctx = { waitUntil(promise: Promise<unknown>) { waits.push(promise); } } as ExecutionContext;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  const stream = deadlineStream(source, 100, Date.now() + 30, new AbortController().signal, ctx), reader = stream.getReader();
  expect((await reader.read()).value).toEqual(new Uint8Array([1])); await expect(reader.read()).rejects.toThrow(); await Promise.all(waits); expect(cancelled).toBe(true);
  cancelled = false;
  const other = deadlineStream(new ReadableStream({ cancel() { cancelled = true; } }), 100, Date.now() + 1000, new AbortController().signal, ctx);
  await other.cancel(); await Promise.all(waits); expect(cancelled).toBe(true);
});

it("uses five-minute renewal and finite network/503 retries; refuses 401/403 retries", () => {
  expect(renewalDelay(1800000, 0)).toBe(1500000);
  expect([0, 1, 2, 3].map(attempt => retryDelay(503, attempt))).toEqual([5000, 15000, 30000, null]);
  expect(retryDelay(401, 0)).toBeNull(); expect(retryDelay(403, 0)).toBeNull(); expect(retryDelay(400, 0)).toBeNull(); expect(retryDelay(0, 0)).toBe(5000);
});
