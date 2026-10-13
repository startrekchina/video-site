import { betterAuth, type BetterAuthOptions } from "better-auth";
import { username } from "better-auth/plugins";
import { hashPassword, verifyPassword } from "./password.ts";
import { USERNAME_RE, passwordPolicy } from "./policy.ts";

export const TEST_ORIGIN = "https://video.example.test";

// Fictional secret for the spike only.
export const SPIKE_SECRET = "spike-only-secret-0123456789abcdef0123456789abcdef";

export function createAuth(db: D1Database, overrides: BetterAuthOptions = {}) {
  return betterAuth({
    database: db,
    secret: SPIKE_SECRET,
    baseURL: TEST_ORIGIN,
    trustedOrigins: [TEST_ORIGIN],
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true },
      cookies: { session_token: { name: "__Host-session" } },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 12,
        usernameValidator: (value) => USERNAME_RE.test(value),
      }),
      passwordPolicy(),
    ],
    ...overrides,
  });
}
