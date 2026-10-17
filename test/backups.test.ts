import { Buffer } from "node:buffer";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { login, member, request } from "./fixtures/auth";
import { verifyEncryptedBackup } from "@/lib/backup-storage.server";
import { runScheduledBackup, updateBackupSchedule } from "@/lib/backups.server";
import { settings } from "@/lib/settings.server";

const runtime: Env = { ...env, APP_ENV: "test", OWNER_EMAIL: "NOVA@example.test", BACKUP_ACCOUNT_ID: "a".repeat(32),
  BACKUP_DATABASE_ID: "00000000-0000-4000-8000-000000000000", CLOUDFLARE_API_TOKEN: "fictional-export-token" };
const input = { target: "download", maintenanceConfirmed: true };
const sql = "CREATE TABLE fictional (value TEXT);\nINSERT INTO fictional VALUES ('private-fixture-sql');\n";
const signed = "https://fictional.r2.cloudflarestorage.com/export.sql?signature=private-fixture-signature";
const complete = () => Response.json({ success: true, result: { status: "complete", success: true, at_bookmark: "fictional-bookmark", result: { signed_url: signed } } });
const download = () => new Response(sql, { headers: { "Content-Length": String(Buffer.byteLength(sql)) } });
type PublicJob = { id: string; status: string; createdAt: number; backupTime: number | null; downloadReady: boolean; failure: { code: string } | null };
let owner: string, ordinary: string, admin: string, ownerId: string;
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  ownerId = (await member("Nova")).id;
  const otherAdmin = (await member("Vega")).id;
  await member("Kepler");
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id IN (?, ?)").bind(ownerId, otherAdmin).run();
  owner = await login("Nova"); ordinary = await login("Kepler"); admin = await login("Vega");
  mockExport();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function mockExport() {
  const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url) === signed ? download() : complete());
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function send(path: string, body?: object, cookie = owner, bindings = runtime, headers: Record<string, string> = {}, signal?: AbortSignal, method?: string) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(request(path, body, cookie, headers), { method: method ?? (body ? "POST" : "GET"), signal }), bindings, ctx);
  await waitOnExecutionContext(ctx); return response;
}
const data = async <T = PublicJob>(response: Response) => (await response.json() as { data: T }).data;
const create = async () => data(await send("/admin/backups", input));
const stateKey = (id: string) => `backup-control/test/jobs/${id}.json`;
const state = async (id: string) => (await env.MEDIA_BUCKET.get(stateKey(id)))!.json<{ sourceId: string; attempt: string; result: { file: string }; [key: string]: unknown }>();

it("keeps a verified encrypted download after external failure and retries without exporting or encrypting again", async () => {
  const bindings = { ...runtime, WEBDAV_URL: "https://dav.example.test/backups/", WEBDAV_USERNAME: "fictional", WEBDAV_PASSWORD: "fictional" };
  let remote = new Uint8Array(), failing = true, exports = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith(bindings.WEBDAV_URL)) {
      if (init?.method === "PUT") { remote = new Uint8Array(await new Response(init.body).arrayBuffer()); return new Response(null); }
      return new Response(failing ? remote.subarray(0, -1) : remote);
    }
    if (String(url) === signed) return download(); exports++; return complete();
  }));
  const body = { target: "webdav", maintenanceConfirmed: true };
  const job = await data(await send("/admin/backups", body, owner, bindings));
  expect(job).toMatchObject({ status: "failed", downloadReady: true, failure: { code: "BACKUP_TARGET_FAILED" } });
  const first = await state(job.id); failing = false;
  expect((await send(`/admin/backups/${job.id}/download`, undefined, owner, bindings)).status).toBe(200);
  const retried = await data(await send(`/admin/backups/${job.id}/retry`, body, owner, bindings));
  expect(retried).toMatchObject({ status: "complete", downloadReady: true });
  expect(exports).toBe(1); expect((await state(job.id)).result.file).toBe(first.result.file);
}, 10000);

