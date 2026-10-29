import { existsSync } from "node:fs";
import { bindings, defineConfig, triggers } from "cf/config";
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
        appOrigin: process.env.APP_ORIGIN ?? "http://localhost:6120",
        turnstileSiteKey: CLOUDFLARE_TEST_TURNSTILE_SITE_KEY,
        emailApiBaseUrl: "https://postal.example.test",
        emailSenderDomain: "example.test",
        emailFrom: "noreply@example.test",
        emailReplyTo: "support@example.test",
      };
    // Same Worker as production; `cf previews deploy` publishes it as the Preview named after the `dev` branch.
    case "preview":
      return {
        worker: "stcn-video-site",
        resource: requiredEnv("PREVIEW_D1_DATABASE_NAME"),
        mediaBucket: requiredEnv("PREVIEW_MEDIA_BUCKET_NAME"),
        d1Id: requiredEnv("PREVIEW_D1_DATABASE_ID"),
        appOrigin: "https://dev.video.startrekchina.org",
        turnstileSiteKey: requiredEnv("PREVIEW_TURNSTILE_SITE_KEY"),
        emailApiBaseUrl: requiredEnv("PREVIEW_EMAIL_API_BASE_URL"),
        emailSenderDomain: requiredEnv("PREVIEW_EMAIL_SENDER_DOMAIN"),
        emailFrom: requiredEnv("PREVIEW_EMAIL_FROM"),
        emailReplyTo: requiredEnv("PREVIEW_EMAIL_REPLY_TO"),
      };
    case "production":
      return {
        worker: "stcn-video-site",
        resource: requiredEnv("PRODUCTION_D1_DATABASE_NAME"),
        mediaBucket: requiredEnv("PRODUCTION_MEDIA_BUCKET_NAME"),
        d1Id: requiredEnv("PRODUCTION_D1_DATABASE_ID"),
        appOrigin: "https://video.startrekchina.org",
        turnstileSiteKey: requiredEnv("PRODUCTION_TURNSTILE_SITE_KEY"),
        emailApiBaseUrl: requiredEnv("PRODUCTION_EMAIL_API_BASE_URL"),
        emailSenderDomain: requiredEnv("PRODUCTION_EMAIL_SENDER_DOMAIN"),
        emailFrom: requiredEnv("PRODUCTION_EMAIL_FROM"),
        emailReplyTo: requiredEnv("PRODUCTION_EMAIL_REPLY_TO"),
      };
    default:
      throw new Error(`Unknown mode "${mode}". Use development, test, preview or production.`);
  }
}

export default defineConfig(({ mode = "development" }) => {
  const e = environment(mode);
  return {
    worker: {
      name: e.worker,
      entrypoint,
      compatibilityDate: "2026-09-25",
      compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      // The custom domain is managed in the dashboard: `cf deploy` would replace the Worker's domain list and drop
      // its Preview routing, and Preview uploads reject domains and triggers.
      workersDev: false,
      previewUrls: false,
      triggers: mode === "production" ? [triggers.scheduled({ schedule: "*/5 * * * *" })] : [],
      observability: {
        enabled: true,
        redactQueryString: true,
        logs: { enabled: true, invocationLogs: false },
        // Auth tokens also appear in path parameters; enable traces after their redaction is verified.
        traces: { enabled: false },
      },
      env: {
        APP_ENV: bindings.text(mode),
        OWNER_EMAIL: bindings.text(process.env[`${mode === "production" ? "PRODUCTION" : mode === "preview" ? "PREVIEW" : "LOCAL"}_OWNER_EMAIL`] ?? ""),
        BACKUP_ACCOUNT_ID: bindings.text(mode === "preview" || mode === "production" ? requiredEnv("CLOUDFLARE_ACCOUNT_ID") : ""),
        BACKUP_DATABASE_ID: bindings.text(e.d1Id),
        APP_ORIGIN: bindings.text(e.appOrigin),
        WEBAUTHN_RP_ID: bindings.text(new URL(e.appOrigin).hostname),
        TURNSTILE_SITE_KEY: bindings.text(e.turnstileSiteKey),
        EMAIL_API_BASE_URL: bindings.text(e.emailApiBaseUrl),
        EMAIL_SENDER_DOMAIN: bindings.text(e.emailSenderDomain),
        EMAIL_FROM: bindings.text(e.emailFrom),
        EMAIL_REPLY_TO: bindings.text(e.emailReplyTo),
        DB: bindings.d1({ name: e.resource, id: e.d1Id }),
        MEDIA_BUCKET: bindings.r2({ name: e.mediaBucket }),
        BETTER_AUTH_SECRET: bindings.secret(),
        TURNSTILE_SECRET_KEY: bindings.secret(),
        BACKUP_ENCRYPTION_KEY: bindings.secret(),
        D1_EXPORT_TOKEN: bindings.secret(),
        // cf secret declarations are deploy requirements. Optional remote secrets are provisioned separately and preserved.
        ...(mode === "development" || mode === "test" ? {
          BACKUP_KEYRING: bindings.secret(),
          WEBDAV_URL: bindings.secret(),
          WEBDAV_USERNAME: bindings.secret(),
          WEBDAV_PASSWORD: bindings.secret(),
          S3_BACKUP_ENDPOINT: bindings.secret(),
          S3_BACKUP_REGION: bindings.secret(),
          S3_BACKUP_BUCKET: bindings.secret(),
          S3_BACKUP_ACCESS_KEY_ID: bindings.secret(),
          S3_BACKUP_SECRET_ACCESS_KEY: bindings.secret(),
        } : {}),
        EMAIL_API_KEY: bindings.secret(),
      },
    },
  };
});
