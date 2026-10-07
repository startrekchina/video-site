import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, twoFactor, username } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { settings } from "./settings.server.ts";

/** HTTP routing requires the third-stage business gates. The optional user ID is server-owned. */
export function createAuth(env: Env, registrationUserId?: string) {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  if (secret === env.PLAYBACK_HMAC_KEY || secret === env.BACKUP_ENCRYPTION_KEY) {
    throw new Error("Authentication, playback and backup must use independent secrets");
  }
  const origin = new URL(env.APP_ORIGIN);
  const secure = origin.protocol === "https:";
  if ((env.APP_ENV === "staging" || env.APP_ENV === "production") && !secure) {
    throw new Error("Deployed authentication requires HTTPS");
  }
  if (origin.hostname !== env.WEBAUTHN_RP_ID) throw new Error("WebAuthn RP ID must match APP_ORIGIN");
  if (!env.TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_SECRET_KEY is required");

  return betterAuth({
    appName: "星际迷航中国",
    database: env.DB,
    baseURL: origin.origin,
    basePath: "/api/auth",
    secret,
    telemetry: { enabled: false },
    // Library logs can include credential URLs and raw SQL; add redacted request logging at HTTP integration.
    logger: { disabled: true },
    trustedOrigins: [origin.origin],
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: settings.resetLinkTtl,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: settings.emailVerificationTtl,
    },
    user: { changeEmail: { enabled: true, updateEmailWithoutVerification: false } },
    session: { ...settings.session, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", ...settings.rateLimits.auth },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // The cookie is explicitly named; avoid Better Auth's automatic __Secure- prefix.
      useSecureCookies: false,
      defaultCookieAttributes: { secure, httpOnly: true, sameSite: "lax", path: "/" },
      cookies: { session_token: { name: secure ? "__Host-session" : "session" } },
    },
    disabledPaths: [
      "/sign-up/email", "/sign-in/email", "/update-user", "/delete-user", "/delete-user/callback",
      "/two-factor/send-otp", "/two-factor/verify-otp",
    ],
    databaseHooks: registrationUserId ? {
      user: { create: { before: async (user) => ({ data: { ...user, id: registrationUserId } }) } },
    } : undefined,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.body?.trustDevice) throw new APIError("BAD_REQUEST", { code: "TRUST_DEVICE_DISABLED", message: "Trusted devices are disabled" });
        if (ctx.path === "/two-factor/enable" && ctx.body?.method === "otp") {
          throw new APIError("BAD_REQUEST", { code: "OTP_DISABLED", message: "OTP is disabled" });
        }
      }),
    },
    plugins: [
      username(),
      twoFactor({
        issuer: "StarTrekChina",
        twoFactorCookieMaxAge: settings.totp.challengeTtl,
        backupCodeOptions: { amount: settings.backupCodeCount },
      }),
      passkey({
        rpID: env.WEBAUTHN_RP_ID,
        rpName: "StarTrekChina",
        origin: origin.origin,
        authenticatorSelection: { userVerification: "required" },
        registration: {
          afterVerification: ({ verification }) => {
            if (!verification.registrationInfo?.userVerified) throw new APIError("FORBIDDEN", { code: "USER_VERIFICATION_REQUIRED", message: "User verification is required" });
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) throw new APIError("FORBIDDEN", { code: "USER_VERIFICATION_REQUIRED", message: "User verification is required" });
          },
        },
      }),
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: ["/sign-up/email", "/sign-in/username", "/request-password-reset", "/send-verification-email"],
        allowedHostnames: [origin.hostname],
        expectedAction: "auth",
      }),
    ],
  });
}
