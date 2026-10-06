import { APIError, createAuthEndpoint, createAuthMiddleware, createEmailVerificationToken } from "better-auth/api";
import { createAuth } from "./auth.server";
import { registerWithInvitation, sha256 } from "./registration.server";
import { currentMember, memberById, requireMember } from "./member.server";
import { deliverMail, finishUnsentMail, reserveMail, type MailAttempt } from "./mail.server";
import { checkCsrf, checkOrigin, cookieName, cookieValue, privateCookie } from "./security.server";

const anonymous = new Set(["/register", "/sign-in/username", "/request-password-reset", "/send-verification-email", "/reset-password",
  "/verify-email", "/two-factor/verify-totp", "/two-factor/verify-backup-code", "/passkey/generate-authenticate-options", "/passkey/verify-authentication", "/get-session"]);
const postPaths = new Set(["/register", "/sign-in/username", "/sign-out", "/request-password-reset", "/send-verification-email", "/reset-password",
  "/change-email", "/change-password", "/two-factor/enable", "/two-factor/disable", "/two-factor/verify-totp", "/two-factor/verify-backup-code",
  "/two-factor/get-totp-uri", "/two-factor/generate-backup-codes", "/passkey/verify-registration", "/passkey/verify-authentication", "/passkey/delete-passkey"]);
const getPaths = new Set(["/get-session", "/verify-email", "/passkey/generate-register-options", "/passkey/generate-authenticate-options", "/passkey/list-user-passkeys"]);

