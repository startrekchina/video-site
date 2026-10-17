import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { APIError } from "better-auth/api";
import { createRequestIdentity, requireMember, type Member } from "./member.server";
import { checkWrite, readJson } from "./security.server";
import { settings } from "./settings.server";
import { encryptBackup, stageBackup, type BackupScope } from "./backup-storage.server";
import { backupKeyId, backupKeys } from "./backup-keys.server";
import { backupDestinationReceipt, backupTargetAvailability, deleteExternalBackup, uploadBackup, verifyExternalBackup, type BackupReceipt, type BackupTarget } from "./backup-targets.server";

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const jobIdPattern = new RegExp(`^\\d{16}-${uuid}$`, "u"), uuidPattern = new RegExp(`^${uuid}$`, "u");
const maxExportBytes = 5 * 1024 ** 3 - 5 * 1024 ** 2 - 4096 - 28;
const failureMessages = {
  BACKUP_EXPORT_FAILED: "数据库导出失败，请稍后人工重试。",
  BACKUP_EXPORT_FORMAT: "导出文件缺少可靠长度、编码不受支持或超过单次存储限制，未标记成功。",
  BACKUP_STORAGE_FAILED: "备份存储或校验失败，完整副本会保留供人工重试。",
  BACKUP_ENCRYPTION_FAILED: "加密或回读校验失败，完整源副本会保留供人工重试。",
  BACKUP_INTERRUPTED: "备份请求中断，未确认完整成功；请检查状态后人工重试。",
  BACKUP_TIMED_OUT: "备份超过执行时限，未确认完整成功；请检查状态后人工重试。",
  BACKUP_TARGET_FAILED: "外部上传或回读校验失败；完整 R2 副本已保留，请人工重试。",
} as const;
type Failure = keyof typeof failureMessages;
type Artifact = Awaited<ReturnType<typeof encryptBackup>>;
type Job = { id: string; environment: BackupScope["environment"]; createdAt: number; startedAt: number; updatedAt: number;
  deadline: number; attempt: string; sourceId: string; target?: BackupTarget; receipt?: BackupReceipt; pendingReceipt?: BackupReceipt;
  cleanup?: { status: "complete" | "failed"; deleted: number }; deleted?: boolean; r2Deleted?: boolean; externalDeleted?: boolean;
  status: "running" | "failed" | "complete"; failure?: Failure; result?: Artifact };
