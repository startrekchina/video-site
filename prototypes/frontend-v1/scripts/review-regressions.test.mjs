import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import test from "node:test"
import ts from "typescript"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
function load(path, overrides = {}) {
  const filename = resolve(root, path)
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    return name.startsWith(".") ? load(resolve(dirname(filename), name + ".ts"), overrides) : require(name)
  }, module, module.exports)
  return module.exports
}

const { expiredJobs, updateSchedule } = load("src/data/backups.ts")
const at = (value) => Date.parse(value + "+08:00")
const schedule = { enabled: true, target: "webdav", frequency: "weekly", weekday: 6, intervalDays: 7, time: "03:00", nextRunAt: at("2026-10-24T03:00"), lastRunAt: at("2026-10-17T03:00") }

test("saving schedules recomputes Beijing daily/weekly times and clears disabled runs", () => {
  const now = at("2026-10-23T12:00")
  assert.equal(updateSchedule(schedule, { ...schedule, time: "09:00" }, now).nextRunAt, at("2026-10-24T09:00"))
  assert.equal(updateSchedule(schedule, { ...schedule, weekday: 1, time: "09:00" }, now).nextRunAt, at("2026-10-26T09:00"))
  assert.equal(updateSchedule(schedule, { ...schedule, frequency: "daily", time: "09:00" }, now).nextRunAt, at("2026-10-24T09:00"))
  assert.equal(updateSchedule(schedule, { ...schedule, frequency: "daily", time: "23:00" }, now).nextRunAt, at("2026-10-23T23:00"))
  const disabled = updateSchedule(schedule, { ...schedule, enabled: false }, now)
  assert.equal(disabled.nextRunAt, undefined)
  assert.equal(disabled.lastRunAt, schedule.lastRunAt)
})

test("interval schedule saves retain their anchor unless the interval changes", () => {
  const first = updateSchedule(schedule, { ...schedule, frequency: "interval", intervalDays: 30 }, at("2026-10-23T12:00"))
  assert.equal(first.nextRunAt, at("2026-11-22T03:00"))
  const next = updateSchedule(first, { ...first, target: "s3", time: "09:00" }, at("2026-10-24T12:00"))
  assert.equal(next.anchorAt, first.anchorAt)
  assert.equal(next.nextRunAt, at("2026-11-22T09:00"))
  const changed = updateSchedule(next, { ...next, intervalDays: 7 }, at("2026-10-24T12:00"))
  assert.equal(changed.nextRunAt, at("2026-10-31T09:00"))
})

test("cleanup keeps the latest complete usable copy per target even when all copies expired", () => {
  const job = (id, target, createdAt, extra = {}) => ({ id, target, createdAt: at(createdAt), status: "complete", downloadReady: true, keyId: "fictional-backup", authKeyId: "fictional-auth", ...extra })
  const jobs = [
    job("old-webdav", "webdav", "2026-09-01T03:00"),
    job("latest-webdav", "webdav", "2026-09-02T03:00"),
    job("only-download", "download", "2026-09-01T03:00"),
    job("running", "download", "2026-09-01T03:00", { status: "running" }),
    job("missing-key", "s3", "2026-09-01T03:00", { authKeyId: undefined }),
    job("lost-download", "download", "2026-09-03T03:00", { downloadReady: false, r2Deleted: true }),
    job("fresh", "s3", "2026-10-22T03:00"),
  ]
  assert.deepEqual(expiredJobs(jobs, at("2026-10-23T12:00")).map((item) => item.id), ["old-webdav", "missing-key", "lost-download"])
  assert.equal(jobs[0].deleted, undefined, "selection must not mutate the ledger")
  const fallback = job("failed-upload", "webdav", "2026-09-01T03:00", { status: "failed" })
  assert.deepEqual(expiredJobs([fallback], at("2026-10-23T12:00")), [], "a verified download remains the last R2 copy even when its upload failed")
})

test("stacked bars and their real y-scale contain each bucket's total", () => {
  const { buildYScalesForLines, getBarMax } = load("src/components/charts/y-axis-scales.ts")
  const data = [{ reads: 12682, writes: 1504 }, { reads: 12000, writes: 2000 }]
  const keys = ["reads", "writes"]
  const scales = buildYScalesForLines({ lines: keys.map((dataKey) => ({ dataKey })), innerHeight: 196, resolveDomain: (dataKeys) => [0, getBarMax(data, dataKeys, true) * 1.1] })
  assert.equal(getBarMax(data, keys, true), 14186)
  assert.equal(getBarMax(data, keys, false), 12682)
  for (const point of data) assert.ok(scales.left(point.reads + point.writes) >= 0)
  assert.equal(getBarMax([], keys, true), 100)
})

