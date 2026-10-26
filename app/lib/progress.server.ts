import { APIError } from "better-auth/api";
import { mediaDuration } from "./catalog.server";
import { createRequestIdentity } from "./member.server";
import { checkWrite, readJson } from "./security.server";
import { settings } from "./settings.server";

type Unit = { media_duration: number | null; duration_seconds: number | null; revision: number | null };
const invalid = (message = "请求格式无效。"): never => { throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message }); };

// Personal watch progress: the member comes from the session and the duration from imported media, never from the client.
export async function progressHttp(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const match = /^\/me\/progress\/([^/]+)$/u.exec(new URL(request.url).pathname);
  if (request.method !== "PUT" || !match) return new Response(null, { status: 404 });
  checkWrite(request, env);
  const body = await readJson(request), unitId = match[1];
  const current = await identity.read((db, userId) => db.batch([db.prepare(`SELECT u.duration_seconds,
      (${mediaDuration}) AS media_duration,
      p.revision FROM playable_units u LEFT JOIN watch_progress p ON p.playable_unit_id = u.id AND p.user_id = ? WHERE u.id = ?`).bind(userId, unitId)]));
  if (!current) throw new APIError("UNAUTHORIZED", { code: "AUTH_REQUIRED", message: "请先登录。" });
  const expected = body.expectedRevision, manual = "completed" in body;
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 || manual === ("positionSeconds" in body)) invalid();
  if (manual ? typeof body.completed !== "boolean" : typeof body.positionSeconds !== "number" || !Number.isFinite(body.positionSeconds) || body.positionSeconds < 0) invalid();
  const unit = current.value[0].results[0] as Unit | undefined;
  if (!unit) throw new APIError("NOT_FOUND", { code: "NOT_FOUND", message: "该单集或电影不存在。" });
  // Automatic reports need watchable media; a manual mark also covers what the member watched elsewhere.
  if (!manual && unit.media_duration === null) throw new APIError("NOT_FOUND", { code: "MEDIA_MISSING", message: "片源暂时无法播放。" });
  const duration = unit.media_duration ?? unit.duration_seconds ?? 0;
  if (!manual && (body.positionSeconds as number) > duration) invalid("播放位置超出片长。");
  const position = manual ? (body.completed ? duration : 0) : body.positionSeconds as number;
  const completed = manual ? Number(body.completed) : Number(position >= settings.completionThreshold * duration);
  const userId = current.member.user_id, now = Date.now();
  // A first row needs expectedRevision 0; an existing row changes only at its expected revision. Automatic
  // reports never clear a completion, so rewatching keeps the mark, while a manual "unwatched" resets it.
  const saved = await env.DB.prepare(`INSERT INTO watch_progress (user_id, playable_unit_id, position_seconds, completed, updated_at, revision)
    SELECT ?1, ?2, ?3, ?4, ?5, 1 WHERE ?6 = 0 OR EXISTS (SELECT 1 FROM watch_progress WHERE user_id = ?1 AND playable_unit_id = ?2)
    ON CONFLICT (user_id, playable_unit_id) DO UPDATE SET position_seconds = excluded.position_seconds,
      completed = CASE WHEN ?7 THEN excluded.completed ELSE max(watch_progress.completed, excluded.completed) END,
      updated_at = excluded.updated_at, revision = watch_progress.revision + 1
    WHERE watch_progress.revision = ?6
    RETURNING position_seconds, completed, updated_at, revision`)
    .bind(userId, unitId, position, completed, now, expected, manual ? 1 : 0)
    .first<{ position_seconds: number; completed: number; updated_at: number; revision: number }>();
  const requestId = request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID();
  if (!saved) {
    const revision = await env.DB.prepare("SELECT revision FROM watch_progress WHERE user_id = ? AND playable_unit_id = ?").bind(userId, unitId).first<number>("revision");
    return Response.json({ error: { code: "REVISION_CONFLICT", message: "进度已在其他设备更新。", revision: revision ?? 0 }, requestId }, { status: 409 });
  }
  return Response.json({ data: { positionSeconds: saved.position_seconds, completed: Boolean(saved.completed), updatedAt: saved.updated_at, revision: saved.revision }, requestId });
}
