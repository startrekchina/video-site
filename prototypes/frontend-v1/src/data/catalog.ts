// Catalog derived from the real poster manifest. Episode data is synthetic:
// in production it comes from TMDB via the offline import tool.
import manifest from "../../../../public/assets/posters/star-trek/manifest.json"

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
}

export type Season = {
  number: number
  poster: string
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

const SERIES_META: Record<string, { code: string; counts: number[]; runtime: number; zh: string; en: string }> = {
  "star-trek-the-original-series": {
    code: "TOS",
    counts: [29, 26, 24],
    runtime: 50,
    zh: "23 世纪，詹姆斯·T·柯克舰长指挥联邦星舰企业号展开五年探索任务，与斯波克、麦考伊一同探寻未知的世界与新文明。",
    en: "Captain James T. Kirk and the crew of the USS Enterprise embark on a five-year mission to explore strange new worlds.",
  },
  "star-trek-the-animated-series": {
    code: "TAS",
    counts: [16, 6],
    runtime: 24,
    zh: "原初系列原班人马以动画形式继续企业号的探索之旅。",
    en: "The original crew of the Enterprise continues their voyages in animated form.",
  },
  "star-trek-the-next-generation": {
    code: "TNG",
    counts: [26, 22, 26, 26, 26, 26, 26],
    runtime: 45,
    zh: "原初系列约一百年后，让-吕克·皮卡德舰长率领企业号 D 继续深入太空，探索人性、外交与未知。",
    en: "A century after Kirk, Captain Jean-Luc Picard leads the Enterprise-D into deep space.",
  },
  "star-trek-deep-space-nine": {
    code: "DS9",
    counts: [20, 26, 26, 26, 26, 26, 26],
    runtime: 45,
    zh: "本杰明·西斯科指挥位于贝久星附近的空间站深空九号，守护通往伽马象限的虫洞。",
    en: "Commander Benjamin Sisko takes command of a space station near a stable wormhole to the Gamma Quadrant.",
  },
  "star-trek-voyager": {
    code: "VOY",
    counts: [16, 26, 26, 26, 26, 26, 26],
    runtime: 45,
    zh: "航海家号被卷入德尔塔象限，距家七万光年。凯瑟琳·珍妮薇舰长必须带领船员踏上漫长的归途。",
    en: "Stranded 70,000 light-years from home, Captain Kathryn Janeway leads Voyager on the long journey back.",
  },
  "star-trek-enterprise": {
    code: "ENT",
    counts: [26, 26, 24, 22],
    runtime: 45,
    zh: "联邦成立之前，乔纳森·阿彻舰长驾驶地球第一艘曲速五级星舰进取号，开启人类的深空探索。",
    en: "Before the Federation, Captain Jonathan Archer commands Earth's first warp-five starship.",
  },
  "star-trek-discovery": {
    code: "DIS",
    counts: [15, 14, 13, 13, 10],
    runtime: 50,
    zh: "迈克尔·伯纳姆与发现号的船员穿越时空与宇宙，面对一次又一次的危机。",
    en: "Michael Burnham and the crew of the USS Discovery face crises across time and space.",
  },
  "star-trek-short-treks": {
    code: "ST",
    counts: [4, 6],
    runtime: 15,
    zh: "一组独立成篇的短篇故事，从新的视角探索星际迷航宇宙。",
    en: "Standalone short stories exploring corners of the Star Trek universe.",
  },
  "star-trek-lower-decks": {
    code: "LD",
    counts: [10, 10, 10, 10, 10],
    runtime: 25,
    zh: "塞里托斯号上一群不起眼的下层舰员，在一艘并不重要的星舰上过着并不轻松的日子。",
    en: "The support crew of one of Starfleet's least important ships.",
  },
  "star-trek-picard": {
    code: "PIC",
    counts: [10, 10, 10],
    runtime: 50,
    zh: "退役多年的皮卡德再度踏上旅程，面对过去的遗憾与新的威胁。",
    en: "Jean-Luc Picard steps back into the stars to confront his past and a new threat.",
  },
  "star-trek-prodigy": {
    code: "PRO",
    counts: [20, 20],
    runtime: 25,
    zh: "一群年轻的外星人发现一艘废弃的星舰，并在航行中学会成为星际舰队的一员。",
    en: "A group of young aliens find an abandoned starship and learn what Starfleet means.",
  },
  "star-trek-strange-new-worlds": {
    code: "SNW",
    counts: [10, 10, 10, 10],
    runtime: 50,
    zh: "克里斯托弗·派克舰长、斯波克与第一官一号在企业号上的探索岁月。",
    en: "Captain Christopher Pike, Spock and Number One aboard the USS Enterprise.",
  },
  "star-trek-starfleet-academy": {
    code: "SFA",
    counts: [10],
    runtime: 45,
    zh: "新一代学员来到星际舰队学院，在动荡的时代中学习成为军官。",
    en: "A new class of cadets comes of age at Starfleet Academy.",
  },
}

const MOVIE_META: Record<string, { runtime: number; zh: string | null; en: string }> = {
  "star-trek-the-motion-picture": { runtime: 132, zh: "一团神秘的巨大能量云逼近地球，柯克重返企业号舰长之位迎击。", en: "An alien cloud of immense power heads for Earth." },
  "star-trek-ii-the-wrath-of-khan": { runtime: 113, zh: "流放多年的可汗重获自由，向柯克展开复仇。", en: "Khan escapes exile and seeks revenge on Admiral Kirk." },
  "star-trek-iii-the-search-for-spock": { runtime: 105, zh: "柯克违抗命令，冒险前往创世星寻找斯波克。", en: "Kirk defies orders to search for Spock on the Genesis planet." },
  "star-trek-iv-the-voyage-home": { runtime: 119, zh: "为拯救未来的地球，船员们回到 20 世纪寻找座头鲸。", en: "The crew travels back to 1986 San Francisco to find humpback whales." },
  "star-trek-v-the-final-frontier": { runtime: 107, zh: "一名瓦肯叛逆者劫持企业号，前往银河中心寻找神。", en: "A renegade Vulcan hijacks the Enterprise in search of God." },
  "star-trek-vi-the-undiscovered-country": { runtime: 113, zh: "克林贡帝国寻求和平之际，柯克被卷入一场暗杀阴谋。", en: "As the Klingon Empire seeks peace, Kirk is framed for assassination." },
  "star-trek-generations": { runtime: 118, zh: "皮卡德与柯克跨越时空并肩作战，阻止一场毁灭性的计划。", en: "Picard teams up with Kirk to stop a madman." },
  "star-trek-first-contact": { runtime: 111, zh: "博格人回到过去企图阻止人类的第一次接触，皮卡德率众追击。", en: "The Borg travel back in time to prevent humanity's first contact." },
  "star-trek-insurrection": { runtime: 103, zh: "皮卡德违抗星际舰队，保护一个与世无争的星球。", en: "Picard defies Starfleet to protect a peaceful planet." },
  "star-trek-nemesis": { runtime: 116, zh: "罗慕兰新任执政官与皮卡德之间隐藏着惊人的联系。", en: "A new Romulan leader has a startling connection to Picard." },
  "star-trek": { runtime: 127, zh: "年轻的柯克与斯波克在一条新的时间线上相遇。", en: "Young Kirk and Spock meet in an alternate timeline." },
  "star-trek-into-darkness": { runtime: 132, zh: "一名来自星际舰队内部的恐怖分子让企业号陷入危机。", en: "The Enterprise hunts a terrorist from within Starfleet." },
  "star-trek-beyond": { runtime: 122, zh: "企业号在未知星云中遭遇伏击，船员们被困于陌生星球。", en: "The Enterprise crew is stranded on a remote planet." },
  // Deliberately missing Chinese overview, to exercise the English fallback.
  "star-trek-section-31": { runtime: 115, zh: null, en: "Emperor Philippa Georgiou joins a secret division of Starfleet." },
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

// Deterministic pseudo-random so the mock data is stable across reloads.
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

function makeEpisodes(slug: string, code: string, season: number, count: number, runtime: number): Episode[] {
  return Array.from({ length: count }, (_, i) => {
    const number = i + 1
    const id = `${code.toLowerCase()}-s${pad(season)}e${pad(number)}`
    // About one in eight episodes lacks Chinese metadata, like real TMDB data.
    const missingZh = hash(id) < 0.125
    return {
      id,
      workSlug: slug,
      season,
      number,
      titleZh: missingZh ? null : `第 ${number} 集（示例标题）`,
      titleEn: `Episode ${number} (sample title)`,
      overviewZh: missingZh ? null : "这是原型中的示例简介，正式数据由导入工具从 TMDB 拉取中英文标题和简介。",
      overviewEn: "Placeholder overview. Real titles and overviews are fetched from TMDB by the import tool.",
      runtimeMin: runtime + Math.round((hash(id + "rt") - 0.5) * 8),
    }
  })
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
      const meta = MOVIE_META[slug]
      return { ...base, code: "", overviewZh: meta.zh, overviewEn: meta.en, runtimeMin: meta.runtime, unitId: `movie-${slug}`, seasons: [] }
    }
    const meta = SERIES_META[slug]
    const seasons = manifest
      .filter((e) => e.kind === "series" && e.season !== null && slugOf(e) === slug)
      .sort((a, b) => a.season! - b.season!)
      .map((e) => ({
        number: e.season!,
        poster: posterOf(e),
        episodes: makeEpisodes(slug, meta.code, e.season!, meta.counts[e.season! - 1] ?? 10, meta.runtime),
      }))
    return { ...base, code: meta.code, overviewZh: meta.zh, overviewEn: meta.en, seasons }
  })
}

export const WORKS: Work[] = build()
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
