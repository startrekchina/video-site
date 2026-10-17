import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { backupStatus, runScheduledBackup, updateBackupSchedule, type BackupSchedule } from "@/lib/backups.server";
import { mediaSyncCron } from "@/lib/media-sync.server";
import { settings } from "@/lib/settings.server";

const runtime: Env = { ...env, APP_ENV: "test", BACKUP_ACCOUNT_ID: "a".repeat(32),
  BACKUP_DATABASE_ID: "00000000-0000-4000-8000-000000000000", D1_EXPORT_TOKEN: "fictional-export-token",
  WEBDAV_URL: "https://dav.example.test/backups/", WEBDAV_USERNAME: "fictional", WEBDAV_PASSWORD: "fictional" };
const input = { enabled: true, target: "webdav", frequency: "daily", time: "08:00" };
const now = Date.UTC(2026, 9, 17, 0, 0), key = "backup-control/test/schedule.json";
const stored = async () => (await env.MEDIA_BUCKET.get(key))!.json<BackupSchedule>();
const status = async (bindings = runtime) => (await backupStatus(bindings)).schedule;
async function run(at: number, bindings = runtime) {
  const ctx = createExecutionContext(), result = await runScheduledBackup(bindings, ctx, at);
  await waitOnExecutionContext(ctx); return result;
}
function network(fail = false) {
  const remote = new Map<string, ArrayBuffer>();
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith(runtime.WEBDAV_URL)) {
      if (fail) return new Response(null, { status: 503 });
      if (init?.method === "PUT") { remote.set(String(url), await new Response(init.body).arrayBuffer()); return new Response(null); }
      return new Response(remote.get(String(url)));
    }
    if (String(url) === "https://export.example.test/snapshot") {
      const sql = "CREATE TABLE fictional (id TEXT);\n";
      return new Response(sql, { headers: { "Content-Length": String(sql.length) } });
    }
    return Response.json({ success: true, result: { status: "complete", at_bookmark: "fictional", result: { signed_url: "https://export.example.test/snapshot" } } });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
  ["daily", "00:05", null, null, Date.UTC(2026, 9, 16, 16, 4), Date.UTC(2026, 9, 16, 16, 5)],
  ["daily", "08:00", null, null, now, Date.UTC(2026, 9, 18, 0, 0)],
  ["weekly", "08:00", 6, null, now, Date.UTC(2026, 9, 24, 0, 0)],
  ["weekly", "00:00", 0, null, Date.UTC(2026, 9, 17, 16, 0), Date.UTC(2026, 9, 24, 16, 0)],
  ["interval", "08:00", null, 1, now, Date.UTC(2026, 9, 18, 0, 0)],
  ["interval", "08:00", null, 30, now, Date.UTC(2026, 10, 16, 0, 0)],
] as const)("computes %s %s in Beijing across equal-time, midnight, week and month boundaries", async (frequency, time, weekday, intervalDays, at, expected) => {
  const saved = await updateBackupSchedule(runtime, { ...input, frequency, time, weekday, intervalDays }, at);
  expect(saved.nextRunAt).toBe(expected); expect(saved.lastStatus).toBeNull();
});

it("rejects malformed or unconfigured schedules without writing a control record", async () => {
  for (const change of [{ target: "download" }, { target: "r2" }, { time: "24:00" }, { time: "08:60" }, { time: "8:00" },
    { enabled: "true" }, { frequency: ["daily"] }, { frequency: "hourly" }, { frequency: "interval", intervalDays: 0 }, { frequency: "interval", intervalDays: 31 },
    { frequency: "interval", intervalDays: 1.5 }, { frequency: "weekly", weekday: 7 }, { frequency: "weekly", weekday: null }, { endpoint: "https://evil.invalid" }]) {
    await expect(updateBackupSchedule(runtime, { ...input, ...change }, now)).rejects.toMatchObject({ statusCode: 400 });
  }
  for (const bindings of [{ ...runtime, WEBDAV_PASSWORD: "" }, { ...runtime, APP_ENV: "development" }, { ...runtime, D1_EXPORT_TOKEN: "" }]) {
    await expect(updateBackupSchedule(bindings, input, now)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateBackupSchedule(bindings, { ...input, enabled: false, time: "09:00" }, now)).rejects.toMatchObject({ statusCode: 400 });
  }
  expect(await env.MEDIA_BUCKET.head(key)).toBeNull();
});

