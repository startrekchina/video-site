import { useEffect, useState } from "react"

import { hash, mulberry32 } from "@/pages/watch-comments/data"

// Fictional telemetry for the /status prototypes. Every hour's numbers hash from that hour's own
// timestamp, so history holds still across reloads and the window just slides forward. Times are
// Beijing time; byte units are decimal (1 GB = 10^9 bytes), as Cloudflare bills them.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const CST = 8 * HOUR

const dayStart = (now: number, daysAgo = 0) => Math.floor((now + CST) / DAY) * DAY - CST - daysAgo * DAY
const hourStart = (t: number) => Math.floor(t / HOUR) * HOUR

// A fictional half-hour slowdown two days ago, so the latency and error series carry a real-looking spike.
const SLOWDOWN = { daysAgo: 2, start: [14, 2], minutes: 29 } as const

/**
 * One hour as the Cloudflare analytics datasets would report it: Workers invocations (requests,
 * statuses, wall and CPU time quantiles), R2 bandwidth and operations, D1 queries.
 */
type Sample = {
  t: number
  bytes: number
  upload: number
  requests: number
  errors: number
  disconnects: number
  /** Wall time quantiles, ms: the Worker's whole handling of a request, I/O waits included. */
  p50: number
  p95: number
  p99: number
  cpuP50: number
  cpuP99: number
  classA: number
  classB: number
  reads: number
  writes: number
  rowsRead: number
  rowsWritten: number
  d1P50: number
  d1P90: number
}

// Slow membership growth from a fixed date (so past hours never change), and the National Day week.
const GROWTH_FROM = Date.UTC(2026, 3, 1)
const growth = (t: number) => 0.7 + 0.3 * Math.min(1, Math.max(0, (t - GROWTH_FROM) / (200 * DAY)))
const holiday = (local: Date) => local.getUTCMonth() === 9 && local.getUTCDate() <= 7

function sample(t: number, now: number): Sample {
  const rnd = mulberry32(hash(`status:${t}`))
  const local = new Date(t + CST)
  const weekday = local.getUTCDay()
  // Evening peak around 22:00 and a trough before dawn; Friday and Saturday nights run hotter.
  const curve = ((1 + Math.cos((2 * Math.PI * (local.getUTCHours() - 22)) / 24)) / 2) ** 1.6
  const busy = weekday === 5 || weekday === 6 ? 1.2 : 1
  const load = (0.06 + 0.94 * curve) * busy * (holiday(local) ? 1.35 : 1) * growth(t) * (0.85 + 0.3 * rnd())
  const from = dayStart(now, SLOWDOWN.daysAgo) + (SLOWDOWN.start[0] * 60 + SLOWDOWN.start[1]) * 60_000
  const hit = from < t + HOUR && from + SLOWDOWN.minutes * 60_000 > t
  const requests = Math.round(800 + 15_000 * load)
  const p50 = (24 + 16 * load + 6 * rnd()) * (hit ? 4 : 1)
  const cpuP50 = 1.1 + 0.5 * rnd()
  // About a third of requests are API calls hitting D1; playback writes progress.
  const reads = Math.round(requests * 0.35 * (1.9 + 0.4 * rnd()))
  const writes = Math.round(requests * (0.06 + 0.03 * rnd()))
  const d1P50 = 0.6 + 0.4 * rnd()
  return {
    t,
    bytes: 27e9 * load,
    // Media sync uploads a batch of new episodes now and then; otherwise only small metadata.
    upload: rnd() < 0.015 ? 2e9 + 4e9 * rnd() : 4e6 * rnd(),
    requests,
    errors: Math.round(requests * (hit ? 0.008 : 0.0002 + 0.0004 * rnd())),
    // Seeking aborts in-flight range requests, so client disconnects are routine for a video site.
    disconnects: Math.round(requests * (0.003 + 0.004 * rnd())),
    p50,
    p95: p50 * (2.8 + 0.6 * rnd()),
    p99: p50 * (5.5 + 2 * rnd()),
    cpuP50,
    cpuP99: cpuP50 * (6 + 4 * rnd()) * (hit ? 1.6 : 1),
    // Media sync lists the bucket every 5 minutes; uploads are rare.
    classA: 12 + Math.round(4 * rnd()),
    classB: Math.round(requests * 0.62),
    reads,
    writes,
    rowsRead: Math.round(reads * (5 + 5 * rnd())),
    rowsWritten: Math.round(writes * 1.3),
    d1P50,
    d1P90: d1P50 * (3 + 1.5 * rnd()),
  }
}

