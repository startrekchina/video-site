import { APIError } from "better-auth/api";
import { requireMember } from "./member.server";
import { checkCsrf, readJson } from "./security.server";
import { sha256 } from "./registration.server";
import { settings } from "./settings.server";

export const occupiedSql = `(SELECT count(*) FROM invitations AS i WHERE i.issuer_user_id = p.user_id
  AND (i.used_by_user_id IS NOT NULL OR (i.revoked_at IS NULL AND i.expires_at > ?)))`;

// Bind the actor and the native session again at the write boundary.
export const actorSql = `EXISTS (SELECT 1 FROM member_profiles AS actor JOIN "user" AS u ON u.id = actor.user_id
  JOIN session AS s ON s.userId = actor.user_id WHERE actor.user_id = ? AND s.id = ? AND s.expiresAt > ?
  AND actor.status = 'active' AND actor.registration_state = 'completed' AND u.emailVerified = 1)`;

async function invitationCode(env: Env, userId: string, operationId: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`invitation\0${userId}\0${operationId}`));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function invitationsHttp(request: Request, env: Env) {
  const current = await requireMember(request, env);
  const userId = current.member.user_id;
  const now = Date.now();
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/invites/data") {
    const rows = await env.DB.prepare(`SELECT i.id, i.created_at, i.expires_at, i.revoked_at, i.used_at, u.displayUsername AS usedBy
      FROM invitations AS i LEFT JOIN "user" AS u ON u.id = i.used_by_user_id WHERE issuer_user_id = ? ORDER BY created_at DESC`).bind(userId).all();
    const occupied = await env.DB.prepare(`SELECT ${occupiedSql} AS n FROM member_profiles AS p WHERE user_id = ?`).bind(now, userId).first<number>("n") ?? 0;
    return Response.json({ data: { invitations: rows.results, total: current.member.invite_quota, occupied, unlimited: current.member.role === "admin" }, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  if (request.method !== "POST") return new Response(null, { status: 404 });
  const body = await readJson(request);
  await checkCsrf(request, env, body.csrfToken);
  const actor = [userId, current.session.id, new Date(now).toISOString()];
  const revoke = /^\/invites\/([^/]+)\/revoke$/.exec(path);
  if (revoke) {
    const result = await env.DB.prepare(`UPDATE invitations SET revoked_at = ? WHERE id = ? AND issuer_user_id = ?
      AND used_by_user_id IS NULL AND revoked_at IS NULL AND expires_at > ? AND ${actorSql}`)
      .bind(now, revoke[1], userId, now, ...actor).run();
    if (!result.meta.changes) {
      const already = await env.DB.prepare(`SELECT id FROM invitations WHERE id = ? AND issuer_user_id = ? AND revoked_at IS NOT NULL AND used_by_user_id IS NULL AND ${actorSql}`)
        .bind(revoke[1], userId, ...actor).first();
      if (!already) throw new APIError("CONFLICT", { code: "INVITATION_INVALID", message: "邀请码不存在或已不能作废。" });
    }
    return Response.json({ data: { revoked: true }, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  if (path !== "/invites/create") return new Response(null, { status: 404 });
  if (typeof body.operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.operationId)) throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "发码操作标识无效。" });
  const expiry = body.expiresAt ?? now + settings.invitationTtl * 1000;
  if (typeof expiry !== "number" || !Number.isSafeInteger(expiry) || expiry <= now || expiry > 8640000000000000) {
    throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "有效期必须晚于当前时间。" });
  }
  const code = await invitationCode(env, userId, body.operationId);
  await env.DB.prepare(`INSERT INTO invitations (id, code_hash, issuer_user_id, operation_id, created_at, expires_at)
    SELECT ?, ?, p.user_id, ?, ?, ? FROM member_profiles AS p WHERE p.user_id = ? AND ${actorSql}
      AND (p.role = 'admin' OR p.invite_quota > ${occupiedSql})
    ON CONFLICT (issuer_user_id, operation_id) WHERE issuer_user_id IS NOT NULL DO NOTHING`)
    .bind(crypto.randomUUID(), await sha256(code), body.operationId, now, expiry, userId, ...actor, now).run();
  const row = await env.DB.prepare("SELECT id, expires_at, used_at, revoked_at FROM invitations WHERE issuer_user_id = ? AND operation_id = ?")
    .bind(userId, body.operationId).first<{ id: string; expires_at: number; used_at: number | null; revoked_at: number | null }>();
  if (!row) throw new APIError("CONFLICT", { code: "QUOTA_EXHAUSTED", message: "邀请额度已用完或账号已停用。" });
  if (row.used_at || row.revoked_at || row.expires_at <= now) throw new APIError("CONFLICT", { code: "INVITATION_USED", message: "本次发码已经结束，请使用新的操作。" });
  return Response.json({ data: { id: row.id, code, expiresAt: row.expires_at }, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
}
