import { APIError } from "better-auth/api";
import { requireMember } from "./member.server";
import { checkCsrf, readJson } from "./security.server";
import { actorSql, occupiedSql } from "./invitations.server";
import { deliverMail, reserveMail } from "./mail.server";
import { settings } from "./settings.server";

const normalAdmins = `(SELECT count(*) FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id
  WHERE p.role = 'admin' AND p.status = 'active' AND p.registration_state = 'completed' AND u.emailVerified = 1)`;
const adminSql = `${actorSql} AND EXISTS (SELECT 1 FROM member_profiles AS a JOIN "user" AS u ON u.id = a.user_id
  JOIN session AS s ON s.userId = a.user_id JOIN twoFactor AS t ON t.userId = a.user_id
  WHERE a.user_id = ? AND a.role = 'admin' AND u.twoFactorEnabled = 1 AND t.verified = 1
    AND s.id = ? AND s.createdAt > ?)`;

export async function adminHttp(request: Request, env: Env) {
  const current = await requireMember(request, env);
  if (current.member.role !== "admin") throw new APIError("FORBIDDEN", { code: "FORBIDDEN", message: "需要管理员权限。" });
  const path = new URL(request.url).pathname;
  const now = Date.now();
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || query.length > 30) {
    throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "页码或搜索内容无效。" });
  }
  if (request.method === "GET" && path === "/admin/members/stats") {
    const stats = await env.DB.prepare(`SELECT
      count(*) AS total, coalesce(sum(p.status = 'active'), 0) AS active, coalesce(sum(p.status = 'banned'), 0) AS banned,
      coalesce(sum(instr(lower(coalesce(u.displayUsername, u.username)), lower(?)) > 0), 0) AS filtered,
      coalesce(sum(p.invited_by_user_id IS NULL), 0) AS roots,
      (SELECT count(*) FROM invitations WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?) AS validUnused,
      (SELECT count(*) FROM invitations) AS invitationCount
      FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id WHERE p.registration_state = 'completed'`).bind(query, now).first();
    return Response.json({ data: stats, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  if (request.method === "GET" && path === "/admin/members/invitations") {
    const rows = await env.DB.prepare(`SELECT i.id, i.created_at, i.expires_at, i.revoked_at, i.used_at,
      i.issuer_user_id AS issuerId, issuer.displayUsername AS issuer, used.displayUsername AS usedBy
      FROM invitations AS i LEFT JOIN "user" AS issuer ON issuer.id = i.issuer_user_id
      LEFT JOIN "user" AS used ON used.id = i.used_by_user_id ORDER BY i.created_at DESC, i.id LIMIT 20 OFFSET ?`).bind((page - 1) * 20).all();
    return Response.json({ data: rows.results, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  const preview = /^\/admin\/members\/([^/]+)\/ban-preview$/.exec(path);
  if (request.method === "GET" && preview) {
    const rows = await env.DB.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT user_id FROM member_profiles WHERE invited_by_user_id = ? AND role = 'member'
      UNION ALL SELECT p.user_id FROM member_profiles AS p JOIN descendants AS d ON p.invited_by_user_id = d.id WHERE p.role = 'member'
    ) SELECT u.displayUsername AS username, p.status, count(*) OVER () AS total,
      sum(p.status = 'active') OVER () AS active FROM descendants AS d JOIN member_profiles AS p ON p.user_id = d.id
      JOIN "user" AS u ON u.id = p.user_id ORDER BY p.created_at, p.user_id LIMIT 20`).bind(preview[1]).all<{ username: string; status: string; total: number; active: number }>();
    return Response.json({ data: { total: rows.results[0]?.total ?? 0, active: rows.results[0]?.active ?? 0,
      members: rows.results.map(row => ({ username: row.username, status: row.status })) },
      requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  const children = /^\/admin\/members\/([^/]+)\/invited$/.exec(path);
  if (request.method === "GET" && (children || path === "/admin/members/roots")) {
    const rows = await env.DB.prepare(`SELECT p.user_id, u.displayUsername AS username, p.role, p.status,
      (SELECT count(*) FROM member_profiles AS child WHERE child.invited_by_user_id = p.user_id AND child.registration_state = 'completed') AS childCount
      FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id
      WHERE ${children ? "p.invited_by_user_id = ?" : "p.invited_by_user_id IS NULL"} AND p.registration_state = 'completed'
      ORDER BY p.created_at, p.user_id LIMIT 20 OFFSET ?`).bind(...(children ? [children[1]] : []), (page - 1) * 20).all();
    return Response.json({ data: rows.results, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  if (request.method === "GET" && path === "/admin/members/data") {
    const rows = await env.DB.prepare(`SELECT p.user_id, u.displayUsername AS username, u.emailVerified, p.role, p.status,
      p.invite_quota AS total, ${occupiedSql} AS occupied, p.invited_by_user_id AS invitedById, parent.displayUsername AS invitedBy, p.created_at,
      (SELECT count(*) FROM member_profiles AS child WHERE child.invited_by_user_id = p.user_id AND child.registration_state = 'completed') AS childCount,
      (SELECT max(updatedAt) FROM session WHERE userId = p.user_id) AS sessionUpdatedAt
      FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id LEFT JOIN "user" AS parent ON parent.id = p.invited_by_user_id
      WHERE p.registration_state = 'completed' AND instr(lower(coalesce(u.displayUsername, u.username)), lower(?)) > 0
      ORDER BY p.created_at DESC, p.user_id LIMIT 20 OFFSET ?`).bind(now, query, (page - 1) * 20).all();
    return Response.json({ data: rows.results, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  const match = /^\/admin\/members\/([^/]+)\/(ban|unban|quota|role)$/.exec(path);
  if (request.method !== "POST" || !match) return new Response(null, { status: 404 });
  const body = await readJson(request);
  await checkCsrf(request, env, body.csrfToken);
  const actorId = current.member.user_id;
  const totp = await env.DB.prepare("SELECT id FROM twoFactor WHERE userId = ? AND verified = 1").bind(actorId).first();
  if (!current.member.twoFactorEnabled || !totp || new Date(current.session.createdAt).getTime() <= now - settings.session.freshAge * 1000) {
    throw new APIError("FORBIDDEN", { code: "FRESH_SESSION_REQUIRED", message: "请先绑定二步验证，并在五分钟内重新登录。" });
  }
  const key = `admin:${actorId}`;
  const limit = await env.DB.prepare(`INSERT INTO rate_limit_counters (key, operation, occurred_at, count, expires_at)
    SELECT ?, 'admin', ?, 1, ? WHERE (SELECT coalesce(sum(count), 0) FROM rate_limit_counters
      WHERE key = ? AND operation = 'admin' AND occurred_at > ?) < ?
    ON CONFLICT (key, operation, occurred_at) DO UPDATE SET count = count + 1`)
    .bind(key, now, now + 60000, key, now - 60000, settings.rateLimits.adminHighImpactPerAdmin.perMinute).run();
  if (!limit.meta.changes) {
    const earliest = await env.DB.prepare("SELECT min(occurred_at) AS n FROM rate_limit_counters WHERE key = ? AND operation = 'admin' AND occurred_at > ?").bind(key, now - 60000).first<number>("n");
    throw new APIError("TOO_MANY_REQUESTS", { code: "ADMIN_RATE_LIMITED", message: "管理操作过于频繁，请稍后再试。" }, { "Retry-After": String(Math.max(1, Math.ceil(((earliest ?? now) + 60000 - now) / 1000))) });
  }
  const [targetId, operation] = match.slice(1);
  const parameters = [actorId, current.session.id, new Date(now).toISOString(), actorId, current.session.id, new Date(now - settings.session.freshAge * 1000).toISOString()];
  let result: D1Result;
  let notifications: { user_id: string }[] = [];
  if (operation === "ban") {
    if (typeof body.cascade !== "boolean") throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "请选择是否连带封禁。" });
    const rows = await env.DB.prepare(`WITH RECURSIVE affected(id) AS (
      SELECT user_id FROM member_profiles WHERE user_id = ? AND status = 'active' AND registration_state = 'completed'
        AND user_id <> ? AND (role <> 'admin' OR (SELECT emailVerified FROM "user" WHERE id = user_id) = 0 OR ${normalAdmins} > 1)
      UNION ALL SELECT p.user_id FROM member_profiles AS p JOIN affected ON p.invited_by_user_id = affected.id WHERE ? = 1 AND p.role = 'member'
    ) UPDATE member_profiles SET status = 'banned' WHERE user_id IN (SELECT id FROM affected) AND status <> 'banned' AND ${adminSql}
      RETURNING user_id`).bind(targetId, actorId, Number(body.cascade), ...parameters).all<{ user_id: string }>();
    result = rows;
    notifications = rows.results;
  } else if (operation === "unban") {
    result = await env.DB.prepare(`UPDATE member_profiles SET status = 'active' WHERE user_id = ? AND status = 'banned' AND registration_state = 'completed' AND ${adminSql}`).bind(targetId, ...parameters).run();
  } else if (operation === "quota") {
    if (typeof body.total !== "number" || !Number.isSafeInteger(body.total) || body.total < 0) throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "总额度必须为非负整数。" });
    result = await env.DB.prepare(`UPDATE member_profiles AS p SET invite_quota = ? WHERE user_id = ? AND registration_state = 'completed'
      AND ? >= ${occupiedSql} AND ${adminSql}`).bind(body.total, targetId, body.total, now, ...parameters).run();
  } else {
    if (body.role !== "member" && body.role !== "admin") throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "角色无效。" });
    result = await env.DB.prepare(`UPDATE member_profiles SET role = ? WHERE user_id = ? AND user_id <> ? AND registration_state = 'completed'
      AND (? = 'admin' OR role <> 'admin' OR status <> 'active' OR (SELECT emailVerified FROM "user" WHERE id = user_id) = 0 OR ${normalAdmins} > 1) AND ${adminSql}`)
      .bind(body.role, targetId, actorId, body.role, ...parameters).run();
  }
  if (!result.meta.changes) {
    const occupied = await env.DB.prepare(`SELECT ${occupiedSql} AS n FROM member_profiles AS p WHERE user_id = ?`).bind(now, targetId).first<number>("n");
    throw new APIError("CONFLICT", { code: operation === "quota" ? "QUOTA_EXHAUSTED" : "ADMIN_CHANGE_REJECTED", message: operation === "quota" ? `总额度不得低于当前占用（${occupied ?? 0}）。` : "目标状态已变化，或操作受到管理员保护。" });
  }
  const notificationResults = await Promise.all(notifications.map(async member => {
    try {
      const email = await env.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(member.user_id).first<string>("email");
      if (!email) return false;
      const attempt = await reserveMail(env, email, "admin_notification");
      await deliverMail(env, attempt, "你的账号已被封禁，无法访问成员功能。如有疑问，请联系站点管理员。", member.user_id);
      const status = await env.DB.prepare("SELECT status FROM email_deliveries WHERE id = ?").bind(attempt.id).first<string>("status");
      return status === "accepted";
    } catch { return false; }
  }));
  const failedNotifications = notificationResults.filter(result => !result).length;
  return Response.json({ data: { changed: operation === "ban" ? notifications.length : result.meta.changes, failedNotifications }, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
}
