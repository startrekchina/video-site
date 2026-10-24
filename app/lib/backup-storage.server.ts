import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const magic = Buffer.from("STCNBKP1"), headerLimit = 4096, maxSqlBytes = 2 ** 36 - 32;
type Environment = "development" | "test" | "staging" | "production";
export type BackupScope = { environment: Environment; id: string };
export type BackupMetadata = BackupScope & { createdAt: number; schemaVersion: string; bookmark: string; authKeyId?: string };
type Fingerprint = { byteLength: number; sha256: string };
type Source = Omit<BackupMetadata, "bookmark"> & Fingerprint;
function requireValid(value: unknown, code = "BACKUP_INVALID"): asserts value { if (!value) throw new Error(code); }
const hex = (value: unknown, length: number): value is string => typeof value === "string" && value.length === length && /^[a-f0-9]+$/u.test(value);
function prefix(scope: BackupScope) {
  requireValid(["development", "test", "staging", "production"].includes(scope.environment)
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(scope.id));
  return `backups/${scope.environment}/${scope.id}/`;
}
function sourceMetadata(value: unknown, scope: BackupScope): Source {
  requireValid(value && typeof value === "object");
  const data = value as Record<string, unknown>;
  requireValid(data.environment === scope.environment && data.id === scope.id, "BACKUP_SCOPE_MISMATCH");
  requireValid(Number.isSafeInteger(data.createdAt) && Number(data.createdAt) > 0
    && typeof data.schemaVersion === "string" && data.schemaVersion.length > 0 && data.schemaVersion.length <= 128
    && Number.isSafeInteger(data.byteLength) && Number(data.byteLength) >= 0 && Number(data.byteLength) <= maxSqlBytes
    && hex(data.sha256, 64));
  requireValid(data.authKeyId === undefined || hex(data.authKeyId, 64));
  return { environment: scope.environment, id: scope.id, createdAt: Number(data.createdAt), schemaVersion: String(data.schemaVersion),
    ...(data.authKeyId ? { authKeyId: String(data.authKeyId) } : {}),
    byteLength: Number(data.byteLength), sha256: String(data.sha256) };
}
function keyId(secret: string) {
  requireValid(Buffer.byteLength(secret) >= 32, "BACKUP_KEY_INVALID");
  return createHash("sha256").update(secret).digest("hex");
}
const fileKey = (secret: string, salt: Uint8Array) => Buffer.from(hkdfSync("sha256", secret, salt, "video-site/backup/v1", 32));
function same(actual: Fingerprint, expected: Fingerprint) {
  requireValid(actual.byteLength === expected.byteLength && actual.sha256 === expected.sha256, "BACKUP_CHECKSUM_MISMATCH");
}