it("allows a configured S3-only target and keeps schedules isolated by environment", async () => {
  const bindings = { ...runtime, WEBDAV_URL: "", S3_BACKUP_ENDPOINT: "https://s3.example.test", S3_BACKUP_BUCKET: "fictional", S3_BACKUP_REGION: "auto",
    S3_BACKUP_ACCESS_KEY_ID: "fictional", S3_BACKUP_SECRET_ACCESS_KEY: "fictional" };
  expect(await updateBackupSchedule(bindings, { ...input, target: "s3" }, now)).toMatchObject({ enabled: true, targetReady: true, available: true });
  expect(await status({ ...bindings, APP_ENV: "staging" })).toMatchObject({ enabled: false, lastStatus: null });
});

it("edits and disables schedules, including disabling after the target configuration is lost", async () => {
  await updateBackupSchedule(runtime, input, now);
  const modified = { ...input, frequency: "weekly", weekday: 0, time: "23:07" };
  const saved = await updateBackupSchedule(runtime, modified, now);
  expect(saved.nextRunAt).toBe(Date.UTC(2026, 9, 18, 15, 7));
  const missing = { ...runtime, WEBDAV_PASSWORD: "" };
  expect(await status(missing)).toMatchObject({ enabled: true, targetReady: false });
  expect(await updateBackupSchedule(missing, { ...modified, enabled: false }, now)).toMatchObject({ enabled: false, nextRunAt: null });
  const fetcher = network(); expect(await run(saved.nextRunAt! + 1, missing)).toEqual({ status: "not_due" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("claims concurrent ticks once and skips media scanning during the backup tick", async () => {
  const saved = await updateBackupSchedule(runtime, input, Date.now() - 86400_000), fetcher = network();
  const list = vi.spyOn(env.MEDIA_BUCKET, "list");
  const ctx = createExecutionContext();
  const results = await Promise.all([
    worker.scheduled({ cron: mediaSyncCron } as ScheduledController, runtime, ctx),
    runScheduledBackup(runtime, ctx, saved.nextRunAt! + 1),
  ]); await waitOnExecutionContext(ctx);
  expect(results[1]?.status).not.toBe("failed");
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("api.cloudflare.com"))).toHaveLength(1);
  expect(list.mock.calls.some(([options]) => options?.prefix === "library/")).toBe(false);
  expect(await status()).toMatchObject({ lastStatus: "complete", failure: null });
});

it("consumes unavailable and failed slots without five-minute automatic retries", async () => {
  const saved = await updateBackupSchedule(runtime, input, now), missing = { ...runtime, WEBDAV_PASSWORD: "" }, fetcher = network(true);
  expect(await run(saved.nextRunAt!, missing)).toEqual({ status: "unavailable" });
  expect(await status(missing)).toMatchObject({ lastStatus: "failed", lastJobId: null, failure: { code: "BACKUP_TARGET_UNAVAILABLE" } });
  expect(await run(saved.nextRunAt! + 300_000, missing)).toEqual({ status: "not_due" });
  expect(fetcher).not.toHaveBeenCalled();
  const next = (await stored()).nextRunAt!;
  expect(await run(next)).toMatchObject({ status: "failed", job: { downloadReady: true, failure: { code: "BACKUP_TARGET_FAILED" } } });
  expect(await status()).toMatchObject({ lastStatus: "failed", failure: { code: "BACKUP_TARGET_FAILED" } });
  const count = fetcher.mock.calls.length;
  expect(await run(next + 300_000)).toEqual({ status: "not_due" }); expect(fetcher).toHaveBeenCalledTimes(count);
});

it.each([true, false])("does not start another export or media scan with a live manual lease (cleanup: %s)", async cleanup => {
  const saved = await updateBackupSchedule(runtime, input, now);
  const id = `9000000000000000-${crypto.randomUUID()}`, attempt = crypto.randomUUID(), deadline = Date.now() + 60000;
  if (!cleanup) await env.MEDIA_BUCKET.put(`backup-control/test/jobs/${id}.json`, JSON.stringify({ id, environment: "test", attempt,
    sourceId: crypto.randomUUID(), status: "running", deadline, updatedAt: Date.now() }));
  await env.MEDIA_BUCKET.put("backup-control/test/lease.json", JSON.stringify({ cleanup, jobId: id, attempt, deadline }));
  const fetcher = network(), list = vi.spyOn(env.MEDIA_BUCKET, "list");
  expect(await run(saved.nextRunAt!)).toEqual({ status: "failed" });
  expect(await status()).toMatchObject({ lastStatus: "failed", failure: { code: "BACKUP_BUSY" } });
  expect(await run(saved.nextRunAt! + 300_000)).toEqual({ status: "busy" });
  const ctx = createExecutionContext(); await worker.scheduled({ cron: mediaSyncCron } as ScheduledController, runtime, ctx); await waitOnExecutionContext(ctx);
  expect(fetcher).not.toHaveBeenCalled(); expect(list.mock.calls.some(([options]) => options?.prefix === "library/")).toBe(false);
});

it("retains the normal media scan when no backup is due", async () => {
  const fetcher = network(), ctx = createExecutionContext();
  await worker.scheduled({ cron: mediaSyncCron } as ScheduledController, runtime, ctx); await waitOnExecutionContext(ctx);
  expect(await env.DB.prepare("SELECT lease_until FROM media_sync_state WHERE id = 'catalog'").first("lease_until")).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not overwrite a concurrent settings edit when an already claimed backup finishes", async () => {
  const saved = await updateBackupSchedule(runtime, input, now), fetcher = network(), original = fetcher.getMockImplementation()!;
  let edited = false;
  fetcher.mockImplementation(async (url, init) => {
    if (!edited && String(url).includes("api.cloudflare.com")) {
      edited = true; await updateBackupSchedule(runtime, { ...input, enabled: false }, now);
    }
    return original(url, init);
  });
  expect(await run(saved.nextRunAt!)).toMatchObject({ status: "complete" });
  expect(await status()).toMatchObject({ enabled: false, nextRunAt: null, lastStatus: "complete" });
});

it("reports state-write failures, preserves completed artifacts, and exposes no upstream errors", async () => {
  const saved = await updateBackupSchedule(runtime, input, now), put = env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET); network();
  vi.spyOn(env.MEDIA_BUCKET, "put").mockImplementation(async (key, value, options) => {
    if (key.startsWith("backup-control/test/jobs/") && typeof value === "string" && JSON.parse(value).status === "complete") throw new Error("private storage error");
    return put(key, value, options);
  });
  expect(await run(saved.nextRunAt!)).toEqual({ status: "failed" });
  const result = await status(); expect(result).toMatchObject({ lastStatus: "failed", failure: { code: "BACKUP_STATE_FAILED" } });
  expect(JSON.stringify(result)).not.toContain("private storage");
  expect((await backupStatus(runtime)).items[0]).toMatchObject({ status: "running", downloadReady: true });
});

it("fails the scheduled event on schedule persistence errors instead of silently reporting success", async () => {
  const saved = await updateBackupSchedule(runtime, input, now), put = env.MEDIA_BUCKET.put.bind(env.MEDIA_BUCKET); network();
  vi.spyOn(env.MEDIA_BUCKET, "put").mockImplementation(async (name, value, options) => {
    if (name === key && typeof value === "string" && JSON.parse(value).lastStatus === "complete") throw new Error("fictional unavailable R2");
    return put(name, value, options);
  });
  await expect(run(saved.nextRunAt!)).rejects.toThrow("fictional unavailable R2");
  expect(await status()).toMatchObject({ lastStatus: "complete", failure: null });
  expect(await run(saved.nextRunAt! + 300_000)).toEqual({ status: "not_due" });
});

it("surfaces a hard interruption before a job record exists and does not rerun the consumed slot", async () => {
  const saved = await updateBackupSchedule(runtime, input, now), original = await stored();
  await env.MEDIA_BUCKET.put(key, JSON.stringify({ ...original, lastStatus: "running", lastRunAt: Date.now() - settings.backupTaskTimeout * 1000 - 1,
    lastJobId: `9000000000000000-${crypto.randomUUID()}`, nextRunAt: saved.nextRunAt! + 86400_000 }));
  const fetcher = network();
  expect(await status()).toMatchObject({ lastStatus: "failed", failure: { code: "BACKUP_INTERRUPTED" } });
  expect(await run(saved.nextRunAt! + 300_000)).toEqual({ status: "not_due" }); expect(fetcher).not.toHaveBeenCalled();
});

it("skips multiple missed slots instead of starting a catch-up loop and rejects malformed stored state", async () => {
  const saved = await updateBackupSchedule(runtime, { ...input, frequency: "interval", intervalDays: 3 }, now); network();
  const late = saved.nextRunAt! + 11 * 86400_000;
  expect(await run(late)).toMatchObject({ status: "complete" });
  expect((await stored()).nextRunAt).toBe(saved.nextRunAt! + 12 * 86400_000);
  expect(await run(late)).toEqual({ status: "not_due" });
  await env.MEDIA_BUCKET.put(key, JSON.stringify({ ...await stored(), anchorDate: null }));
  await expect(status()).rejects.toThrow("BACKUP_RECORD_INVALID");
});
