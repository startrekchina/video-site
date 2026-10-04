import { readFile, writeFile, mkdir, rm, stat, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID, createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const target = join(root, "public/assets/stills/star-trek")
const raw = join(root, "assets-raw/episode-stills")
const session = process.env.WEBBRIDGE_SESSION ?? "episode-stills-20261003"
const bridge = process.env.WEBBRIDGE_URL ?? "http://127.0.0.1:10086"
const pad = (n) => String(n).padStart(2, "0")
const codes = {253:"tos",1992:"tas",655:"tng",580:"ds9",1855:"voy",314:"ent",67198:"dis",82491:"st",85948:"ld",85949:"pic",106393:"pro",103516:"snw",223530:"sfa"}

async function command(action, args) {
  const path = join(tmpdir(), `webbridge-stills-${randomUUID()}.json`)
  await writeFile(path, JSON.stringify({action,args,session}))
  try {
    const {stdout} = await exec("curl.exe", ["-sS", "--max-time", "180", "-X", "POST", `${bridge}/command`, "-H", "Content-Type: application/json", "--data-binary", `@${path}`], {maxBuffer: 8 * 1024 * 1024, timeout:190000})
    const reply = JSON.parse(stdout)
    if (!reply.ok) throw new Error(JSON.stringify(reply.error))
    return reply.data
  } finally { await rm(path, {force:true}) }
}

async function collect() {
  const catalog = JSON.parse(await readFile(join(root,"prototypes/frontend-v1/src/data/tmdb.json"),"utf8"))
  const posters = JSON.parse(await readFile(join(root,"public/assets/posters/star-trek/manifest.json"),"utf8"))
  let cached = []
  try { cached = JSON.parse(await readFile(join(raw,"sources.json"),"utf8")) } catch (error) { if (error.code !== "ENOENT") throw error }
  const episodes = []
  for (const series of catalog.series) {
    const main = posters.find(p=>p.kind === "series" && p.season === null && p.tmdb_id === series.tmdbId)
    if (!main) throw new Error(`No poster entry for ${series.tmdbId}`)
    const slug = main.file.replace(/^series-\d{4}-/, "").replace(/\.jpg$/, "")
    const code = codes[series.tmdbId]
    if (!code) throw new Error(`No series code for ${series.tmdbId}`)
    for (const season of series.seasons) {
      const saved = cached.filter(e=>e.tmdbId === series.tmdbId && e.season === season.number)
      if (saved.length === season.episodes.length && season.episodes.every(e=>saved.some(s=>s.episode === e.number))) {
        episodes.push(...saved)
        console.log(`${code} S${pad(season.number)}: reused ${saved.length} source records`)
        continue
      }
      const sourcePage = `https://www.themoviedb.org/tv/${series.tmdbId}-${slug}/season/${season.number}`
      const result = await command("evaluate", {code:`(async () => {const response=await fetch(${JSON.stringify(sourcePage)});if(!response.ok)throw new Error('HTTP '+response.status);const doc=new DOMParser().parseFromString(await response.text(),'text/html');return JSON.stringify({url:response.url,episodes:Array.from(doc.querySelectorAll('.episode .image a[data-episode-number]')).map(a=>({season:Number(a.dataset.seasonNumber),episode:Number(a.dataset.episodeNumber),src:a.querySelector('img.backdrop')?.getAttribute('src')??null}))})})()`})
      const data = JSON.parse(result.value)
      if (!data.episodes.length && season.episodes.length) throw new Error(`No episode cards on ${sourcePage}`)
      for (const ep of season.episodes) {
        const found = data.episodes.find(e=>e.season === season.number && e.episode === ep.number)
        if (!found) throw new Error(`Missing episode card ${series.tmdbId} S${season.number}E${ep.number}`)
        const sourceUrl = found.src?.startsWith("https://media.themoviedb.org/t/p/") ? found.src.replace(/\/t\/p\/[^/]+\//, "/t/p/w300/") : null
        episodes.push({tmdbId:series.tmdbId,season:season.number,episode:ep.number,file:sourceUrl?`${code}-s${pad(season.number)}e${pad(ep.number)}.webp`:null,sourceUrl,sourcePage:data.url})
      }
      console.log(`${code} S${pad(season.number)}: ${season.episodes.length} episodes, ${data.episodes.filter(e=>e.src).length} stills`)
      await mkdir(raw,{recursive:true})
      await writeFile(join(raw,"sources.json"),JSON.stringify(episodes,null,2)+"\n")
      await new Promise(r=>setTimeout(r,350))
    }
  }
  return episodes
}

function validateSources(episodes, catalog) {
  if (!Array.isArray(episodes)) throw new Error("Sources must be an array")
  const key = ep => JSON.stringify([ep?.tmdbId, ep?.season, ep?.episode])
  const expected = new Set(catalog.series.flatMap(series => series.seasons.flatMap(season => season.episodes.map(ep => key({tmdbId:series.tmdbId,season:season.number,episode:ep.number})))))
  const seen = new Set()
  for (const ep of episodes) {
    const id = key(ep)
    if (!expected.has(id)) throw new Error(`Unknown source episode ${id}`)
    if (seen.has(id)) throw new Error(`Duplicate source episode ${id}`)
    seen.add(id)
  }
  const missing = [...expected].filter(id => !seen.has(id))
  if (missing.length) throw new Error(`Missing source episodes: ${missing.slice(0,5).join(", ")} (${missing.length} total)`)
}

async function writeAtomic(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, contents)
    await rename(temporary, path)
  } finally { await rm(temporary,{force:true}) }
}

