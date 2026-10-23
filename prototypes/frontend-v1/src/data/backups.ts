// In-memory presentation model only; no files, keyring or remote targets are accessed here.
export type Target = "download" | "webdav" | "s3"
export type External = Exclude<Target, "download">
export type Frequency = "daily" | "weekly" | "interval"
export type Job = {
  id: string
  target: Target
  createdAt: number
  status: "complete" | "failed" | "running"
  failure?: string
  downloadReady: boolean
  r2Deleted?: boolean
  deleted?: boolean
  cleanupFailed?: boolean
  byteLength?: number
  keyId?: string
  authKeyId?: string
}
export type Schedule = {
  enabled: boolean
  target: External
  frequency: Frequency
  intervalDays: number
  weekday: number
  time: string
  anchorAt?: number
  nextRunAt?: number
  lastRunAt?: number
  lastStatus?: "complete" | "failed"
  failure?: string
}

const DAY = 86_400_000
const OFFSET = 8 * 60 * 60 * 1000
const localDay = (now: number) => Math.floor((now + OFFSET) / DAY) * DAY - OFFSET

export function updateSchedule(previous: Schedule, settings: Pick<Schedule, "enabled" | "target" | "frequency" | "intervalDays" | "weekday" | "time">, now: number): Schedule {
  const anchorAt = settings.frequency === "interval"
    ? previous.frequency === "interval" && previous.intervalDays === settings.intervalDays ? previous.anchorAt ?? localDay(now) : localDay(now)
    : undefined
  const schedule = { ...previous, ...settings, anchorAt, failure: undefined, nextRunAt: undefined as number | undefined }
  if (!schedule.enabled) return schedule
  const [hour, minute] = schedule.time.split(":").map(Number)
  let day = localDay(now)
  if (schedule.frequency === "weekly") day += (schedule.weekday - new Date(day + OFFSET).getUTCDay() + 7) % 7 * DAY
  if (anchorAt !== undefined) day += (schedule.intervalDays - ((day - anchorAt) / DAY) % schedule.intervalDays) % schedule.intervalDays * DAY
  let candidate = day + (hour * 60 + minute) * 60_000
  if (candidate <= now) candidate += (schedule.frequency === "weekly" ? 7 : schedule.frequency === "interval" ? schedule.intervalDays : 1) * DAY
  return { ...schedule, nextRunAt: candidate }
}

export function expiredJobs(jobs: Job[], now: number): Job[] {
  const protectedJobs = new Map<Target, Job>()
  let latestDownload: Job | undefined
  for (const job of jobs) {
    if (job.deleted || !job.keyId || !job.authKeyId) continue
    if (job.downloadReady && !job.r2Deleted && (!latestDownload || latestDownload.createdAt < job.createdAt)) latestDownload = job
    if (job.status !== "complete" || (job.target === "download" && (!job.downloadReady || job.r2Deleted))) continue
    const current = protectedJobs.get(job.target)
    if (!current || current.createdAt < job.createdAt) protectedJobs.set(job.target, job)
  }
  return jobs.filter((job) => job.status !== "running" && !job.deleted && job.createdAt < now - 30 * DAY && protectedJobs.get(job.target) !== job && latestDownload !== job)
}