it("retains verified ciphertext and remote ownership when final status persistence crosses the deadline", async () => {
  const bindings = { ...runtime, WEBDAV_URL: "https://dav.example.test/backups/", WEBDAV_USERNAME: "fictional", WEBDAV_PASSWORD: "fictional" };
  let remote = new Uint8Array(), exports = 0;
  const uploaded: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith(bindings.WEBDAV_URL)) {
      if (init?.method === "PUT") { uploaded.push(String(url)); remote = new Uint8Array(await new Response(init.body).arrayBuffer()); return new Response(null); }
      return new Response(remote);
    }
    if (String(url) === signed) return download(); exports++; return complete();
  }));
  const now = Date.now.bind(Date), list = env.MEDIA_BUCKET.list.bind(env.MEDIA_BUCKET);
  const crossing = vi.spyOn(env.MEDIA_BUCKET, "list").mockImplementationOnce(options => {
    vi.spyOn(Date, "now").mockImplementation(() => now() + settings.backupTaskTimeout * 1000 + 2000);
    return list(options);
  });
  const body = { target: "webdav", maintenanceConfirmed: true };
  const job = await data(await send("/admin/backups", body, owner, bindings)); crossing.mockRestore();
  expect(job).toMatchObject({ status: "failed", downloadReady: true, failure: { code: "BACKUP_TIMED_OUT" } });
  const first = await state(job.id);
  expect(first).toMatchObject({ receipt: { target: "webdav", name: expect.any(String) } });
  const downloaded = await send(`/admin/backups/${job.id}/download`, undefined, owner, bindings);
  expect(downloaded.status).toBe(200); await downloaded.body!.cancel();
  expect(await data(await send(`/admin/backups/${job.id}/retry`, body, owner, bindings))).toMatchObject({ status: "complete", downloadReady: true });
  expect(exports).toBe(1); expect(uploaded).toHaveLength(2); expect(uploaded[1]).toBe(uploaded[0]);
  expect((await state(job.id)).result.file).toBe(first.result.file);
}, 10000);

it("protects the last known-key R2 copy past retention and cleans only older backups, never media", async () => {
  const first = await create(), second = await create();
  await env.MEDIA_BUCKET.put("library/fictional.mp4", "protected media");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 86400_000);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  owner = await login("Nova"); mockExport();
  const cleaned = await data<{ status: string; deleted: number }>(await send("/admin/backups/cleanup", {}));
  expect(cleaned).toEqual({ status: "complete", deleted: 1 });
  expect((await data(await send(`/admin/backups/${first.id}`))).downloadReady).toBe(false);
  expect((await data(await send(`/admin/backups/${second.id}`))).downloadReady).toBe(true);
  expect(await env.MEDIA_BUCKET.head("library/fictional.mp4")).not.toBeNull();
});

it("cleans expired source prefixes abandoned by a retry without a source completion marker", async () => {
  const put = env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET); let failed = false;
  const failure = vi.spyOn(env.MEDIA_BUCKET, "put").mockImplementation(async (key, value, options) => {
    if (!failed && key.endsWith("/source.json")) { failed = true; throw new Error("fictional source marker failure"); }
    return put(key, value, options);
  });
  const job = await create(), abandoned = (await state(job.id)).sourceId; failure.mockRestore();
  expect(job.status).toBe("failed"); expect(await env.MEDIA_BUCKET.head(`backups/test/${abandoned}/source.sql`)).not.toBeNull();
  expect(await data(await send(`/admin/backups/${job.id}/retry`, input))).toMatchObject({ status: "complete" });
  const current = (await state(job.id)).sourceId; expect(current).not.toBe(abandoned);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 86400_000);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  owner = await login("Nova"); mockExport();
  expect(await data(await send("/admin/backups/cleanup", {}))).toEqual({ status: "complete", deleted: 1 });
  expect((await env.MEDIA_BUCKET.list({ prefix: `backups/test/${abandoned}/` })).objects).toHaveLength(0);
  expect(await env.MEDIA_BUCKET.head(`backups/test/${current}/source.sql`)).not.toBeNull();
}, 10000);

