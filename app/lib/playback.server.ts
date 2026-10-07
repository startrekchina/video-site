import { APIError } from "better-auth/api";
import { requireMember } from "./member.server";
import { checkCsrf, readJson } from "./security.server";
import { settings } from "./settings.server";

type Payload = { v: number; kid: string; environment: string; purpose: string; userId: string; sessionId: string; playableUnitId: string; mediaFileId: string; iat: number; exp: number };
export type Authorization = { url: string; expiresAt: number; tracks: { id: string; language: string; displayName: string; url: string }[] };
const encoder = new TextEncoder(), prefix = "video-site:playback\0";
const fail = (status: "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "NOT_FOUND", code: string, message: string): never => { throw new APIError(status, { code, message }); };
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

async function liveMember(request: Request, env: Env) {
  const current = await requireMember(request, env);
  const now = new Date().toISOString();
  const active = await env.DB.withSession("first-primary").prepare(`SELECT s.id FROM session s JOIN "user" u ON u.id = s.userId
    JOIN member_profiles p ON p.user_id = u.id WHERE s.id = ? AND s.userId = ? AND s.expiresAt > ?
    AND u.emailVerified = 1 AND p.registration_state = 'completed' AND p.status = 'active'`).bind(current.session.id, current.member.user_id, now).first();
  if (!active) return fail("UNAUTHORIZED", "AUTH_REQUIRED", "会话已失效，请重新登录。");
  return current;
}
async function quota(env: Env, userId: string) {
  const now = Date.now(), counter = `playback:${userId}`;
  const result = await env.DB.prepare(`INSERT INTO rate_limit_counters (key, operation, occurred_at, count, expires_at)
    SELECT ?, 'playback', ?, 1, ? WHERE (SELECT coalesce(sum(count), 0) FROM rate_limit_counters WHERE key = ? AND operation = 'playback' AND occurred_at > ?) < ?
    ON CONFLICT(key, operation, occurred_at) DO UPDATE SET count = count + 1`).bind(counter, now, now + 60000, counter, now - 60000, settings.rateLimits.playbackTokenPerMember.perMinute).run();
  if (!result.meta.changes) {
    const earliest = await env.DB.prepare("SELECT min(occurred_at) AS n FROM rate_limit_counters WHERE key = ? AND operation = 'playback' AND occurred_at > ?").bind(counter, now - 60000).first<number>("n");
    throw new APIError("TOO_MANY_REQUESTS", { code: "PLAYBACK_RATE_LIMITED", message: "签发过于频繁，请稍后重试。" }, { "Retry-After": String(Math.max(1, Math.ceil(((earliest ?? now) + 60000 - now) / 1000))) });
  }
}
export async function authorizePlayback(request: Request, env: Env, unitId: string, responseHeaders?: Headers): Promise<Authorization> {
  const current = await liveMember(request, env);
  current.headers.forEach((value, name) => responseHeaders?.append(name, value));
  const files = await env.DB.withSession("first-primary").prepare("SELECT id FROM media_files WHERE playable_unit_id = ? AND format = 'mp4'").bind(unitId).all<{ id: string }>();
  if (files.results.length !== 1) return fail("NOT_FOUND", "MEDIA_MISSING", "暂无可播放片源。");
  await quota(env, current.member.user_id);
  const iat = Math.floor(Date.now() / 1000), exp = iat + settings.playbackTokenTtl;
  const token = await signPlayback(env, { v: 1, kid: "1", environment: env.APP_ENV, purpose: "playback", userId: current.member.user_id, sessionId: current.session.id, playableUnitId: unitId, mediaFileId: files.results[0].id, iat, exp });
  const tracks = await env.DB.prepare("SELECT id, language, display_name FROM subtitle_tracks WHERE playable_unit_id = ? AND format = 'vtt' ORDER BY language, track_key").bind(unitId).all<{ id: string; language: string; display_name: string }>();
  return { url: `/media/${files.results[0].id}?token=${token}`, expiresAt: exp * 1000, tracks: tracks.results.map(track => ({ id: track.id, language: track.language, displayName: track.display_name, url: `/subtitles/${track.id}?token=${token}` })) };
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

export async function playbackHttp(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url), issuing = /^\/playback\/([^/]+)\/authorize$/u.exec(url.pathname);
  if (issuing) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    if (url.search) return fail("BAD_REQUEST", "INVALID_INPUT", "签发参数无效。");
    const body = await readJson(request); await checkCsrf(request, env, body.csrfToken);
    if (Object.keys(body).some(key => key !== "csrfToken")) return fail("BAD_REQUEST", "INVALID_INPUT", "签发参数无效。");
    const headers = new Headers();
    return Response.json(await authorizePlayback(request, env, issuing[1], headers), { headers });
  }
  const match = /^\/(media|subtitles)\/([^/]+)$/u.exec(url.pathname);
  if (!match) return fail("NOT_FOUND", "NOT_FOUND", "资源不存在。");
  const current = await liveMember(request, env);
  if (url.searchParams.getAll("token").length !== 1 || [...url.searchParams.keys()].some(key => key !== "token")) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证无效。");
  const payload = await verifyPlayback(env, url.searchParams.get("token")!);
  if (payload.userId !== current.member.user_id || payload.sessionId !== current.session.id) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证不属于当前会话。");
  const authorizedMedia = await env.DB.withSession("first-primary").prepare("SELECT id FROM media_files WHERE id = ? AND playable_unit_id = ? AND format = 'mp4'").bind(payload.mediaFileId, payload.playableUnitId).first();
  if (!authorizedMedia) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放片源已失效。");
  const table = match[1] === "media" ? "media_files" : "subtitle_tracks";
  const file = await env.DB.withSession("first-primary").prepare(`SELECT id, playable_unit_id, format, object_key, byte_length, r2_etag FROM ${table} WHERE id = ?`).bind(match[2]).first<{ id: string; playable_unit_id: string; format: string; object_key: string; byte_length: number; r2_etag: string | null }>();
  if (!file || file.playable_unit_id !== payload.playableUnitId || (match[1] === "media" ? file.id !== payload.mediaFileId || file.format !== "mp4" : file.format !== "vtt")) return fail("FORBIDDEN", "PLAYBACK_INVALID", "播放凭证不能访问此资源。");
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const metadata = await env.MEDIA_BUCKET.head(file.object_key);
  if (!metadata || file.r2_etag && metadata.etag !== file.r2_etag) { console.info(JSON.stringify({ event: "media_missing", resourceId: file.id })); return fail("NOT_FOUND", "MEDIA_MISSING", "媒体暂时不可用。"); }
  if (metadata.size !== file.byte_length) throw new Error("Media length mismatch");
  const headers = new Headers({ "Content-Type": match[1] === "media" ? "video/mp4" : "text/vtt; charset=utf-8", "Content-Length": String(metadata.size), "Accept-Ranges": "bytes", ETag: metadata.httpEtag, "Last-Modified": metadata.uploaded.toUTCString(), "Cache-Control": "private, no-store", "Content-Encoding": "identity" });
  current.headers.forEach((value, name) => headers.append(name, value));
  if (request.method === "HEAD") return new Response(null, { headers });
  const raw = request.headers.get("Range"), condition = request.headers.get("If-Range");
  const date = condition && !condition.startsWith('"') && !condition.startsWith("W/") ? Date.parse(condition) : NaN;
  const matching = !condition || condition === metadata.httpEtag || Number.isFinite(date) && Math.floor(metadata.uploaded.getTime() / 1000) <= date / 1000;
  const range = raw && matching ? rangeRequest(raw, metadata.size) : null;
  if (range && "unsatisfied" in range) { headers.set("Content-Range", `bytes */${metadata.size}`); headers.delete("Content-Length"); return new Response(null, { status: 416, headers }); }
  const object = await env.MEDIA_BUCKET.get(file.object_key, range ? { range: request.headers } : undefined);
  if (!object || !("body" in object)) return fail("NOT_FOUND", "MEDIA_MISSING", "媒体暂时不可用。");
  if (object.size !== metadata.size || object.etag !== metadata.etag) { await object.body.cancel(); throw new Error("Media object changed"); }
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
