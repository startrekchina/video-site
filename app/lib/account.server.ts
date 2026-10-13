import { APIError } from "better-auth/api";
import { createAuth } from "./auth.server";
import { requireMember } from "./member.server";
import { checkCsrf, readJson } from "./security.server";

export async function accountHttp(request: Request, env: Env) {
  const current = await requireMember(request, env);
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/account/sessions") {
    const rows = await env.DB.prepare(`SELECT id, createdAt, updatedAt, expiresAt, userAgent FROM session
      WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC`).bind(current.member.user_id, new Date().toISOString())
      .all<{ id: string; createdAt: string; updatedAt: string; expiresAt: string; userAgent: string | null }>();
    return Response.json({ data: rows.results.map(row => ({ ...row, userAgent: row.userAgent?.slice(0, 160), current: row.id === current.session.id })), requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
  }
  const match = /^\/account\/sessions\/([^/]+)\/revoke$/.exec(path);
  if (request.method !== "POST" || !match) return new Response(null, { status: 404 });
  const body = await readJson(request);
  await checkCsrf(request, env, body.csrfToken);
  const token = await env.DB.prepare("SELECT token FROM session WHERE id = ? AND userId = ?").bind(match[1], current.member.user_id).first<string>("token");
  if (!token) throw new APIError("NOT_FOUND", { code: "NOT_FOUND", message: "会话不存在。" });
  const result = await createAuth(env).api.revokeSession({ headers: request.headers, body: { token }, returnHeaders: true });
  for (const cookie of result.headers.getSetCookie()) current.headers.append("Set-Cookie", cookie);
  return Response.json({ data: { revoked: true }, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { headers: current.headers });
}
