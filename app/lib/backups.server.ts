import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { APIError } from "better-auth/api";
import { createRequestIdentity, requireMember, type Member } from "./member.server";
import { checkWrite, readJson } from "./security.server";
import { settings } from "./settings.server";
import { backupSourceMetadata, encryptBackup, stageBackup, type BackupScope } from "./backup-storage.server";
import { backupKeyId, backupKeys } from "./backup-keys.server";
import { backupDestinationMatches, backupDestinationReceipt, backupTargetAvailability, deleteExternalBackup, uploadBackup, verifyExternalBackup, type BackupReceipt, type BackupTarget, type ExternalBackupTarget } from "./backup-targets.server";

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const jobIdPattern = new RegExp(`^\\d{16}-${uuid}$`, "u"), uuidPattern = new RegExp(`^${uuid}$`, "u");
const maxExportBytes = 5 * 1024 ** 3 - 5 * 1024 ** 2 - 4096 - 28;
const failureMessages = {
  BACKUP_EXPORT_FAILED: "数据库导出失败。",
  BACKUP_EXPORT_FORMAT: "导出文件长度未知、编码不受支持或超过单次存储上限。",
  BACKUP_STORAGE_FAILED: "暂存或校验失败。",
  BACKUP_ENCRYPTION_FAILED: "加密或校验失败。",
  BACKUP_INTERRUPTED: "备份中途中断（例如关闭了页面）。",
  BACKUP_TIMED_OUT: "备份超过执行时限。",
  BACKUP_TARGET_FAILED: "上传或回读校验失败，加密文件已保留。",
} as const;
type Failure = keyof typeof failureMessages;
type Artifact = Awaited<ReturnType<typeof encryptBackup>>;
type Job = { id: string; environment: BackupScope["environment"]; createdAt: number; startedAt: number; updatedAt: number;
  deadline: number; attempt: string; sourceId: string; target?: BackupTarget; receipt?: BackupReceipt; pendingReceipt?: BackupReceipt;
  cleanup?: { status: "complete" | "failed" | "pending"; deleted: number; pending?: number };
  deleted?: boolean; r2Deleted?: boolean; externalDeleted?: boolean; externalClosedAt?: number;
  status: "running" | "failed" | "complete"; failure?: Failure; result?: Artifact };
type Lease = { jobId: string; attempt: string; deadline: number; updatedAt?: number };
export type BackupFrequency = "daily" | "weekly" | "interval";
const scheduleFailures = {
  BACKUP_TARGET_UNAVAILABLE: "保存渠道或导出配置失效，本次没有执行。",
  BACKUP_BUSY: "到点时已有备份或清理在进行，本次没有执行。",
  BACKUP_STATE_FAILED: "本次备份的结果没有完整保存，请刷新记录查看。",
} as const;
export type BackupSchedule = { enabled: boolean; target: ExternalBackupTarget; frequency: BackupFrequency; intervalDays: number | null;
  weekday: number | null; time: string; anchorDate: string | null; nextRunAt: number | null; lastRunAt: number | null;
  lastStatus: "running" | "complete" | "failed" | null; lastJobId: string | null; lastFailure: keyof typeof scheduleFailures | null; updatedAt: number };
const rejected = (code: string, message: string) => new APIError("CONFLICT", { code, message });
const invalid = () => new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "备份请求无效。" });
const invalidRecord = () => new APIError("SERVICE_UNAVAILABLE", { code: "BACKUP_RECORD_INVALID", message: "备份控制记录损坏，请检查存储记录后重试。" });
const isInvalidRecord = (error: unknown) => error instanceof APIError && error.body?.code === "BACKUP_RECORD_INVALID";
function environment(env: Env): BackupScope["environment"] {
  if (env.APP_ENV === "development" || env.APP_ENV === "test" || env.APP_ENV === "preview" || env.APP_ENV === "production") return env.APP_ENV;
  throw new APIError("SERVICE_UNAVAILABLE", { code: "BACKUP_CONFIG_INVALID", message: "当前环境的备份配置无效。" });
}
const control = (env: Env) => `backup-control/${environment(env)}/`;
const jobKey = (env: Env, id: string) => `${control(env)}jobs/${id}.json`;
const sourceControlKey = (env: Env, id: string) => `${control(env)}sources/${id}.json`;
const scheduleKey = (env: Env) => `${control(env)}schedule.json`;
const newJobId = (now: number) => `${String(Number.MAX_SAFE_INTEGER - now).padStart(16, "0")}-${crypto.randomUUID()}`;
const scope = (job: Job): BackupScope => ({ environment: job.environment, id: job.sourceId });
const sourceKey = (job: Job) => `backups/${job.environment}/${job.sourceId}/source.json`;

const HOUR_MS = 60 * 60 * 1000, DAY_MS = 24 * HOUR_MS, SHANGHAI_OFFSET_MS = 8 * HOUR_MS;
const defaultSchedule = (): BackupSchedule => ({ enabled: false, target: "webdav", frequency: "daily", intervalDays: null, weekday: null,
  time: "04:00", anchorDate: null, nextRunAt: null, lastRunAt: null, lastStatus: null, lastJobId: null, lastFailure: null, updatedAt: 0 });
