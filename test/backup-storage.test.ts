import { Buffer } from "node:buffer";
import { createHash, hkdfSync } from "node:crypto";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { encryptBackup, stageBackup, verifyEncryptedBackup, type BackupMetadata } from "@/lib/backup-storage.server";

const secret = "fictional-backup-secret-0123456789abcdef", signal = () => new AbortController().signal;
const metadata = (): BackupMetadata => ({ environment: "test", id: crypto.randomUUID(), createdAt: 1792108800000, schemaVersion: "0017_discussions.sql", bookmark: "fictional-export-bookmark" });
const path = (value: BackupMetadata) => `backups/${value.environment}/${value.id}/`;
const sql = Buffer.from("CREATE TABLE fictional (id TEXT);\nINSERT INTO fictional VALUES ('starship');\n");
function stream(bytes: Uint8Array, chunkSize = 17) {
  let at = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (at === bytes.length) { controller.close(); return; }
    const end = Math.min(at + chunkSize, bytes.length); controller.enqueue(bytes.subarray(at, end)); at = end;
  } });
}
async function fixture(bytes = sql) {
  const meta = metadata(), source = await stageBackup(env.MEDIA_BUCKET, meta, stream(bytes), bytes.length, signal());
  const encrypted = await encryptBackup(env.MEDIA_BUCKET, meta, secret, signal());
  const object = await env.MEDIA_BUCKET.get(`${path(meta)}${encrypted.file}.bin`);
  return { meta, source, encrypted, bytes: Buffer.from(await object!.arrayBuffer()) };
}
afterEach(() => vi.restoreAllMocks());

it.each([Buffer.alloc(0), sql])("stores, authenticates and independently restores the full SQL", async bytes => {
  const result = await fixture(bytes), { meta, source, encrypted } = result;
  const { bookmark, ...recoveryMetadata } = meta;
  expect(source).toEqual({ ...recoveryMetadata, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  const verified = await verifyEncryptedBackup(env.MEDIA_BUCKET, meta, encrypted.file, secret, signal());
  expect(verified).toMatchObject({ source, byteLength: result.bytes.length, sha256: encrypted.sha256 });
  const headerEnd = 12 + result.bytes.readUInt32BE(8), header = JSON.parse(result.bytes.subarray(12, headerEnd).toString());
  // Independent Web Crypto decryption checks the file format, not just the implementation's own verifier.
  const key = await crypto.subtle.importKey("raw", hkdfSync("sha256", secret, Buffer.from(header.salt, "hex"), "video-site/backup/v1", 32), "AES-GCM", false, ["decrypt"]);
  const restored = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(header.nonce, "hex"), additionalData: result.bytes.subarray(0, headerEnd), tagLength: 128 }, key, result.bytes.subarray(headerEnd));
  expect(Buffer.from(restored)).toEqual(bytes);
  expect(await (await env.MEDIA_BUCKET.get(`${path(meta)}source.json`))!.json()).toEqual({ ...source, bookmark });
  expect(await (await env.MEDIA_BUCKET.get(`${path(meta)}${encrypted.file}.json`))!.json()).toEqual(encrypted);
  expect(result.bytes.includes(Buffer.from(secret))).toBe(false);
  expect(result.bytes.includes(Buffer.from(bookmark))).toBe(false);
  if (bytes.length) expect(result.bytes.includes(bytes)).toBe(false);
  expect(await env.MEDIA_BUCKET.list({ prefix: "library/" })).toMatchObject({ objects: [] });
});

it("reuses the verified source and produces independently nonced files on manual encryption retry", async () => {
  const { meta, encrypted, source } = await fixture();
  const head = await env.MEDIA_BUCKET.head(`${path(meta)}source.sql`);
  const retry = await encryptBackup(env.MEDIA_BUCKET, meta, secret, signal());
  expect(retry.source).toEqual(source); expect(retry.file).not.toBe(encrypted.file); expect(retry.sha256).not.toBe(encrypted.sha256);
  expect((await env.MEDIA_BUCKET.head(`${path(meta)}source.sql`))!.etag).toBe(head!.etag);
  expect(await env.MEDIA_BUCKET.head(`${path(meta)}${encrypted.file}.bin`)).not.toBeNull();
  await expect(stageBackup(env.MEDIA_BUCKET, meta, stream(sql), sql.length, signal())).rejects.toThrow("BACKUP_ALREADY_EXISTS");
  expect(await (await env.MEDIA_BUCKET.get(`${path(meta)}source.sql`))!.text()).toBe(sql.toString());
});