/** The last `count` hours, oldest first, ending with the current (partial) hour. */
const samples = (now: number, count: number) => Array.from({ length: count }, (_, i) => sample(hourStart(now) - (count - 1 - i) * HOUR, now))

const toMbps = (bytes: number, hours = 1) => (bytes * 8) / (hours * 3600) / 1e6

export type Range = "24h" | "7d" | "30d"
export const RANGES: Record<Range, { label: string; hours: number; bucket: number }> = {
  "24h": { label: "24h", hours: 24, bucket: 1 },
  "7d": { label: "7d", hours: 168, bucket: 24 },
  "30d": { label: "30d", hours: 720, bucket: 24 },
}

const SUMMED = ["bytes", "upload", "requests", "errors", "disconnects", "classA", "classB", "reads", "writes", "rowsRead", "rowsWritten"] as const
const QUANTILES = ["p50", "p95", "p99", "cpuP50", "cpuP99", "d1P50", "d1P90"] as const
export type Totals = Record<(typeof SUMMED)[number] | (typeof QUANTILES)[number], number> & { peakMbps: number }

function totals(list: Sample[]): Totals {
  const sum = (f: (s: Sample) => number) => list.reduce((n, s) => n + f(s), 0)
  const requests = sum((s) => s.requests)
  const queries = sum((s) => s.reads + s.writes)
  const out = { peakMbps: toMbps(Math.max(...list.map((s) => s.bytes))) } as Totals
  for (const k of SUMMED) out[k] = sum((s) => s[k])
  // shortcut: request-weighted mean of hourly percentiles, not a true percentile; real data would come pre-aggregated.
  for (const k of QUANTILES) out[k] = sum((s) => s[k] * (k.startsWith("d1") ? s.reads + s.writes : s.requests)) / (k.startsWith("d1") ? queries : requests)
  return out
}

/** How the range's invocations ended, under the Workers analytics `status` names. */
export const outcomes = (t: Totals) => {
  const exceptions = Math.round(t.errors * 0.72)
  const exceeded = Math.round(t.errors * 0.24)
  return [
    { key: "success", count: t.requests - t.errors - t.disconnects },
    { key: "clientDisconnected", count: t.disconnects },
    { key: "scriptThrewException", count: exceptions },
    { key: "exceededResources", count: exceeded },
    { key: "internalError", count: t.errors - exceptions - exceeded },
  ]
}

/** R2 operations by action type; object names and the bucket stay out of public view. */
export const r2Operations = (t: Totals) => [
  { key: "GetObject", count: Math.round(t.classB * 0.94) },
  { key: "HeadObject", count: Math.round(t.classB * 0.06) },
  { key: "ListObjects", count: Math.round(t.classA * 0.93) },
  { key: "PutObject", count: Math.round(t.classA * 0.07) },
]

export type Bucket = Totals & { t: number; mbps: number }

/** One range of buckets plus totals for it. */
export function telemetry(range: Range, now: number) {
  const { hours, bucket } = RANGES[range]
  // Daily buckets are whole Beijing calendar days (today partial), so every bucket starts at midnight.
  const span = bucket === 1 ? hours : (hourStart(now) - dayStart(now, hours / 24 - 1)) / HOUR + 1
  const current = samples(now, span)
  const buckets: Bucket[] = []
  for (let i = 0; i < current.length; i += bucket) {
    const group = current.slice(i, i + bucket)
    const t = totals(group)
    buckets.push({ ...t, t: group[0].t, mbps: toMbps(t.bytes, group.length) })
  }
  return { buckets, totals: totals(current) }
}