it("protects the last WebDAV copy independently while expiring its R2 copy after a newer download backup", async () => {
  const bindings = { ...runtime, WEBDAV_URL: "https://dav.example.test/backups/", WEBDAV_USERNAME: "fictional", WEBDAV_PASSWORD: "fictional" };
  const remote = new Map<string, Uint8Array<ArrayBuffer>>();
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith(bindings.WEBDAV_URL)) {
      if (init?.method === "PUT") { remote.set(String(url), new Uint8Array(await new Response(init.body).arrayBuffer())); return new Response(null); }
      if (init?.method === "DELETE") { remote.delete(String(url)); return new Response(null); }
      return new Response(remote.get(String(url)));
    }
    return String(url) === signed ? download() : complete();
  }));
  const external = await data(await send("/admin/backups", { target: "webdav", maintenanceConfirmed: true }, owner, bindings));
  await create();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 86400_000);
  const network = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  owner = await login("Nova"); vi.stubGlobal("fetch", network);
  expect(await data(await send("/admin/backups/cleanup", {}, owner, bindings))).toEqual({ status: "complete", deleted: 0 });
  expect(await data(await send(`/admin/backups/${external.id}`, undefined, owner, bindings))).toMatchObject({ downloadReady: false, r2Deleted: true, deleted: false });
  expect(remote.size).toBe(1);
}, 10000);

it("preserves recovery options when historical keys are missing and reports partial cleanup failures", async () => {
  await create(); await create();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 86400_000);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  owner = await login("Nova"); mockExport();
  const rotated = { ...runtime, BACKUP_ENCRYPTION_KEY: "fictional-rotated-backup-key-0123456789abcdef", BETTER_AUTH_SECRET: runtime.BETTER_AUTH_SECRET };
  // Rotating only the backup secret does not invalidate the existing login session.
  expect(await data(await send("/admin/backups/cleanup", {}, owner, rotated))).toEqual({ status: "failed", deleted: 0 });
  vi.spyOn(env.MEDIA_BUCKET, "delete").mockRejectedValue(new Error("private deletion failure"));
  expect(await data(await send("/admin/backups/cleanup", {}))).toEqual({ status: "failed", deleted: 0 });
}, 10000);

