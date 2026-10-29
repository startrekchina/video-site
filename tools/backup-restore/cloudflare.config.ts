import { existsSync } from "node:fs";
import { bindings, defineConfig, defineWorker } from "cf/config";

if (existsSync(".env")) process.loadEnvFile(".env");
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
export function recoveryWorker(mode = "production") {
  const environment = required("RESTORE_SOURCE_ENV"), sourceId = required("RESTORE_SOURCE_DATABASE_ID"), targetId = required("RESTORE_TARGET_DATABASE_ID");
  const id = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
  if (!["preview", "production"].includes(environment) || !id.test(sourceId) || !id.test(targetId) || sourceId === targetId) throw new Error("Recovery requires an isolated target");
  return defineWorker({
    name: "video-site-restore-" + environment,
    entrypoint: "./worker.ts",
    compatibilityDate: "2026-09-25", compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
    workersDev: true, previewUrls: false,
    observability: { enabled: false, logs: { enabled: false, invocationLogs: false }, traces: { enabled: false } },
    env: {
      APP_ENV: bindings.text(environment), BACKUP_ACCOUNT_ID: bindings.text(required("CLOUDFLARE_ACCOUNT_ID")),
      BACKUP_DATABASE_ID: bindings.text(sourceId), RESTORE_TARGET_DATABASE_ID: bindings.text(targetId),
      RESTORE_DB: bindings.d1({ name: required("RESTORE_TARGET_DATABASE_NAME"), id: targetId }),
      MEDIA_BUCKET: bindings.r2({ name: required("RESTORE_SOURCE_BUCKET_NAME") }),
      D1_IMPORT_TOKEN: bindings.secret(), BACKUP_ENCRYPTION_KEY: bindings.secret(),
      ...(mode === "development" || mode === "test" ? { BACKUP_KEYRING: bindings.secret() } : {}),
      BETTER_AUTH_SECRET: bindings.secret(), RESTORE_NEW_AUTH_SECRET: bindings.secret(), RESTORE_OPERATOR_TOKEN: bindings.secret(),
    },
  });
}
export default defineConfig(({ mode }) => ({ worker: recoveryWorker(mode) }));
