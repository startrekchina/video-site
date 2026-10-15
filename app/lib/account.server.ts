import { APIError } from "better-auth/api";
import { createRequestIdentity, requireMember } from "./member.server";
import { checkWrite, privateCookie } from "./security.server";

export async function accountHttp(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const current = await requireMember(request, env, identity);
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/account/sessions") {
    const rows = await env.DB.prepare(`SELECT id, createdAt, updatedAt, expiresAt, userAgent FROM session
      WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC`).bind(current.member.user_id, new Date().toISOString())
      .all<{ id: string; createdAt: string; updatedAt: string; expiresAt: string; userAgent: string | null }>();
    return Response.json({ data: rows.results.map(row => ({ ...row, userAgent: row.userAgent?.slice(0, 160), current: row.id === current.session.id })), requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  const match = /^\/account\/sessions\/([^/]+)\/revoke$/.exec(path);
  if (request.method !== "POST" || !match) return new Response(null, { status: 404 });
  checkWrite(request, env);
  const token = await env.DB.prepare("SELECT token FROM session WHERE id = ? AND userId = ?").bind(match[1], current.member.user_id).first<string>("token");
  if (!token) throw new APIError("NOT_FOUND", { code: "NOT_FOUND", message: "该登录设备不存在或已退出。" });
  const result = await identity.auth().api.revokeSession({ headers: request.headers, body: { token }, returnHeaders: true });
  identity.invalidate();
  if (match[1] === current.session.id) result.headers.append("Set-Cookie", privateCookie(env, "session", "", 0));
  const headers = identity.headers(result.headers);
  return Response.json({ data: { revoked: true }, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers });
}
