import { APIError } from "better-auth/api";
import { createRequestIdentity, liveMemberSql, type D1Reader } from "./member.server";
import { checkWrite, readJson } from "./security.server";
import { settings } from "./settings.server";

export type Danmaku = { id: string; time: number; text: string; mode: 0 | 1 | 2; color: string };
export type AdminDanmaku = Danmaku & { author: string; createdAt: number };

const fail = (status: "BAD_REQUEST" | "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN", code: string, message: string): never => { throw new APIError(status, { code, message }); };
const invalid = (message = "请求格式无效。") => fail("BAD_REQUEST", "INVALID_INPUT", message);
const missing = () => fail("NOT_FOUND", "NOT_FOUND", "弹幕不存在或已被删除。");
const respond = (request: Request, body: object) => Response.json({ ...body, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() });
const { minInterval, perHour } = settings.rateLimits.danmaku;
const HOUR = 3600000;
// Members never see who sent a danmaku (B 6.17); only the admin list adds the author.
const fields = "d.id, d.position_seconds AS time, d.text, d.mode, d.color";

// B 6.17: plain text without line breaks, counted in Unicode code points like comments.
function text(value: unknown) {
  const body = typeof value === "string" ? value.trim() : "";
  return body && [...body].length <= settings.danmaku.maxLength && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(body)
    && /[^\p{White_Space}\p{Default_Ignorable_Code_Point}]/u.test(body) ? body : invalid(`弹幕需为 1–${settings.danmaku.maxLength} 个字，不能换行。`);
}

