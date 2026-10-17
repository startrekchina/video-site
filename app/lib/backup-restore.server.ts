import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { backupKeyId, backupKeys } from "./backup-keys.server";
import { backupFingerprint, decryptBackupForRestore, type BackupScope } from "./backup-storage.server";

const requireValid = (value: unknown) => { if (!value) throw new Error("RESTORE_VALIDATION_FAILED"); };
type RecoveryEnv = Pick<Env, "APP_ENV" | "BACKUP_DATABASE_ID" | "BACKUP_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN" | "MEDIA_BUCKET" | "BACKUP_KEYRING" | "BACKUP_ENCRYPTION_KEY" | "BETTER_AUTH_SECRET">;
const businessTables = ["works", "seasons", "playable_units", "media_files", "subtitle_tracks", "user", "account", "member_profiles", "invitations",
  "passkey", "watch_progress", "favorites", "playlists", "playlist_items", "comments", "comment_replies", "discussion_votes"] as const;
async function metadata(response: Response) {
  requireValid(response.ok && response.body);
  const reader = response.body!.getReader(), parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength; requireValid(length <= 65536); parts.push(part.value);
    }
    const data = JSON.parse(Buffer.concat(parts).toString("utf8")) as { success?: boolean; result?: {
      status?: string; success?: boolean; error?: string; upload_url?: string; filename?: string; at_bookmark?: string;
    } };
    requireValid(data.success === true && data.result && data.result.success !== false && !data.result.error && data.result.status !== "error");
    return data.result!;
  } finally { await reader.cancel().catch(() => {}); }
}
function uploadUrl(value: string | undefined) {
  requireValid(value); const url = new URL(value!);
  // Cloudflare's authenticated init response supplies this URL; the API token must not follow it.
  requireValid(url.protocol === "https:" && !url.username && !url.password && !url.hash); return url;
}