it("exports, checks and downloads only encrypted data through the authenticated HTTP boundary", async () => {
  const network = mockExport(), log = vi.spyOn(console, "info");
  const made = await send("/admin/backups", input), job = await data(made);
  expect(made.status).toBe(200); expect(job).toMatchObject({ status: "complete", downloadReady: true, failure: null });
  const response = await send(`/admin/backups/${job.id}/download`);
  expect(response.status).toBe(200); expect(response.headers.get("Content-Disposition")).toContain(".stcnbak");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  const bytes = Buffer.from(await response.arrayBuffer()); expect(bytes.subarray(0, 8).toString()).toBe("STCNBKP1");
  expect(bytes.includes(Buffer.from(sql))).toBe(false); expect(bytes.includes(Buffer.from(runtime.BACKUP_ENCRYPTION_KEY))).toBe(false);
  const stored = await state(job.id);
  const verified = await verifyEncryptedBackup(env.MEDIA_BUCKET, { environment: "test", id: stored.sourceId }, stored.result.file, runtime.BACKUP_ENCRYPTION_KEY, new AbortController().signal);
  expect(verified.source.byteLength).toBe(Buffer.byteLength(sql));
  const listing = await data<{ items: PublicJob[]; environment: string; targets: object }>(await send("/admin/backups/status"));
  const statusResponse = await send(`/admin/backups/${job.id}`), statusBody = await statusResponse.json() as { requestId: string };
  expect(statusBody.requestId).toBe(statusResponse.headers.get("X-Request-Id"));
  expect(listing).toMatchObject({ environment: "test", targets: { download: true, webdav: false, s3: false }, items: [job] });
  const output = JSON.stringify([job, listing, log.mock.calls]);
  for (const privateValue of [runtime.BACKUP_ACCOUNT_ID, runtime.CLOUDFLARE_API_TOKEN, runtime.BACKUP_ENCRYPTION_KEY, signed, sql, "backups/test/", "fictional-bookmark"]) expect(output).not.toContain(privateValue);
  const calls = network.mock.calls;
  expect(calls[0][1]).toMatchObject({ method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${runtime.CLOUDFLARE_API_TOKEN}` } });
  expect(JSON.parse(String(calls[0][1]!.body))).toEqual({ output_format: "polling" });
  expect(calls[1][1]).toMatchObject({ redirect: "manual", headers: { "Accept-Encoding": "identity" } });
  expect(new Headers(calls[1][1]!.headers).has("Authorization")).toBe(false);
});

it("rejects visitors, ordinary members and other administrators on every implemented endpoint", async () => {
  const network = mockExport(), id = `9000000000000000-${crypto.randomUUID()}`;
  for (const cookie of ["", ordinary, admin]) for (const [path, body] of [
    ["/admin/backups/status", undefined], [`/admin/backups/${id}`, undefined], ["/admin/backups", input],
    [`/admin/backups/${id}/retry`, input], [`/admin/backups/${id}/download`, undefined],
  ] as const) {
    const response = await send(path, body, cookie); expect(response.status).toBe(cookie ? 403 : 401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
  expect(network).not.toHaveBeenCalled(); expect((await env.MEDIA_BUCKET.list()).objects).toHaveLength(0);
});

it("stores schedule settings privately, rejects direct-download scheduling, and exposes Beijing next-run metadata", async () => {
  expect((await send("/admin/backups/schedule", { enabled: true, target: "download", frequency: "daily", time: "04:00" }, owner, runtime, {}, undefined, "PUT")).status).toBe(400);
  const unavailable = await send("/admin/backups/schedule", { enabled: true, target: "webdav", frequency: "daily", intervalDays: null, weekday: null, time: "04:00" }, owner, runtime, {}, undefined, "PUT");
  expect(unavailable.status).toBe(400);
  const bindings = { ...runtime, WEBDAV_URL: "https://dav.example.test/backups/", WEBDAV_USERNAME: "fictional", WEBDAV_PASSWORD: "fictional" };
  const now = Date.UTC(2026, 9, 17, 0, 0);
  const saved = await updateBackupSchedule(bindings, { enabled: true, target: "webdav", frequency: "weekly", intervalDays: null, weekday: 6, time: "09:30" }, now);
  expect(saved).toMatchObject({ enabled: true, target: "webdav", frequency: "weekly", time: "09:30", targetReady: true });
  expect(saved.nextRunAt).toBe(Date.UTC(2026, 9, 17, 1, 30));
  const status = await data<{ schedule: { enabled: boolean; target: string; nextRunAt: number } }>(await send("/admin/backups/status"));
  expect(status.schedule).toMatchObject({ enabled: true, target: "webdav", nextRunAt: saved.nextRunAt });
});

it("protects schedule PUT with live ownership, origin and JSON checks and persists only valid requests", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  const body = { enabled: true, target: "webdav", frequency: "daily", time: "04:00" };
  const bindings = { ...runtime, WEBDAV_URL: "https://dav.example.test/backups/", WEBDAV_USERNAME: "fictional", WEBDAV_PASSWORD: "fictional" };
  const put = (cookie = owner, headers = {}, config = bindings) => send("/admin/backups/schedule", body, cookie, config, headers, undefined, "PUT");
  for (const cookie of ["", ordinary, admin]) expect((await put(cookie)).status).toBe(cookie ? 403 : 401);
  expect((await put(owner, {}, { ...bindings, OWNER_EMAIL: "" })).status).toBe(403);
  for (const headers of [{ Origin: "https://evil.invalid" }, { "Sec-Fetch-Site": "cross-site" }, { "Content-Type": "text/plain" }]) {
    expect([400, 403]).toContain((await put(owner, headers)).status);
  }
  expect(await env.MEDIA_BUCKET.head("backup-control/test/schedule.json")).toBeNull();
  const saved = await put(); expect(saved.status).toBe(200);
  expect(await data(saved)).toMatchObject({ enabled: true, target: "webdav", targetReady: true });
  expect(saved.headers.get("Cache-Control")).toBe("private, no-store");
  expect((await send("/admin/backups/schedule", body, owner, bindings)).status).toBe(404);
  await env.DB.prepare("UPDATE member_profiles SET role = 'member' WHERE user_id = ?").bind(ownerId).run();
  expect((await put()).status).toBe(403);
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin', status = 'banned' WHERE user_id = ?").bind(ownerId).run();
  expect((await put()).status).toBe(401);
  await env.DB.prepare("UPDATE member_profiles SET status = 'active' WHERE user_id = ?").bind(ownerId).run();
  // The ban trigger revoked the old session; email ownership must be tested with a new live session.
  owner = await login("Nova");
  await env.DB.prepare('UPDATE "user" SET email = ? WHERE id = ?').bind("other@example.test", ownerId).run();
  expect((await put()).status).toBe(403);
  await env.DB.prepare('UPDATE "user" SET email = ? WHERE id = ?').bind("nova@example.test", ownerId).run();
  await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(ownerId).run();
  expect((await put()).status).toBe(401);
});

it("claims one due schedule slot and does not run it twice", async () => {
  const bindings = { ...runtime, WEBDAV_URL: "https://dav.example.test/backups/", WEBDAV_USERNAME: "fictional", WEBDAV_PASSWORD: "fictional" };
  let remote = new Uint8Array();
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith(bindings.WEBDAV_URL)) {
      if (init?.method === "PUT") { remote = new Uint8Array(await new Response(init.body).arrayBuffer()); return new Response(null); }
      return new Response(remote);
    }
    if (String(url) === signed) return download(); return complete();
  }));
  const now = Date.UTC(2026, 9, 17, 0, 0), schedule = await updateBackupSchedule(bindings, { enabled: true, target: "webdav", frequency: "daily", intervalDays: null, weekday: null, time: "08:00" }, now);
  const ctx = createExecutionContext(), first = await runScheduledBackup(bindings, ctx, schedule.nextRunAt! + 1); await waitOnExecutionContext(ctx);
  expect(first.status).toBe("complete");
  const second = await runScheduledBackup(bindings, createExecutionContext(), schedule.nextRunAt! + 1);
  expect(second.status).toBe("not_due");
});

it.each(["", "not-an-email", "other@example.test", " nova@example.test"])("rejects absent, invalid or nonmatching OWNER_EMAIL: %s", async email => {
  expect((await send("/admin/backups/status", undefined, owner, { ...runtime, OWNER_EMAIL: email })).status).toBe(403);
});

it.each(["role", "banned", "email", "unverified", "session"])("rechecks live ownership despite cached session cookies after %s changes", async change => {
  const job = await create();
  if (change === "role") await env.DB.prepare("UPDATE member_profiles SET role = 'member' WHERE user_id = ?").bind(ownerId).run();
  if (change === "banned") await env.DB.prepare("UPDATE member_profiles SET status = 'banned' WHERE user_id = ?").bind(ownerId).run();
  if (change === "email") await env.DB.prepare('UPDATE "user" SET email = ? WHERE id = ?').bind("new@example.test", ownerId).run();
  if (change === "unverified") await env.DB.prepare('UPDATE "user" SET emailVerified = 0 WHERE id = ?').bind(ownerId).run();
  if (change === "session") await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(ownerId).run();
  for (const [path, body] of [["/admin/backups/status", undefined], [`/admin/backups/${job.id}`, undefined],
    ["/admin/backups", input], [`/admin/backups/${job.id}/retry`, input], [`/admin/backups/${job.id}/download`, undefined]] as const) {
    expect([401, 403]).toContain((await send(path, body)).status);
  }
});

it("rejects cross-origin, non-JSON, missing maintenance acknowledgement and extra destination fields before exporting", async () => {
  const network = mockExport();
  const invalidHeaders: Record<string, string>[] = [{ Origin: "https://evil.invalid" }, { "Sec-Fetch-Site": "cross-site" }, { "Content-Type": "text/plain" }];
  for (const headers of invalidHeaders) {
    expect([400, 403]).toContain((await send("/admin/backups", input, owner, runtime, headers)).status);
  }
  for (const body of [{ target: "download" }, { ...input, maintenanceConfirmed: false }, { ...input, url: "https://evil.invalid" }, { ...input, target: "webdav" }, { ...input, databaseId: "other" }]) {
    expect((await send("/admin/backups", body)).status).toBe(400);
  }
  expect(network).not.toHaveBeenCalled();
});

it("fails closed on incomplete export configuration and never exports a local development database remotely", async () => {
  const network = mockExport();
  for (const bindings of [{ ...runtime, BACKUP_ACCOUNT_ID: "" }, { ...runtime, BACKUP_DATABASE_ID: "invalid" },
    { ...runtime, CLOUDFLARE_API_TOKEN: "" }, { ...runtime, BACKUP_ENCRYPTION_KEY: "short" }, { ...runtime, APP_ENV: "development" }]) {
    expect((await send("/admin/backups", input, owner, bindings)).status).toBe(503);
    expect((await data<{ targets: { download: boolean } }>(await send("/admin/backups/status", undefined, owner, bindings))).targets.download).toBe(false);
  }
  expect(network).not.toHaveBeenCalled();
});

it("continues polling the same bookmark and does not report completion before receiving the full file", async () => {
  let poll = 0;
  const network = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === signed) return download();
    const body = JSON.parse(String(init?.body));
    if (++poll === 1) { expect(body.current_bookmark).toBeUndefined(); return Response.json({ success: true, result: { at_bookmark: "fictional-bookmark" } }); }
    expect(body.current_bookmark).toBe("fictional-bookmark"); return complete();
  });
  vi.stubGlobal("fetch", network);
  expect((await create()).status).toBe("complete"); expect(poll).toBe(2);
});

it("keeps upstream errors and signed redirects private, and never follows redirects", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, errors: [{ message: `private failure ${signed}` }] }, { status: 500 })));
  const failed = await create(); expect(failed).toMatchObject({ status: "failed", failure: { code: "BACKUP_EXPORT_FAILED" }, downloadReady: false });
  expect(JSON.stringify(failed)).not.toContain(signed);
  expect((await send(`/admin/backups/${failed.id}/download`)).status).toBe(409);
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => String(url) === signed ? new Response(null, { status: 302, headers: { Location: "https://evil.invalid" } }) : complete()));
  const redirected = await create(); expect(redirected).toMatchObject({ status: "failed", failure: { code: "BACKUP_EXPORT_FORMAT" } });
});

it("rejects missing lengths, oversized exports and compressed bodies without a source completion marker", async () => {
  const invalidHeaders: Record<string, string>[] = [{}, { "Content-Length": String(5 * 1024 ** 3) }, { "Content-Length": String(sql.length), "Content-Encoding": "gzip" }];
  for (const headers of invalidHeaders) {
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => String(url) === signed ? new Response(sql, { headers }) : complete()));
    const job = await create(); expect(job).toMatchObject({ status: "failed", failure: { code: "BACKUP_EXPORT_FORMAT" } });
    const stored = await state(job.id); expect(await env.MEDIA_BUCKET.head(`backups/test/${stored.sourceId}/source.json`)).toBeNull();
  }
});

it("retries encryption without exporting again or changing the source date, preserving a full source after failure", async () => {
  const network = mockExport(), put = env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET);
  const fail = vi.spyOn(env.MEDIA_BUCKET, "put").mockImplementation(async (key, value, options) => {
    if (key.endsWith(".bin")) throw new Error(`private storage failure ${signed}`);
    return put(key, value, options);
  });
  const job = await create(); expect(job).toMatchObject({ status: "failed", failure: { code: "BACKUP_ENCRYPTION_FAILED" } });
  const stored = await state(job.id), sourceBefore = await env.MEDIA_BUCKET.get(`backups/test/${stored.sourceId}/source.json`);
  expect(sourceBefore).not.toBeNull(); fail.mockRestore();
  const retried = await data(await send(`/admin/backups/${job.id}/retry`, input));
  expect(retried).toMatchObject({ id: job.id, createdAt: job.createdAt, status: "complete" });
  expect(retried.backupTime).toBe((await sourceBefore!.json<{ createdAt: number }>()).createdAt);
  expect(network).toHaveBeenCalledTimes(2); expect((await state(job.id)).sourceId).toBe(stored.sourceId);
  expect((await send(`/admin/backups/${job.id}/retry`, input)).status).toBe(409);
});

it("serializes concurrent creation and retry attempts without duplicating exports", async () => {
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), exporting = new Promise<void>(resolve => { entered = resolve; });
  const network = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === signed) return download(); entered(); await blocked; return complete();
  });
  vi.stubGlobal("fetch", network);
  const first = create(); await exporting;
  const listed = await data<{ items: PublicJob[] }>(await send("/admin/backups/status"));
  expect(listed.items[0].status).toBe("running");
  expect((await send("/admin/backups", input)).status).toBe(409);
  expect((await send(`/admin/backups/${listed.items[0].id}/retry`, input)).status).toBe(409);
  release(); expect((await first).status).toBe("complete"); expect(network).toHaveBeenCalledTimes(2);
});

it("keeps the environment locked while a retry is publishing its new attempt", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
  const job = await create(); mockExport();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), publishing = new Promise<void>(resolve => { entered = resolve; });
  const put = env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET);
  vi.spyOn(env.MEDIA_BUCKET, "put").mockImplementation(async (key, value, options) => {
    if (key === stateKey(job.id) && typeof value === "string" && JSON.parse(value).status === "running") { entered(); await blocked; }
    return put(key, value, options);
  });
  const retry = send(`/admin/backups/${job.id}/retry`, input); await publishing;
  expect((await send("/admin/backups", input)).status).toBe(409);
  release(); expect((await data(await retry)).status).toBe("complete");
});

it("does not let a stale finishing request overwrite a newer attempt", async () => {
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }), exporting = new Promise<void>(resolve => { entered = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === signed) return download(); entered(); await blocked; return complete();
  }));
  const pending = send("/admin/backups", input); await exporting;
  const job = (await data<{ items: PublicJob[] }>(await send("/admin/backups/status"))).items[0];
  const stored = await state(job.id), nextAttempt = crypto.randomUUID();
  await env.MEDIA_BUCKET.put(stateKey(job.id), JSON.stringify({ ...stored, attempt: nextAttempt }));
  release(); expect((await pending).status).toBe(409);
  expect(await state(job.id)).toMatchObject({ attempt: nextAttempt, status: "running" });
});

it("does not report success or expose storage errors when the final state write fails", async () => {
  const put = env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET), logs = vi.spyOn(console, "info");
  vi.spyOn(env.MEDIA_BUCKET, "put").mockImplementation(async (key, value, options) => {
    if (key.startsWith("backup-control/test/jobs/") && typeof value === "string" && JSON.parse(value).status === "complete") throw new Error(`private storage error ${signed}`);
    return put(key, value, options);
  });
  const response = await send("/admin/backups", input);
  expect(response.status).toBe(500); expect(JSON.stringify([await response.json(), logs.mock.calls])).not.toContain(signed);
  const job = (await data<{ items: PublicJob[] }>(await send("/admin/backups/status"))).items[0];
  expect(job).toMatchObject({ status: "running", downloadReady: false });
  const stored = await state(job.id); expect(await env.MEDIA_BUCKET.head(`backups/test/${stored.sourceId}/source.json`)).not.toBeNull();
});

it("aborts a pending export at the execution deadline without scheduling an automatic retry", async () => {
  let entered!: () => void;
  const exporting = new Promise<void>(resolve => { entered = resolve; });
  const network = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    entered();
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("timed out")), { once: true }));
  });
  vi.stubGlobal("fetch", network); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = create(); await exporting;
  await vi.advanceTimersByTimeAsync(settings.backupTaskTimeout * 1000);
  expect(await pending).toMatchObject({ status: "failed", failure: { code: "BACKUP_TIMED_OUT" }, downloadReady: false });
  expect(network).toHaveBeenCalledTimes(1);
});

it("records a disconnected request as failed and lets a later manual retry export again", async () => {
  const abort = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async () => { abort.abort(); throw new Error(`private aborted request ${signed}`); }));
  const job = await data(await send("/admin/backups", input, owner, runtime, {}, abort.signal));
  expect(job).toMatchObject({ status: "failed", failure: { code: "BACKUP_INTERRUPTED" } });
  const original = await state(job.id); mockExport();
  expect((await data(await send(`/admin/backups/${job.id}/retry`, input))).status).toBe("complete");
  expect((await state(job.id)).sourceId).not.toBe(original.sourceId);
});

it("shows an expired running task as interrupted and permits recovery without automatic execution", async () => {
  const job = await create(), original = await state(job.id), expired = { ...original, status: "running", deadline: Date.now() - 1, result: undefined };
  await env.MEDIA_BUCKET.put(stateKey(job.id), JSON.stringify(expired));
  await env.MEDIA_BUCKET.put("backup-control/test/lease.json", JSON.stringify({ jobId: job.id, attempt: original.attempt, deadline: expired.deadline }));
  const network = mockExport();
  expect(await data(await send(`/admin/backups/${job.id}`))).toMatchObject({ status: "failed", failure: { code: "BACKUP_INTERRUPTED" }, downloadReady: false });
  expect(network).not.toHaveBeenCalled();
  expect((await data(await send(`/admin/backups/${job.id}/retry`, input))).status).toBe("complete");
  expect(network).not.toHaveBeenCalled();
});

it("refuses changed ciphertext but allows the previously verified file to be downloaded after key rotation", async () => {
  const job = await create();
  const rotated = await send(`/admin/backups/${job.id}/download`, undefined, owner, { ...runtime, BACKUP_ENCRYPTION_KEY: "rotated-fictional-key-0123456789abcdef" });
  expect(rotated.status).toBe(200); await rotated.body!.cancel();
  const stored = await state(job.id); await env.MEDIA_BUCKET.put(`backups/test/${stored.sourceId}/${stored.result.file}.bin`, "corrupted");
  expect((await send(`/admin/backups/${job.id}/download`)).status).toBe(409);
  expect((await send(`/admin/backups/${job.id}`, undefined, owner, { ...runtime, APP_ENV: "development" })).status).toBe(404);
});

it("paginates newest-first using public task IDs and isolates environment listings", async () => {
  const now = Date.now(), ids: string[] = [];
  for (let index = 0; index < 21; index++) {
    const id = `${String(Number.MAX_SAFE_INTEGER - now + index).padStart(16, "0")}-${crypto.randomUUID()}`; ids.push(id);
    await env.MEDIA_BUCKET.put(stateKey(id), JSON.stringify({ id, environment: "test", createdAt: now - index, startedAt: now - index,
      updatedAt: now - index, deadline: now - 1, attempt: crypto.randomUUID(), sourceId: crypto.randomUUID(), status: "failed", failure: "BACKUP_INTERRUPTED" }));
  }
  const first = await data<{ items: PublicJob[]; after: string }>(await send("/admin/backups/status"));
  expect(first.items.map(job => job.id)).toEqual(ids.slice(0, 20)); expect(first.after).toBe(ids[19]);
  const last = await data<{ items: PublicJob[]; after: null }>(await send(`/admin/backups/status?after=${first.after}`));
  expect(last.items.map(job => job.id)).toEqual(ids.slice(20)); expect(last.after).toBeNull();
  expect((await send("/admin/backups/status?after=../../library")).status).toBe(400);
  expect(await data(await send("/admin/backups/status", undefined, owner, { ...runtime, APP_ENV: "development" }))).toMatchObject({ items: [] });
});