for (const end of ["onTouchEnd", "onTouchCancel"]) test(`chart ${end} forgets the pointer before a data refresh`, () => {
  const slots = []
  let cursor = 0, effects = [], scheduled = 0
  const { scaleLinear, scaleTime } = require("@visx/scale")
  const { useChartInteraction } = load("src/components/charts/use-chart-interaction.ts", {
    react: {
      useCallback: (fn) => fn,
      useRef: (value) => slots[cursor++] ??= { current: value },
      useState: (initial) => { const index = cursor++; slots[index] ??= initial; return [slots[index], (value) => { slots[index] = value }] },
      useEffect: (effect) => effects.push(effect),
    },
    "@visx/event": { localPoint: (_svg, touch) => ({ x: touch.clientX, y: touch.clientY }) },
    "./use-scheduled-tooltip": { useScheduledTooltip: () => ({ tooltipData: null, setTooltipData() {}, scheduleTooltip() { scheduled++ }, clearTooltip() {}, resetTooltipDedupe() {} }) },
  })
  const data = [{ date: new Date(0), value: 10 }, { date: new Date(1000), value: 20 }]
  const props = { data, xScale: scaleTime({ domain: [new Date(0), new Date(1000)], range: [0, 200] }), yScale: scaleLinear({ domain: [0, 20], range: [100, 0] }), yScales: {}, lines: [{ dataKey: "value" }], margin: { left: 64 }, xAccessor: (point) => point.date, bisectDate: () => 1, canInteract: true }
  const render = () => { cursor = 0; effects = []; const result = useChartInteraction(props); effects.forEach((effect) => effect()); return result }
  let hook = render()
  let prevented = false
  hook.interactionHandlers.onTouchStart({ touches: [{ clientX: 164, clientY: 20 }], currentTarget: { ownerSVGElement: {} }, preventDefault() { prevented = true } })
  assert.ok(scheduled > 0, "touch still opens the tooltip")
  assert.equal(prevented, false, "a vertical pan must remain available to the browser")
  assert.equal(hook.interactionStyle.touchAction, "pan-y pinch-zoom")
  hook.interactionHandlers[end]()
  const beforeRefresh = scheduled
  props.data = [...data]
  hook = render()
  assert.equal(scheduled, beforeRefresh, "refresh must not resurrect a released touch")
})

test("the prototype installs the shared zero-time and in-place filter plugin patch", async () => {
  const source = readFileSync(resolve(root, "node_modules/artplayer-plugin-danmuku/dist/artplayer-plugin-danmuku.mjs"), "utf8")
  const start = source.indexOf("class Danmuku {"), end = source.indexOf("const lib =", start)
  assert.ok(start >= 0 && end > start)
  const Danmuku = runInNewContext(`${source.slice(start, end)}; Danmuku`)
  const active = (text) => ({ text, time: 118, $state: "stop", $restTime: 5, $ref: { style: { visibility: "visible" }, dataset: {} } })
  const blocked = active("blocked"), allowed = active("allowed")
  const blockedRef = blocked.$ref, allowedRef = allowed.$ref
  const plugin = Object.assign(Object.create(Danmuku.prototype), {
    art: { currentTime: 120, emit() {} }, utils: { clamp: (v, min, max) => Math.max(min, Math.min(v, max)) }, validator() {},
    option: { ...Danmuku.option, beforeVisible: (item) => item.text !== "blocked" },
    queue: [blocked, allowed], states: { wait: [], ready: [], emit: [], stop: [blocked, allowed] }, $refs: [], index: 0,
  })
  plugin.reset(true)
  await Promise.resolve()
  assert.equal(blocked.$ref, blockedRef)
  assert.equal(blockedRef.style.visibility, "hidden")
  assert.equal(allowed.$ref, allowedRef)
  assert.equal(allowedRef.style.visibility, "visible")
  assert.equal(allowed.$restTime, 5)
  plugin.option.beforeVisible = () => true
  plugin.reset(true)
  await Promise.resolve()
  assert.equal(blockedRef.style.visibility, "visible")
  await plugin.emit({ text: "zero", time: 0 })
  assert.equal(plugin.queue.at(-1).time, 0)
})
