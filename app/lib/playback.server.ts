import { APIError } from "better-auth/api";
import type { UnitKey } from "./catalog.server";
import { qualityTiers, type QualityTier } from "./media-format";
import { createRequestIdentity, liveMemberSql, type D1Reader } from "./member.server";
import { settings } from "./settings.server";

// qualities run from the highest tier down (B 6.6); type lets the player find the highest one this browser can decode.
export type PlaybackSource = { qualities: { label: string; url: string; type: string }[]; tracks: { id: string; language: string; displayName: string; url: string }[] };
const variants = Object.keys(qualityTiers) as QualityTier[];
// What each tier declares to canPlayType: VP9 profile 0 8-bit at the level its resolution needs, H.264 High 4.0, AAC-LC.
const mediaTypes: Record<QualityTier, string> = {
  "2160p": 'video/mp4; codecs="vp09.00.51.08, mp4a.40.2"', "1080p": 'video/mp4; codecs="vp09.00.41.08, mp4a.40.2"',
  "720p": 'video/mp4; codecs="avc1.640028, mp4a.40.2"', "480p": 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
};
type Resource = { id: string | null; object_key: string; byte_length: number; r2_etag: string | null };
const fail = (status: "UNAUTHORIZED" | "BAD_REQUEST" | "NOT_FOUND" | "SERVICE_UNAVAILABLE", code: string, message: string): never => { throw new APIError(status, { code, message }); };
const missing = (id: string | null): never => {
  if (id) console.info(JSON.stringify({ event: "media_missing", resourceId: id }));
  return fail("NOT_FOUND", "MEDIA_MISSING", "片源暂时无法播放。");
};
async function storage<T>(read: () => Promise<T>) {
  try { return await read(); } catch { return fail("SERVICE_UNAVAILABLE", "MEDIA_UNAVAILABLE", "媒体服务暂时不可用，请稍后重试。"); }
}

// The unit a page path names, found inside the page's single batch.
const unitId = `(SELECT u.id FROM playable_units u JOIN works w ON w.id = u.work_id LEFT JOIN seasons s ON s.id = u.season_id
  WHERE w.kind = ? AND w.tmdb_id = ? AND (u.kind = 'movie' OR (s.season_number = ? AND u.episode_number = ?)))`;

// Verified sources come from D1 only; every media request checks the current R2 version itself.
export async function playbackSource(db: D1Reader, unit: UnitKey): Promise<PlaybackSource | null> {
  const key = [unit.kind, unit.tmdbId, unit.kind === "series" ? unit.season : null, unit.kind === "series" ? unit.episode : null];
  const [files, tracks] = await db.batch<{ id: string; variant: QualityTier; duration_seconds: number; language: string; display_name: string }>([
    db.prepare(`SELECT id, variant, duration_seconds FROM media_files WHERE playable_unit_id = ${unitId} AND format = 'mp4' AND r2_etag IS NOT NULL AND r2_etag <> ''`).bind(...key),
    // B 6.6 order: 简中, 简英, 繁中, 繁英; extra tracks follow their kind.
    db.prepare(`SELECT id, language, display_name FROM subtitle_tracks WHERE playable_unit_id = ${unitId} AND format = 'vtt'
      AND r2_etag IS NOT NULL AND r2_etag <> '' ORDER BY language, track_key GLOB language || '.bilingual*', track_key`).bind(...key),
  ]);
  const linked = files.results.filter(file => variants.includes(file.variant)).sort((a, b) => variants.indexOf(a.variant) - variants.indexOf(b.variant));
  if (!linked.length) return null;
  // The highest verified tier stands for the unit; a lower tier of another duration stays hidden until its own replacement passes the scan.
  const qualities = linked.filter(file => Math.abs(file.duration_seconds - linked[0].duration_seconds) <= settings.qualityDurationTolerance)
    .map(file => ({ label: file.variant, url: `/media/${file.id}`, type: mediaTypes[file.variant] }));
  return { qualities, tracks: tracks.results.map(track => ({ id: track.id, language: track.language, displayName: track.display_name, url: `/subtitles/${track.id}` })) };
}