type Lease = { jobId: string; attempt: string; deadline: number; updatedAt?: number; cleanup?: boolean };
const rejected = (code: string, message: string) => new APIError("CONFLICT", { code, message });
const invalid = () => new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "备份请求无效。" });
function environment(env: Env): BackupScope["environment"] {
  if (env.APP_ENV === "development" || env.APP_ENV === "test" || env.APP_ENV === "staging" || env.APP_ENV === "production") return env.APP_ENV;
  throw new APIError("SERVICE_UNAVAILABLE", { code: "BACKUP_CONFIG_INVALID", message: "当前环境的备份配置无效。" });
}
const control = (env: Env) => `backup-control/${environment(env)}/`;
const jobKey = (env: Env, id: string) => `${control(env)}jobs/${id}.json`;
const sourceControlKey = (env: Env, id: string) => `${control(env)}sources/${id}.json`;
const scope = (job: Job): BackupScope => ({ environment: job.environment, id: job.sourceId });
const sourceKey = (job: Job) => `backups/${job.environment}/${job.sourceId}/source.json`;

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
    && !!env.CLOUDFLARE_API_TOKEN && Buffer.byteLength(env.BACKUP_ENCRYPTION_KEY ?? "") >= 32
    && env.BACKUP_ENCRYPTION_KEY !== env.BETTER_AUTH_SECRET;
}
async function record<T>(bucket: R2Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size > 16384) { await object.body.cancel(); throw new Error("BACKUP_RECORD_INVALID"); }
  return { value: await object.json<T>(), etag: object.etag };
}
async function readJob(env: Env, id: string) {
  if (!jobIdPattern.test(id)) throw invalid();
  const stored = await record<Job>(env.MEDIA_BUCKET, jobKey(env, id));
  if (stored && (stored.value.id !== id || stored.value.environment !== environment(env)
    || !uuidPattern.test(stored.value.sourceId) || !uuidPattern.test(stored.value.attempt)
    || !Number.isSafeInteger(stored.value.deadline) || !Number.isSafeInteger(stored.value.updatedAt)
    || !["running", "failed", "complete"].includes(stored.value.status)
    || stored.value.status === "complete" && !stored.value.result)) throw new Error("BACKUP_RECORD_INVALID");
  return stored;
}
function publicJob(job: Job) {
  const interrupted = job.status === "running" && job.deadline <= Date.now();
  const failure = interrupted ? "BACKUP_INTERRUPTED" : job.failure;
  return { id: job.id, environment: job.environment, createdAt: job.createdAt, startedAt: job.startedAt,
    backupTime: job.result?.source.createdAt ?? null, target: job.target ?? "download", status: interrupted ? "failed" : job.status,
    failure: failure ? { code: failure, message: failureMessages[failure] } : null,
    downloadReady: !!job.result && !job.deleted && !job.r2Deleted, byteLength: job.result?.byteLength ?? null, keyId: job.result?.keyId ?? null,
    authKeyId: job.result?.source.authKeyId ?? null, deleted: !!job.deleted, r2Deleted: !!job.deleted || !!job.r2Deleted, cleanup: job.cleanup ?? null };
}
async function acquire(env: Env, job: Job) {
  const key = `${control(env)}lease.json`, previous = await record<Lease>(env.MEDIA_BUCKET, key);
  if (previous && previous.value.deadline > Date.now()) {
    if (previous.value.cleanup) throw rejected("BACKUP_BUSY", "本环境正在清理备份，请稍后重试。");
    const active = await readJob(env, previous.value.jobId);
    if (!active || active.value.attempt !== previous.value.attempt || active.value.status === "running") {
      throw rejected("BACKUP_BUSY", "本环境已有备份正在执行，请等待完成或中断状态生效。");
    }
  }
  if (previous) await delay(Math.max(0, (previous.value.updatedAt ?? 0) + 1100 - Date.now()));
  const lease: Lease = { jobId: job.id, attempt: job.attempt, deadline: job.deadline, updatedAt: Date.now() };
  const locked = await env.MEDIA_BUCKET.put(key, JSON.stringify(lease), {
    onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" },
  });
  if (!locked) throw rejected("BACKUP_BUSY", "本环境已有备份正在执行，请稍后检查状态。");
}

