import { APIError, createAuthEndpoint, createAuthMiddleware, createEmailVerificationToken, freshSessionMiddleware, getSession } from "better-auth/api";
import { createAuth } from "./auth.server";
import { registerWithInvitation, sha256 } from "./registration.server";
import { createRequestIdentity, memberById, memberForSession, type RequestIdentity } from "./member.server";
import { deliverMail, finishUnsentMail, reserveMail, type MailAttempt } from "./mail.server";
import { checkOrigin, cookieName, cookieValue, privateCookie } from "./security.server";

const anonymous = new Set(["/register", "/sign-in/username", "/request-password-reset", "/send-verification-email", "/reset-password",
  "/verify-email", "/two-factor/verify-totp", "/two-factor/verify-backup-code", "/passkey/generate-authenticate-options", "/passkey/verify-authentication", "/get-session"]);
const postPaths = new Set(["/register", "/sign-in/username", "/sign-out", "/request-password-reset", "/send-verification-email", "/reset-password",
  "/change-email", "/change-password", "/two-factor/enable", "/two-factor/disable", "/two-factor/verify-totp", "/two-factor/verify-backup-code",
  "/two-factor/get-totp-uri", "/two-factor/generate-backup-codes", "/passkey/verify-registration", "/passkey/verify-authentication", "/passkey/delete-passkey"]);
const getPaths = new Set(["/get-session", "/verify-email", "/passkey/generate-register-options", "/passkey/generate-authenticate-options", "/passkey/list-user-passkeys"]);

// D1 reports unique violations only in the message, sometimes on a wrapped cause.
function uniqueViolation(error: unknown, column: string) {
  for (let cause = error; cause instanceof Error; cause = cause.cause) if (cause.message.includes(`UNIQUE constraint failed: ${column}`)) return true;
  return false;
}

