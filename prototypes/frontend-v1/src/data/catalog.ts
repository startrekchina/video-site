// Catalog built from the real poster manifest + real TMDB metadata (tmdb.json,
// fetched by scripts/fetch-tmdb.mjs, zh-CN with en-US fallback). This mirrors
// what the offline import tool (requirements 6.8) will write into D1.
import manifest from "../../../../public/assets/posters/star-trek/manifest.json"
import tmdb from "./tmdb.json"

type ManifestEntry = (typeof manifest)[number]

export type WorkKind = "movie" | "series"

export type Episode = {
  id: string
  workSlug: string
  season: number
  number: number
  titleZh: string | null
  titleEn: string
  overviewZh: string | null
  overviewEn: string
  runtimeMin: number
  airDate: string | null
}

export type Season = {
  number: number
  poster: string
  titleZh: string | null
  titleEn: string
  overviewZh: string | null
  overviewEn: string
  episodes: Episode[]
}

export type Work = {
  slug: string
  kind: WorkKind
  code: string
  year: number
  titleZh: string
  titleEn: string
  overviewZh: string | null
  overviewEn: string
  tmdbId: number
  poster: string
  textFree: boolean
  /** Movies only. */
  runtimeMin?: number
  /** Movies map to exactly one playable unit; this is its id. */
  unitId?: string
  seasons: Season[]
}

const POSTER_DIR = "/assets/posters/star-trek/"

// Short codes (TOS, TNG, …) are fan conventions, not TMDB data.
const SERIES_CODE: Record<string, string> = {
  "star-trek-the-original-series": "TOS",
  "star-trek-the-animated-series": "TAS",
  "star-trek-the-next-generation": "TNG",
  "star-trek-deep-space-nine": "DS9",
  "star-trek-voyager": "VOY",
  "star-trek-enterprise": "ENT",
  "star-trek-discovery": "DIS",
  "star-trek-short-treks": "ST",
  "star-trek-lower-decks": "LD",
  "star-trek-picard": "PIC",
  "star-trek-prodigy": "PRO",
  "star-trek-strange-new-worlds": "SNW",
  "star-trek-starfleet-academy": "SFA",
}

function slugOf(entry: ManifestEntry) {
  return entry.file.replace(/^(movie|series)-\d{4}-/, "").replace(/(-s\d+)?\.jpg$/, "")
}

function posterOf(entry: ManifestEntry) {
  return POSTER_DIR + entry.file.replace(/\.jpg$/, ".webp")
}

function pad(n: number) {
  return String(n).padStart(2, "0")
}

function warn(msg: string) {
  console.warn(`[catalog] ${msg}`)
}

// Some TMDB zh-CN episode titles carry a redundant "第 N 集" prefix in front of the
// real title (e.g. all of Short Treks and Lower Decks S4–S5). The UI already shows
// SxxExx / the episode number, so strip the prefix; if nothing remains, fall back
// to the English title (e.g. DS9 S03E24 is just "第 24 集" on TMDB).
const EP_PREFIX = /^第\s*[0-9零一二三四五六七八九十百千两]+\s*集[：:、.\s\-—·]*/
let strippedTitles = 0
function zhEpisodeTitle(zh: string | null) {
  if (!zh) return null
  const t = zh.replace(EP_PREFIX, "").trim()
  if (t && t !== zh) {
    strippedTitles++
    return t
  }
  if (!t && EP_PREFIX.test(zh)) {
    strippedTitles++
    return null // pure "第 N 集" carries no information; show English instead
  }
  return zh
}

