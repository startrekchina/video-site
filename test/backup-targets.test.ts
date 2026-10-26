import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { backupTargetAvailability, deleteExternalBackup, uploadBackup, type ExternalBackupTarget } from "@/lib/backup-targets.server";
import { backupKeyId } from "@/lib/backup-keys.server";
import { encryptBackup, stageBackup } from "@/lib/backup-storage.server";

const runtime: Env = { ...env, WEBDAV_URL: "https://dav.example.test/private/", WEBDAV_USERNAME: "fictional-owner", WEBDAV_PASSWORD: "fictional-password",
  S3_BACKUP_ENDPOINT: "https://s3.example.test/", S3_BACKUP_BUCKET: "fictional-backups", S3_BACKUP_REGION: "auto",
  S3_BACKUP_ACCESS_KEY_ID: "fictional-access-key", S3_BACKUP_SECRET_ACCESS_KEY: "fictional-secret-key" };
const signal = () => new AbortController().signal;
async function artifact() {
  const scope = { environment: "test" as const, id: crypto.randomUUID() }, sql = "CREATE TABLE fictional (id INTEGER);";
  await stageBackup(env.MEDIA_BUCKET, { ...scope, createdAt: Date.now(), schemaVersion: "fictional", bookmark: "private-bookmark", authKeyId: backupKeyId(runtime.BETTER_AUTH_SECRET) }, new Response(sql).body!, sql.length, signal());
  return encryptBackup(env.MEDIA_BUCKET, scope, runtime.BACKUP_ENCRYPTION_KEY, signal());
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each(["webdav", "s3"].flatMap(target => ["aborted-before-fetch", "network-error"].map(fault => ({ target: target as ExternalBackupTarget, fault }))))
  ("closes the encrypted $target source after $fault without deleting it", async ({ target, fault }) => {
    const file = await artifact(), controller = new AbortController(), get = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET);
    const cancellations: ReturnType<typeof vi.spyOn>[] = [];
    vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementation(async (key, options) => {
      const object = await get(key, options);
      if (object && "body" in object) cancellations.push(vi.spyOn(object.body, "cancel"));
      if (fault === "aborted-before-fetch") controller.abort();
      return object;
    });
    const network = vi.fn(async () => { throw new Error("fictional network failure"); }); vi.stubGlobal("fetch", network);
    await expect(uploadBackup(runtime, target, file, controller.signal)).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(fault === "aborted-before-fetch" ? 0 : 1);
    expect(cancellations).toHaveLength(1); expect(cancellations[0]).toHaveBeenCalledOnce();
    expect(await env.MEDIA_BUCKET.head(`backups/test/${file.source.id}/${file.file}.bin`)).not.toBeNull();
  });
it.each(["webdav", "s3"] as ExternalBackupTarget[])("streams encrypted %s PUT and checks GET content, not ETag", async target => {
  const file = await artifact(); let uploaded = new Uint8Array();
  const network = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toMatch(/^https:/u); expect(init?.redirect).toBe("manual");
    const headers = new Headers(init?.headers);
    expect(headers.get("Accept-Encoding")).toBe("identity");
    if (target === "webdav") expect(headers.get("Authorization")).toBe("Basic " + Buffer.from("fictional-owner:fictional-password").toString("base64"));
    else {
      expect(headers.get("Authorization")).toMatch(/^AWS4-HMAC-SHA256 /u);
      expect(headers.get("Authorization")).not.toMatch(/SignedHeaders=[^, ]*accept-encoding/u);
      expect(headers.get("X-Amz-Content-Sha256")).toBe(init?.method === "PUT" ? file.sha256 : createHash("sha256").digest("hex"));
      expect(String(url)).toContain("/fictional-backups/");
    }
    if (init?.method === "PUT") { expect(init.body).toBeInstanceOf(ReadableStream); uploaded = new Uint8Array(await new Response(init.body).arrayBuffer()); return new Response(null); }
    return new Response(uploaded, { headers: { ETag: "not-a-content-hash" } });
  });
  vi.stubGlobal("fetch", network);
  const receipt = await uploadBackup(runtime, target, file, signal());
  expect(receipt).toMatchObject({ target }); expect(network).toHaveBeenCalledTimes(2);
  expect(Buffer.from(uploaded).includes(Buffer.from("CREATE TABLE"))).toBe(false);
  await deleteExternalBackup(runtime, receipt, signal()); expect(network).toHaveBeenCalledTimes(3);
});
it.each(["redirect", "corrupt", "truncated", "appended", "compressed", "failed-put"])("does not mark external success on %s or remove the R2 source", async fault => {
  const file = await artifact(); let uploaded = new Uint8Array();
  const network = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      uploaded = new Uint8Array(await new Response(init.body).arrayBuffer());
      return new Response(null, { status: fault === "failed-put" ? 500 : 200 });
    }
    if (fault === "redirect") return new Response(null, { status: 302, headers: { Location: "https://evil.example.test" } });
    if (fault === "corrupt") uploaded[uploaded.length - 1] ^= 1;
    if (fault === "truncated") uploaded = uploaded.subarray(0, -1);
    if (fault === "appended") uploaded = new Uint8Array([...uploaded, 1]);
    return new Response(uploaded, { headers: { ETag: file.etag, ...(fault === "compressed" ? { "Content-Encoding": "gzip" } : {}) } });
  });
  vi.stubGlobal("fetch", network);
  await expect(uploadBackup(runtime, "webdav", file, signal())).rejects.toThrow();
  expect(network).toHaveBeenCalledTimes(fault === "failed-put" ? 1 : 2);
  expect(await env.MEDIA_BUCKET.head(`backups/test/${file.source.id}/source.sql`)).not.toBeNull();
});
it("fails closed on partial/insecure targets and refuses deletion after destination changes", async () => {
  expect(backupTargetAvailability({ ...runtime, WEBDAV_PASSWORD: "", S3_BACKUP_REGION: "" })).toEqual({ webdav: false, s3: false });
  for (const url of ["http://dav.example.test/", "https://user:pass@dav.example.test/", "https://dav.example.test/?secret=x", "invalid"]) {
    expect(backupTargetAvailability({ ...runtime, WEBDAV_URL: url }).webdav).toBe(false);
  }
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  await expect(deleteExternalBackup(runtime, { target: "webdav", destinationId: "changed", name: "arbitrary", verifiedAt: 0 }, signal())).rejects.toThrow("BACKUP_TARGET_CHANGED");
  expect(network).not.toHaveBeenCalled();
});