it("rejects wrong keys, other environments and other backup identities", async () => {
  const { meta, bytes, encrypted } = await fixture();
  await expect(verifyEncryptedBackup(env.MEDIA_BUCKET, meta, encrypted.file, "short", signal())).rejects.toThrow("BACKUP_KEY_INVALID");
  await expect(verifyEncryptedBackup(env.MEDIA_BUCKET, meta, encrypted.file, `${secret}wrong`, signal())).rejects.toThrow("BACKUP_KEY_MISMATCH");
  for (const other of [{ ...meta, environment: "production" as const }, { ...meta, id: crypto.randomUUID() }]) {
    await expect(verifyEncryptedBackup(env.MEDIA_BUCKET, other, encrypted.file, secret, signal())).rejects.toThrow("BACKUP_OBJECT_UNAVAILABLE");
    await env.MEDIA_BUCKET.put(`${path(other)}${encrypted.file}.bin`, bytes);
    await expect(verifyEncryptedBackup(env.MEDIA_BUCKET, other, encrypted.file, secret, signal())).rejects.toThrow("BACKUP_SCOPE_MISMATCH");
  }
});

it("handles one-byte ciphertext chunks and rejects an object version change before reading its tag", async () => {
  const { meta, encrypted } = await fixture(), get = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET);
  const read = vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementation(async (key, options) => {
    const object = await get(key, options);
    if (object && "body" in object && !options?.range) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      return { ...object, body: stream(bytes, 1), writeHttpMetadata: object.writeHttpMetadata.bind(object) };
    }
    return object;
  });
  expect((await verifyEncryptedBackup(env.MEDIA_BUCKET, meta, encrypted.file, secret, signal())).sha256).toBe(encrypted.sha256);
  read.mockImplementation(async (key, options) => options?.onlyIf ? null : get(key));
  await expect(verifyEncryptedBackup(env.MEDIA_BUCKET, meta, encrypted.file, secret, signal())).rejects.toThrow("BACKUP_OBJECT_UNAVAILABLE");
});

it("rejects modified headers, ciphertext, authentication tags, truncation and appended data", async () => {
  const { meta, bytes, encrypted } = await fixture();
  async function verify(changed: Uint8Array) {
    await env.MEDIA_BUCKET.put(`${path(meta)}${encrypted.file}.bin`, changed);
    return verifyEncryptedBackup(env.MEDIA_BUCKET, meta, encrypted.file, secret, signal());
  }
  const payload = 12 + bytes.readUInt32BE(8);
  for (const at of [bytes.indexOf(Buffer.from("0017")), payload, bytes.length - 1]) {
    const changed = Buffer.from(bytes); changed[at] ^= 1;
    await expect(verify(changed)).rejects.toThrow("BACKUP_AUTHENTICATION_FAILED");
  }
  for (const length of [0, 8, 11, payload - 1, payload, bytes.length - 1]) {
    await expect(verify(bytes.subarray(0, length))).rejects.toThrow("BACKUP_TRUNCATED");
  }
  await expect(verify(Buffer.concat([bytes, Buffer.from([0])]))).rejects.toThrow("BACKUP_AUTHENTICATION_FAILED");
  const tooLong = Buffer.from(bytes); tooLong.writeUInt32BE(4097, 8);
  await expect(verify(tooLong)).rejects.toThrow("BACKUP_INVALID");
});

it("rejects invalid scopes and lengths before writing any object", async () => {
  for (const invalid of [-1, 0.5, 2 ** 36 - 31, Number.NaN]) {
    await expect(stageBackup(env.MEDIA_BUCKET, metadata(), stream(sql), invalid, signal())).rejects.toThrow("BACKUP_INVALID");
  }
  await expect(stageBackup(env.MEDIA_BUCKET, { ...metadata(), id: "../../library/movie" }, stream(sql), sql.length, signal())).rejects.toThrow("BACKUP_INVALID");
  expect((await env.MEDIA_BUCKET.list({ prefix: "backups/" })).objects).toHaveLength(0);
});

it.each([-1, 1])("does not mark incomplete or overlong source streams complete (%i)", async difference => {
  const meta = metadata();
  await expect(stageBackup(env.MEDIA_BUCKET, meta, stream(sql), sql.length + difference, signal())).rejects.toThrow();
  expect(await env.MEDIA_BUCKET.head(`${path(meta)}source.json`)).toBeNull();
});

it("does not complete a source whose readback differs from the bytes uploaded", async () => {
  const meta = metadata(), get = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET);
  vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementation(async (key, options) => {
    const object = await get(key, options);
    if (key.endsWith("source.sql") && object && "body" in object) {
      await object.body.cancel();
      return { ...object, body: stream(Buffer.alloc(sql.length)), writeHttpMetadata: object.writeHttpMetadata.bind(object) };
    }
    return object;
  });
  await expect(stageBackup(env.MEDIA_BUCKET, meta, stream(sql), sql.length, signal())).rejects.toThrow("BACKUP_CHECKSUM_MISMATCH");
  expect(await env.MEDIA_BUCKET.head(`${path(meta)}source.json`)).toBeNull();
});

it("rejects corruption of the saved source and preserves its completion record for diagnosis", async () => {
  const meta = metadata(); await stageBackup(env.MEDIA_BUCKET, meta, stream(sql), sql.length, signal());
  await env.MEDIA_BUCKET.put(`${path(meta)}source.sql`, Buffer.alloc(sql.length));
  await expect(encryptBackup(env.MEDIA_BUCKET, meta, secret, signal())).rejects.toThrow();
  expect(await env.MEDIA_BUCKET.head(`${path(meta)}source.json`)).not.toBeNull();
  expect((await env.MEDIA_BUCKET.list({ prefix: `${path(meta)}encrypted-` })).objects.filter(object => object.key.endsWith(".json"))).toHaveLength(0);
});

