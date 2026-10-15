import { APIError } from "better-auth/api";
import { createRequestIdentity, memberForSession, requireMember } from "./member.server";
import { checkCsrf, readJson } from "./security.server";
import { settings } from "./settings.server";

type Payload = { v: number; kid: string; environment: string; purpose: string; userId: string; sessionId: string; playableUnitId: string; mediaFileId: string; iat: number; exp: number };
type MediaFile = { id: string; object_key: string; byte_length: number; r2_etag: string | null };
export type Authorization = { url: string; expiresAt: number; tracks: { id: string; language: string; displayName: string; url: string }[] };
const encoder = new TextEncoder(), prefix = "video-site:playback\0";
const fail = (status: "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "NOT_FOUND" | "SERVICE_UNAVAILABLE", code: string, message: string): never => { throw new APIError(status, { code, message }); };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。");
  try {
    const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
    if (encode(bytes) !== value) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。");
    return bytes;
  } catch { return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。"); }
}
const key = (env: Env) => crypto.subtle.importKey("raw", encoder.encode(env.PLAYBACK_HMAC_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
function signedBytes(raw: Uint8Array) { const purpose = encoder.encode(prefix), bytes = new Uint8Array(purpose.length + raw.length); bytes.set(purpose); bytes.set(raw, purpose.length); return bytes; }
export async function signPlayback(env: Env, payload: Payload) {
  const bytes = encoder.encode(JSON.stringify(payload)), raw = encode(bytes);
  const signature = await crypto.subtle.sign("HMAC", await key(env), signedBytes(bytes));
  return `${raw}.${encode(new Uint8Array(signature))}`;
}
export async function verifyPlayback(env: Env, token: string, now = Math.floor(Date.now() / 1000)) {
  if (token.length > 4096 || token.split(".").length !== 2) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。");
  const [raw, signed] = token.split("."), signature = decode(signed), bytes = decode(raw);
  if (signature.length !== 32 || !await crypto.subtle.verify("HMAC", await key(env), signature, signedBytes(bytes))) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。");
  let payload: Payload;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。"); }
  const names = ["v", "kid", "environment", "purpose", "userId", "sessionId", "playableUnitId", "mediaFileId", "iat", "exp"];
  if (!payload || typeof payload !== "object" || Object.keys(payload).length !== names.length || !names.every(name => Object.hasOwn(payload, name))
    || payload.v !== 1 || payload.kid !== "1" || payload.environment !== env.APP_ENV || payload.purpose !== "playback"
    || ![payload.userId, payload.sessionId, payload.playableUnitId, payload.mediaFileId].every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(id))
    || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.iat > now || payload.exp <= now || payload.iat < 0 || payload.exp <= payload.iat || payload.exp - payload.iat > settings.playbackTokenTtl) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效或已到期。");
  return payload;
}

const liveSession = `SELECT s.id FROM session s JOIN "user" u ON u.id = s.userId
  JOIN member_profiles p ON p.user_id = u.id WHERE s.id = ? AND s.userId = ? AND s.expiresAt > ?
  AND u.emailVerified = 1 AND p.registration_state = 'completed' AND p.status = 'active'`;
async function verifiedObject(bucket: R2Bucket, file: Pick<MediaFile, "object_key" | "byte_length" | "r2_etag">) {
  if (!file.r2_etag) return null;
  let object;
  try { object = await bucket.head(file.object_key); }
  catch { return fail("SERVICE_UNAVAILABLE", "MEDIA_UNAVAILABLE", "媒体服务暂时不可用，请稍后重试。"); }
  return object?.etag === file.r2_etag && object.size === file.byte_length ? object : null;
}
const sourceVersion = "SELECT id FROM media_files WHERE id = ? AND playable_unit_id = ? AND format = 'mp4' AND r2_etag = ? AND object_key = ? AND byte_length = ?";
async function quota(env: Env, current: Awaited<ReturnType<typeof requireMember>>, unitId: string, file: MediaFile) {
  const userId = current.member.user_id;
  const now = Date.now(), counter = `playback:${userId}`;
  const source = [file.id, unitId, file.r2_etag, file.object_key, file.byte_length];
  const result = await env.DB.prepare(`INSERT INTO rate_limit_counters (key, operation, occurred_at, count, expires_at)
    SELECT ?, 'playback', ?, 1, ? WHERE (SELECT coalesce(sum(count), 0) FROM rate_limit_counters WHERE key = ? AND operation = 'playback' AND occurred_at > ?) < ?
    AND EXISTS (${liveSession}) AND EXISTS (${sourceVersion})
    ON CONFLICT(key, operation, occurred_at) DO UPDATE SET count = count + 1`).bind(counter, now, now + 60000, counter, now - 60000, settings.rateLimits.playbackTokenPerMember.perMinute,
      current.session.id, userId, new Date(now).toISOString(), ...source).run();
  if (!result.meta.changes) {
    try { await memberForSession(env, current.session); }
    catch (error) { if (error instanceof APIError) return fail("UNAUTHORIZED", "AUTH_REQUIRED", "会话已失效，请重新登录。"); throw error; }
    if (!await env.DB.prepare(sourceVersion).bind(...source).first()) return fail("NOT_FOUND", "MEDIA_MISSING", "暂无可播放片源。");
    const earliest = await env.DB.prepare("SELECT min(occurred_at) AS n FROM rate_limit_counters WHERE key = ? AND operation = 'playback' AND occurred_at > ?").bind(counter, now - 60000).first<number>("n");
    throw new APIError("TOO_MANY_REQUESTS", { code: "PLAYBACK_RATE_LIMITED", message: "播放请求过于频繁，请稍后重试。" }, { "Retry-After": String(Math.max(1, Math.ceil(((earliest ?? now) + 60000 - now) / 1000))) });
  }
}
export async function authorizePlayback(request: Request, env: Env, unitId: string, responseHeaders?: Headers, identity = createRequestIdentity(request, env)): Promise<Authorization> {
  const current = await requireMember(request, env, identity);
  for (const cookie of current.headers.getSetCookie()) responseHeaders?.append("Set-Cookie", cookie);
  const db = env.DB.withSession("first-primary");
  const [files, tracks] = await db.batch<MediaFile>([
    db.prepare("SELECT id, object_key, byte_length, r2_etag FROM media_files WHERE playable_unit_id = ? AND format = 'mp4'").bind(unitId),
    db.prepare("SELECT id, language, display_name, object_key, byte_length, r2_etag FROM subtitle_tracks WHERE playable_unit_id = ? AND format = 'vtt' AND r2_etag IS NOT NULL AND r2_etag <> '' ORDER BY language, track_key").bind(unitId),
  ]);
  if (files.results.length !== 1) return fail("NOT_FOUND", "MEDIA_MISSING", "暂无可播放片源。");
  const file = files.results[0], fileId = file.id;
  if (!file.r2_etag) return fail("NOT_FOUND", "MEDIA_MISSING", "媒体暂时不可用。");
  const subtitleTracks = tracks.results as (MediaFile & { language: string; display_name: string })[];
  // Keep optional subtitle checks observed while required video failures return promptly.
  const videoCheck = verifiedObject(env.MEDIA_BUCKET, file);
  const subtitleChecks = Promise.allSettled(subtitleTracks.map(track => verifiedObject(env.MEDIA_BUCKET, track)));
  const video = await videoCheck;
  if (!video) return fail("NOT_FOUND", "MEDIA_MISSING", "媒体暂时不可用。");
  const subtitles = await subtitleChecks;
  const availableTracks = subtitleTracks.filter((track, index) => {
    const result = subtitles[index];
    if (result.status === "fulfilled") return result.value !== null;
    console.warn(JSON.stringify({ event: "subtitle_unavailable", resourceId: track.id })); return false;
  });
  await quota(env, current, unitId, file);
  const iat = Math.floor(Date.now() / 1000), exp = iat + settings.playbackTokenTtl;
  const token = await signPlayback(env, { v: 1, kid: "1", environment: env.APP_ENV, purpose: "playback", userId: current.member.user_id, sessionId: current.session.id, playableUnitId: unitId, mediaFileId: fileId, iat, exp });
  return { url: `/media/${fileId}?token=${token}`, expiresAt: exp * 1000, tracks: availableTracks.map(track => ({ id: track.id, language: track.language, displayName: track.display_name, url: `/subtitles/${track.id}?token=${token}` })) };
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

// A fixed-length stream preserves Content-Length in workerd and ties cancellation to the pipe.
export function deadlineStream(source: ReadableStream<Uint8Array>, length: number, expiresAt: number, signal: AbortSignal, ctx: ExecutionContext) {
  const stream = new FixedLengthStream(length), reader = source.getReader(), writer = stream.writable.getWriter();
  let stopped = false;
  const abort = () => {
    stopped = true;
    ctx.waitUntil(reader.cancel().catch(() => {}));
    ctx.waitUntil(writer.abort(new Error("Media stream stopped")).catch(() => {}));
  };
  const timer = setTimeout(abort, Math.max(0, expiresAt - Date.now()));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  ctx.waitUntil((async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (stopped) break;
        if (done) { await writer.close(); return; }
        await writer.write(value);
      }
    } catch { await writer.abort(new Error("Media stream stopped")).catch(() => {}); }
    finally { await reader.cancel().catch(() => {}); clearTimeout(timer); signal.removeEventListener("abort", abort); }
  })());
  return stream.readable;
}