type ShanghaiDate = { year: number; month: number; day: number; weekday: number };
function shanghaiDate(value: number): ShanghaiDate {
  const date = new Date(value + SHANGHAI_OFFSET_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), weekday: date.getUTCDay() };
}
function localDayStart(value: ShanghaiDate) { return Date.UTC(value.year, value.month, value.day) - SHANGHAI_OFFSET_MS; }
function localDateString(value: number) {
  const date = shanghaiDate(value);
  return `${String(date.year).padStart(4, "0")}-${String(date.month + 1).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]), timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp - SHANGHAI_OFFSET_MS : null;
}
function scheduledAt(dayStart: number, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return dayStart + (hour * 60 + minute) * 60 * 1000;
}
function nextScheduleAt(schedule: Pick<BackupSchedule, "frequency" | "intervalDays" | "weekday" | "time" | "anchorDate">, after: number) {
  const current = shanghaiDate(after), today = localDayStart(current);
  if (schedule.frequency === "daily") {
    const candidate = scheduledAt(today, schedule.time);
    return candidate > after ? candidate : candidate + DAY_MS;
  }
  if (schedule.frequency === "weekly") {
    const weekday = schedule.weekday!, delta = (weekday - current.weekday + 7) % 7;
    let candidate = scheduledAt(today + delta * DAY_MS, schedule.time);
    if (candidate <= after) candidate += 7 * DAY_MS;
    return candidate;
  }
  const interval = schedule.intervalDays!, anchor = parseLocalDate(schedule.anchorDate!)!;
  let days = Math.max(0, Math.floor((today - anchor) / DAY_MS));
  days += (interval - (days % interval)) % interval;
  let candidate = scheduledAt(anchor + days * DAY_MS, schedule.time);
  while (candidate <= after) { days += interval; candidate = scheduledAt(anchor + days * DAY_MS, schedule.time); }
  return candidate;
}

export function isBackupOwner(member: Member, env: Env) {
  // A live, verified member's email already passed Better Auth validation; invalid configured values cannot match it.
  return member.role === "admin" && !!env.OWNER_EMAIL && member.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
}
export async function requireBackupOwner(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const current = await requireMember(request, env, identity);
  if (!isBackupOwner(current.member, env)) throw new APIError("FORBIDDEN", { code: "BACKUP_OWNER_REQUIRED", message: "仅本站站长可操作备份。" });
  return current;
}
function configured(env: Env) {
  return env.APP_ENV !== "development" && /^[a-f0-9]{32}$/u.test(env.BACKUP_ACCOUNT_ID)
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(env.BACKUP_DATABASE_ID)
    && !!env.D1_EXPORT_TOKEN && Buffer.byteLength(env.BACKUP_ENCRYPTION_KEY ?? "") >= 32
    && typeof env.BETTER_AUTH_SECRET === "string" && env.BETTER_AUTH_SECRET.length >= 32
    && env.BACKUP_ENCRYPTION_KEY !== env.BETTER_AUTH_SECRET;
}
async function record<T>(bucket: R2Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size > 16384) { await object.body.cancel(); throw invalidRecord(); }
  try { return { value: await object.json<T>(), etag: object.etag }; }
  catch { throw invalidRecord(); }
}
function validSchedule(value: BackupSchedule) {
  if (!value || typeof value !== "object" || typeof value.enabled !== "boolean" || (value.target !== "webdav" && value.target !== "s3")
    || !["daily", "weekly", "interval"].includes(value.frequency) || typeof value.time !== "string" || !/^\d{2}:\d{2}$/u.test(value.time)
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 || value.nextRunAt !== null && (!Number.isSafeInteger(value.nextRunAt) || value.nextRunAt < 0)
    || value.lastRunAt !== null && (!Number.isSafeInteger(value.lastRunAt) || value.lastRunAt < 0)
    || value.lastStatus !== null && !["running", "complete", "failed"].includes(value.lastStatus)
    || value.lastJobId !== null && (typeof value.lastJobId !== "string" || !jobIdPattern.test(value.lastJobId))
    || value.lastFailure !== null && !Object.hasOwn(scheduleFailures, value.lastFailure)
    || value.anchorDate !== null && (typeof value.anchorDate !== "string" || parseLocalDate(value.anchorDate) === null)) throw new Error("BACKUP_RECORD_INVALID");
  const minute = Number(value.time.slice(3));
  if (Number(value.time.slice(0, 2)) > 23 || minute > 59) throw new Error("BACKUP_RECORD_INVALID");
  if (value.frequency === "interval" && (!Number.isSafeInteger(value.intervalDays) || value.intervalDays! < 1 || value.intervalDays! > 30)) throw new Error("BACKUP_RECORD_INVALID");
  if (value.frequency !== "interval" && value.intervalDays !== null) throw new Error("BACKUP_RECORD_INVALID");
  if (value.frequency === "weekly" && (!Number.isSafeInteger(value.weekday) || value.weekday! < 0 || value.weekday! > 6)) throw new Error("BACKUP_RECORD_INVALID");
  if (value.frequency !== "weekly" && value.weekday !== null) throw new Error("BACKUP_RECORD_INVALID");
  if (value.enabled !== (value.nextRunAt !== null) || (value.frequency === "interval") !== (value.anchorDate !== null)
    || (value.lastStatus !== null) !== (value.lastRunAt !== null)) throw new Error("BACKUP_RECORD_INVALID");
  return value;
}
async function readSchedule(env: Env) {
  const stored = await record<BackupSchedule>(env.MEDIA_BUCKET, scheduleKey(env));
  return stored ? { ...stored, value: validSchedule(stored.value) } : null;
}
async function publicSchedule(value: BackupSchedule, env: Env) {
  const targets = backupTargetAvailability(env), ready = configured(env) && targets[value.target];
  let unreadable = false;
  const stored = value.lastJobId ? await readJob(env, value.lastJobId).catch(error => {
    if (!isInvalidRecord(error)) throw error; unreadable = true; return null;
  }) : null, job = stored ? publicJob(stored.value, env) : null;
  const interrupted = value.lastStatus === "running" && Date.now() >= value.lastRunAt! + settings.backupTaskTimeout * 1000;
  const stateFailed = unreadable ? "BACKUP_STATE_FAILED" : !job || job.status === "running" ? value.lastFailure : null;
  return { enabled: value.enabled, target: value.target, frequency: value.frequency, intervalDays: value.intervalDays,
    weekday: value.weekday, time: value.time, nextRunAt: value.nextRunAt, lastRunAt: value.lastRunAt,
    lastStatus: stateFailed ? "failed" as const : job?.status ?? (interrupted ? "failed" : value.lastStatus), lastJobId: job?.id ?? null,
    failure: stateFailed ? { code: stateFailed, message: scheduleFailures[stateFailed] } : job?.failure ?? (
      interrupted ? { code: "BACKUP_INTERRUPTED", message: failureMessages.BACKUP_INTERRUPTED } : null),
    updatedAt: value.updatedAt, targetReady: ready,
    available: configured(env) && Object.values(targets).some(Boolean) };
}
function parseScheduleInput(body: Record<string, unknown>, env: Env, previous: BackupSchedule | undefined, now: number): BackupSchedule {
  const allowed = ["enabled", "target", "frequency", "intervalDays", "weekday", "time"];
  if (Object.keys(body).some(key => !allowed.includes(key)) || typeof body.enabled !== "boolean"
    || (body.target !== "webdav" && body.target !== "s3") || typeof body.frequency !== "string" || !["daily", "weekly", "interval"].includes(body.frequency)
    || typeof body.time !== "string" || !/^\d{2}:\d{2}$/u.test(body.time)) throw invalid();
  const hour = Number(body.time.slice(0, 2)), minute = Number(body.time.slice(3));
  if (hour > 23 || minute > 59) throw invalid();
  const frequency = body.frequency as BackupFrequency;
  const intervalDays = frequency === "interval" ? body.intervalDays : null;
  const weekday = frequency === "weekly" ? body.weekday : null;
  if (frequency === "interval" && (!Number.isSafeInteger(intervalDays) || Number(intervalDays) < 1 || Number(intervalDays) > 30)) throw invalid();
  if (frequency === "weekly" && (!Number.isSafeInteger(weekday) || Number(weekday) < 0 || Number(weekday) > 6)) throw invalid();
  const existing = previous ?? defaultSchedule();
  if ((!configured(env) || !backupTargetAvailability(env)[body.target]) && (body.enabled
    || body.target !== existing.target || frequency !== existing.frequency || intervalDays !== existing.intervalDays
    || weekday !== existing.weekday || body.time !== existing.time)) {
    throw new APIError("BAD_REQUEST", { code: "BACKUP_TARGET_UNAVAILABLE", message: "所选外部目标配置不完整或无效，只能关闭原有定时备份。" });
  }
  const schedule: BackupSchedule = { enabled: body.enabled, target: body.target, frequency, intervalDays: intervalDays as number | null,
    weekday: weekday as number | null, time: body.time, anchorDate: frequency === "interval" ? localDateString(now) : null,
    nextRunAt: null, lastRunAt: previous?.lastRunAt ?? null, lastStatus: previous?.lastStatus ?? null,
    lastJobId: previous?.lastJobId ?? null, lastFailure: previous?.lastFailure ?? null, updatedAt: Date.now() };
  schedule.nextRunAt = schedule.enabled ? nextScheduleAt(schedule, now) : null;
  return schedule;
}
export async function updateBackupSchedule(env: Env, body: Record<string, unknown>, now = Date.now()) {
  const current = await readSchedule(env), schedule = parseScheduleInput(body, env, current?.value, now);
  if (current) await delay(Math.max(0, current.value.updatedAt + 1100 - Date.now()));
  schedule.updatedAt = Date.now();
  const written = await env.MEDIA_BUCKET.put(scheduleKey(env), JSON.stringify(schedule), current ? { onlyIf: { etagMatches: current.etag } } : { onlyIf: { etagDoesNotMatch: "*" } });
  if (!written) throw rejected("BACKUP_STATE_CHANGED", "备份设置已变化，请刷新后重试。");
  return publicSchedule(schedule, env);
}
async function readJob(env: Env, id: string) {
  if (!jobIdPattern.test(id)) throw invalid();
  const stored = await record<Job>(env.MEDIA_BUCKET, jobKey(env, id));
  if (stored && (!stored.value || typeof stored.value !== "object" || stored.value.id !== id || stored.value.environment !== environment(env)
    || !uuidPattern.test(stored.value.sourceId) || !uuidPattern.test(stored.value.attempt)
    || !Number.isSafeInteger(stored.value.createdAt) || stored.value.createdAt <= 0
    || !Number.isSafeInteger(stored.value.startedAt) || stored.value.startedAt <= 0
    || !Number.isSafeInteger(stored.value.deadline) || !Number.isSafeInteger(stored.value.updatedAt)
    || !["running", "failed", "complete"].includes(stored.value.status)
    || stored.value.status === "complete" && !stored.value.result
    || stored.value.target !== undefined && !["download", "webdav", "s3"].includes(stored.value.target)
    || stored.value.failure !== undefined && !Object.hasOwn(failureMessages, stored.value.failure))) throw invalidRecord();
  const job = stored?.value, artifact = job?.result;
  if (job && ([job.deleted, job.r2Deleted, job.externalDeleted].some(value => value !== undefined && typeof value !== "boolean")
    || job.externalClosedAt !== undefined && (!Number.isSafeInteger(job.externalClosedAt) || job.externalClosedAt < job.createdAt
      || job.externalClosedAt > job.updatedAt || !(job.receipt ?? job.pendingReceipt))
    || job.cleanup !== undefined && (!job.cleanup || !["complete", "failed", "pending"].includes(job.cleanup.status)
      || !Number.isSafeInteger(job.cleanup.deleted) || job.cleanup.deleted < 0
      || job.cleanup.pending !== undefined && (!Number.isSafeInteger(job.cleanup.pending) || job.cleanup.pending <= 0)
      || job.cleanup.status === "pending" && !job.cleanup.pending))) throw invalidRecord();
  const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  if (artifact !== undefined) {
    try { backupSourceMetadata(artifact?.source, scope(job!)); } catch { throw invalidRecord(); }
    if (artifact.source.createdAt > job!.startedAt || artifact.source.byteLength > maxExportBytes
      || !digest(artifact.keyId) || !digest(artifact.sha256) || !new RegExp(`^encrypted-${uuid}$`, "u").test(artifact.file)
      || typeof artifact.etag !== "string" || !artifact.etag || !Number.isSafeInteger(artifact.byteLength)
      || artifact.byteLength <= 0 || artifact.byteLength > maxExportBytes + 4096 + 28) throw invalidRecord();
  }
  for (const receipt of [job?.receipt, job?.pendingReceipt]) {
    if (receipt !== undefined && (!receipt || !artifact || !["webdav", "s3"].includes(receipt.target) || !digest(receipt.destinationId)
      || receipt.name !== `video-site-${job!.environment}-${job!.sourceId}-${artifact.file}.stcnbak`
      || !Number.isSafeInteger(receipt.verifiedAt) || receipt.verifiedAt < 0)) throw invalidRecord();
  }
  return stored;
}
function externalPending(job: Job, env: Env) {
  const receipt = job.receipt ?? job.pendingReceipt;
  return !!receipt && !job.externalDeleted && !job.externalClosedAt && !backupDestinationMatches(env, receipt);
}
function publicJob(job: Job, env: Env) {
  const interrupted = job.status === "running" && job.deadline <= Date.now();
  const failure = interrupted ? "BACKUP_INTERRUPTED" : job.failure;
  return { id: job.id, environment: job.environment, createdAt: job.createdAt, startedAt: job.startedAt, updatedAt: job.updatedAt,
    backupTime: job.result?.source.createdAt ?? null, target: job.target ?? "download", status: interrupted ? "failed" : job.status,
    failure: failure ? { code: failure, message: failureMessages[failure] } : null,
    downloadReady: !!job.result && !job.deleted && !job.r2Deleted, byteLength: job.result?.byteLength ?? null, keyId: job.result?.keyId ?? null,
    authKeyId: job.result?.source.authKeyId ?? null, deleted: !!job.deleted, r2Deleted: !!job.deleted || !!job.r2Deleted, cleanup: job.cleanup ?? null,
    externalPending: externalPending(job, env), externalClosedAt: job.externalClosedAt ?? null };
}
async function readLease(env: Env) {
  const key = `${control(env)}lease.json`, object = await env.MEDIA_BUCKET.get(key);
  if (!object) return { key, stored: null, busy: false };
  try {
    if (object.size > 16384) throw invalidRecord();
    const value = await object.json<Lease>();
    if (!value || !Number.isSafeInteger(value.deadline) || value.deadline < 0
      || value.updatedAt !== undefined && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0)) throw invalidRecord();
    return { key, stored: { value, etag: object.etag }, busy: value.deadline > Date.now() };
  } catch {
    await object.body.cancel().catch(() => {});
    // A corrupt record never grants a new lease. R2's upload time bounds the possible in-flight task before scanning resumes.
    return { key, stored: null, busy: object.uploaded.getTime() + settings.backupTaskTimeout * 1000 > Date.now(), error: invalidRecord() };
  }
}
async function acquire(env: Env, job: Job) {
  const state = await readLease(env);
  if (state.error) throw state.error;
  const { key, stored: previous } = state;
  if (previous && previous.value.deadline > Date.now()) {
    throw rejected("BACKUP_BUSY", "已有备份或清理正在进行，请等它结束后再试。");
  }
  if (previous) await delay(Math.max(0, (previous.value.updatedAt ?? 0) + 1100 - Date.now()));
  const lease: Lease = { jobId: job.id, attempt: job.attempt, deadline: job.deadline, updatedAt: Date.now() };
  const locked = await env.MEDIA_BUCKET.put(key, JSON.stringify(lease), {
    onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" },
  });
  if (!locked) throw rejected("BACKUP_BUSY", "已有备份正在进行，请稍后查看记录。");
  return { key, value: lease, etag: locked.etag };
}
async function release(env: Env, lease: Awaited<ReturnType<typeof acquire>>, ctx: ExecutionContext) {
  const finish = (async () => {
    await delay(Math.max(0, (lease.value.updatedAt ?? 0) + 1100 - Date.now()));
    await env.MEDIA_BUCKET.put(lease.key, JSON.stringify({ ...lease.value, deadline: 0, updatedAt: Date.now() }), { onlyIf: { etagMatches: lease.etag } });
  })();
  ctx.waitUntil(finish.catch(() => {})); await finish;
}
// A client disconnect ends the invocation and only waitUntil work outlives it, so the request's own catch/finally never run.
function onDisconnect(signal: AbortSignal, settle: () => void) {
  if (signal.aborted) { settle(); return () => {}; }
  signal.addEventListener("abort", settle, { once: true });
  return () => signal.removeEventListener("abort", settle);
}

async function exportMetadata(response: Response) {
  if (!response.body) throw new Error("BACKUP_EXPORT_FAILED");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let length = 0, text = "";
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength; if (length > 65536) throw new Error("BACKUP_EXPORT_FAILED");
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as { success?: boolean; errors?: { code?: unknown }[]; result?: {
      status?: string; success?: boolean; at_bookmark?: string; result?: { signed_url?: string };
    } };
  } finally { await reader.cancel().catch(() => {}); }
}
async function exportSnapshot(env: Env, job: Job, signal: AbortSignal) {
  // No D1 access after starting export: D1 may suspend queries while the export is being polled.
  const migrations = await env.DB.withSession("first-primary").prepare("SELECT name FROM d1_migrations ORDER BY name").all<{ name: string }>();
  if (!migrations.results.length) throw new Error("BACKUP_EXPORT_FAILED");
  const schemaVersion = createHash("sha256").update(JSON.stringify(migrations.results.map(row => row.name))).digest("hex");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.BACKUP_ACCOUNT_ID}/d1/database/${env.BACKUP_DATABASE_ID}/export`;
  let bookmark: string | undefined, httpStatus: number | undefined, data: Awaited<ReturnType<typeof exportMetadata>> | undefined;
  try {
    while (true) {
      signal.throwIfAborted();
      const response = await fetch(endpoint, { method: "POST", redirect: "manual", signal,
        headers: { Authorization: `Bearer ${env.D1_EXPORT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ output_format: "polling", ...(bookmark ? { current_bookmark: bookmark } : {}) }) });
      httpStatus = response.status; data = undefined;
      data = await exportMetadata(response); const result = data.result;
      if (!response.ok || data.success !== true || !result || result.success === false || result.status === "error"
        || typeof result.at_bookmark !== "string" || !result.at_bookmark || result.at_bookmark.length > 256
        || bookmark && result.at_bookmark !== bookmark) throw new Error("BACKUP_EXPORT_FAILED");
      bookmark = result.at_bookmark;
      if (result.status === "complete") {
        if (typeof result.result?.signed_url !== "string") throw new Error("BACKUP_EXPORT_FAILED");
        const url = new URL(result.result.signed_url);
        if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("BACKUP_EXPORT_FAILED");
        // The URL comes from authenticated Cloudflare metadata. Never forward the API token or follow a redirect.
        const download = await fetch(url, { redirect: "manual", signal, cache: "no-store", headers: { "Accept-Encoding": "identity" } });
        const size = download.headers.get("Content-Length"), byteLength = Number(size), encoding = download.headers.get("Content-Encoding");
        if (!download.ok || !download.body || !size || !/^\d+$/u.test(size) || byteLength <= 0 || byteLength > maxExportBytes || encoding && encoding !== "identity") {
          await download.body?.cancel(); throw new Error("BACKUP_EXPORT_FORMAT");
        }
        return { metadata: { ...scope(job), createdAt: job.startedAt, schemaVersion, bookmark, authKeyId: backupKeyId(env.BETTER_AUTH_SECRET) }, body: download.body, byteLength };
      }
      if (result.status !== undefined && result.status !== "active") throw new Error("BACKUP_EXPORT_FAILED");
      await delay(1000, undefined, { signal });
    }
  } catch (error) {
    // Statuses and numeric API codes only: upstream messages may carry signed URLs.
    if (!signal.aborted) console.warn(JSON.stringify({ event: "backup_export_rejected", jobId: job.id, httpStatus, status: data?.result?.status,
      errors: Array.isArray(data?.errors) ? data.errors.map(item => item?.code).filter(code => typeof code === "number") : undefined,
      error: error instanceof Error && error.message.startsWith("BACKUP_") ? error.message : error instanceof Error ? error.name : "unknown" }));
    throw error;
  }
}

async function* allJobs(env: Env) {
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA_BUCKET.list({ prefix: `${control(env)}jobs/`, limit: 100, cursor });
    for (const object of page.objects) {
      const id = object.key.slice(`${control(env)}jobs/`.length, -5), stored = await readJob(env, id);
      if (!stored) throw new Error("BACKUP_RECORD_UNAVAILABLE");
      yield stored;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
async function deleteSource(env: Env, id: string, signal: AbortSignal) {
  if (!uuidPattern.test(id)) throw new Error("BACKUP_RECORD_INVALID");
  const prefix = `backups/${environment(env)}/${id}/`;
  while (true) {
    signal.throwIfAborted();
    const page = await env.MEDIA_BUCKET.list({ prefix, limit: 100 });
    if (!page.objects.length) break;
    await env.MEDIA_BUCKET.delete(page.objects.map(object => object.key));
  }
  await env.MEDIA_BUCKET.delete(sourceControlKey(env, id));
}
async function discardPlaintext(env: Env, job: Job, signal: AbortSignal) {
  const prefix = `backups/${job.environment}/${job.sourceId}/`, plaintext = await env.MEDIA_BUCKET.head(`${prefix}source.sql`);
  if (!plaintext) return;
  const encrypted = await env.MEDIA_BUCKET.head(`${prefix}${job.result!.file}.bin`);
  if (encrypted?.etag !== job.result!.etag || encrypted.size !== job.result!.byteLength) throw new Error("BACKUP_OBJECT_CHANGED");
  await delay(Math.min(1100, Math.max(0, plaintext.uploaded.getTime() + 1100 - Date.now())), undefined, { signal });
  await env.MEDIA_BUCKET.delete(`${prefix}source.sql`);
}

async function cleanupBackups(env: Env, current: Job | undefined, signal: AbortSignal) {
  signal.throwIfAborted();
  const pairs = backupKeys(env), protectedR2 = { id: "", time: 0 }, protectedExternal = new Map<string, { name: string; time: number }>();
  const recoverable = (job: Job) => job.result && pairs.some(pair => pair.keyId === job.result!.keyId)
    && pairs.some(pair => pair.authKeyId === job.result!.source.authKeyId);
  async function protect(job: Job) {
    signal.throwIfAborted();
    if (job.deleted || !recoverable(job)) return;
    const artifact = job.result!, time = artifact.source.createdAt;
    if (!job.r2Deleted && time > protectedR2.time) {
      const object = await env.MEDIA_BUCKET.head(`backups/${job.environment}/${job.sourceId}/${artifact.file}.bin`);
      if (object?.etag === artifact.etag && object.size === artifact.byteLength) Object.assign(protectedR2, { id: job.sourceId, time });
    }
    if (job.receipt && !job.externalDeleted && !job.externalClosedAt && backupDestinationMatches(env, job.receipt)
      && time > (protectedExternal.get(job.receipt.destinationId)?.time ?? 0)) {
      // Recheck the candidate before treating it as the last recoverable external copy.
      try {
        await verifyExternalBackup(env, job.receipt, artifact, signal);
        protectedExternal.set(job.receipt.destinationId, { name: job.receipt.name, time });
      } catch { signal.throwIfAborted(); }
    }
  }
  for await (const { value: job } of allJobs(env)) if (job.status !== "running") await protect(job);
  let deleted = 0, pending = 0, failed = false;
  for await (const stored of allJobs(env)) {
    signal.throwIfAborted(); const job = stored.value;
    if (job.result && !job.r2Deleted && (job.status !== "running" || job.deadline <= Date.now())) {
      try { await discardPlaintext(env, job, signal); }
      catch { failed = true; signal.throwIfAborted(); }
    }
    if (job.deleted || job.id === current?.id || job.status === "running" && job.deadline > Date.now()
      || (job.result?.source.createdAt ?? job.createdAt) >= Date.now() - settings.backupRetention * 1000) continue;
    const remote = job.receipt ?? job.pendingReceipt, time = job.result?.source.createdAt ?? job.createdAt;
    const remotePending = externalPending(job, env), remoteManaged = remote && !job.externalDeleted && !job.externalClosedAt && !remotePending;
    if (remotePending) pending++;
    let changed = false;
    if ((!job.r2Deleted && !protectedR2.id) || (remoteManaged && !protectedExternal.has(remote.destinationId))) failed = true;
    // A fallback protection point only authorizes deleting older copies, never a newer unverified recovery option.
    if (remoteManaged && remote.name !== protectedExternal.get(remote.destinationId)?.name
      && (protectedExternal.get(remote.destinationId)?.time ?? 0) > time) {
      try { await deleteExternalBackup(env, remote, signal); job.externalDeleted = true; changed = true; }
      catch { failed = true; signal.throwIfAborted(); }
    }
    if (!job.r2Deleted && job.sourceId !== protectedR2.id && protectedR2.time > time) {
      try {
        await deleteSource(env, job.sourceId, signal);
        job.r2Deleted = true; changed = true;
      } catch { failed = true; signal.throwIfAborted(); }
    }
    if (changed) {
      job.deleted = !!job.r2Deleted && (!remote || !!job.externalDeleted || !!job.externalClosedAt); job.updatedAt = Date.now();
      try {
        if (!await env.MEDIA_BUCKET.put(jobKey(env, job.id), JSON.stringify(job), { onlyIf: { etagMatches: stored.etag } })) throw new Error("BACKUP_STATE_CHANGED");
        if (job.deleted) deleted++;
      } catch { failed = true; signal.throwIfAborted(); }
    }
  }
  let after: string | undefined;
  do {
    const prefix = `${control(env)}sources/`, page = await env.MEDIA_BUCKET.list({ prefix, limit: 100, ...(after ? { startAfter: after } : {}) });
    for (const object of page.objects) {
      signal.throwIfAborted(); const id = object.key.slice(prefix.length, -5);
      if (!uuidPattern.test(id)) throw new Error("BACKUP_RECORD_INVALID");
      const entry = await record<{ jobId: string; createdAt: number }>(env.MEDIA_BUCKET, object.key);
      if (!entry || !Number.isSafeInteger(entry.value.createdAt) || entry.value.createdAt <= 0) throw new Error("BACKUP_RECORD_INVALID");
      if (entry.value.createdAt >= Date.now() - settings.backupRetention * 1000) continue;
      const job = await readJob(env, entry.value.jobId);
      if (job?.value.sourceId === id && !job.value.r2Deleted && !job.value.deleted) continue;
      if (!protectedR2.id) { failed = true; continue; }
      try { await deleteSource(env, id, signal); deleted++; }
      catch { failed = true; signal.throwIfAborted(); }
    }
    after = page.truncated ? page.objects.at(-1)?.key : undefined;
    if (page.truncated && !after) throw new Error("BACKUP_RECORD_INVALID");
  } while (after);
  signal.throwIfAborted();
  return { status: failed ? "failed" as const : pending ? "pending" as const : "complete" as const, deleted, ...(pending ? { pending } : {}) };
}
async function closeExternalBackup(env: Env, id: string, updatedAt: number, signal: AbortSignal) {
  const stored = await readJob(env, id);
  if (!stored) throw new APIError("NOT_FOUND", { code: "BACKUP_NOT_FOUND", message: "找不到这次备份。" });
  const job = stored.value;
  if (job.externalClosedAt) return publicJob(job, env);
  if (!externalPending(job, env) || job.updatedAt !== updatedAt) throw rejected("BACKUP_STATE_CHANGED", "保存位置或记录已变化，请刷新后检查。");
  const lease = await readLease(env);
  if (lease.error) throw lease.error;
  if (lease.busy || job.status === "running" && job.deadline > Date.now()) throw rejected("BACKUP_BUSY", "已有备份或清理正在进行，请等它结束后再试。");
  await delay(Math.max(0, job.updatedAt + 1100 - Date.now()), undefined, { signal });
  job.externalClosedAt = job.updatedAt = Date.now(); job.deleted = !!job.r2Deleted;
  if (!await env.MEDIA_BUCKET.put(jobKey(env, id), JSON.stringify(job), { onlyIf: { etagMatches: stored.etag } })) {
    throw rejected("BACKUP_STATE_CHANGED", "备份状态已变化，请刷新后检查。");
  }
  return publicJob(job, env);
}
async function manualCleanup(env: Env, requestSignal: AbortSignal, ctx: ExecutionContext) {
  const now = Date.now(), job: Job = { id: newJobId(now),
    environment: environment(env), createdAt: now, startedAt: now, updatedAt: now, deadline: now + settings.backupTaskTimeout * 1000,
    attempt: crypto.randomUUID(), sourceId: crypto.randomUUID(), status: "running" };
  requestSignal.throwIfAborted();
  const claiming = Promise.resolve().then(() => acquire(env, job));
  const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), Math.max(0, job.deadline - Date.now()));
  let released: Promise<void> | undefined;
  const finish = () => released ??= claiming.then(lease => release(env, lease, ctx), () => {});
  const detach = onDisconnect(requestSignal, () => { ctx.waitUntil(finish().catch(() => {})); });
  try { await claiming; return await cleanupBackups(env, undefined, AbortSignal.any([requestSignal, timer.signal])); }
  finally {
    clearTimeout(timeout); detach(); await finish();
  }
}

async function runBackup(requestSignal: AbortSignal, env: Env, ctx: ExecutionContext, target: BackupTarget, old?: Awaited<ReturnType<typeof readJob>>, scheduledId?: string) {
  const now = Date.now(), previous = old?.value;
  if (previous?.status === "complete") throw rejected("BACKUP_ALREADY_COMPLETE", "这次备份已经成功，无需重试。");
  if (previous?.deleted || previous?.r2Deleted || previous?.externalClosedAt) throw rejected("BACKUP_NOT_READY", "这次备份已结束或加密文件已过期清理，请创建新备份。");
  if (previous?.status === "running" && previous.deadline > now) throw rejected("BACKUP_BUSY", "这次备份仍在进行，请稍后查看记录。");
  let reused = false;
  if (previous?.result) {
    const encrypted = await env.MEDIA_BUCKET.head(`backups/${previous.environment}/${previous.sourceId}/${previous.result.file}.bin`);
    if (encrypted?.etag !== previous.result.etag || encrypted.size !== previous.result.byteLength) {
      throw rejected("BACKUP_OBJECT_CHANGED", "加密文件缺失或已被改动，请保留原记录并创建新备份。");
    }
    reused = true;
  } else if (previous) {
    reused = !!await env.MEDIA_BUCKET.head(sourceKey(previous))
      && !!await env.MEDIA_BUCKET.head(`backups/${previous.environment}/${previous.sourceId}/source.sql`);
  }
  const job: Job = { id: previous?.id ?? scheduledId ?? newJobId(now),
    environment: environment(env), createdAt: previous?.createdAt ?? now, startedAt: now, updatedAt: now,
    deadline: now + settings.backupTaskTimeout * 1000, attempt: crypto.randomUUID(),
    sourceId: reused ? previous!.sourceId : crypto.randomUUID(), target, status: "running",
    ...(reused && previous?.result ? { result: previous.result, receipt: previous.receipt, pendingReceipt: previous.pendingReceipt } : {}) };
  requestSignal.throwIfAborted();
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), Math.max(0, job.deadline - Date.now()));
  const signal = AbortSignal.any([requestSignal, timeout.signal]);
  let lease: Awaited<ReturnType<typeof acquire>> | undefined, etag: string | undefined;
  let abandoned: Promise<void> | undefined, released: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  const finish = () => released ??= (async () => { await writes.catch(() => {}); if (lease) await release(env, lease, ctx); })();
  const save = () => {
    const written = writes.catch(() => {}).then(async () => {
      if (!etag) return;
      await delay(Math.max(0, job.updatedAt + 1100 - Date.now())); job.updatedAt = Date.now();
      const saved = await env.MEDIA_BUCKET.put(jobKey(env, job.id), JSON.stringify(job), { onlyIf: { etagMatches: etag } });
      if (!saved) throw rejected("BACKUP_STATE_CHANGED", "备份状态已变化，请刷新后检查。");
      etag = saved.etag;
    });
    writes = written; ctx.waitUntil(written.catch(() => {})); return written;
  };
  const detach = onDisconnect(requestSignal, () => {
    if (job.status === "running") { job.status = "failed"; job.failure = "BACKUP_INTERRUPTED"; }
    abandoned = save().finally(finish); ctx.waitUntil(abandoned.catch(() => {}));
  });
  // Register the disconnect listener before claiming or writing the initial record; the promise includes the lease assignment.
  writes = Promise.resolve().then(async () => {
    signal.throwIfAborted(); lease = await acquire(env, job); signal.throwIfAborted();
    // R2 limits writes to the same object to one per second; no per-poll status writes are needed.
    if (previous) await delay(Math.max(0, previous.updatedAt + 1100 - Date.now()), undefined, { signal });
    job.updatedAt = Date.now();
    const started = await env.MEDIA_BUCKET.put(jobKey(env, job.id), JSON.stringify(job), {
      onlyIf: old ? { etagMatches: old.etag } : { etagDoesNotMatch: "*" },
    });
    if (!started) throw rejected("BACKUP_BUSY", "备份状态已变化，请刷新后重试。");
    etag = started.etag;
  });
  try {
    await writes;
    let phase: Failure = "BACKUP_EXPORT_FAILED";
    const persist = () => abandoned ? abandoned.catch(() => {}) : save();
    try {
      signal.throwIfAborted();
      if (!reused) {
        phase = "BACKUP_STORAGE_FAILED";
        if (!await env.MEDIA_BUCKET.put(sourceControlKey(env, job.sourceId), JSON.stringify({ jobId: job.id, createdAt: job.startedAt }), { onlyIf: { etagDoesNotMatch: "*" } })) throw new Error("BACKUP_RECORD_INVALID");
        phase = "BACKUP_EXPORT_FAILED";
        const exported = await exportSnapshot(env, job, signal); phase = "BACKUP_STORAGE_FAILED";
        await stageBackup(env.MEDIA_BUCKET, exported.metadata, exported.body, exported.byteLength, signal);
      }
      phase = "BACKUP_ENCRYPTION_FAILED";
      job.result ??= await encryptBackup(env.MEDIA_BUCKET, scope(job), env.BACKUP_ENCRYPTION_KEY, signal);
      if (target !== "download") {
        phase = "BACKUP_TARGET_FAILED";
        const intended = backupDestinationReceipt(env, target, job.result);
        const previousReceipt = job.receipt ?? job.pendingReceipt;
        if (previousReceipt && previousReceipt.destinationId !== intended.destinationId) throw new Error("BACKUP_TARGET_CHANGED");
        job.pendingReceipt = intended;
        // Publish the immutable encrypted artifact and intended remote object before the first external write.
        await save();
        try { await discardPlaintext(env, job, signal); }
        catch { job.cleanup = { status: "failed", deleted: 0 }; signal.throwIfAborted(); }
        job.receipt = await uploadBackup(env, target, job.result, signal);
        delete job.pendingReceipt;
      }
      if (Date.now() >= job.deadline) timeout.abort();
      signal.throwIfAborted(); job.status = "complete";
    } catch (error) {
      job.status = "failed";
      job.failure = timeout.signal.aborted ? "BACKUP_TIMED_OUT" : requestSignal.aborted ? "BACKUP_INTERRUPTED"
        : error instanceof Error && error.message === "BACKUP_EXPORT_FORMAT" ? "BACKUP_EXPORT_FORMAT" : phase;
    }
    await persist();
    if (job.status === "complete" && !abandoned) {
      try { job.cleanup = await cleanupBackups(env, job, signal); }
      catch { job.cleanup = { status: "failed", deleted: 0 }; }
      await persist();
    }
    return publicJob(job, env);
  } finally { clearTimeout(timer); detach(); await (abandoned?.catch(() => {}) ?? finish()); }
}

export async function runScheduledBackup(env: Env, ctx: ExecutionContext, now = Date.now()) {
  const lease = await readLease(env);
  if (lease.error) return { status: "schedule_failed" as const, error: lease.error, busy: lease.busy };
  let current: Awaited<ReturnType<typeof readSchedule>>;
  try { current = await readSchedule(env); }
  catch (error) { return { status: "schedule_failed" as const, error, busy: lease.busy }; }
  if (!current?.value.enabled || current.value.nextRunAt === null || current.value.nextRunAt > now) {
    if (lease.busy) return { status: "busy" as const };
    return { status: "not_due" as const };
  }
  const available = configured(env) && backupTargetAvailability(env)[current.value.target];
  await delay(Math.max(0, current.value.updatedAt + 1100 - Date.now()));
  const started = Date.now(), claimedValue: BackupSchedule = { ...current.value, nextRunAt: nextScheduleAt(current.value, now), lastRunAt: started,
    lastStatus: available ? "running" : "failed", lastJobId: available ? newJobId(started) : null,
    lastFailure: available ? null : "BACKUP_TARGET_UNAVAILABLE", updatedAt: started };
  const claimed = await env.MEDIA_BUCKET.put(scheduleKey(env), JSON.stringify(claimedValue), { onlyIf: { etagMatches: current.etag } });
  if (!claimed) return { status: "busy" as const };
  if (!available) return { status: lease.busy ? "busy" as const : "unavailable" as const };
  let result: Awaited<ReturnType<typeof runBackup>> | undefined;
  try {
    result = await runBackup(new AbortController().signal, env, ctx, current.value.target, undefined, claimedValue.lastJobId!);
  } catch (error) {
    claimedValue.lastFailure = error instanceof APIError && error.body?.code === "BACKUP_BUSY" ? "BACKUP_BUSY" : "BACKUP_STATE_FAILED";
  }
  await delay(Math.max(0, claimedValue.updatedAt + 1100 - Date.now()));
  const finished: BackupSchedule = { ...claimedValue, lastStatus: result?.status ?? "failed", updatedAt: Date.now() };
  // A concurrent settings edit wins over this old invocation; storage failures must still fail the scheduled event.
  await env.MEDIA_BUCKET.put(scheduleKey(env), JSON.stringify(finished), { onlyIf: { etagMatches: claimed.etag } });
  return result ? { status: result.status, job: result } : { status: "failed" as const };
}

export async function backupStatus(env: Env, after: string | null = null) {
  if (after && !jobIdPattern.test(after)) throw invalid();
  const prefix = `${control(env)}jobs/`, page = await env.MEDIA_BUCKET.list({ prefix, limit: 20, ...(after ? { startAfter: `${prefix}${after}.json` } : {}) });
  const ids = page.objects.map(object => object.key.slice(prefix.length, -5)), invalidJobs: string[] = [];
  const jobs = await Promise.all(ids.map(async id => {
    try {
      const stored = await readJob(env, id);
      if (!stored) throw invalidRecord();
      return publicJob(stored.value, env);
    } catch (error) { if (!isInvalidRecord(error)) throw error; invalidJobs.push(id); return null; }
  }));
  const schedule = await readSchedule(env);
  return { environment: environment(env), items: jobs.filter(job => job !== null), invalidJobs, after: page.truncated ? ids.at(-1)! : null,
    targets: { download: configured(env), ...Object.fromEntries(Object.entries(backupTargetAvailability(env)).map(([key, ready]) => [key, configured(env) && ready])) } as Record<BackupTarget, boolean>,
    schedule: await publicSchedule(schedule?.value ?? defaultSchedule(), env),
    unavailableReason: configured(env) ? null : "本环境未配置数据库导出，不能创建备份。" };
}

export async function backupsHttp(request: Request, env: Env, ctx: ExecutionContext, identity = createRequestIdentity(request, env)) {
  const current = await requireBackupOwner(request, env, identity), url = new URL(request.url), path = url.pathname;
  const json = (data: unknown, status = 200) => Response.json({ data, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { status, headers: current.headers });
  if (request.method === "GET" && path === "/admin/backups/status") {
    return json(await backupStatus(env, url.searchParams.get("after")));
  }
  if (request.method === "PUT" && path === "/admin/backups/schedule") {
    checkWrite(request, env);
    return json(await updateBackupSchedule(env, await readJson(request)));
  }
  const match = new RegExp(`^/admin/backups/(\\d{16}-${uuid})(?:/(retry|download|close-external))?$`, "u").exec(path);
  if (request.method === "GET" && match) {
    const stored = await readJob(env, match[1]);
    if (!stored) throw new APIError("NOT_FOUND", { code: "BACKUP_NOT_FOUND", message: "找不到这次备份。" });
    const job = stored.value;
    if (!match[2]) return json(publicJob(job, env));
    if (match[2] === "download") {
      if (!job.result || job.deleted || job.r2Deleted) throw rejected("BACKUP_NOT_READY", "这次备份没有完成，或加密文件已过期清理，不能下载。");
      const artifact = job.result;
      // The completion record already proves SHA-256 and GCM verification; serve only that exact immutable version.
      const object = await env.MEDIA_BUCKET.get(`backups/${job.environment}/${job.sourceId}/${artifact.file}.bin`, { onlyIf: { etagMatches: artifact.etag } });
      if (!object || !("body" in object) || object.size !== artifact.byteLength) {
        if (object && "body" in object) await object.body.cancel();
        throw rejected("BACKUP_OBJECT_CHANGED", "备份文件缺失或已被改动，为安全起见拒绝下载。");
      }
      return new Response(object.body, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="backup-${job.environment}-${job.id}.stcnbak"` } });
    }
  }
  if (request.method !== "GET") {
    checkWrite(request, env); const body = await readJson(request);
    if (request.method === "POST" && path === "/admin/backups/cleanup") {
      if (Object.keys(body).length) throw invalid();
      return json(await manualCleanup(env, request.signal, ctx));
    }
    if (request.method === "POST" && match?.[2] === "close-external") {
      if (body.confirmed !== true || !Number.isSafeInteger(body.updatedAt) || Number(body.updatedAt) <= 0
        || Object.keys(body).some(key => !["confirmed", "updatedAt"].includes(key))) throw invalid();
      return json(await closeExternalBackup(env, match[1], Number(body.updatedAt), request.signal));
    }
    if (request.method !== "POST" || path !== "/admin/backups" && match?.[2] !== "retry") return new Response(null, { status: 404 });
    if (body.maintenanceConfirmed !== true || Object.keys(body).some(key => !["target", "maintenanceConfirmed"].includes(key))) throw invalid();
    if (body.target !== "download" && body.target !== "webdav" && body.target !== "s3"
      || body.target !== "download" && !backupTargetAvailability(env)[body.target]) throw new APIError("BAD_REQUEST", { code: "BACKUP_TARGET_UNAVAILABLE", message: "所选保存位置未配置或配置无效。" });
    if (!configured(env)) throw new APIError("SERVICE_UNAVAILABLE", { code: "BACKUP_CONFIG_INVALID", message: "本环境未配置数据库导出，不能创建备份。" });
    const old = match ? await readJob(env, match[1]) : undefined;
    if (match && !old) throw new APIError("NOT_FOUND", { code: "BACKUP_NOT_FOUND", message: "找不到这次备份。" });
    if (old && (old.value.target ?? "download") !== body.target) throw invalid();
    return json(await runBackup(request.signal, env, ctx, body.target, old), 200);
  }
  return new Response(null, { status: 404 });
}