async function exportMetadata(response: Response) {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("BACKUP_EXPORT_FAILED"); }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let length = 0, text = "";
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength; if (length > 65536) throw new Error("BACKUP_EXPORT_FAILED");
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as { success?: boolean; result?: {
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
  let bookmark: string | undefined;
  while (true) {
    signal.throwIfAborted();
    const response = await fetch(endpoint, { method: "POST", redirect: "manual", signal,
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ output_format: "polling", ...(bookmark ? { current_bookmark: bookmark } : {}) }) });
    const data = await exportMetadata(response), result = data.result;
    if (data.success !== true || !result || result.success === false || result.status === "error"
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
    if (result.status !== undefined) throw new Error("BACKUP_EXPORT_FAILED");
    await delay(1000, undefined, { signal });
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
async function cleanupBackups(env: Env, current: Job | undefined, signal: AbortSignal) {
  const pairs = backupKeys(env), protectedR2 = { id: "", time: 0 }, protectedExternal = new Map<string, { id: string; time: number }>();
  const recoverable = (job: Job) => job.result && pairs.some(pair => pair.keyId === job.result!.keyId)
    && pairs.some(pair => pair.authKeyId === job.result!.source.authKeyId);
  async function protect(job: Job) {
    signal.throwIfAborted();
    if (job.deleted || !recoverable(job)) return;
    const artifact = job.result!, time = artifact.source.createdAt;
    if (!job.r2Deleted && time > protectedR2.time) {
      const object = await env.MEDIA_BUCKET.head(`backups/${job.environment}/${job.sourceId}/${artifact.file}.bin`);
      if (object?.etag === artifact.etag && object.size === artifact.byteLength) Object.assign(protectedR2, { id: job.id, time });
    }
    if (job.receipt && !job.externalDeleted && time > (protectedExternal.get(job.receipt.destinationId)?.time ?? 0)) {
      // Recheck the candidate before treating it as the last recoverable external copy.
      try {
        await verifyExternalBackup(env, job.receipt, artifact, signal);
        protectedExternal.set(job.receipt.destinationId, { id: job.id, time });
      } catch { signal.throwIfAborted(); }
    }
  }
  for await (const { value: job } of allJobs(env)) if (job.id !== current?.id && job.status !== "running") await protect(job);
  let deleted = 0, failed = false;
  for await (const stored of allJobs(env)) {
    signal.throwIfAborted(); const job = stored.value;
    if (job.deleted || job.id === current?.id || job.status === "running" && job.deadline > Date.now()
      || (job.result?.source.createdAt ?? job.createdAt) >= Date.now() - settings.backupRetention * 1000) continue;
    const remote = job.receipt ?? job.pendingReceipt;
    let changed = false;
    if ((!job.r2Deleted && !protectedR2.id) || (remote && !job.externalDeleted && !protectedExternal.has(remote.destinationId))) failed = true;
    // Protect each endpoint independently. An unavailable/unknown-key endpoint cannot authorize its own deletion.
    if (remote && !job.externalDeleted && protectedExternal.has(remote.destinationId) && protectedExternal.get(remote.destinationId)!.id !== job.id) {
      try { await deleteExternalBackup(env, remote, signal); job.externalDeleted = true; changed = true; }
      catch { failed = true; signal.throwIfAborted(); }
    }
    if (!job.r2Deleted && protectedR2.id && protectedR2.id !== job.id) {
      try {
        await deleteSource(env, job.sourceId, signal);
        job.r2Deleted = true; changed = true;
      } catch { failed = true; signal.throwIfAborted(); }
    }
    if (changed) {
      job.deleted = !!job.r2Deleted && (!remote || !!job.externalDeleted); job.updatedAt = Date.now();
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
  return { status: failed ? "failed" as const : "complete" as const, deleted };
}
async function manualCleanup(env: Env, requestSignal: AbortSignal) {
  const now = Date.now(), job: Job = { id: `${String(Number.MAX_SAFE_INTEGER - now).padStart(16, "0")}-${crypto.randomUUID()}`,
    environment: environment(env), createdAt: now, startedAt: now, updatedAt: now, deadline: now + settings.backupTaskTimeout * 1000,
    attempt: crypto.randomUUID(), sourceId: crypto.randomUUID(), status: "running" };
  await acquire(env, job);
  const key = `${control(env)}lease.json`, lease = await record<Lease>(env.MEDIA_BUCKET, key);
  if (!lease || lease.value.attempt !== job.attempt) throw rejected("BACKUP_BUSY", "备份状态已变化，请稍后重试。");
  await delay(1100);
  const locked = await env.MEDIA_BUCKET.put(key, JSON.stringify({ ...lease.value, cleanup: true, updatedAt: Date.now() }), { onlyIf: { etagMatches: lease.etag } });
  if (!locked) throw rejected("BACKUP_BUSY", "备份状态已变化，请稍后重试。");
  const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), Math.max(0, job.deadline - Date.now()));
  try { return await cleanupBackups(env, undefined, AbortSignal.any([requestSignal, timer.signal])); }
  finally {
    clearTimeout(timeout); await delay(1100);
    await env.MEDIA_BUCKET.put(key, JSON.stringify({ ...lease.value, deadline: 0, cleanup: true, updatedAt: Date.now() }), { onlyIf: { etagMatches: locked.etag } });
  }
}

async function runBackup(request: Request, env: Env, ctx: ExecutionContext, target: BackupTarget, old?: Awaited<ReturnType<typeof readJob>>) {
  const now = Date.now(), previous = old?.value;
  if (previous?.status === "complete") throw rejected("BACKUP_ALREADY_COMPLETE", "该备份已完整完成，无需重试。");
  if (previous?.deleted || previous?.r2Deleted) throw rejected("BACKUP_NOT_READY", "该备份的 R2 副本已清理，请创建新备份。");
  if (previous?.status === "running" && previous.deadline > now) throw rejected("BACKUP_BUSY", "该备份仍在执行，请稍后检查状态。");
  const reused = previous && await env.MEDIA_BUCKET.head(sourceKey(previous));
  const job: Job = { id: previous?.id ?? `${String(Number.MAX_SAFE_INTEGER - now).padStart(16, "0")}-${crypto.randomUUID()}`,
    environment: environment(env), createdAt: previous?.createdAt ?? now, startedAt: now, updatedAt: now,
    deadline: now + settings.backupTaskTimeout * 1000, attempt: crypto.randomUUID(),
    sourceId: reused ? previous!.sourceId : crypto.randomUUID(), target, status: "running",
    ...(reused && previous?.result ? { result: previous.result, pendingReceipt: previous.pendingReceipt } : {}) };
  await acquire(env, job);
  // R2 limits writes to the same object to one per second; no per-poll status writes are needed.
  if (previous) await delay(Math.max(0, previous.updatedAt + 1100 - Date.now()));
  job.updatedAt = Date.now();
  let started = await env.MEDIA_BUCKET.put(jobKey(env, job.id), JSON.stringify(job), {
    onlyIf: old ? { etagMatches: old.etag } : { etagDoesNotMatch: "*" },
  });
  if (!started) throw rejected("BACKUP_BUSY", "备份状态已变化，请刷新后重试。");
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), Math.max(0, job.deadline - Date.now()));
  const signal = AbortSignal.any([request.signal, timeout.signal]); let phase: Failure = "BACKUP_EXPORT_FAILED";
  try {
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
      if (job.pendingReceipt && job.pendingReceipt.destinationId !== intended.destinationId) throw new Error("BACKUP_TARGET_CHANGED");
      job.pendingReceipt = intended;
      // Publish the immutable encrypted artifact and intended remote object before the first external write.
      await delay(Math.max(0, job.updatedAt + 1100 - Date.now()), undefined, { signal }); job.updatedAt = Date.now();
      const published = await env.MEDIA_BUCKET.put(jobKey(env, job.id), JSON.stringify(job), { onlyIf: { etagMatches: started.etag } });
      if (!published) throw rejected("BACKUP_STATE_CHANGED", "备份状态已变化，请刷新后检查。");
      started = published;
      job.receipt = await uploadBackup(env, target, job.result, signal);
      delete job.pendingReceipt;
    }
    if (Date.now() >= job.deadline) timeout.abort();
    signal.throwIfAborted(); job.status = "complete";
  } catch (error) {
    job.status = "failed";
    job.failure = timeout.signal.aborted ? "BACKUP_TIMED_OUT" : request.signal.aborted ? "BACKUP_INTERRUPTED"
      : error instanceof Error && error.message === "BACKUP_EXPORT_FORMAT" ? "BACKUP_EXPORT_FORMAT" : phase;
  }
  if (job.status === "complete") {
    try { job.cleanup = await cleanupBackups(env, job, signal); }
    catch { job.cleanup = { status: "failed", deleted: 0 }; }
  }
  clearTimeout(timer);
  const finish = (async () => {
    await delay(Math.max(0, job.updatedAt + 1100 - Date.now())); job.updatedAt = Date.now();
    if (job.status === "complete" && job.updatedAt >= job.deadline) {
      job.status = "failed"; job.failure = "BACKUP_TIMED_OUT";
    }
    const saved = await env.MEDIA_BUCKET.put(jobKey(env, job.id), JSON.stringify(job), { onlyIf: { etagMatches: started.etag } });
    if (!saved) throw rejected("BACKUP_STATE_CHANGED", "备份状态已变化，请刷新后检查。");
  })();
  // Only the small final status write uses the disconnect grace period, never the export/encryption pipeline.
  ctx.waitUntil(finish.catch(() => {})); await finish;
  return publicJob(job);
}

