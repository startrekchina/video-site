import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const stillDir = resolve(root, "../../public/assets/stills/star-trek")
const manifestPath = resolve(stillDir, "manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const tmdb = JSON.parse(readFileSync(resolve(root, "src/data/tmdb.json"), "utf8"))
const catalogPath = resolve(root, "src/data/catalog.ts")

// Run the same TS/TSX modules with the existing compiler, without starting Vite or adding a test dependency.
function loadModule(path, overrides = new Map()) {
  const require = createRequire(path)
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", output)(
    (specifier) => overrides.get(require.resolve(specifier)) ?? require(specifier),
    module,
    module.exports,
  )
  return module.exports
}

const catalog = loadModule(catalogPath)
const { EpisodeStill } = loadModule(resolve(root, "src/components/site/episode-still.tsx"))
const keyOf = (ep) => `${ep.tmdbId}/${ep.season}/${ep.episode}`

function webpDimensions(data) {
  assert.equal(data.toString("ascii", 0, 4), "RIFF")
  assert.equal(data.toString("ascii", 8, 12), "WEBP")
  assert.equal(data.readUInt32LE(4) + 8, data.length)
  for (let offset = 12; offset + 8 <= data.length;) {
    const chunk = data.toString("ascii", offset, offset + 4)
    const length = data.readUInt32LE(offset + 4)
    const start = offset + 8
    assert.ok(start + length <= data.length, "WebP chunk must not be truncated")
    if (chunk === "VP8X") return [data.readUIntLE(start + 4, 3) + 1, data.readUIntLE(start + 7, 3) + 1]
    if (chunk === "VP8 ") {
      assert.equal(data.toString("hex", start + 3, start + 6), "9d012a")
      return [data.readUInt16LE(start + 6) & 0x3fff, data.readUInt16LE(start + 8) & 0x3fff]
    }
    if (chunk === "VP8L") {
      assert.equal(data[start], 0x2f)
      const bits = data.readUInt32LE(start + 1)
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
    }
    offset = start + length + (length % 2)
  }
  assert.fail("WebP must contain image dimensions")
}

test("manifest has one unique, traceable record for every cached episode", () => {
  assert.equal(manifest.version, 1)
  assert.equal(manifest.width, 240)
  assert.equal(manifest.height, 135)
  assert.equal(manifest.quality, 55)
  const expected = tmdb.series.flatMap((work) => work.seasons.flatMap((season) => season.episodes.map((ep) =>
    `${work.tmdbId}/${season.number}/${ep.number}`,
  )))
  const keys = manifest.episodes.map(keyOf)
  assert.equal(new Set(keys).size, keys.length, "Episode keys must be unique")
  assert.deepEqual([...keys].sort(), [...expected].sort())
  for (const ep of manifest.episodes) {
    assert.deepEqual(Object.keys(ep).sort(), ["tmdbId", "season", "episode", "file", "sourceUrl", "sourcePage"].sort())
    const page = new URL(ep.sourcePage)
    assert.equal(page.origin, "https://www.themoviedb.org")
    assert.match(page.pathname, new RegExp(`^/tv/${ep.tmdbId}(?:-[^/]+)?/season/${ep.season}$`))
    assert.equal(page.search, "")
    assert.equal(page.hash, "")
    if (ep.file === null) {
      assert.equal(ep.sourceUrl, null)
      continue
    }
    assert.match(ep.file, /^[a-z0-9]+-s\d{2}e\d{2}\.webp$/)
    const source = new URL(ep.sourceUrl)
    assert.equal(source.origin, "https://media.themoviedb.org")
    assert.match(source.pathname, /^\/t\/p\/w300\/[^/]+\.(?:jpg|png|webp)$/)
    assert.equal(source.search, "")
    assert.equal(source.hash, "")
  }
})

test("all referenced local stills are complete 240×135 WebP files with no orphan images", () => {
  const files = manifest.episodes.flatMap((ep) => ep.file ? [ep.file] : [])
  assert.equal(new Set(files).size, files.length, "Still filenames must be unique")
  assert.deepEqual(readdirSync(stillDir).filter((file) => file.endsWith(".webp")).sort(), [...files].sort())
  for (const file of files) {
    assert.deepEqual(webpDimensions(readFileSync(resolve(stillDir, file))), [240, 135], file)
  }
})

test("catalog matches stills by work TMDB ID, season and episode, never by record order", () => {
  const shuffled = { ...manifest, episodes: [...manifest.episodes].reverse() }
  const { SERIES, EPISODE_TOTAL } = loadModule(catalogPath, new Map([[manifestPath, shuffled]]))
  const records = new Map(manifest.episodes.map((ep) => [keyOf(ep), ep]))
  assert.equal(EPISODE_TOTAL, manifest.episodes.length)
  for (const work of SERIES) {
    for (const season of work.seasons) {
      for (const ep of season.episodes) {
        const record = records.get(`${work.tmdbId}/${season.number}/${ep.number}`)
        assert.ok(record, ep.id)
        assert.equal(ep.still, record.file ? `/assets/stills/star-trek/${record.file}` : null, ep.id)
        if (record.file) assert.equal(record.file, `${ep.id}.webp`)
      }
    }
  }
  for (const work of catalog.MOVIES) assert.deepEqual(work.seasons, [])
})

test("catalog keeps episodes playable when a still is null or its record is missing", () => {
  const work = catalog.SERIES[0]
  const ep = work.seasons[0].episodes[0]
  const key = `${work.tmdbId}/${ep.season}/${ep.number}`
  for (const missingRecord of [false, true]) {
    const episodes = manifest.episodes.flatMap((record) => {
      if (keyOf(record) !== key) return [record]
      return missingRecord ? [] : [{ ...record, file: null, sourceUrl: null }]
    })
    const { getUnit } = loadModule(catalogPath, new Map([[manifestPath, { ...manifest, episodes }]]))
    const unit = getUnit(ep.id)
    assert.equal(unit.kind, "episode")
    assert.equal(unit.episode.still, null)
    assert.equal(unit.episode.titleEn, ep.titleEn)
    assert.equal(unit.runtimeMin, ep.runtimeMin)
  }
})

test("still renders as a decorative, lazy local image inside a stable placeholder", () => {
  const ep = catalog.SERIES.flatMap((work) => work.seasons.flatMap((season) => season.episodes)).find((ep) => ep.still)
  assert.ok(ep, "The asset set must include a still to exercise image rendering")
  const image = renderToStaticMarkup(createElement(EpisodeStill, { src: ep.still }))
  const missing = renderToStaticMarkup(createElement(EpisodeStill, { src: null }))
  const absent = renderToStaticMarkup(createElement(EpisodeStill))
  assert.match(image, /<img[^>]+alt=""/)
  assert.match(image, /loading="lazy"/)
  assert.match(image, /decoding="async"/)
  assert.match(image, /width="240" height="135"/)
  assert.ok(image.includes(`src="${ep.still}"`))
  assert.doesNotMatch(image, /src="(?:https?:|[^\"]*assets\/posters)/)
  assert.equal(image.match(/^<div[^>]*>/)[0], missing.match(/^<div[^>]*>/)[0])
  assert.match(missing, /aria-hidden="true"/)
  assert.doesNotMatch(missing, /<img/)
  assert.equal(absent, missing)
})
