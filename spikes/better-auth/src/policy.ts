import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

// Requirements 6.3: 10-128 printable ASCII 0x21-0x7E, no trim, no normalization.
export const PASSWORD_RE = /^[\x21-\x7E]{10,128}$/;
export const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

const PASSWORD_PATHS = new Set(["/sign-up/email", "/reset-password", "/change-password", "/set-password"]);

export const passwordPolicy = (): BetterAuthPlugin => ({
  id: "password-policy",
  hooks: {
    before: [
      {
        matcher: (ctx) => PASSWORD_PATHS.has(ctx.path ?? ""),
        handler: createAuthMiddleware(async (ctx) => {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const value = ctx.path === "/sign-up/email" ? body.password : body.newPassword;
          if (typeof value !== "string" || !PASSWORD_RE.test(value)) {
            throw new APIError("BAD_REQUEST", { code: "PASSWORD_INVALID", message: "密码不符合要求" });
          }
        }),
      },
    ],
  },
});