export async function restoreBackup(env: RecoveryEnv, target: { db: D1Database; id: string }, scope: BackupScope, file: string,
  keys: { keyId: string; authKeyId: string }, signal: AbortSignal) {
  requireValid(scope.environment === env.APP_ENV && target.id !== env.BACKUP_DATABASE_ID
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(target.id));
  const inventory = backupKeys(env), encryption = inventory.find(pair => pair.keyId === keys.keyId), authentication = inventory.find(pair => pair.authKeyId === keys.authKeyId);
  requireValid(encryption && authentication);
  // Only a new, isolated database is eligible. Never drop tables to make an existing target look empty.
  const tables = await target.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  requireValid(tables.results.length === 0);
  const decrypted = await decryptBackupForRestore(env.MEDIA_BUCKET, scope, file, encryption!.backupKey, signal);
  try {
    requireValid(decrypted.source.authKeyId === authentication!.authKeyId);
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.BACKUP_ACCOUNT_ID}/d1/database/${target.id}/import`;
    const call = async (body: object) => metadata(await fetch(endpoint, { method: "POST", redirect: "manual", signal,
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const init = await call({ action: "init", etag: decrypted.md5 });
    requireValid(typeof init.filename === "string" && init.filename.length > 0 && init.filename.length <= 1024);
    if (init.upload_url) {
      const object = await env.MEDIA_BUCKET.get(decrypted.sqlKey, { onlyIf: { etagMatches: decrypted.sqlEtag } });
      requireValid(object && "body" in object && object.size === decrypted.source.byteLength);
      const uploaded = await fetch(uploadUrl(init.upload_url), { method: "PUT", signal, redirect: "manual",
        headers: { "Content-Length": String(decrypted.source.byteLength) }, body: (object as R2ObjectBody).body });
      await uploaded.body?.cancel(); requireValid(uploaded.ok);
    }
    let state = await call({ action: "ingest", etag: decrypted.md5, filename: init.filename }), bookmark: string | undefined;
    while (state.status !== "complete") {
      requireValid((state.status === undefined || state.status === "active") && typeof state.at_bookmark === "string" && state.at_bookmark.length > 0 && state.at_bookmark.length <= 256
        && (!bookmark || bookmark === state.at_bookmark));
      bookmark = state.at_bookmark; await delay(1000, undefined, { signal });
      state = await call({ action: "poll", current_bookmark: bookmark });
    }
    const validation = await validateRestoredDatabase(target.db, env.MEDIA_BUCKET, decrypted.source.schemaVersion, signal);
    return { source: decrypted.source, keyId: decrypted.keyId, validation, credentialsCleared: false as const };
  } finally {
    // The authenticated encrypted source remains intact. Recovery plaintext never leaves Cloudflare.
    await env.MEDIA_BUCKET.delete(decrypted.sqlKey);
  }
}

export async function restoredBusinessSummary(db: D1Database) {
  const summary: Record<string, { count: number; sha256: string }> = {};
  // Stable pagination keeps large discussion tables out of memory; composite primary keys determine ordering.
  for (const table of businessTables) {
    const info = await db.prepare(`PRAGMA table_info("${table}")`).all<{ name: string; pk: number }>();
    const order = table === "discussion_votes" ? '"user_id", "comment_id", "reply_id"'
      : info.results.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => '"' + column.name + '"').join(", ");
    requireValid(order); const hash = createHash("sha256"); let count = 0;
    while (true) {
      const page = await db.prepare(`SELECT * FROM "${table}" ORDER BY ${order} LIMIT 100 OFFSET ?`).bind(count).all<Record<string, unknown>>();
      for (const row of page.results) { hash.update(JSON.stringify(row) + "\n"); count++; }
      if (page.results.length < 100) break;
    }
    summary[table] = { count, sha256: hash.digest("hex") };
  }
  return summary;
}
export async function validateRestoredDatabase(db: D1Database, bucket: R2Bucket, schemaVersion: string, signal: AbortSignal) {
  const migrations = await db.prepare("SELECT name FROM d1_migrations ORDER BY name").all<{ name: string }>();
  requireValid(createHash("sha256").update(JSON.stringify(migrations.results.map(row => row.name))).digest("hex") === schemaVersion);
  const integrity = await db.prepare("PRAGMA quick_check").all<Record<string, string>>();
  requireValid(integrity.results.length === 1 && Object.values(integrity.results[0])[0] === "ok");
  requireValid((await db.prepare("PRAGMA foreign_key_check").all()).results.length === 0);
  for (const table of ["media_files", "subtitle_tracks"]) {
    let offset = 0;
    while (true) {
      const page = await db.prepare(`SELECT id, object_key, byte_length, checksum_sha256, r2_etag FROM ${table} ORDER BY id LIMIT 25 OFFSET ?`).bind(offset)
        .all<{ id: string; object_key: string; byte_length: number; checksum_sha256: string; r2_etag: string | null }>();
      for (const media of page.results) {
        signal.throwIfAborted(); requireValid(media.object_key.startsWith("library/") && !media.object_key.split("/").includes(".."));
        const head = await bucket.head(media.object_key); requireValid(head && head.size === media.byte_length);
        // This exact version was fully hashed by media sync before its ETag entered the authenticated snapshot.
        if (media.r2_etag && media.r2_etag === head!.etag) continue;
        const object = await bucket.get(media.object_key, { onlyIf: { etagMatches: head!.etag } }); requireValid(object && "body" in object);
        const result = await backupFingerprint((object as R2ObjectBody).body, signal, media.byte_length);
        requireValid(result.sha256 === media.checksum_sha256 && result.byteLength === media.byte_length);
        await db.prepare(`UPDATE ${table} SET r2_etag = ? WHERE id = ?`).bind(head!.etag, media.id).run();
      }
      offset += page.results.length; if (page.results.length < 25) break;
    }
  }
  return { schemaVersion, business: await restoredBusinessSummary(db), mediaVerified: true as const };
}

export async function sanitizeRestoredCredentials(db: D1Database, oldSecret: string, newSecret: string) {
  requireValid(Buffer.byteLength(oldSecret) >= 32 && Buffer.byteLength(newSecret) >= 32 && oldSecret !== newSecret);
  const rows = await db.prepare('SELECT id, secret FROM "twoFactor" LIMIT 1001').all<{ id: string; secret: string }>();
  requireValid(rows.results.length <= 1000);
  const updates: D1PreparedStatement[] = [];
  // Authenticate every old TOTP and validate every new ciphertext before the atomic batch mutates anything.
  for (const row of rows.results) {
    const plaintext = await symmetricDecrypt({ key: oldSecret, data: row.secret });
    const secret = await symmetricEncrypt({ key: newSecret, data: plaintext }), backupCodes = await symmetricEncrypt({ key: newSecret, data: "[]" });
    requireValid(await symmetricDecrypt({ key: newSecret, data: secret }) === plaintext);
    requireValid(await symmetricDecrypt({ key: newSecret, data: backupCodes }) === "[]");
    updates.push(db.prepare('UPDATE "twoFactor" SET secret = ?, backupCodes = ?, failedVerificationCount = 0, lockedUntil = NULL WHERE id = ?').bind(secret, backupCodes, row.id));
  }
  const now = Date.now();
  await db.batch([...updates, db.prepare('DELETE FROM "session"'), db.prepare('DELETE FROM "verification"'),
    db.prepare("UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?) WHERE used_at IS NULL").bind(now),
    db.prepare("UPDATE registration_attempts SET state = 'failed', updated_at = MAX(updated_at, ?) WHERE state IN ('reserved', 'created')").bind(now),
    db.prepare('UPDATE "account" SET accessToken = NULL, refreshToken = NULL, idToken = NULL, accessTokenExpiresAt = NULL, refreshTokenExpiresAt = NULL')]);
  return { totpPreserved: rows.results.length, authKeyId: backupKeyId(newSecret), credentialsCleared: true as const };
}

export async function verifyRestoredCredentials(db: D1Database, newSecret: string) {
  requireValid(Buffer.byteLength(newSecret) >= 32);
  const counts = await db.batch<{ n: number }>([
    db.prepare('SELECT COUNT(*) AS n FROM "session"'), db.prepare('SELECT COUNT(*) AS n FROM "verification"'),
    db.prepare("SELECT COUNT(*) AS n FROM invitations WHERE used_at IS NULL AND revoked_at IS NULL"),
    db.prepare("SELECT COUNT(*) AS n FROM registration_attempts WHERE state IN ('reserved', 'created')"),
    db.prepare('SELECT COUNT(*) AS n FROM account WHERE accessToken IS NOT NULL OR refreshToken IS NOT NULL OR idToken IS NOT NULL'),
  ]);
  requireValid(counts.every(result => result.results[0].n === 0));
  const factors = await db.prepare('SELECT secret, backupCodes FROM "twoFactor" LIMIT 1001').all<{ secret: string; backupCodes: string }>();
  requireValid(factors.results.length <= 1000);
  for (const factor of factors.results) {
    requireValid((await symmetricDecrypt({ key: newSecret, data: factor.secret })).length > 0);
    requireValid(await symmetricDecrypt({ key: newSecret, data: factor.backupCodes }) === "[]");
  }
  return { credentialsCleared: true as const, authKeyId: backupKeyId(newSecret), totpPreserved: factors.results.length };
}