it("keeps the full source and never marks a failed encrypted readback successful", async () => {
  const meta = metadata(); await stageBackup(env.MEDIA_BUCKET, meta, stream(sql), sql.length, signal());
  const get = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET);
  vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementation(async (key, options) => {
    const object = await get(key, options);
    if (key.endsWith(".bin") && !options?.range && object && "body" in object) {
      const changed = Buffer.from(await object.arrayBuffer()); changed[changed.length - 1] ^= 1;
      return { ...object, body: stream(changed), writeHttpMetadata: object.writeHttpMetadata.bind(object) };
    }
    return object;
  });
  await expect(encryptBackup(env.MEDIA_BUCKET, meta, secret, signal())).rejects.toThrow("BACKUP_AUTHENTICATION_FAILED");
  expect(await (await get(`${path(meta)}source.sql`))!.text()).toBe(sql.toString());
  expect((await env.MEDIA_BUCKET.list({ prefix: `${path(meta)}encrypted-` })).objects.filter(object => object.key.endsWith(".json"))).toHaveLength(0);
});

it("retains the source when encrypted upload fails and succeeds on a later manual retry", async () => {
  const meta = metadata(); await stageBackup(env.MEDIA_BUCKET, meta, stream(sql), sql.length, signal());
  const put = vi.spyOn(env.MEDIA_BUCKET, "put").mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(encryptBackup(env.MEDIA_BUCKET, meta, secret, signal())).rejects.toThrow("storage unavailable");
  put.mockRestore();
  expect(await (await env.MEDIA_BUCKET.get(`${path(meta)}source.sql`))!.text()).toBe(sql.toString());
  expect((await env.MEDIA_BUCKET.list({ prefix: `${path(meta)}encrypted-` })).objects).toHaveLength(0);
  expect((await encryptBackup(env.MEDIA_BUCKET, meta, secret, signal())).source.byteLength).toBe(sql.length);
});

it("does not report success when the completion record cannot be stored, without deleting either full copy", async () => {
  const meta = metadata(); await stageBackup(env.MEDIA_BUCKET, meta, stream(sql), sql.length, signal());
  const put = env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET);
  vi.spyOn(env.MEDIA_BUCKET, "put").mockImplementation(async (key, value, options) => {
    if (key.includes("encrypted-") && key.endsWith(".json")) throw new Error("record write failed");
    return put(key, value, options);
  });
  await expect(encryptBackup(env.MEDIA_BUCKET, meta, secret, signal())).rejects.toThrow("record write failed");
  expect(await env.MEDIA_BUCKET.head(`${path(meta)}source.sql`)).not.toBeNull();
  const files = (await env.MEDIA_BUCKET.list({ prefix: `${path(meta)}encrypted-` })).objects;
  expect(files).toHaveLength(1); expect(files[0].key.endsWith(".bin")).toBe(true);
});

it("cancels a source passed with an already aborted signal without touching storage", async () => {
  const abort = new AbortController(), cancelled = vi.fn(); abort.abort(new Error("already cancelled"));
  const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
  await expect(stageBackup(env.MEDIA_BUCKET, metadata(), body, 10, abort.signal)).rejects.toThrow("already cancelled");
  expect(cancelled).toHaveBeenCalled(); expect((await env.MEDIA_BUCKET.list({ prefix: "backups/" })).objects).toHaveLength(0);
});

it("cancels a pending source read without writing a source completion record", async () => {
  const abort = new AbortController(), cancelled = vi.fn(), meta = metadata();
  const body = new ReadableStream<Uint8Array>({ pull() { abort.abort(new Error("cancelled")); }, cancel: cancelled }, { highWaterMark: 0 });
  await expect(stageBackup(env.MEDIA_BUCKET, meta, body, 10, abort.signal)).rejects.toThrow("cancelled");
  expect(cancelled).toHaveBeenCalled(); expect(await env.MEDIA_BUCKET.head(`${path(meta)}source.json`)).toBeNull();
});

it("streams a 144 MiB generated backup through R2 without buffering it as a whole", async () => {
  const meta = metadata(), chunk = Buffer.alloc(64 * 1024, 65), size = 144 * 1024 * 1024;
  let remaining = size;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (!remaining) { controller.close(); return; } controller.enqueue(chunk); remaining -= chunk.length;
  } });
  const source = await stageBackup(env.MEDIA_BUCKET, meta, body, size, signal());
  const encrypted = await encryptBackup(env.MEDIA_BUCKET, meta, secret, signal());
  expect(encrypted.source).toEqual(source); expect(encrypted.byteLength).toBeGreaterThan(size); expect(remaining).toBe(0);
}, 90_000);
