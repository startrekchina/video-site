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
    throw new APIError("FORBIDDEN", { code: "MEMBERSHIP_REQUIRED", message: "账号尚未完成注册和邮箱验证，或已被封禁。" });
  }
  return member;
}
type NativeSession = Pick<ReturnType<typeof createAuth>["$Infer"]["Session"], "session">;
type Identity = { member: Member; session: NativeSession["session"] };

// The single live-membership rule for a native session; bind userId, sessionId and the current ISO time.
export const liveMemberSql = `FROM member_profiles p JOIN "user" u ON u.id = p.user_id JOIN session s ON s.userId = u.id
    WHERE p.user_id = ? AND s.id = ? AND s.expiresAt > ? AND p.registration_state = 'completed'
      AND p.status = 'active' AND u.emailVerified = 1`;
export async function memberForSession(env: Env, session: NativeSession["session"]) {
  const member = await env.DB.withSession("first-primary").prepare(`SELECT p.*, u.username, u.displayUsername, u.email, u.emailVerified, u.twoFactorEnabled
    ${liveMemberSql}`).bind(session.userId, session.id, new Date().toISOString()).first<Member>();
  if (!member) throw new APIError("FORBIDDEN", { code: "MEMBERSHIP_REQUIRED", message: "账号尚未完成注册和邮箱验证，或已被封禁。" });
  return member;
}

export function createRequestIdentity(request: Request, env: Env) {
  let pending: Promise<Identity | null> | undefined, native: Promise<NativeSession | null> | undefined, auth: ReturnType<typeof createAuth> | undefined;
  const cookies = new Map<string, string>();
  const capture = (headers: Headers) => { for (const cookie of headers.getSetCookie()) cookies.set(cookie.split("=")[0], cookie); };
  const headers = (response = new Headers()) => {
    const result = new Headers(response), merged = new Map(cookies);
    // A native new/cleared cookie wins over an earlier rolling renewal.
    for (const cookie of response.getSetCookie()) merged.set(cookie.split("=")[0], cookie);
    result.delete("Set-Cookie"); for (const cookie of merged.values()) result.append("Set-Cookie", cookie);
    return result;
  };
  const nativeAuth = () => auth ??= createAuth(env);
  async function resolve(session: NativeSession | null) {
    if (!session) return null;
    return { member: await memberForSession(env, session.session), session: session.session };
  }
  // Native session only; callers that skip memberForSession must apply liveMemberSql themselves.
  const session = () => native ??= (async () => {
    const result = await nativeAuth().api.getSession({ headers: request.headers, returnHeaders: true });
    capture(result.headers); return result.response;
  })();
  return {
    auth: nativeAuth, headers, session,
    invalidate() { pending = undefined; native = undefined; },
    // Only server-owned native results may populate this request's identity.
    accept(result: NativeSession | null, responseHeaders: Headers) {
      capture(responseHeaders); native = Promise.resolve(result); return pending = resolve(result);
    },
    current() { return pending ??= session().then(resolve); },
  };
}
export type RequestIdentity = ReturnType<typeof createRequestIdentity>;

export async function currentMember(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  try {
    const current = await identity.current();
    return current ? { ...current, headers: identity.headers() } : null;
  } catch (error) { if (error instanceof APIError && error.body?.code === "MEMBERSHIP_REQUIRED") return null; throw error; }
}
export async function requireMember(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const member = await currentMember(request, env, identity);
  if (!member) throw new APIError("UNAUTHORIZED", { code: "AUTH_REQUIRED", message: "请先登录。" });
  return member;
}
export async function pageMember(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const current = await currentMember(request, env, identity);
  if (!current) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(safeNext(url.pathname + url.search, env.APP_ORIGIN))}`);
  }
  return current;
}
