// Fetch bilingual (zh-CN + en-US) metadata from TMDB for every work in the poster
// manifest: movies, series, seasons and episodes. Output: src/data/tmdb.json.
// This simulates what the offline import tool (requirements 6.8) will do.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

// The key stays on the station owner's machine (requirements 6.8); never commit it.
const API_KEY = process.env.TMDB_API_KEY
if (!API_KEY) {
  console.error("Set TMDB_API_KEY in the environment first (the key is not stored in this repo).")
  process.exit(1)
}
const API = "https://api.themoviedb.org/3"

// Node's fetch tries IPv6 first and times out on this network; curl works fine.
// Fetch one URL via curl and parse stdout as JSON.
import { execFile } from "node:child_process"
function curlJson(url) {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      ["-sS", "-4", "-m", "30", "-w", "\n%{http_code}", url],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`curl failed: ${stderr || err.message}`))
        const nl = stdout.lastIndexOf("\n")
        const status = Number(stdout.slice(nl + 1))
        resolve({ status, body: stdout.slice(0, nl) })
      },
    )
  })
}
const root = import.meta.dirname
const manifestPath = path.resolve(root, "../../../public/assets/posters/star-trek/manifest.json")
const outPath = path.resolve(root, "../src/data/tmdb.json")

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

const movieIds = [...new Set(manifest.filter((e) => e.kind === "movie").map((e) => e.tmdb_id))]
const seriesIds = [...new Set(manifest.filter((e) => e.kind === "series").map((e) => e.tmdb_id))]
// Seasons per series, per the manifest (posters were picked for these seasons).
const manifestSeasons = new Map()
for (const e of manifest) {
  if (e.kind === "series" && e.season !== null) {
    if (!manifestSeasons.has(e.tmdb_id)) manifestSeasons.set(e.tmdb_id, new Set())
    manifestSeasons.get(e.tmdb_id).add(e.season)
  }
}

let fetched = 0
async function tmdb(pathname) {
  const sep = pathname.includes("?") ? "&" : "?"
  const url = `${API}${pathname}${sep}api_key=${API_KEY}`
  for (let attempt = 1; attempt <= 5; attempt++) {
    let status, body
    try {
      ;({ status, body } = await curlJson(url))
    } catch (err) {
      // Transient network failure (TLS reset, timeout): back off and retry.
      const wait = 1500 * attempt
      console.warn(`${err.message} on ${pathname}, retry in ${wait}ms (attempt ${attempt})`)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    if (status === 200) {
      fetched++
      return JSON.parse(body)
    }
    if (status === 404) {
      console.warn(`404: ${pathname}`)
      return null
    }
    const wait = 1500 * attempt
    console.warn(`TMDB ${status} on ${pathname}, retry in ${wait}ms (attempt ${attempt})`)
    await new Promise((r) => setTimeout(r, wait))
  }
  throw new Error(`TMDB gave up on ${pathname} after retries`)
}

const clean = (s) => (typeof s === "string" && s.trim() ? s.trim() : null)

function pickBilingual(zh, en, fields) {
  const out = {}
  for (const f of fields) out[f] = { zh: clean(zh?.[f]), en: clean(en?.[f]) }
  return out
}

const movies = []
for (const id of movieIds) {
  const [zh, en] = await Promise.all([
    tmdb(`/movie/${id}?language=zh-CN`),
    tmdb(`/movie/${id}?language=en-US`),
  ])
  if (!en) throw new Error(`movie ${id} missing on TMDB`)
  movies.push({
    tmdbId: id,
    ...pickBilingual(zh, en, ["title", "overview"]),
    releaseDate: en.release_date || null,
    runtimeMin: en.runtime || null,
    voteAverage: en.vote_average ?? null,
  })
  console.log(`movie ${id} ${en.title}`)
}

const series = []
for (const id of seriesIds) {
  const [zh, en] = await Promise.all([
    tmdb(`/tv/${id}?language=zh-CN`),
    tmdb(`/tv/${id}?language=en-US`),
  ])
  if (!en) throw new Error(`series ${id} missing on TMDB`)
  const wanted = manifestSeasons.get(id)
  const tmdbSeasons = (en.seasons ?? []).filter((s) => s.season_number > 0)
  const tmdbSet = new Set(tmdbSeasons.map((s) => s.season_number))
  for (const n of wanted) {
    if (!tmdbSet.has(n)) console.warn(`series ${id}: manifest season ${n} not on TMDB`)
  }
  const seasons = []
  for (const s of tmdbSeasons) {
    const n = s.season_number
    const [sZh, sEn] = await Promise.all([
      tmdb(`/tv/${id}/season/${n}?language=zh-CN`),
      tmdb(`/tv/${id}/season/${n}?language=en-US`),
    ])
    if (!sEn) continue
    const episodes = (sEn.episodes ?? []).map((ep, i) => {
      const epZh = sZh?.episodes?.find((e) => e.episode_number === ep.episode_number) ?? sZh?.episodes?.[i]
      return {
        number: ep.episode_number,
        ...pickBilingual(epZh, ep, ["name", "overview"]),
        runtimeMin: ep.runtime ?? null,
        airDate: ep.air_date || null,
      }
    })
    if (!wanted.has(n)) console.warn(`series ${id}: TMDB season ${n} has no poster in the manifest`)
    seasons.push({
      number: n,
      inManifest: wanted.has(n),
      ...pickBilingual(sZh, sEn, ["name", "overview"]),
      airDate: sEn.air_date || null,
      episodes,
    })
    console.log(`tv ${id} ${en.name} S${String(n).padStart(2, "0")} (${episodes.length} eps)`)
  }
  series.push({
    tmdbId: id,
    ...pickBilingual(zh, en, ["name", "overview"]),
    firstAirDate: en.first_air_date || null,
    status: en.status ?? null,
    voteAverage: en.vote_average ?? null,
    seasons,
  })
}

const episodeTotal = series.reduce((n, s) => n + s.seasons.reduce((m, x) => m + x.episodes.length, 0), 0)
const payload = {
  fetchedAt: new Date().toISOString(),
  source: "TMDB API v3 (zh-CN + en-US)",
  movies,
  series,
}
mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n")
console.log(
  `\nFetched ${fetched} endpoints -> ${path.relative(process.cwd(), outPath)}`,
  `\nMovies: ${movies.length}, series: ${series.length}, seasons: ${series.reduce((n, s) => n + s.seasons.length, 0)}, episodes: ${episodeTotal}`,
)