export async function backupStatus(env: Env, after: string | null = null) {
  if (after && !jobIdPattern.test(after)) throw invalid();
  const prefix = `${control(env)}jobs/`, page = await env.MEDIA_BUCKET.list({ prefix, limit: 20, ...(after ? { startAfter: `${prefix}${after}.json` } : {}) });
  const ids = page.objects.map(object => object.key.slice(prefix.length, -5)), jobs = await Promise.all(ids.map(id => readJob(env, id)));
  if (jobs.some(job => !job)) throw new Error("BACKUP_RECORD_UNAVAILABLE");
  return { environment: environment(env), items: jobs.map(job => publicJob(job!.value)), after: page.truncated ? ids.at(-1)! : null,
    targets: { download: configured(env), ...Object.fromEntries(Object.entries(backupTargetAvailability(env)).map(([key, ready]) => [key, configured(env) && ready])) } as Record<BackupTarget, boolean>,
    notice: "导出期间成员查询可能暂时不可用；请保持请求连接。下载文件需要独立保管的历史认证与备份密钥。",
    unavailableReason: configured(env) ? null : "本环境导出配置未就绪；本地开发不调用远程 D1。" };
}

export async function backupsHttp(request: Request, env: Env, ctx: ExecutionContext, identity = createRequestIdentity(request, env)) {
  const current = await requireBackupOwner(request, env, identity), url = new URL(request.url), path = url.pathname;
  const json = (data: unknown, status = 200) => Response.json({ data, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { status, headers: current.headers });
  if (request.method === "GET" && path === "/admin/backups/status") {
    return json(await backupStatus(env, url.searchParams.get("after")));
  }
  const match = new RegExp(`^/admin/backups/(\\d{16}-${uuid})(?:/(retry|download))?$`, "u").exec(path);
  if (request.method === "GET" && match) {
    const stored = await readJob(env, match[1]);
    if (!stored) throw new APIError("NOT_FOUND", { code: "BACKUP_NOT_FOUND", message: "找不到本环境的备份。" });
    const job = stored.value;
    if (!match[2]) return json(publicJob(job));
    if (match[2] === "download") {
      if (!job.result || job.deleted || job.r2Deleted) throw rejected("BACKUP_NOT_READY", "该备份尚未完整完成或 R2 副本已按保留策略清理，不能下载。");
      const artifact = job.result;
      if (artifact.source.environment !== environment(env) || artifact.source.id !== job.sourceId
        || !new RegExp(`^encrypted-${uuid}$`, "u").test(artifact.file) || !artifact.etag) throw new Error("BACKUP_RECORD_INVALID");
      // The completion record already proves SHA-256 and GCM verification; serve only that exact immutable version.
      const object = await env.MEDIA_BUCKET.get(`backups/${job.environment}/${job.sourceId}/${artifact.file}.bin`, { onlyIf: { etagMatches: artifact.etag } });
      if (!object || !("body" in object) || object.size !== artifact.byteLength) {
        if (object && "body" in object) await object.body.cancel();
        throw rejected("BACKUP_OBJECT_CHANGED", "备份对象缺失或版本已变化，拒绝下载未经校验的内容。");
      }
      return new Response(object.body, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="backup-${job.environment}-${job.id}.stcnbak"` } });
    }
  }
  if (request.method !== "GET") {
    checkWrite(request, env); const body = await readJson(request);
    if (request.method === "POST" && path === "/admin/backups/cleanup") {
      if (Object.keys(body).length) throw invalid();
      return json(await manualCleanup(env, request.signal));
    }
    if (request.method !== "POST" || path !== "/admin/backups" && match?.[2] !== "retry") return new Response(null, { status: 404 });
    if (body.maintenanceConfirmed !== true || Object.keys(body).some(key => !["target", "maintenanceConfirmed"].includes(key))) throw invalid();
    if (body.target !== "download" && body.target !== "webdav" && body.target !== "s3"
      || body.target !== "download" && !backupTargetAvailability(env)[body.target]) throw new APIError("BAD_REQUEST", { code: "BACKUP_TARGET_UNAVAILABLE", message: "所选外部目标配置不完整或无效。" });
    if (!configured(env)) throw new APIError("SERVICE_UNAVAILABLE", { code: "BACKUP_CONFIG_INVALID", message: "本环境导出配置未就绪；本地开发不调用远程 D1。" });
    const old = match ? await readJob(env, match[1]) : undefined;
    if (match && !old) throw new APIError("NOT_FOUND", { code: "BACKUP_NOT_FOUND", message: "找不到本环境的备份。" });
    if (old && (old.value.target ?? "download") !== body.target) throw invalid();
    return json(await runBackup(request, env, ctx, body.target, old), 200);
  }
  return new Response(null, { status: 404 });
}