async function compress(episodes) {
  const catalog = JSON.parse(await readFile(join(root,"prototypes/frontend-v1/src/data/tmdb.json"),"utf8"))
  validateSources(episodes, catalog)
  await mkdir(target,{recursive:true})
  await mkdir(raw,{recursive:true})
  let next = 0
  let done = 0
  let failed = false
  async function worker() {
    try {
      while(!failed && next < episodes.length) {
        const ep = episodes[next++]
        if(!ep.file) continue
        const sourceHash = createHash("sha256").update(ep.sourceUrl).digest("hex")
        const original = join(raw, ep.file.replace(/\.webp$/, `-w300-${sourceHash}.jpg`))
        const output = join(target,ep.file)
        try { const info = await stat(original); if (!info.size) throw new Error("Empty download") } catch {
          const temporary = `${original}.${randomUUID()}.download`
          try {
            await exec("curl.exe",["-4","-fSL","--retry","5","--retry-all-errors","--max-time","45",ep.sourceUrl,"-o",temporary],{timeout:360000})
            await rename(temporary, original)
          } finally { await rm(temporary,{force:true}) }
        }
        const temporary = `${output}.${randomUUID()}.tmp.webp`
        try {
          await exec("ffmpeg",["-hide_banner","-loglevel","error","-y","-i",original,"-vf","scale=240:135:force_original_aspect_ratio=decrease,format=rgba,pad=240:135:(ow-iw)/2:(oh-ih)/2,setsar=1","-frames:v","1","-c:v","libwebp","-quality","55","-compression_level","6",temporary],{timeout:60000})
          await rename(temporary, output)
        } finally { await rm(temporary,{force:true}) }
        done++
        if(done%50===0) console.log(`Compressed ${done} stills`)
      }
    } catch (error) {
      failed = true
      throw error
    }
  }
  const results = await Promise.allSettled(Array.from({length:4},worker))
  const rejected = results.find(result => result.status === "rejected")
  if (rejected) throw rejected.reason
  const sizes = await Promise.all(episodes.filter(e=>e.file).map(async e=>(await stat(join(target,e.file))).size))
  await writeAtomic(join(target,"manifest.json"),JSON.stringify({version:1,width:240,height:135,quality:55,episodes},null,2)+"\n")
  console.log(JSON.stringify({episodes:episodes.length,images:sizes.length,missing:episodes.length-sizes.length,totalBytes:sizes.reduce((a,b)=>a+b,0),averageBytes:Math.round(sizes.reduce((a,b)=>a+b,0)/sizes.length),maxBytes:Math.max(...sizes)}))
}

const mode = process.argv[2] ?? "--all"
if(!["--collect","--compress","--all"].includes(mode)) throw new Error("Usage: node scripts/fetch-episode-stills.mjs [--collect|--compress|--all]")
const episodes = mode === "--compress" ? JSON.parse(await readFile(join(raw,"sources.json"),"utf8")) : await collect()
if(mode !== "--collect") await compress(episodes)
