import { existsSync } from "node:fs";
import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./workers/app.ts" with { type: "cf-worker" };

// `react-router build` does not load .env into process.env; `cf` does. Load it here for both.
if (existsSync(".env")) process.loadEnvFile(".env");

const LOCAL_D1_ID = "00000000-0000-4000-8000-000000000000";
const CLOUDFLARE_TEST_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Set it in .env (see .env.example).`);
  return value;
}

function environment(mode: string) {
  switch (mode) {
    case "development":
    case "test":
      return {
        worker: "video-site-dev",
        resource: "video-site-dev",
        mediaBucket: "video-site-dev-media",
        d1Id: LOCAL_D1_ID,
        rateLimitBase: 1000,
        appOrigin: process.env.APP_ORIGIN ?? "http://localhost:6120",
        turnstileSiteKey: CLOUDFLARE_TEST_TURNSTILE_SITE_KEY,
        emailApiBaseUrl: "https://postal.example.test",
        emailSenderDomain: "example.test",
        emailFrom: "noreply@example.test",
        emailReplyTo: "support@example.test",
      };
    case "staging":
      return {
        worker: "stcn-video-site-staging",
        resource: requiredEnv("STAGING_D1_DATABASE_NAME"),
        mediaBucket: requiredEnv("STAGING_MEDIA_BUCKET_NAME"),
        d1Id: requiredEnv("STAGING_D1_DATABASE_ID"),
        rateLimitBase: 2000,
        appOrigin: requiredEnv("STAGING_APP_ORIGIN"),
        turnstileSiteKey: requiredEnv("STAGING_TURNSTILE_SITE_KEY"),
        emailApiBaseUrl: requiredEnv("STAGING_EMAIL_API_BASE_URL"),
        emailSenderDomain: requiredEnv("STAGING_EMAIL_SENDER_DOMAIN"),
        emailFrom: requiredEnv("STAGING_EMAIL_FROM"),
        emailReplyTo: requiredEnv("STAGING_EMAIL_REPLY_TO"),
      };
    case "production":
      return {
        worker: "stcn-video-site",
        resource: requiredEnv("PRODUCTION_D1_DATABASE_NAME"),
        mediaBucket: requiredEnv("PRODUCTION_MEDIA_BUCKET_NAME"),
        d1Id: requiredEnv("PRODUCTION_D1_DATABASE_ID"),
        rateLimitBase: 3000,
        appOrigin: "https://video.startrekchina.org",
        turnstileSiteKey: requiredEnv("PRODUCTION_TURNSTILE_SITE_KEY"),
        emailApiBaseUrl: requiredEnv("PRODUCTION_EMAIL_API_BASE_URL"),
        emailSenderDomain: requiredEnv("PRODUCTION_EMAIL_SENDER_DOMAIN"),
        emailFrom: requiredEnv("PRODUCTION_EMAIL_FROM"),
        emailReplyTo: requiredEnv("PRODUCTION_EMAIL_REPLY_TO"),
      };
    default:
      throw new Error(`Unknown mode "${mode}". Use development, test, staging or production.`);
  }
}

export default defineConfig(({ mode = "development" }) => {
  const e = environment(mode);
  const rateLimit = (offset: number, limit: number) =>
    bindings.rateLimit({ namespace: String(e.rateLimitBase + offset), simple: { limit, period: 60 } });

  return {
    worker: {
      name: e.worker,
      entrypoint,
      compatibilityDate: "2026-09-25",
      compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      domains: mode === "staging" || mode === "production" ? [new URL(e.appOrigin).hostname] : [],
      workersDev: false,
      previewUrls: false,
      observability: {
        enabled: true,
        redactQueryString: true,
        logs: { enabled: true, invocationLogs: false },
        // Auth tokens also appear in path parameters; enable traces after their redaction is verified.
        traces: { enabled: false },
      },
      env: {
        APP_ENV: bindings.text(mode),
        APP_ORIGIN: bindings.text(e.appOrigin),
        WEBAUTHN_RP_ID: bindings.text(new URL(e.appOrigin).hostname),
        TURNSTILE_SITE_KEY: bindings.text(e.turnstileSiteKey),
        EMAIL_API_BASE_URL: bindings.text(e.emailApiBaseUrl),
        EMAIL_SENDER_DOMAIN: bindings.text(e.emailSenderDomain),
        EMAIL_FROM: bindings.text(e.emailFrom),
        EMAIL_REPLY_TO: bindings.text(e.emailReplyTo),
        DB: bindings.d1({ name: e.resource, id: e.d1Id }),
        MEDIA_BUCKET: bindings.r2({ name: e.mediaBucket }),
        // Auxiliary only: quotas are decided by exact D1 counters (requirements 6.3.2).
        AUTH_RATE_LIMITER: rateLimit(1, 10),
        PLAYBACK_RATE_LIMITER: rateLimit(2, 30),
        ADMIN_RATE_LIMITER: rateLimit(3, 30),
        EMAIL_RATE_LIMITER: rateLimit(4, 5),
        PLAYBACK_HMAC_KEY: bindings.secret(),
        BETTER_AUTH_SECRET: bindings.secret(),
        TURNSTILE_SECRET_KEY: bindings.secret(),
        BACKUP_ENCRYPTION_KEY: bindings.secret(),
        EMAIL_API_KEY: bindings.secret(),
      },
    },
  };
});