export function createSiteAuth(env: Env, identity: RequestIdentity) {
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
          const previous = await env.DB.prepare(`SELECT a.state, a.expected_user_id, a.identity_key, i.code_hash
            FROM registration_attempts AS a JOIN invitations AS i ON i.id = a.invitation_id WHERE a.id = ?`)
            .bind(await sha256(attemptToken)).first<{ state: string; expected_user_id: string; identity_key: string; code_hash: string }>();
          // Recovery replaces its attempt; if that response was lost, the stale cookie must not block the password-verified retry.
          if (!previous) attemptToken = undefined;
          const identity = typeof ctx.body?.username === "string" && typeof ctx.body?.email === "string"
            ? await sha256(JSON.stringify([ctx.body.username.toLowerCase(), ctx.body.email.toLowerCase()])) : "";
          const codeHash = typeof ctx.body?.invitationCode === "string" ? await sha256(ctx.body.invitationCode) : "";
          if (previous?.state === "completed") {
            if (previous.identity_key !== identity || previous.code_hash !== codeHash) attemptToken = undefined;
          } else if (previous?.state === "failed" && (previous.identity_key !== identity || previous.code_hash !== codeHash)) {
            // Keep proof of ownership; registration validates credentials before rebinding an unfinished identity.
            const exists = await env.DB.prepare('SELECT id FROM "user" WHERE id = ?').bind(previous.expected_user_id).first();
            if (!exists) attemptToken = undefined;
          }
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
      // Better Auth already refuses non-JSON bodies here (415), so registration needs only the origin check.
      if (request.method !== "GET") checkOrigin(request, env);
      const readMember = async () => {
        const result = await getSession()({ ...ctx, headers: request.headers, method: "GET", asResponse: false, returnHeaders: true, returnStatus: false, query: { disableCookieCache: true } });
        renewedCookies.push(...result.headers.getSetCookie());
        ctx.context.session = result.response;
        return identity.accept(result.response, result.headers);
      };
      if (!anonymous.has(ctx.path) && !ctx.path.startsWith("/reset-password/")) {
        const current = await readMember().catch(error => { if (error instanceof APIError && error.body?.code === "MEMBERSHIP_REQUIRED") return null; throw error; });
        if (!current) throw new APIError("UNAUTHORIZED", { code: "AUTH_REQUIRED", message: "请先登录。" });
      }
      if (ctx.path === "/two-factor/verify-totp" || ctx.path === "/two-factor/verify-backup-code") {
        await readMember();
      }
      if (ctx.path === "/change-email" || ctx.path === "/passkey/delete-passkey") await freshSessionMiddleware(ctx);
      if (ctx.path === "/two-factor/enable" && (ctx.body?.method === undefined || ctx.body.method === "totp")) {
        const adapter = ctx.context.adapter, userId = ctx.context.session!.user.id;
        const pending = await adapter.findOne<{ verified: boolean }>({ model: "twoFactor", where: [{ field: "userId", value: userId }] });
        if (pending?.verified === false) {
          const native = createAuth(env);
          const uri = await native.api.getTOTPURI({ headers: request.headers, body: { password: ctx.body?.password } });
          const { backupCodes } = await native.api.viewBackupCodes({ body: { userId } });
          return ctx.json({ method: "totp", ...uri, backupCodes });
        }
        const conflict = () => new APIError("CONFLICT", { code: "TOTP_SETUP_CONFLICT", message: "绑定已由另一请求开始，请重新打开绑定页面。" });
        const { create, update } = adapter;
        // This request may only create the first setup; native enable must not overwrite a concurrent winner.
        adapter.update = async options => { if (options.model === "twoFactor") throw conflict(); return update(options); };
        adapter.create = async options => {
          try { return await create(options); }
          catch (error) {
            if (options.model === "twoFactor" && uniqueViolation(error, "twoFactor.userId")) throw conflict();
            throw error;
          }
        };
      }
      if (ctx.path === "/change-password" && ctx.body?.revokeOtherSessions !== true) {
        throw new APIError("BAD_REQUEST", { code: "SESSION_REVOCATION_REQUIRED", message: "修改密码时必须同时退出其他设备。" });
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
        // Members open this link from mail, so failures land on the verification page rather than a JSON body.
        const invalid = (error = "INVALID_TOKEN") => ctx.redirect(`${env.APP_ORIGIN}/verify-email?error=${error}`);
        let payload: { email?: string; updateTo?: string };
        try {
          const token = ctx.query?.token;
          if (typeof token !== "string" || token.length > 8192) throw new Error();
          payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))));
          if (!payload || typeof payload !== "object") throw new Error();
        } catch { throw invalid(); }
        // The decoded data is only a restrictive gate. Better Auth still verifies the JWT before any mutation.
        if (payload.updateTo) {
          const current = await readMember().catch(error => { if (error instanceof APIError && error.body?.code === "MEMBERSHIP_REQUIRED") return null; throw error; });
          if (!current) {
            const token = ctx.query?.token;
            if (typeof token !== "string" || token.length > 3584) throw invalid();
            ctx.setHeader("Set-Cookie", privateCookie(env, "email-change", token, 3600));
            // Keep the signed link away from the login page's third-party captcha script.
            throw ctx.redirect(`${env.APP_ORIGIN}/login?next=/account/email-confirm`);
          }
          if (current.member.email !== payload.email) throw invalid("EMAIL_CHANGE_ACCOUNT");
          // Pending addresses are not reserved, so another account may have taken this one since the link was sent.
          // Only the signed link reaches this write, so the result page cannot be used to probe addresses.
          const adapter = ctx.context.adapter, { update } = adapter;
          adapter.update = async options => {
            try { return await update(options); }
            catch (error) { throw options.model === "user" && uniqueViolation(error, "user.email") ? invalid("EMAIL_IN_USE") : error; }
          };
        } else if (payload.email) {
          const id = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(payload.email).first<string>("id");
          if (!id) throw invalid();
          await memberById(env, id, false).catch(error => { if (error instanceof APIError && error.body?.code === "MEMBERSHIP_REQUIRED") throw invalid(); throw error; });
        }
      }
      if (ctx.path === "/request-password-reset" || ctx.path === "/send-verification-email" || ctx.path === "/change-email") {
        mail = await reserveMail(env, ctx.path === "/change-email" ? ctx.body.newEmail : ctx.body.email,
          ctx.path === "/request-password-reset" ? "password_reset" : ctx.path === "/change-email" ? "email_change_verification" : "verification_resend",
          ctx.path === "/change-email" ? ctx.context.session!.session.userId : undefined);
      }
    }) }], after: [{ matcher: () => true, handler: createAuthMiddleware(async ctx => {
      // The public session endpoint has already performed native verification and rolling renewal.
      if (ctx.path === "/get-session" && ctx.context.returned && !(ctx.context.returned instanceof APIError) && ctx.context.session) {
        await memberForSession(env, ctx.context.session.session);
      }
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

export async function authHttp(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const url = new URL(request.url);
  const emailResume = url.pathname === "/account/email-confirm";
  if (emailResume) {
    const token = cookieValue(request, cookieName(env, "email-change"));
    if (request.method !== "GET" || !token || !/^[A-Za-z0-9_.-]{1,3584}$/.test(token)) return new Response(null, { status: 303, headers: { Location: `${env.APP_ORIGIN}/verify-email?error=INVALID_TOKEN` } });
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
  // The public session endpoint stays authoritative: a revoked or expired session reads as null and clears its cookies.
  if (path === "/get-session") { url.searchParams.set("disableCookieCache", "true"); request = new Request(url, { headers: request.headers }); }
  const site = createSiteAuth(env, identity);
  try {
    const response = await site.auth.handler(request);
    if (emailResume && new URL(response.headers.get("Location") ?? "/", env.APP_ORIGIN).pathname !== "/login") {
      const headers = new Headers(response.headers); headers.append("Set-Cookie", privateCookie(env, "email-change", "", 0));
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  }
  finally { identity.invalidate(); await site.finish(); }
}