function rangeRequest(header: string, total: number) {
  if (!header.startsWith("bytes=")) return null;
  const parts = header.slice(6).split(",");
  if (!parts.every(part => /^\s*\d*-\d*\s*$/u.test(part) && part.trim() !== "-")) return fail("BAD_REQUEST", "RANGE_INVALID", "Range 格式无效。");
  if (parts.length > 1) return null;
  const [left, right] = parts[0].trim().split("-");
  const a = left ? Number(left) : null, b = right ? Number(right) : null;
  if ((a !== null && !Number.isSafeInteger(a)) || (b !== null && !Number.isSafeInteger(b))) return fail("BAD_REQUEST", "RANGE_INVALID", "Range 数值无效。");
  if (a === null) return b === 0 ? { unsatisfied: true } : { start: Math.max(0, total - b!), end: total - 1 };
  if (a >= total || (b !== null && b < a)) return { unsatisfied: true };
  return { start: a, end: Math.min(b ?? total - 1, total - 1) };
}

export async function playbackHttp(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const match = /^\/(media|subtitles)\/([^/]+)$/u.exec(new URL(request.url).pathname);
  if (!match) return fail("NOT_FOUND", "NOT_FOUND", "资源不存在。");
  const native = await identity.session();
  if (!native) return fail("UNAUTHORIZED", "AUTH_REQUIRED", "请先登录。");
  const media = match[1] === "media";
  // One primary read authorizes the live session and member, then finds the resource.
  const file = await env.DB.withSession("first-primary").prepare(`SELECT f.id, f.object_key, f.byte_length, f.r2_etag
    FROM (SELECT 1 ${liveMemberSql}) AS active LEFT JOIN ${media ? "media_files" : "subtitle_tracks"} f ON f.id = ? AND f.format = ?`)
    .bind(native.session.userId, native.session.id, new Date().toISOString(), match[2], media ? "mp4" : "vtt").first<Resource>();
  if (!file) return fail("UNAUTHORIZED", "AUTH_REQUIRED", "登录已失效，请重新登录。");
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const etag = file.r2_etag;
  if (!file.id || !etag) return missing(file.id);
  const headers = new Headers({ "Content-Type": media ? "video/mp4" : "text/vtt; charset=utf-8", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Encoding": "identity" });
  const describe = (object: R2Object) => { headers.set("ETag", object.httpEtag); headers.set("Last-Modified", object.uploaded.toUTCString()); };
  const head = async () => {
    const object = await storage(() => env.MEDIA_BUCKET.head(file.object_key));
    if (object?.etag !== etag || object.size !== file.byte_length) return missing(file.id);
    describe(object);
  };
  if (request.method === "HEAD") {
    await head();
    headers.set("Content-Length", String(file.byte_length));
    return new Response(null, { headers });
  }
  // Only the strong ETag can keep a Range; a date validator falls back to the full body.
  const condition = request.headers.get("If-Range"), raw = request.headers.get("Range");
  const range = raw && (!condition || condition === `"${etag}"`) ? rangeRequest(raw, file.byte_length) : null;
  if (range && "unsatisfied" in range) {
    await head();
    headers.set("Content-Range", `bytes */${file.byte_length}`);
    return new Response(null, { status: 416, headers });
  }
  const object = await storage(() => env.MEDIA_BUCKET.get(file.object_key,
    { onlyIf: { etagMatches: etag }, ...(range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {}) }));
  if (!object || !("body" in object) || object.size !== file.byte_length) {
    if (object && "body" in object) await object.body.cancel();
    return missing(file.id);
  }
  describe(object);
  headers.set("Content-Length", String(range ? range.end - range.start + 1 : object.size));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${object.size}`);
  return new Response(object.body, { status: range ? 206 : 200, headers, encodeBody: "manual" });
}