function build(): Work[] {
  const mains = manifest.filter((e) => e.season === null)
  return mains.map((main) => {
    const slug = slugOf(main)
    const base = {
      slug,
      kind: main.kind as WorkKind,
      year: main.year,
      titleZh: main.title_zh,
      titleEn: main.title_en,
      tmdbId: main.tmdb_id,
      poster: posterOf(main),
      textFree: main.text_free,
    }
    if (main.kind === "movie") {
      const m = tmdb.movies.find((x) => x.tmdbId === main.tmdb_id)
      if (!m) throw new Error(`movie ${main.tmdb_id} missing from tmdb.json`)
      if (m.runtimeMin == null) warn(`${slug}: TMDB has no runtime, using 120`)
      return {
        ...base,
        code: "",
        overviewZh: m.overview.zh,
        overviewEn: m.overview.en ?? "",
        runtimeMin: m.runtimeMin ?? 120,
        unitId: `movie-${slug}`,
        seasons: [],
      }
    }
    const s = tmdb.series.find((x) => x.tmdbId === main.tmdb_id)
    if (!s) throw new Error(`series ${main.tmdb_id} missing from tmdb.json`)
    const code = SERIES_CODE[slug] ?? ""
    const posterSeasons = manifest
      .filter((e) => e.kind === "series" && e.season !== null && slugOf(e) === slug)
      .sort((a, b) => a.season! - b.season!)
    const seasons = posterSeasons.map((p) => {
      const t = s.seasons.find((x) => x.number === p.season)
      if (!t) throw new Error(`${slug} season ${p.season} missing from tmdb.json`)
      if (t.episodes.length === 0) warn(`${slug} S${pad(p.season!)}: no episodes on TMDB yet`)
      return {
        number: p.season!,
        poster: posterOf(p),
        titleZh: t.name.zh,
        titleEn: t.name.en ?? "",
        overviewZh: t.overview.zh,
        overviewEn: t.overview.en ?? "",
        episodes: t.episodes.map((ep): Episode => {
          if (ep.runtimeMin == null) warn(`${slug} S${pad(p.season!)}E${pad(ep.number)}: no runtime, using 45`)
          return {
            id: `${code.toLowerCase()}-s${pad(p.season!)}e${pad(ep.number)}`,
            workSlug: slug,
            season: p.season!,
            number: ep.number,
            titleZh: zhEpisodeTitle(ep.name.zh),
            titleEn: ep.name.en ?? "",
            overviewZh: ep.overview.zh,
            overviewEn: ep.overview.en ?? "",
            runtimeMin: ep.runtimeMin ?? 45,
            airDate: ep.airDate,
          }
        }),
      }
    })
    return { ...base, code, overviewZh: s.overview.zh, overviewEn: s.overview.en ?? "", seasons }
  })
}

export const WORKS: Work[] = build()
if (strippedTitles) console.info(`[catalog] stripped "第 N 集" prefix from ${strippedTitles} episode title(s)`)
export const SERIES = WORKS.filter((w) => w.kind === "series")
export const MOVIES = WORKS.filter((w) => w.kind === "movie")

export type Unit =
  | { kind: "movie"; id: string; work: Work; runtimeMin: number }
  | { kind: "episode"; id: string; work: Work; episode: Episode; runtimeMin: number }

const UNITS = new Map<string, Unit>()
for (const work of WORKS) {
  if (work.kind === "movie") UNITS.set(work.unitId!, { kind: "movie", id: work.unitId!, work, runtimeMin: work.runtimeMin! })
  for (const s of work.seasons)
    for (const ep of s.episodes) UNITS.set(ep.id, { kind: "episode", id: ep.id, work, episode: ep, runtimeMin: ep.runtimeMin })
}

export const EPISODE_TOTAL = SERIES.reduce((n, w) => n + w.seasons.reduce((m, s) => m + s.episodes.length, 0), 0)
export const SEASON_TOTAL = SERIES.reduce((n, w) => n + w.seasons.length, 0)

export function getWork(slug: string) {
  return WORKS.find((w) => w.slug === slug)
}

export function getUnit(id: string) {
  return UNITS.get(id)
}

export function nextUnit(id: string): Unit | undefined {
  const u = UNITS.get(id)
  if (!u || u.kind !== "episode") return undefined
  const { work, episode } = u
  const season = work.seasons.find((s) => s.number === episode.season)!
  const next = season.episodes[episode.number] ?? work.seasons.find((s) => s.number === episode.season + 1)?.episodes[0]
  return next ? UNITS.get(next.id) : undefined
}

export function prevUnit(id: string): Unit | undefined {
  const u = UNITS.get(id)
  if (!u || u.kind !== "episode") return undefined
  const { work, episode } = u
  const season = work.seasons.find((s) => s.number === episode.season)!
  const prev = season.episodes[episode.number - 2] ?? work.seasons.find((s) => s.number === episode.season - 1)?.episodes.at(-1)
  return prev ? UNITS.get(prev.id) : undefined
}

export function episodeCode(ep: Episode) {
  return `S${pad(ep.season)}E${pad(ep.number)}`
}

/** Chinese first, English fallback, per requirements 5.3/16. */
export function displayTitle(x: { titleZh: string | null; titleEn: string }) {
  return x.titleZh ?? x.titleEn
}

export function unitTitle(u: Unit) {
  return u.kind === "movie" ? u.work.titleZh : `${u.work.code} ${episodeCode(u.episode)} · ${displayTitle(u.episode)}`
}

export function unitPoster(u: Unit) {
  if (u.kind === "movie") return u.work.poster
  return u.work.seasons.find((s) => s.number === u.episode.season)?.poster ?? u.work.poster
}

export function searchWorks(q: string) {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return WORKS.filter(
    (w) => w.titleZh.toLowerCase().includes(s) || w.titleEn.toLowerCase().includes(s) || w.code.toLowerCase() === s,
  )
}

export function formatRuntime(min: number) {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}
