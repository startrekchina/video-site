// Data shaping for the home hero (prototype). Layout lives in theatre.tsx.
import { displayTitle, episodeCode, getUnit, getWork, unitPoster, type Unit, type Work } from "@/data/catalog"
import { continueWatching, useStore, type Progress } from "@/data/store"

export type QueueItem = { unit: Unit; progress: Progress | null; reason: "resume" | "next" }

export function useQueue(): QueueItem[] {
  return useStore(continueWatching).flatMap((i) => {
    const unit = getUnit(i.unitId)
    return unit ? [{ unit, progress: i.progress, reason: i.reason }] : []
  })
}

/** Editorial starting points for members with no history. Who curates these is an open question. */
export const STARTS: { slug: string; why: string }[] = [
  { slug: "star-trek-strange-new-worlds", why: "新拍、单元剧为主，不需要任何前置知识" },
  { slug: "star-trek-the-next-generation", why: "老粉最常推荐的入门作，七季一气呵成" },
  { slug: "star-trek-the-original-series", why: "1966 年，一切的起点：柯克与斯波克" },
]

export function startWorks() {
  return STARTS.map((s) => ({ ...s, work: getWork(s.slug)! }))
}

export function firstUnitId(work: Work) {
  return work.kind === "movie" ? work.unitId! : work.seasons[0].episodes[0].id
}

/** "TNG · S03E26" or "电影 · 1982". */
export function kicker(u: Unit) {
  return u.kind === "episode" ? `${u.work.code} · ${episodeCode(u.episode)}` : `电影 · ${u.work.year}`
}

export function subtitle(u: Unit) {
  return u.kind === "episode" ? displayTitle(u.episode) : u.work.titleEn
}

export function overview(u: Unit) {
  const x = u.kind === "episode" ? u.episode : u.work
  return x.overviewZh ?? x.overviewEn
}

export function poster(u: Unit) {
  return unitPoster(u)
}

export function watchHref(u: Unit) {
  return `/watch/${u.id}`
}

export function pickHref(u: Unit) {
  return u.kind === "episode" ? `/title/${u.work.slug}?season=${u.episode.season}` : `/title/${u.work.slug}`
}

export function fraction(item: QueueItem) {
  return item.progress ? item.progress.positionSec / item.progress.durationSec : 0
}

export function minutesLeft(item: QueueItem) {
  const p = item.progress
  if (!p || item.reason === "next") return item.unit.runtimeMin
  return Math.max(1, Math.round((p.durationSec - p.positionSec) / 60))
}

export function playLabel(item: QueueItem) {
  return item.reason === "next" ? "播放下一集" : "继续播放"
}

function clock(sec: number) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

export function timecode(item: QueueItem) {
  const total = item.progress?.durationSec ?? item.unit.runtimeMin * 60
  const pos = item.reason === "next" ? 0 : (item.progress?.positionSec ?? 0)
  return `${clock(pos)} / ${clock(total)}`
}

export function ago(ts: number | undefined) {
  if (!ts) return ""
  const min = (Date.now() - ts) / 60_000
  if (min < 5) return "刚刚"
  if (min < 60) return `${Math.round(min)} 分钟前`
  const h = min / 60
  if (h < 24) return `${Math.round(h)} 小时前`
  if (h < 48) return "昨天"
  return `${Math.round(h / 24)} 天前`
}