// Danmaku under one playable unit: members read and send, admins list senders and delete (B 6.17).
export async function danmakuHttp(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const url = new URL(request.url), match = /^\/units\/([^/]+)\/danmaku(?:\/([^/]+))?$/u.exec(url.pathname);
  const [, unitId, part] = match ?? [];
  const route = `${request.method} ${part === "admin" ? "admin" : part ? "item" : "list"}`;
  if (!match || !["GET list", "POST list", "GET admin", "DELETE item"].includes(route)) return new Response(null, { status: 404 });
  if (request.method !== "GET") checkWrite(request, env);
  const body = request.method === "POST" ? await readJson(request) : {}, db = env.DB, now = Date.now();
  const read = async <T>(load: (reader: D1Reader) => Promise<T>) => await identity.read(load) ?? fail("UNAUTHORIZED", "AUTH_REQUIRED", "请先登录。");
  const admin = (role: string) => { if (role !== "admin") fail("FORBIDDEN", "FORBIDDEN", "需要管理员权限。"); };

  if (route === "GET list") {
    const current = await read(reader => reader.batch<Record<string, unknown>>([reader.prepare("SELECT 1 FROM playable_units WHERE id = ?").bind(unitId),
      reader.prepare(`SELECT ${fields} FROM danmaku d WHERE d.playable_unit_id = ? ORDER BY d.created_at DESC, d.id DESC LIMIT ?`).bind(unitId, settings.danmaku.readLimit)]));
    const [unit, rows] = current.value;
    if (!unit.results.length) missing();
    return respond(request, { data: { items: rows.results as Danmaku[] } });
  }
  if (route === "GET admin") {
    const raw = url.searchParams.get("page") ?? "1", page = /^\d{1,6}$/u.test(raw) ? Number(raw) : 0, size = settings.danmaku.adminPageSize;
    if (page < 1) invalid();
    admin((await read(async () => null)).member.role);
    const reader = db.withSession("first-primary"), [count, rows] = await reader.batch<Record<string, unknown>>([
      reader.prepare("SELECT count(*) AS total FROM danmaku WHERE playable_unit_id = ?").bind(unitId),
      reader.prepare(`SELECT ${fields}, d.created_at AS createdAt, coalesce(u.displayUsername, u.username) AS author FROM danmaku d
        JOIN "user" u ON u.id = d.author_user_id WHERE d.playable_unit_id = ? ORDER BY d.position_seconds, d.created_at, d.id LIMIT ? OFFSET ?`)
        .bind(unitId, size, (page - 1) * size)]);
    return respond(request, { data: { items: rows.results as AdminDanmaku[], total: count.results[0].total as number, pageSize: size } });
  }
  if (route === "DELETE item") {
    const current = await read(async () => null);
    admin(current.member.role);
    // Deletion is final and refunds no send quota (B 6.17); a target already gone or under another unit is missing alike.
    const saved = await db.prepare(`DELETE FROM danmaku WHERE id = ? AND playable_unit_id = ?
      AND EXISTS (SELECT 1 ${liveMemberSql} AND p.role = 'admin')`)
      .bind(part, unitId, current.member.user_id, current.session.id, new Date().toISOString()).run();
    if (!saved.meta.changes) { admin((await read(async () => null)).member.role); missing(); }
    return respond(request, { data: { deleted: true } });
  }

  const content = text(body.text), color = typeof body.color === "string" ? body.color.toUpperCase() : "";
  const time = typeof body.time === "number" && Number.isFinite(body.time) && body.time >= 0 ? body.time : invalid("弹幕时间无效。");
  const mode = body.mode === 0 || body.mode === 1 || body.mode === 2 ? body.mode : invalid("弹幕位置无效。");
  if (!(settings.danmaku.colors as readonly string[]).includes(color)) invalid("弹幕颜色无效。");
  const current = await read(reader => reader.batch<{ media_duration: number | null }>([reader.prepare(`SELECT (SELECT m.duration_seconds FROM media_files m
    WHERE m.playable_unit_id = u.id AND m.format = 'mp4' AND m.variant = 'original' AND m.r2_etag IS NOT NULL AND m.r2_etag <> '') AS media_duration
    FROM playable_units u WHERE u.id = ?`).bind(unitId)]));
  const unit = current.value[0].results[0];
  if (!unit) missing();
  if (unit.media_duration === null) fail("NOT_FOUND", "MEDIA_MISSING", "片源暂时无法播放。");
  if (time > unit.media_duration!) invalid("弹幕时间超出片长。");
  const key = `danmaku:${current.member.user_id}`, item: Danmaku = { id: crypto.randomUUID(),
    time: Math.min(Math.round(time * 10), Math.floor(unit.media_duration! * 10)) / 10, text: content, mode, color };
  // One transaction: the danmaku is written only while both limits hold, its counter row follows it, and this member's
  // expired counters are cleared. Counters outlive deleted danmaku, so deletions refund nothing.
  const [saved] = await db.batch([
    db.prepare(`INSERT INTO danmaku (id, playable_unit_id, author_user_id, position_seconds, text, mode, color, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE NOT EXISTS (SELECT 1 FROM rate_limit_counters WHERE key = ?9 AND operation = 'danmaku' AND occurred_at > ?8 - ?10)
        AND (SELECT coalesce(sum(count), 0) FROM rate_limit_counters WHERE key = ?9 AND operation = 'danmaku' AND occurred_at > ?8 - ?11) < ?12`)
      .bind(item.id, unitId, current.member.user_id, item.time, item.text, item.mode, item.color, now, key, minInterval * 1000, HOUR, perHour),
    db.prepare(`INSERT INTO rate_limit_counters (key, operation, occurred_at, count, expires_at)
      SELECT ?1, 'danmaku', ?2, 1, ?2 + ?3 WHERE EXISTS (SELECT 1 FROM danmaku WHERE id = ?4)`).bind(key, now, HOUR, item.id),
    db.prepare("DELETE FROM rate_limit_counters WHERE key = ? AND operation = 'danmaku' AND expires_at <= ?").bind(key, now),
  ]);
  if (!saved.meta.changes) {
    const last = await db.prepare(`SELECT max(occurred_at) AS latest, min(occurred_at) AS earliest, coalesce(sum(count), 0) AS n FROM rate_limit_counters
      WHERE key = ? AND operation = 'danmaku' AND occurred_at > ?`).bind(key, now - HOUR).first<{ latest: number | null; earliest: number | null; n: number }>();
    const hourly = (last?.n ?? 0) >= perHour, until = Math.max((last?.latest ?? now) + minInterval * 1000, hourly ? (last?.earliest ?? now) + HOUR : 0);
    const wait = Math.max(1, Math.ceil((until - now) / 1000));
    throw new APIError("TOO_MANY_REQUESTS", { code: "DANMAKU_RATE_LIMITED", message: hourly ? `每小时最多发送 ${perHour} 条弹幕，请稍后再试。` : `发送太快，请 ${wait} 秒后再试。` },
      { "Retry-After": String(wait) });
  }
  return respond(request, { data: { item } });
}
