import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { InferEnv, UnwrapConfig } from "cf/config";
import type { recoveryWorker } from "./cloudflare.config";
import type { BackupScope } from "../../app/lib/backup-storage.server";
import { restoreBackup, sanitizeRestoredCredentials, validateRestoredDatabase, verifyRestoredCredentials } from "../../app/lib/backup-restore.server";
import { readJson } from "../../app/lib/security.server";
import { settings } from "../../app/lib/settings.server";
import { backupKeyId, backupKeys } from "../../app/lib/backup-keys.server";

type RecoveryBindings = InferEnv<UnwrapConfig<ReturnType<typeof recoveryWorker>>>;
const digest = (value: string) => createHash("sha256").update(value).digest();
export default {
  async fetch(request: Request, env, ctx) {
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/operate" || request.headers.has("Origin")
      || Buffer.byteLength(env.RESTORE_OPERATOR_TOKEN ?? "") < 32 || !timingSafeEqual(digest(request.headers.get("Authorization") ?? ""), digest("Bearer " + env.RESTORE_OPERATOR_TOKEN))) return json({ error: "RESTORE_UNAUTHORIZED" }, 403);
    if (!/^application\/json\s*(;|$)/iu.test(request.headers.get("Content-Type") ?? "")) return json({ error: "RESTORE_INVALID_INPUT" }, 400);
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), settings.backupTaskTimeout * 1000);
    const signal = AbortSignal.any([request.signal, timeout.signal]);
    let locked: { key: string; etag: string; updatedAt: number } | undefined;
    try {
      if (env.RESTORE_TARGET_DATABASE_ID === env.BACKUP_DATABASE_ID) throw new Error("RESTORE_TARGET_INVALID");
      const body = await readJson(request), target = { db: env.RESTORE_DB, id: env.RESTORE_TARGET_DATABASE_ID };
      const key = `backup-restore-control/${env.APP_ENV}/${target.id}.json`, previous = await env.MEDIA_BUCKET.get(key);
      if (previous && previous.size > 1024) { await previous.body.cancel(); throw new Error("RESTORE_STATE_INVALID"); }
      const state = previous ? await previous.json<{ deadline: number; updatedAt: number }>() : null;
      if (state && (!Number.isSafeInteger(state.deadline) || !Number.isSafeInteger(state.updatedAt))) throw new Error("RESTORE_STATE_INVALID");
      if (state && state.deadline > Date.now()) return json({ error: "RESTORE_BUSY" }, 409);
      if (state) await delay(Math.max(0, state.updatedAt + 1100 - Date.now()), undefined, { signal });
      const updatedAt = Date.now(), lease = await env.MEDIA_BUCKET.put(key, JSON.stringify({ updatedAt, deadline: updatedAt + settings.backupTaskTimeout * 1000 }), {
        onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" },
      });
      if (!lease) return json({ error: "RESTORE_BUSY" }, 409);
      locked = { key, etag: lease.etag, updatedAt };
      if (body.action === "restore" && typeof body.id === "string" && typeof body.file === "string" && typeof body.keyId === "string" && typeof body.authKeyId === "string") {
        if (!["staging", "production"].includes(env.APP_ENV)) throw new Error("RESTORE_ENV_INVALID");
        const scope: BackupScope = { environment: env.APP_ENV as "staging" | "production", id: body.id };
        const restored = await restoreBackup(env, target, scope, body.file, { keyId: body.keyId, authKeyId: body.authKeyId }, signal);
        return json(restored);
      }
      if ((body.action === "sanitize" && body.maintenanceConfirmed === true || body.action === "credentials") && typeof body.authKeyId === "string") {
        const inventory = backupKeys(env), pair = inventory.find(pair => pair.authKeyId === body.authKeyId), newKeyId = backupKeyId(env.RESTORE_NEW_AUTH_SECRET);
        if (!pair || inventory.some(pair => pair.keyId === newKeyId || pair.authKeyId === newKeyId)) throw new Error("RESTORE_KEYS_INVALID");
        return json(body.action === "sanitize" ? await sanitizeRestoredCredentials(target.db, pair.authSecret, env.RESTORE_NEW_AUTH_SECRET)
          : await verifyRestoredCredentials(target.db, env.RESTORE_NEW_AUTH_SECRET));
      }
      if (body.action === "validate" && typeof body.schemaVersion === "string") return json(await validateRestoredDatabase(target.db, env.MEDIA_BUCKET, body.schemaVersion, signal));
      if (body.action === "review" && (body.after === undefined || typeof body.after === "string" && body.after.length <= 128)) {
        const page = await target.db.prepare(`SELECT u.id, u.username, u.emailVerified, p.role, p.status, p.registration_state,
          (SELECT COUNT(*) FROM passkey k WHERE k.userId = u.id) AS passkeys, u.twoFactorEnabled
          FROM "user" u JOIN member_profiles p ON p.user_id = u.id WHERE u.id > ? ORDER BY u.id LIMIT 100`).bind(body.after ?? "").all();
        const devices = await target.db.prepare('SELECT id, userId, name, createdAt, deviceType, backedUp FROM passkey WHERE userId IN (SELECT value FROM json_each(?)) ORDER BY userId, id')
          .bind(JSON.stringify(page.results.map(member => member.id))).all();
        return json({ members: page.results, devices: devices.results, after: page.results.length === 100 ? page.results.at(-1)!.id : null, readyToOpen: false });
      }
      return json({ error: "RESTORE_INVALID_INPUT" }, 400);
    } catch (error) {
      const importError = error instanceof Error ? /^RESTORE_IMPORT_REJECTED (D1_[A-Z0-9_]{1,60})$/u.exec(error.message)?.[1] : undefined;
      return json({ error: "RESTORE_FAILED", ...(importError ? { importError } : {}), message: "恢复操作未完成，保持目标隔离并检查阶段结果；不要切换数据库或开放服务。" }, 500);
    }
    finally {
      clearTimeout(timer);
      if (locked) {
        const lock = locked, release = (async () => {
          await delay(Math.max(0, lock.updatedAt + 1100 - Date.now()));
          await env.MEDIA_BUCKET.put(lock.key, JSON.stringify({ updatedAt: Date.now(), deadline: 0 }), { onlyIf: { etagMatches: lock.etag } });
        })();
        ctx.waitUntil(release.catch(() => {})); await release;
      }
    }
  },
} satisfies ExportedHandler<RecoveryBindings>;
