import assert from "node:assert/strict"
import { test } from "node:test"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createHash, randomUUID } from "node:crypto"
import { Script, createContext } from "node:vm"
import { setImmediate } from "node:timers/promises"

const scriptPath = fileURLToPath(new URL("./fetch-episode-stills.mjs", import.meta.url))
const source = (await fs.readFile(scriptPath, "utf8"))
  .replace(/^import .*\r?\n/gm, "")
  .replaceAll("import.meta.url", "scriptUrl")
const script = new Script(`(async () => {\n${source}\n})()`, { filename: scriptPath })
const oldManifest = "previous manifest\n"
const oldImage = "previous image"

function episode(number, overrides = {}) {
  return {
    tmdbId: 253,
    season: 1,
    episode: number,
    file: `tos-s01e${String(number).padStart(2, "0")}.webp`,
    sourceUrl: `https://media.themoviedb.org/t/p/w300/test-${number}.jpg`,
    sourcePage: "https://www.themoviedb.org/tv/253-test/season/1",
    ...overrides,
  }
}

function catalogFor(episodes) {
  const series = []
  for (const ep of episodes) {
    let show = series.find(item => item.tmdbId === ep.tmdbId)
    if (!show) series.push(show = { tmdbId: ep.tmdbId, seasons: [] })
    let season = show.seasons.find(item => item.number === ep.season)
    if (!season) show.seasons.push(season = { number: ep.season, episodes: [] })
    season.episodes.push({ number: ep.episode })
  }
  return { series }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function fixture(t, episodes, catalog = catalogFor(episodes)) {
  const directory = await fs.mkdtemp(join(tmpdir(), "episode-stills-test-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const target = join(directory, "public/assets/stills/star-trek")
  const raw = join(directory, "assets-raw/episode-stills")
  const catalogPath = join(directory, "prototypes/frontend-v1/src/data/tmdb.json")
  const manifest = join(target, "manifest.json")
  await fs.mkdir(dirname(catalogPath), { recursive: true })
  await fs.mkdir(target, { recursive: true })
  await fs.mkdir(raw, { recursive: true })
  await fs.writeFile(catalogPath, JSON.stringify(catalog))
  await fs.writeFile(join(raw, "sources.json"), JSON.stringify(episodes))
  await fs.writeFile(manifest, oldManifest)
  for (const ep of episodes.filter(item => item.file)) {
    await fs.writeFile(join(target, ep.file), oldImage)
  }

  const mutations = []
  const commands = []
  function checkPath(path) {
    const absolute = resolve(path)
    assert.ok(absolute === directory || absolute.startsWith(`${directory}${sep}`), `Outside fixture: ${absolute}`)
  }
  function run({ execute, filesystem = {} } = {}) {
    const bindings = {}
    for (const name of ["readFile", "writeFile", "mkdir", "rm", "stat", "rename"]) {
      bindings[name] = async (...args) => {
        checkPath(args[0])
        if (name === "rename") checkPath(args[1])
        if (!["readFile", "stat"].includes(name)) mutations.push({ name, path: args[0], destination: args[1] })
        return (filesystem[name] ?? fs[name])(...args)
      }
    }
    const exec = async (command, args) => {
      assert.ok(["curl.exe", "ffmpeg"].includes(command), `Unexpected command: ${command}`)
      const output = command === "curl.exe" ? args[args.indexOf("-o") + 1] : args.at(-1)
      checkPath(output)
      commands.push({ command, args, output })
      if (execute) return execute(command, args, output)
      if (command === "curl.exe") {
        const url = args[args.indexOf("-o") - 1]
        assert.match(url, /\/t\/p\/w300\//)
        await fs.writeFile(output, `raw:${url}`)
      } else {
        const input = args[args.indexOf("-i") + 1]
        checkPath(input)
        assert.ok(output.endsWith(".webp"))
        await fs.writeFile(output, `webp:${await fs.readFile(input, "utf8")}`)
      }
      return { stdout: "", stderr: "" }
    }
    const context = createContext({
      ...bindings,
      tmpdir, resolve, dirname, join, fileURLToPath, randomUUID, createHash,
      scriptUrl: pathToFileURL(join(directory, "prototypes/frontend-v1/scripts/fetch-episode-stills.mjs")).href,
      process: { env: {}, argv: ["node", scriptPath, "--compress"] },
      console: { log() {} },
      execFile() { throw new Error("External execution is disabled") },
      promisify: () => exec,
    })
    return script.runInContext(context)
  }
  async function assertNoTemporaryFiles() {
    for (const path of [target, raw]) {
      assert.deepEqual((await fs.readdir(path)).filter(name => /\.(tmp|download)(\.|$)/.test(name)), [])
    }
  }
  return { directory, target, raw, manifest, run, commands, mutations, assertNoTemporaryFiles }
}

const complete = [episode(1), episode(2)]
const invalidSources = [
  ["partial sources", [complete[0]], /Missing source episodes/],
  ["duplicate replacing a missing episode", [complete[0], complete[0]], /Duplicate source episode/],
  ["extra duplicate", [...complete, complete[0]], /Duplicate source episode/],
  ["unknown episode", [complete[0], episode(3)], /Unknown source episode/],
  ["extra unknown episode", [...complete, episode(3)], /Unknown source episode/],
  ["unknown season", [complete[0], episode(2, { season: 2 })], /Unknown source episode/],
  ["unknown series", [complete[0], episode(2, { tmdbId: 1992 })], /Unknown source episode/],
  ["string identifier", [complete[0], episode(2, { tmdbId: "253" })], /Unknown source episode/],
  ["non-array sources", {}, /Sources must be an array/],
]

for (const [name, records, message] of invalidSources) {
  test(`--compress rejects ${name} before any mutation`, async t => {
    const state = await fixture(t, complete)
    await fs.writeFile(join(state.raw, "sources.json"), JSON.stringify(records))
    await assert.rejects(state.run(), message)
    assert.deepEqual(state.commands, [])
    assert.deepEqual(state.mutations, [])
    assert.equal(await fs.readFile(state.manifest, "utf8"), oldManifest)
    assert.equal(await fs.readFile(join(state.target, complete[0].file), "utf8"), oldImage)
  })
}

test("--compress publishes the exact catalog set with missing-image records and arbitrary ordering", async t => {
  const episodes = [episode(1), episode(1, { season: 2, file: null, sourceUrl: null }), episode(1, { tmdbId: 1992, file: null, sourceUrl: null })]
  const records = [...episodes].reverse()
  const state = await fixture(t, records, catalogFor(episodes))
  await state.run()
  const manifest = JSON.parse(await fs.readFile(state.manifest, "utf8"))
  assert.deepEqual(manifest, { version: 1, width: 240, height: 135, quality: 55, episodes: records })
  assert.equal(state.commands.filter(item => item.command === "ffmpeg").length, 1)
  assert.ok(state.commands.every(item => item.output !== join(state.target, episodes[0].file)))
  assert.ok(state.mutations.filter(item => item.name === "writeFile").every(item => item.path !== state.manifest))
  const replacements = state.mutations.filter(item => item.name === "rename" && item.destination === state.manifest)
  assert.equal(replacements.length, 1)
  assert.notEqual(replacements[0].path, state.manifest)
  await state.assertNoTemporaryFiles()
})

test("raw cache follows sourceUrl changes and reuses unchanged hashed originals", async t => {
  const ep = episode(1)
  const state = await fixture(t, [ep])
  await fs.writeFile(join(state.raw, ep.file.replace(/\.webp$/, "-w300.jpg")), "legacy stale image")
  await state.run()
  await state.run()
  assert.equal(state.commands.filter(item => item.command === "curl.exe").length, 1)
  const changed = { ...ep, sourceUrl: "https://media.themoviedb.org/t/p/w300/replacement.jpg" }
  await fs.writeFile(join(state.raw, "sources.json"), JSON.stringify([changed]))
  await state.run()
  const downloads = state.commands.filter(item => item.command === "curl.exe")
  assert.equal(downloads.length, 2)
  assert.notEqual(downloads[0].output, downloads[1].output)
  const originals = state.commands.filter(item => item.command === "ffmpeg").map(item => item.args[item.args.indexOf("-i") + 1])
  assert.equal(originals[0], originals[1])
  assert.notEqual(originals[0], originals[2])
  assert.equal(await fs.readFile(join(state.target, ep.file), "utf8"), `webp:raw:${changed.sourceUrl}`)
  assert.equal(await fs.readFile(join(state.raw, ep.file.replace(/\.webp$/, "-w300.jpg")), "utf8"), "legacy stale image")
  await state.assertNoTemporaryFiles()
})

test("failed download preserves published files and removes its partial temporary file", async t => {
  const ep = episode(1)
  const state = await fixture(t, [ep])
  await assert.rejects(state.run({
    execute: async (command, args, output) => {
      assert.equal(command, "curl.exe")
      await fs.writeFile(output, "partial download")
      throw new Error("download failed")
    },
  }), /download failed/)
  assert.equal(await fs.readFile(join(state.target, ep.file), "utf8"), oldImage)
  assert.equal(await fs.readFile(state.manifest, "utf8"), oldManifest)
  assert.deepEqual(await fs.readdir(state.raw), ["sources.json"])
  await state.assertNoTemporaryFiles()
})

test("ffmpeg failure cannot truncate the previously published WebP or manifest", async t => {
  const ep = episode(1)
  const state = await fixture(t, [ep])
  await assert.rejects(state.run({
    execute: async (command, args, output) => {
      await fs.writeFile(output, "partial output")
      if (command === "ffmpeg") throw new Error("encoder failed")
      return { stdout: "", stderr: "" }
    },
  }), /encoder failed/)
  assert.equal(await fs.readFile(join(state.target, ep.file), "utf8"), oldImage)
  assert.equal(await fs.readFile(state.manifest, "utf8"), oldManifest)
  await state.assertNoTemporaryFiles()
})

test("failed WebP rename preserves the old image and cleans the encoded temporary file", async t => {
  const ep = episode(1)
  const state = await fixture(t, [ep])
  await assert.rejects(state.run({
    filesystem: {
      rename: async (from, to) => {
        if (to === join(state.target, ep.file)) throw new Error("image rename failed")
        return fs.rename(from, to)
      },
    },
  }), /image rename failed/)
  assert.equal(await fs.readFile(join(state.target, ep.file), "utf8"), oldImage)
  assert.equal(await fs.readFile(state.manifest, "utf8"), oldManifest)
  await state.assertNoTemporaryFiles()
})

test("failed manifest write leaves the previous manifest intact and cleans partial JSON", async t => {
  const state = await fixture(t, [episode(1)])
  await assert.rejects(state.run({
    filesystem: {
      writeFile: async (path, contents) => {
        assert.notEqual(path, state.manifest)
        await fs.writeFile(path, contents.slice(0, 8))
        throw new Error("manifest write failed")
      },
    },
  }), /manifest write failed/)
  assert.equal(await fs.readFile(state.manifest, "utf8"), oldManifest)
  await state.assertNoTemporaryFiles()
})

test("manifest is complete before rename and a failed rename preserves its previous version", async t => {
  const records = [episode(1)]
  const state = await fixture(t, records)
  await assert.rejects(state.run({
    filesystem: {
      rename: async (from, to) => {
        if (to === state.manifest) {
          assert.equal(await fs.readFile(to, "utf8"), oldManifest)
          assert.deepEqual(JSON.parse(await fs.readFile(from, "utf8")).episodes, records)
          throw new Error("manifest rename failed")
        }
        return fs.rename(from, to)
      },
    },
  }), /manifest rename failed/)
  assert.equal(await fs.readFile(state.manifest, "utf8"), oldManifest)
  await state.assertNoTemporaryFiles()
})

test("worker failures stop new work and wait for every active worker before returning", async t => {
  const episodes = Array.from({ length: 6 }, (_, index) => episode(index + 1))
  const state = await fixture(t, episodes)
  const allStarted = deferred()
  const failureCleaned = deferred()
  const release = deferred()
  const started = []
  let settled = false
  let active = 0
  const running = state.run({
    execute: async (command, args, output) => {
      if (command === "curl.exe") {
        await fs.writeFile(output, "raw image")
        return { stdout: "", stderr: "" }
      }
      active++
      started.push(output)
      if (started.length === 4) allStarted.resolve()
      try {
        await fs.writeFile(output, "encoded image")
        if (output.startsWith(join(state.target, episodes[0].file))) {
          await allStarted.promise
          throw new Error("first worker failed")
        }
        await release.promise
        if (output.startsWith(join(state.target, episodes[1].file))) throw new Error("second worker failed")
        return { stdout: "", stderr: "" }
      } finally { active-- }
    },
    filesystem: {
      rm: async (path, options) => {
        await fs.rm(path, options)
        if (path.startsWith(join(state.target, episodes[0].file))) failureCleaned.resolve()
      },
    },
  }).then(
    () => { settled = true; return null },
    error => { settled = true; return error },
  )
  try {
    await failureCleaned.promise
    await setImmediate()
    assert.equal(settled, false)
    assert.equal(active, 3)
    assert.equal(started.length, 4)
  } finally { release.resolve() }
  const error = await running
  assert.match(error.message, /first worker failed/)
  assert.equal(active, 0)
  assert.equal(started.length, 4)
  assert.equal(await fs.readFile(state.manifest, "utf8"), oldManifest)
  assert.equal(await fs.readFile(join(state.target, episodes[0].file), "utf8"), oldImage)
  assert.equal(await fs.readFile(join(state.target, episodes[1].file), "utf8"), oldImage)
  assert.equal(await fs.readFile(join(state.target, episodes[4].file), "utf8"), oldImage)
  await state.assertNoTemporaryFiles()
})
