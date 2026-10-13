import { APIError } from "better-auth/api";
import { createAuth } from "./auth.server";
import { redirect } from "react-router";
import { safeNext } from "./security.server";

export type Member = { user_id: string; role: "member" | "admin"; status: "active" | "banned"; registration_state: string;
  created_at: number; invite_quota: number; invited_by_user_id: string | null; username: string; displayUsername: string; email: string; emailVerified: number; twoFactorEnabled: number };
export async function memberById(env: Env, id: string, verified = true) {
  const member = await env.DB.prepare(`SELECT p.*, u.username, u.displayUsername, u.email, u.emailVerified, u.twoFactorEnabled
    FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id WHERE p.user_id = ?`).bind(id).first<Member>();
  if (!member || member.registration_state !== "completed" || member.status !== "active" || (verified && !member.emailVerified)) {
    throw new APIError("FORBIDDEN", { code: "MEMBERSHIP_REQUIRED", message: "账号尚未完成验证或已被停用。" });
  }
  return member;
}
export async function currentMember(request: Request, env: Env) {
  const result = await createAuth(env).api.getSession({ headers: request.headers, returnHeaders: true });
  if (!result.response) return null;
  try {
    const member = await memberById(env, result.response.user.id);
    return { member, session: result.response.session, headers: result.headers };
  } catch (error) { if (error instanceof APIError) return null; throw error; }
}
export async function requireMember(request: Request, env: Env) {
  const member = await currentMember(request, env);
  if (!member) throw new APIError("UNAUTHORIZED", { code: "AUTH_REQUIRED", message: "请先登录。" });
  return member;
}
export async function pageMember(request: Request, env: Env) {
  const current = await currentMember(request, env);
  if (!current) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(safeNext(url.pathname + url.search, env.APP_ORIGIN))}`);
  }
  return current;
}
