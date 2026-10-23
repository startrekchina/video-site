import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { AwsV4Signer } from "aws4fetch";
import { backupFingerprint } from "./backup-storage.server";

export type ExternalBackupTarget = "webdav" | "s3";
export type BackupTarget = "download" | ExternalBackupTarget;
export type BackupReceipt = { target: ExternalBackupTarget; destinationId: string; name: string; verifiedAt: number };
export type BackupArtifact = { source: { environment: string; id: string }; file: string; etag: string; byteLength: number; sha256: string };

function https(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}
function destination(env: Env, target: ExternalBackupTarget) {
  const base = https(target === "webdav" ? env.WEBDAV_URL : env.S3_BACKUP_ENDPOINT);
  if (!base) return null;
  if (target === "webdav") {
    if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD || env.WEBDAV_USERNAME.includes(":")) return null;
  } else {
    if (!env.S3_BACKUP_REGION || !env.S3_BACKUP_BUCKET || !env.S3_BACKUP_ACCESS_KEY_ID || !env.S3_BACKUP_SECRET_ACCESS_KEY
      || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(env.S3_BACKUP_BUCKET)) return null;
    base.pathname = base.pathname.replace(/\/$/u, "") + "/" + env.S3_BACKUP_BUCKET + "/";
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return { base, id: createHash("sha256").update(target + ":" + base.href).digest("hex") };
}
export function backupTargetAvailability(env: Env) {
  return { webdav: !!destination(env, "webdav"), s3: !!destination(env, "s3") };
}
async function targetFetch(env: Env, target: ExternalBackupTarget, name: string, method: "PUT" | "GET" | "DELETE", signal: AbortSignal,
  payload?: { body: ReadableStream<Uint8Array>; byteLength: number; sha256: string }) {
  const dest = destination(env, target);
  if (!dest || !/^video-site-(development|test|staging|production)-[a-f0-9-]+-encrypted-[a-f0-9-]+\.stcnbak$/u.test(name)) throw new Error("BACKUP_TARGET_INVALID");
  const url = new URL(name, dest.base), headers = new Headers();
  if (payload) {
    headers.set("Content-Type", "application/octet-stream"); headers.set("Content-Length", String(payload.byteLength));
  }
  if (target === "webdav") headers.set("Authorization", "Basic " + Buffer.from(env.WEBDAV_USERNAME + ":" + env.WEBDAV_PASSWORD).toString("base64"));
  else {
    // Sign the already verified payload hash, not the streaming body. No library retries or redirects.
    headers.set("X-Amz-Content-Sha256", payload?.sha256 ?? createHash("sha256").digest("hex"));
    const signed = await new AwsV4Signer({ url: url.href, method, headers, service: "s3", region: env.S3_BACKUP_REGION,
      accessKeyId: env.S3_BACKUP_ACCESS_KEY_ID, secretAccessKey: env.S3_BACKUP_SECRET_ACCESS_KEY }).sign();
    for (const [key, value] of signed.headers) headers.set(key, value);
  }
  headers.set("Accept-Encoding", "identity");
  signal.throwIfAborted();
  return fetch(url, { method, headers, body: payload?.body, signal, redirect: "manual", cache: "no-store" });
}
export function backupDestinationReceipt(env: Env, target: ExternalBackupTarget, artifact: BackupArtifact): BackupReceipt {
  const dest = destination(env, target); if (!dest) throw new Error("BACKUP_TARGET_INVALID");
  const name = `video-site-${artifact.source.environment}-${artifact.source.id}-${artifact.file}.stcnbak`;
  return { target, destinationId: dest.id, name, verifiedAt: 0 };
}
export async function uploadBackup(env: Env, target: ExternalBackupTarget, artifact: BackupArtifact, signal: AbortSignal): Promise<BackupReceipt> {
  const attempted = backupDestinationReceipt(env, target, artifact), name = attempted.name;
  const object = await env.MEDIA_BUCKET.get(`backups/${artifact.source.environment}/${artifact.source.id}/${artifact.file}.bin`, { onlyIf: { etagMatches: artifact.etag } });
  if (!object || !("body" in object) || object.size !== artifact.byteLength) {
    if (object && "body" in object) await object.body.cancel();
    throw new Error("BACKUP_OBJECT_CHANGED");
  }
  const put = await targetFetch(env, target, name, "PUT", signal, { ...artifact, body: object.body });
  await put.body?.cancel(); if (!put.ok) throw new Error("BACKUP_TARGET_UPLOAD_FAILED");
  const receipt = { ...attempted, verifiedAt: Date.now() };
  await verifyExternalBackup(env, receipt, artifact, signal);
  return receipt;
}
export async function verifyExternalBackup(env: Env, receipt: BackupReceipt, artifact: BackupArtifact, signal: AbortSignal) {
  if (destination(env, receipt.target)?.id !== receipt.destinationId) throw new Error("BACKUP_TARGET_CHANGED");
  const get = await targetFetch(env, receipt.target, receipt.name, "GET", signal);
  if (!get.ok || !get.body || get.headers.get("Content-Encoding") && get.headers.get("Content-Encoding") !== "identity") {
    await get.body?.cancel(); throw new Error("BACKUP_TARGET_VERIFY_FAILED");
  }
  const verified = await backupFingerprint(get.body, signal, artifact.byteLength);
  if (verified.byteLength !== artifact.byteLength || verified.sha256 !== artifact.sha256) throw new Error("BACKUP_TARGET_VERIFY_FAILED");
}
export async function deleteExternalBackup(env: Env, receipt: BackupReceipt, signal: AbortSignal) {
  // Changed targets cannot authorize deletion in a different storage location.
  if (destination(env, receipt.target)?.id !== receipt.destinationId) throw new Error("BACKUP_TARGET_CHANGED");
  const response = await targetFetch(env, receipt.target, receipt.name, "DELETE", signal);
  await response.body?.cancel();
  if (!response.ok && response.status !== 404) throw new Error("BACKUP_TARGET_DELETE_FAILED");
}