export async function playbackHttp(request: Request, env: Env, ctx: ExecutionContext, identity = createRequestIdentity(request, env)) {
  const url = new URL(request.url), issuing = /^\/playback\/([^/]+)\/authorize$/u.exec(url.pathname);
  if (issuing) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    if (url.search) return fail("BAD_REQUEST", "INVALID_INPUT", "签发参数无效。");
    const body = await readJson(request); await checkCsrf(request, env, body.csrfToken);
    if (Object.keys(body).some(key => key !== "csrfToken")) return fail("BAD_REQUEST", "INVALID_INPUT", "签发参数无效。");
    const headers = new Headers();
    return Response.json(await authorizePlayback(request, env, issuing[1], headers, identity), { headers });
  }
  const match = /^\/(media|subtitles)\/([^/]+)$/u.exec(url.pathname);
  if (!match) return fail("NOT_FOUND", "NOT_FOUND", "资源不存在。");
  const current = await requireMember(request, env, identity);
  if (url.searchParams.getAll("token").length !== 1 || [...url.searchParams.keys()].some(key => key !== "token")) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。");
  const payload = await verifyPlayback(env, url.searchParams.get("token")!);
  if (payload.userId !== current.member.user_id || payload.sessionId !== current.session.id) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证不属于当前会话。");
  const media = match[1] === "media", target = media ? "m" : "t";
  const file = await env.DB.withSession("first-primary").prepare(`SELECT ${target}.id, ${target}.playable_unit_id, ${target}.format,
      ${target}.object_key, ${target}.byte_length, ${target}.r2_etag FROM (${liveSession}) AS active
    LEFT JOIN media_files m ON m.id = ? AND m.playable_unit_id = ? AND m.format = 'mp4'
    ${media ? "" : "LEFT JOIN subtitle_tracks t ON t.id = ? AND t.playable_unit_id = m.playable_unit_id AND t.format = 'vtt'"}`)
    .bind(current.session.id, current.member.user_id, new Date().toISOString(), payload.mediaFileId, payload.playableUnitId, ...(media ? [] : [match[2]]))
    .first<{ id: string | null; playable_unit_id: string; format: string; object_key: string; byte_length: number; r2_etag: string | null }>();
  if (!file) return fail("UNAUTHORIZED", "AUTH_REQUIRED", "会话已失效，请重新登录。");
  if (file.id !== match[2] || file.playable_unit_id !== payload.playableUnitId || (media ? file.id !== payload.mediaFileId || file.format !== "mp4" : file.format !== "vtt")) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证不能访问此资源。");
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const metadata = await verifiedObject(env.MEDIA_BUCKET, file);
  if (!metadata) { console.info(JSON.stringify({ event: "media_missing", resourceId: file.id })); return fail("NOT_FOUND", "MEDIA_MISSING", "媒体暂时不可用。"); }
  const headers = new Headers({ "Content-Type": match[1] === "media" ? "video/mp4" : "text/vtt; charset=utf-8", "Content-Length": String(metadata.size), "Accept-Ranges": "bytes", ETag: metadata.httpEtag, "Last-Modified": metadata.uploaded.toUTCString(), "Cache-Control": "private, no-store", "Content-Encoding": "identity" });
  current.headers.forEach((value, name) => headers.append(name, value));
  if (request.method === "HEAD") return new Response(null, { headers });
  const raw = request.headers.get("Range"), condition = request.headers.get("If-Range");
  const date = condition && !condition.startsWith('"') && !condition.startsWith("W/") ? Date.parse(condition) : NaN;
  const matching = !condition || condition === metadata.httpEtag || Number.isFinite(date) && Math.floor(metadata.uploaded.getTime() / 1000) <= date / 1000;
  const range = raw && matching ? rangeRequest(raw, metadata.size) : null;
  if (range && "unsatisfied" in range) { headers.set("Content-Range", `bytes */${metadata.size}`); headers.delete("Content-Length"); return new Response(null, { status: 416, headers }); }
  let object;
  try { object = await env.MEDIA_BUCKET.get(file.object_key, range ? { range: request.headers } : undefined); }
  catch { return fail("SERVICE_UNAVAILABLE", "MEDIA_UNAVAILABLE", "媒体服务暂时不可用，请稍后重试。"); }
  if (!object || !("body" in object)) return fail("NOT_FOUND", "MEDIA_MISSING", "媒体暂时不可用。");
  if (object.size !== metadata.size || object.etag !== metadata.etag) { await object.body.cancel(); return fail("NOT_FOUND", "MEDIA_MISSING", "媒体暂时不可用。"); }
  let length = object.size, status = 200;
  if (range) {
    const actual = object.range;
    const start = actual && "offset" in actual ? actual.offset ?? 0 : range.start;
    length = actual && "length" in actual ? actual.length ?? object.size - start : range.end - start + 1;
    if (start !== range.start || length !== range.end - range.start + 1) { await object.body.cancel(); throw new Error("R2 range mismatch"); }
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`); status = 206;
  }
  headers.set("Content-Length", String(length));
  return new Response(deadlineStream(object.body, length, payload.exp * 1000, request.signal, ctx), { status, headers, encodeBody: "manual" });
}
