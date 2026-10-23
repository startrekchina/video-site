import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const backupKeyId = (secret: string) => createHash("sha256").update(secret).digest("hex");
export function backupKeys(env: Pick<Env, "BACKUP_ENCRYPTION_KEY" | "BETTER_AUTH_SECRET" | "BACKUP_KEYRING">) {
  const old: unknown = JSON.parse(env.BACKUP_KEYRING || "[]");
  if (!Array.isArray(old) || old.length > 20) throw new Error("BACKUP_KEYRING_INVALID");
  const pairs: unknown[] = [{ backupKey: env.BACKUP_ENCRYPTION_KEY, authSecret: env.BETTER_AUTH_SECRET }, ...old];
  return pairs.map(pair => {
    if (!pair || typeof pair !== "object" || !("backupKey" in pair) || !("authSecret" in pair)
      || typeof pair.backupKey !== "string" || typeof pair.authSecret !== "string"
      || Buffer.byteLength(pair.backupKey) < 32 || Buffer.byteLength(pair.authSecret) < 32 || pair.backupKey === pair.authSecret) throw new Error("BACKUP_KEYRING_INVALID");
    return { backupKey: pair.backupKey, authSecret: pair.authSecret, keyId: backupKeyId(pair.backupKey), authKeyId: backupKeyId(pair.authSecret) };
  });
}