/** Production deployments as the Workers versions API and Workers Builds would list them. */
export const DEPLOYS = [
  { daysAgo: 0, at: [0, 42], version: "a41c09e2", commit: "e3b71f0", message: "fix(admin): close the divider under the stats row", via: "Workers Builds" },
  { daysAgo: 1, at: [21, 47], version: "7d20b5c1", commit: "9a4c2d8", message: "feat(player): quality switching and danmaku", via: "Workers Builds" },
  { daysAgo: 4, at: [15, 3], version: "c9e8f137", commit: "51f0aa6", message: "fix(backup): unify feedback and time format", via: "Workers Builds" },
  { daysAgo: 9, at: [9, 30], version: "02bd6e4a", commit: "c27e915", message: "feat(catalog): media import and protected playback", via: "Workers Builds" },
  { daysAgo: 16, at: [2, 55], version: "f3a90d7b", commit: "8b1d4e2", message: "chore(db): migrate sessions table", via: "手动部署" },
] as const
export const deployedAt = (d: (typeof DEPLOYS)[number], now: number) => dayStart(now, d.daysAgo) + (d.at[0] * 60 + d.at[1]) * 60_000

/** D1 database size; the R2 bucket's size and object count stay private because they would reveal the library's size. */
export const D1_SIZE = 41.7e6

export const COLOS = [
  { key: "HKG", share: 0.46 },
  { key: "NRT", share: 0.17 },
  { key: "SJC", share: 0.11 },
  { key: "LAX", share: 0.08 },
  { key: "SIN", share: 0.07 },
  { key: "FRA", share: 0.04 },
  { key: "其他", share: 0.07 },
]

/** Media is fetched in ranges, so 206 dominates. */
export const STATUS_CODES = [
  { key: "206", share: 0.652 },
  { key: "200", share: 0.318 },
  { key: "304", share: 0.011 },
  { key: "4xx", share: 0.0185 },
  { key: "5xx", share: 0.0005 },
]

const MINUTE = 60_000
// The analytics API is still aggregating the last few minutes, so the per-minute series stops this far back.
const LAG = 3 * MINUTE

/** One minute of egress in Mbps: the hour average eased toward the next hour, with jitter that holds across refreshes. */
function minuteMbps(t: number, now: number) {
  const h = hourStart(t)
  const ease = (t - h) / HOUR
  const base = toMbps(sample(h, now).bytes) * (1 - ease) + toMbps(sample(h + HOUR, now).bytes) * ease
  return base * (0.85 + 0.3 * mulberry32(hash(`minute:${t}`))())
}

function lastHour() {
  const now = Date.now()
  const at = Math.floor((now - LAG) / MINUTE) * MINUTE
  const history = Array.from({ length: 60 }, (_, i) => at - (59 - i) * MINUTE).map((t) => ({ t, mbps: minuteMbps(t, now) }))
  return { at, mbps: history[59].mbps, history }
}

/** The last hour of egress per minute, ending LAG ago; refreshed every minute while the page is visible. */
export function useMinutes() {
  const [state, setState] = useState(lastHour)
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setState(lastHour)
    }
    const id = setInterval(refresh, MINUTE)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [])
  return state
}

const pad = (n: number) => String(n).padStart(2, "0")
const local = (t: number) => new Date(t + CST)
export const fmtDay = (t: number) => `${pad(local(t).getUTCMonth() + 1)}-${pad(local(t).getUTCDate())}`
export const fmtClock = (t: number) => `${pad(local(t).getUTCHours())}:${pad(local(t).getUTCMinutes())}`
export const fmtBytes = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)
export const fmtMbps = (m: number) => `${m.toFixed(1)} Mbps`
export const fmtMs = (ms: number) => `${ms === 0 || ms >= 10 ? Math.round(ms) : ms.toFixed(1)} ms`
export const fmtPct = (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 })
export const fmtCount = (n: number) => (n >= 1e4 ? compact.format(n) : n.toLocaleString("en-US"))