async function consume(body: ReadableStream<Uint8Array>, signal: AbortSignal, accept: (chunk: Uint8Array) => void) {
  const reader = body.getReader(), cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) { const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; accept(next.value); }
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
}
export async function backupFingerprint(body: ReadableStream<Uint8Array>, signal: AbortSignal, limit = Infinity): Promise<Fingerprint> {
  const hash = createHash("sha256"); let byteLength = 0;
  await consume(body, signal, chunk => { byteLength += chunk.byteLength; requireValid(byteLength <= limit, "BACKUP_CHECKSUM_MISMATCH"); hash.update(chunk); });
  return { byteLength, sha256: hash.digest("hex") };
}
async function readObject(bucket: R2Bucket, key: string, etag?: string) {
  const object = await bucket.get(key, etag ? { onlyIf: { etagMatches: etag } } : undefined);
  requireValid(object && "body" in object, "BACKUP_OBJECT_UNAVAILABLE");
  return object;
}
async function writeStream(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array>, length: number, signal: AbortSignal) {
  const stop = new AbortController(), combined = AbortSignal.any([signal, stop.signal]);
  const fixed = new FixedLengthStream(length), hash = createHash("sha256"); let byteLength = 0;
  const reader = body.getReader(), writer = fixed.writable.getWriter();
  const cancel = () => { void reader.cancel().catch(() => {}); void writer.abort().catch(() => {}); };
  combined.addEventListener("abort", cancel, { once: true });
  // R2 needs a known-length stream; await both sides and cancel the producer on upload failure.
  const pumping = (async () => {
    try {
      combined.throwIfAborted();
      while (true) {
        const next = await reader.read(); combined.throwIfAborted(); if (next.done) break;
        byteLength += next.value.byteLength; hash.update(next.value); await writer.write(next.value);
      }
      await writer.close();
    } catch (error) { stop.abort(); throw error; }
    finally { await reader.cancel().catch(() => {}); }
  })();
  const storing = Promise.resolve().then(() => bucket.put(key, fixed.readable, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/octet-stream" } }))
    .then(object => { requireValid(object, "BACKUP_ALREADY_EXISTS"); return object!; }).catch(error => { stop.abort(); throw error; });
  const results = await Promise.allSettled([pumping, storing]);
  combined.removeEventListener("abort", cancel);
  signal.throwIfAborted();
  // Prefer the storage error when it caused cancellation of the source stream.
  if (results[1].status === "rejected") throw results[1].reason;
  if (results[0].status === "rejected") throw results[0].reason;
  return { object: results[1].value, byteLength, sha256: hash.digest("hex") };
}
async function writeRecord(bucket: R2Bucket, key: string, record: unknown) {
  requireValid(await bucket.put(key, JSON.stringify(record), { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json" } }), "BACKUP_ALREADY_EXISTS");
}

export async function stageBackup(bucket: R2Bucket, metadata: BackupMetadata, body: ReadableStream<Uint8Array>, byteLength: number, signal: AbortSignal) {
  if (signal.aborted) { await body.cancel(); signal.throwIfAborted(); }
  const path = prefix(metadata);
  sourceMetadata({ ...metadata, byteLength, sha256: "0".repeat(64) }, metadata);
  requireValid(typeof metadata.bookmark === "string" && metadata.bookmark.length > 0 && metadata.bookmark.length <= 256);
  signal.throwIfAborted();
  const stored = await writeStream(bucket, `${path}source.sql`, body, byteLength, signal);
  const reread = await readObject(bucket, `${path}source.sql`, stored.object.etag);
  same(await backupFingerprint(reread.body, signal), stored);
  const source = sourceMetadata({ ...metadata, byteLength: stored.byteLength, sha256: stored.sha256 }, metadata);
  signal.throwIfAborted();
  await writeRecord(bucket, `${path}source.json`, { ...source, bookmark: metadata.bookmark });
  return source;
}

// Authentication verifies the whole file before returning metadata; no unauthenticated plaintext escapes.
async function verifyStream(body: ReadableStream<Uint8Array>, scope: BackupScope, secret: string, tag: Uint8Array, signal: AbortSignal,
  accept?: (chunk: Uint8Array) => Promise<void>) {
  prefix(scope); const expectedKey = keyId(secret), reader = body.getReader(), hash = createHash("sha256");
  let pending: Uint8Array = new Uint8Array(0), offset = 0, byteLength = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  async function take(max: number): Promise<Uint8Array | null> {
    signal.throwIfAborted();
    while (offset === pending.byteLength) {
      const next = await reader.read(); signal.throwIfAborted(); if (next.done) return null;
      pending = next.value; offset = 0; hash.update(pending); byteLength += pending.byteLength;
    }
    const part = pending.subarray(offset, offset + max); offset += part.byteLength; return part;
  }
  async function exact(length: number) {
    const bytes = Buffer.alloc(length); let at = 0;
    while (at < length) { const part = await take(length - at); requireValid(part, "BACKUP_TRUNCATED"); bytes.set(part!, at); at += part!.byteLength; }
    return bytes;
  }
  try {
    const start = await exact(12);
    requireValid(start.subarray(0, 8).equals(magic), "BACKUP_FORMAT_UNSUPPORTED");
    const headerLength = start.readUInt32BE(8); requireValid(headerLength > 0 && headerLength <= headerLimit);
    const header = await exact(headerLength), parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(header));
    requireValid(parsed && typeof parsed === "object"); const data = parsed as Record<string, unknown>;
    const source = sourceMetadata(data.source, scope);
    requireValid(data.cipher === "AES-256-GCM" && hex(data.salt, 64) && hex(data.nonce, 24) && hex(data.keyId, 64));
    requireValid(data.keyId === expectedKey, "BACKUP_KEY_MISMATCH");
    const decipher = createDecipheriv("aes-256-gcm", fileKey(secret, Buffer.from(String(data.salt), "hex")), Buffer.from(String(data.nonce), "hex"));
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.concat([start, header]));
    const plaintextHash = createHash("sha256"); let remaining = source.byteLength, plaintextLength = 0;
    while (remaining) {
      const part = await take(remaining); requireValid(part, "BACKUP_TRUNCATED"); remaining -= part!.byteLength;
      const plaintext = decipher.update(part!); plaintextLength += plaintext.byteLength; plaintextHash.update(plaintext);
      if (accept) await accept(plaintext);
    }
    requireValid((await exact(16)).equals(tag), "BACKUP_AUTHENTICATION_FAILED");
    requireValid(await take(1) === null, "BACKUP_TRAILING_DATA");
    let final: Buffer;
    try { final = decipher.final(); } catch { throw new Error("BACKUP_AUTHENTICATION_FAILED"); }
    plaintextLength += final.byteLength; plaintextHash.update(final);
    same({ byteLength: plaintextLength, sha256: plaintextHash.digest("hex") }, source);
    if (accept && final.byteLength) await accept(final);
    return { source, keyId: expectedKey, byteLength, sha256: hash.digest("hex") };
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
}

export function restorePlaintextKey(environment: BackupScope["environment"], id: string) {
  prefix({ environment, id }); return `backup-restore/${environment}/${id}/source.sql`;
}
// Only call from a Cloudflare-side recovery Worker, never a local SQL export CLI or the public application.
export async function decryptBackupForRestore(bucket: R2Bucket, scope: BackupScope, file: string, secret: string, signal: AbortSignal, restoreId: string = crypto.randomUUID()) {
  const verified = await verifyEncryptedBackup(bucket, scope, file, secret, signal);
  const destination = restorePlaintextKey(scope.environment, restoreId);
  const object = await readObject(bucket, `${prefix(scope)}${file}.bin`, verified.etag);
  const tail = await bucket.get(`${prefix(scope)}${file}.bin`, { range: { suffix: 16 }, onlyIf: { etagMatches: verified.etag } });
  if (!tail || !("body" in tail)) { await object.body.cancel(); throw new Error("BACKUP_OBJECT_UNAVAILABLE"); }
  const tag = new Uint8Array(await tail.arrayBuffer()), stream = new FixedLengthStream(verified.source.byteLength), writer = stream.writable.getWriter();
  const stop = new AbortController(), combined = AbortSignal.any([signal, stop.signal]);
  const cancel = () => { void writer.abort().catch(() => {}); }; combined.addEventListener("abort", cancel, { once: true });
  const pumping = (async () => {
    try {
      await verifyStream(object.body, scope, secret, tag, combined, chunk => writer.write(chunk));
      await writer.close();
    } catch (error) { stop.abort(); throw error; }
  })();
  const storing = bucket.put(destination, stream.readable, { onlyIf: { etagDoesNotMatch: "*" } }).then(result => {
    requireValid(result, "BACKUP_ALREADY_EXISTS"); return result!;
  }).catch(error => { stop.abort(); throw error; });
  try {
    const results = await Promise.allSettled([pumping, storing]);
    if (results[1].status === "rejected") throw results[1].reason;
    if (results[0].status === "rejected") throw results[0].reason;
    combined.throwIfAborted();
    const stored = results[1].value, reread = await readObject(bucket, destination, stored.etag);
    same(await backupFingerprint(reread.body, signal, verified.source.byteLength), verified.source);
    return { ...verified, sqlKey: destination, sqlEtag: stored.etag };
  } catch (error) {
    await bucket.delete(destination); throw error;
  } finally { combined.removeEventListener("abort", cancel); }
}

export async function verifyEncryptedBackup(bucket: R2Bucket, scope: BackupScope, file: string, secret: string, signal: AbortSignal) {
  const path = prefix(scope); keyId(secret); signal.throwIfAborted();
  requireValid(/^encrypted-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(file));
  // workerd requires the GCM tag before update(); a bounded range read also pins the full read to this object version.
  const object = await readObject(bucket, `${path}${file}.bin`);
  try {
    requireValid(object.size >= 28, "BACKUP_TRUNCATED");
    const tail = await bucket.get(`${path}${file}.bin`, { range: { suffix: 16 }, onlyIf: { etagMatches: object.etag } });
    requireValid(tail && "body" in tail, "BACKUP_OBJECT_UNAVAILABLE");
    const tag = new Uint8Array(await tail.arrayBuffer()); requireValid(tag.byteLength === 16);
    return { ...await verifyStream(object.body, scope, secret, tag, signal), etag: object.etag };
  } finally { await object.body.cancel().catch(() => {}); }
}

export async function encryptBackup(bucket: R2Bucket, scope: BackupScope, secret: string, signal: AbortSignal) {
  const path = prefix(scope), fingerprintKey = keyId(secret); signal.throwIfAborted();
  const record = await readObject(bucket, `${path}source.json`);
  requireValid(record.size <= headerLimit);
  const source = sourceMetadata(await record.json(), scope);
  const salt = randomBytes(32), nonce = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ cipher: "AES-256-GCM", source, keyId: fingerprintKey, salt: salt.toString("hex"), nonce: nonce.toString("hex") }));
  requireValid(header.byteLength <= headerLimit);
  const start = Buffer.alloc(12); magic.copy(start); start.writeUInt32BE(header.byteLength, 8);
  const aad = Buffer.concat([start, header]), cipher = createCipheriv("aes-256-gcm", fileKey(secret, salt), nonce);
  cipher.setAAD(aad);
  const plaintext = await readObject(bucket, `${path}source.sql`), hash = createHash("sha256"); let length = 0;
  requireValid(plaintext.size === source.byteLength, "BACKUP_CHECKSUM_MISMATCH");
  const encrypted = plaintext.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    start(controller) { controller.enqueue(aad); },
    transform(chunk, controller) { length += chunk.byteLength; hash.update(chunk); controller.enqueue(cipher.update(chunk)); },
    flush(controller) {
      same({ byteLength: length, sha256: hash.digest("hex") }, source);
      controller.enqueue(cipher.final()); controller.enqueue(cipher.getAuthTag());
    },
  }));
  const file = `encrypted-${crypto.randomUUID()}`, stored = await writeStream(bucket, `${path}${file}.bin`, encrypted, aad.byteLength + source.byteLength + 16, signal);
  const verified = await verifyEncryptedBackup(bucket, scope, file, secret, signal); same(verified, stored);
  const result = { source, formatVersion: 1, keyId: fingerprintKey, file, byteLength: verified.byteLength, sha256: verified.sha256, etag: verified.etag };
  signal.throwIfAborted();
  await writeRecord(bucket, `${path}${file}.json`, result);
  return result;
}