export function createSiteAuth(env: Env) {
  // Per-request state: never cache this instance across requests or Worker isolates.
  let mail: MailAttempt | undefined;
  const renewedCookies: string[] = [];
  const plugin = {
    id: "site-membership",
    rateLimit: [{ pathMatcher: (path: string) => path === "/register", window: 10, max: 3 }],
    endpoints: {
      registerWithInvitation: createAuthEndpoint("/register", { method: "POST" }, async ctx => {
        const request = ctx.request!;
        let attemptToken = cookieValue(request, cookieName(env, "registration"));
        if (attemptToken) {
          const previous = await env.DB.prepare("SELECT state, expected_user_id, identity_key, invitation_id FROM registration_attempts WHERE id = ?")
            .bind(await sha256(attemptToken)).first<{ state: string; expected_user_id: string; identity_key: string; invitation_id: string }>();
          const identity = typeof ctx.body?.username === "string" && typeof ctx.body?.email === "string"
            ? await sha256(JSON.stringify([ctx.body.username.toLowerCase(), ctx.body.email.toLowerCase()])) : "";
          const exists = previous && await env.DB.prepare('SELECT id FROM "user" WHERE id = ?').bind(previous.expected_user_id).first();
          // Failed attempts with no native identity may safely start over after an input correction.
          if (previous?.state === "failed" && !exists && previous.identity_key !== identity) attemptToken = undefined;
        }
        const result = await registerWithInvitation(env, ctx.body, attemptToken);
        if (result.attemptToken) ctx.setHeader("Set-Cookie", privateCookie(env, "registration", result.attemptToken, 86400));
        if (result.status !== "registered") {
          throw new APIError(result.status === "retry" ? "SERVICE_UNAVAILABLE" : result.code.startsWith("INVITATION_") && result.code !== "INVITATION_INVALID" ? "CONFLICT" : "BAD_REQUEST",
            { code: result.code, message: "注册尚未完成，请检查输入或稍后重试。" });
        }
        if (!result.alreadyCompleted) {
          try {
            mail = await reserveMail(env, ctx.body.email, "registration_verification");
            const user = await env.DB.prepare('SELECT id, email FROM "user" WHERE email = ?').bind(ctx.body.email.toLowerCase()).first<{ id: string; email: string }>();
            if (user) {
              const token = await createEmailVerificationToken(ctx.context.secret, user.email, undefined, 3600);
              const url = `${env.APP_ORIGIN}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(`${env.APP_ORIGIN}/verify-email`)}`;
              await deliverMail(env, mail, url, user.id);
            }
          } catch (error) { if (!(error instanceof APIError)) throw error; }
        }
        const delivery = mail ? await env.DB.prepare("SELECT status FROM email_deliveries WHERE id = ?").bind(mail.id).first<string>("status") : null;
        return ctx.json({ status: "pending_verification", delivery, alreadyCompleted: result.alreadyCompleted });
      }),
    },
    hooks: { before: [{ matcher: () => true, handler: createAuthMiddleware(async ctx => {
      const request = ctx.request;
      if (!request) return;
      if (request.method !== "GET") checkOrigin(request, env);
      if (ctx.path === "/register") await checkCsrf(request, env, ctx.body?.csrfToken);
      if (!anonymous.has(ctx.path) && !ctx.path.startsWith("/reset-password/")) {
        const current = await requireMember(request, env);
        renewedCookies.push(...current.headers.getSetCookie());
      }
      if (ctx.path === "/get-session") {
        const session = await createAuth(env).api.getSession({ headers: request.headers, returnHeaders: true });
        renewedCookies.push(...session.headers.getSetCookie());
        if (session.response) await memberById(env, session.response.user.id);
      }
      if (ctx.path === "/two-factor/verify-totp" || ctx.path === "/two-factor/verify-backup-code") {
        const session = await createAuth(env).api.getSession({ headers: request.headers, returnHeaders: true });
        renewedCookies.push(...session.headers.getSetCookie());
        if (session.response) await memberById(env, session.response.user.id);
      }
      if (ctx.path === "/change-password" && ctx.body?.revokeOtherSessions !== true) {
        throw new APIError("BAD_REQUEST", { code: "SESSION_REVOCATION_REQUIRED", message: "修改密码必须撤销其他会话。" });
      }
      for (const field of ["callbackURL", "redirectTo"]) {
        const value = ctx.body?.[field] ?? ctx.query?.[field];
        let valid = value === undefined;
        try { valid ||= typeof value === "string" && value.length <= 2048 && new URL(value, env.APP_ORIGIN).origin === new URL(env.APP_ORIGIN).origin; } catch { /* Reject malformed URLs. */ }
        if (!valid) {
          throw new APIError("BAD_REQUEST", { code: "INVALID_CALLBACK_URL", message: "返回地址无效。" });
        }
      }
      if (ctx.path === "/verify-email") {
        let payload: { email?: string; updateTo?: string };
        try {
          const token = ctx.query?.token;
          if (typeof token !== "string" || token.length > 8192) throw new Error();
          payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))));
          if (!payload || typeof payload !== "object") throw new Error();
        } catch { throw new APIError("UNAUTHORIZED", { code: "INVALID_TOKEN", message: "验证链接无效。" }); }
        // The decoded data is only a restrictive gate. Better Auth still verifies the JWT before any mutation.
        if (payload.updateTo) {
          const current = await currentMember(request, env);
          if (!current) {
            const token = ctx.query?.token;
            if (typeof token !== "string" || token.length > 3584) throw new APIError("BAD_REQUEST", { code: "INVALID_TOKEN", message: "验证链接无效。" });
            ctx.setHeader("Set-Cookie", privateCookie(env, "email-change", token, 3600));
            // Keep the signed link away from the login page's third-party captcha script.
            throw ctx.redirect(`${env.APP_ORIGIN}/login?next=/account/email-confirm`);
          }
          renewedCookies.push(...current.headers.getSetCookie());
          if (current.member.email !== payload.email) throw new APIError("FORBIDDEN", { code: "AUTH_INVALID", message: "请使用申请修改邮箱的账号登录。" });
        } else if (payload.email) {
          const id = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(payload.email).first<string>("id");
          if (!id) throw new APIError("UNAUTHORIZED", { code: "INVALID_TOKEN", message: "验证链接无效。" });
          await memberById(env, id, false);
        }
      }
      if (ctx.path === "/request-password-reset" || ctx.path === "/send-verification-email" || ctx.path === "/change-email") {
        mail = await reserveMail(env, ctx.path === "/change-email" ? ctx.body.newEmail : ctx.body.email,
          ctx.path === "/request-password-reset" ? "password_reset" : ctx.path === "/change-email" ? "email_change_verification" : "verification_resend");
      }
    }) }], after: [{ matcher: () => true, handler: createAuthMiddleware(async ctx => {
      // Native dispatch replaces before-hook headers. Preserve renewals, but never overwrite a new/cleared session.
      const issued = ctx.context.responseHeaders?.getSetCookie().map(cookie => cookie.split("=")[0]) ?? [];
      for (const cookie of renewedCookies) if (!issued.includes(cookie.split("=")[0])) ctx.setHeader("Set-Cookie", cookie);
      if (ctx.path === "/passkey/generate-authenticate-options" && ctx.context.returned && !(ctx.context.returned instanceof APIError)) {
        return ctx.json({ ...(ctx.context.returned as object), userVerification: "required" });
      }
      const created = ctx.context.newSession;
      if (created) {
        try { await memberById(env, created.user.id); }
        catch (error) {
          ctx.setHeader("Set-Cookie", privateCookie(env, "session", "", 0));
          await ctx.context.internalAdapter.deleteSession(created.session.token);
          throw error;
        }
      }
    }) }] },
  };
  const auth = createAuth(env, undefined, {
    plugin,
    beforeSession: userId => memberById(env, userId),
    sendMail: async ({ user, url }) => {
      if (!mail) return;
      const profile = await env.DB.prepare("SELECT user_id FROM member_profiles WHERE user_id = ? AND registration_state = 'completed'").bind(user.id).first();
      if (profile) await deliverMail(env, mail, url, user.id);
    },
  });
  return { auth, finish: async () => { if (mail) await finishUnsentMail(env, mail); } };
}

export async function authHttp(request: Request, env: Env) {
  const url = new URL(request.url);
  const emailResume = url.pathname === "/account/email-confirm";
  if (emailResume) {
    const token = cookieValue(request, cookieName(env, "email-change"));
    if (request.method !== "GET" || !token || !/^[A-Za-z0-9_.-]{1,3584}$/.test(token)) return Response.json({ code: "INVALID_TOKEN", message: "验证凭证已失效，请重新申请修改邮箱。" }, { status: 400 });
    url.pathname = "/api/auth/verify-email";
    url.search = ""; url.searchParams.set("token", token); url.searchParams.set("callbackURL", `${env.APP_ORIGIN}/verify-email`);
    request = new Request(url, { headers: request.headers });
  }
  if (url.pathname === "/auth/register") url.pathname = "/api/auth/register";
  const path = url.pathname.slice("/api/auth".length);
  const allowed = request.method === "POST" ? postPaths.has(path) : request.method === "GET" && (getPaths.has(path) || /^\/reset-password\/[^/]+$/.test(path));
  if (!allowed) return new Response(null, { status: 404 });
  if (request.method === "POST") {
    checkOrigin(request, env);
    const declared = Number(request.headers.get("Content-Length"));
    if (declared > 65536) return Response.json({ code: "INPUT_TOO_LARGE", message: "请求过大。" }, { status: 413 });
    let text = "";
    let length = 0;
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); return Response.json({ code: "INPUT_TOO_LARGE", message: "请求过大。" }, { status: 413 }); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    request = new Request(url, { method: "POST", headers: request.headers, body: text });
  } else if (path !== "/verify-email" && !path.startsWith("/reset-password/") && ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site") ?? "")) {
    return Response.json({ code: "CSRF_INVALID", message: "请求来源无效。" }, { status: 403 });
  }
  const site = createSiteAuth(env);
  try {
    const response = await site.auth.handler(request);
    if (emailResume && new URL(response.headers.get("Location") ?? "/", env.APP_ORIGIN).pathname !== "/login") {
      const headers = new Headers(response.headers); headers.append("Set-Cookie", privateCookie(env, "email-change", "", 0));
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  }
  finally { await site.finish(); }
}
