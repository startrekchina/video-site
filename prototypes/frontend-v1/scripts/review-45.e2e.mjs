// Browser regression checks for the PR #45 review findings, run against the prototype dev server.
// Drives the developer's browser through the kimi-webbridge daemon. Each case asserts the expected
// behavior, so it fails while the finding is real and passes once it is fixed.
// Run: node --test scripts/review-45.e2e.mjs   (PROTO_URL defaults to http://127.0.0.1:6120)
import assert from "node:assert/strict"
import { after, afterEach, before, test } from "node:test"

const DAEMON = process.env.WEBBRIDGE_URL ?? "http://127.0.0.1:10086/command"
const BASE = process.env.PROTO_URL ?? "http://127.0.0.1:6120"
const session = "pr45-review-codex"
let preferences

async function call(action, args = {}) {
  const res = await fetch(DAEMON, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, args, session }) })
  const body = await res.json()
  if (!body.ok) throw new Error(`${action}: ${body.error?.code} ${body.error?.message}`)
  return body.data
}
const cdp = (method, params = {}) => call("cdp", { method, params })
const js = async (code) => (await call("evaluate", { code: `(() => { ${code} })()` })).value
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(code, timeout = 8000) {
  const end = Date.now() + timeout
  for (;;) {
    const value = await js(code)
    if (value || Date.now() > end) return value
    await sleep(150)
  }
}
async function open(path, scenario = "member") {
  await js(`sessionStorage.setItem("proto-scenario", ${JSON.stringify(scenario)})`)
  await call("navigate", { url: BASE + path })
  await until(`return document.readyState === "complete" && !!document.querySelector("main")`)
}
const mobile = (width = 360, height = 800) => cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true })
// Center of an element in viewport CSS pixels, after scrolling it to the middle of the screen.
const centerOf = (selector) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center", behavior: "instant" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }`)
// A finger drag as frame-by-frame touch events; returns how far the page scrolled.
async function drag(point, dx, dy) {
  const before = await js(`return scrollY`)
  await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] })
  for (let i = 1; i <= 4; i++) {
    await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + (dx * i) / 4, y: point.y + (dy * i) / 4 }] })
    await sleep(16)
  }
  return before
}
const lift = () => cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
const FIG_01 = '[role="img"][aria-label*="R2 下行流量"]'
const openTooltips = `[...document.querySelectorAll('[class*="min-w-[160px]"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && getComputedStyle(el).visibility !== "hidden" && Number(getComputedStyle(el.parentElement).opacity) > 0.1 }).length`
const tooltips = `return ${openTooltips}`

before(async () => {
  await call("navigate", { url: `${BASE}/about`, newTab: true, group_title: "PR #45 复核" })
  // Background tabs skip ResizeObserver, which the width-measured charts need.
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true })
  preferences = await js(`return { subtitle: localStorage.getItem("proto-sub"), scenario: sessionStorage.getItem("proto-scenario") }`)
})
afterEach(async () => {
  await cdp("Emulation.clearDeviceMetricsOverride")
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false })
  await cdp("Emulation.setEmulatedMedia", { features: [] })
})
after(async () => {
  try {
    await cdp("Emulation.setFocusEmulationEnabled", { enabled: false })
  } finally {
    try {
      if (preferences) await js(`const saved = ${JSON.stringify(preferences)}; if (saved.subtitle === null) localStorage.removeItem("proto-sub"); else localStorage.setItem("proto-sub", saved.subtitle); if (saved.scenario === null) sessionStorage.removeItem("proto-scenario"); else sessionStorage.setItem("proto-scenario", saved.scenario)`)
    } finally {
      await call("close_session")
    }
  }
})

test("search keeps ?q= when arriving from another browse page", async () => {
  await open("/series")
  await js(`document.querySelector('[aria-label="前端原型，打开控制台"]').click()`)
  await call("fill", { selector: 'input[aria-label="筛选作品"]', value: "tng" })
  // The prototype console is the only entry that links to /search?q=.
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "全站搜索").click()`)
  assert.equal(await until(`return location.pathname === "/search"`), true, "client-side navigation to /search did not happen")
  assert.equal(await until(`return document.querySelector("h1")?.textContent.includes("按中文或英文作品名")`), true, "React has not committed the search screen")
  assert.equal(await js(`return document.querySelector('input[aria-label="筛选作品"]').value`), "voyager")
})

test("subtitles can be switched from the keyboard on the watch page", async () => {
  await open("/watch/tng-s03e26")
  await until(`return !!document.querySelector(".art-video-player")`)
  const names = await js(`
    const tabbable = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0)
    return tabbable.map((el) => (el.getAttribute("aria-label") || el.title || el.textContent || "").trim().slice(0, 30))`)
  assert.ok(names.length > 5, `too few tabbable elements found (${names.length}); page not ready`)
  assert.ok(names.some((name) => name.includes("字幕")), `no tabbable subtitle control among: ${names.join(" | ")}`)
  for (let i = 0; i < 60 && !(await js(`return document.activeElement?.getAttribute("aria-label") === "字幕"`)); i++) {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
  }
  assert.equal(await js(`return document.activeElement?.getAttribute("aria-label")`), "字幕", "Tab did not reach subtitle selection")
  for (const [key, code] of [["Home", 36], ["ArrowDown", 40], ["Enter", 13]]) {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code })
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code })
  }
  assert.equal(await until(`return document.querySelector('select[aria-label="字幕"]').value === "zh-CN.bilingual" && [...(document.querySelector(".art-video-player").parentElement.art.subtitle.textTrack?.cues ?? [])].some((cue) => cue.text.includes("(Prototype subtitle)"))`), true, "keyboard selection did not update the player's actual subtitle cues")
})

test("a vertical touch swipe that starts on a status chart scrolls the page", async () => {
  await mobile()
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
  await open("/status")
  await until(`return !!document.querySelector('${FIG_01} svg')`)
  const swipe = async (point) => {
    const before = await drag(point, 0, -200)
    await lift()
    await sleep(400)
    return (await js(`return scrollY`)) - before
  }
  // Control: the same gesture on the page heading must scroll, or the harness is not delivering touch.
  const control = await swipe(await centerOf("h1"))
  assert.ok(control > 50, `control swipe on the heading scrolled ${control}px; touch gestures are not reaching the page`)
  const onChart = await swipe(await centerOf(FIG_01))
  assert.ok(onChart > 50, `swipe starting on Fig 01 scrolled ${onChart}px (control scrolled ${control}px)`)
})

test("a chart tooltip stays closed after the finger lifts", async () => {
  await mobile()
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
  await open("/status")
  await until(`return !!document.querySelector('${FIG_01} svg')`)
  await sleep(2000)
  await drag(await centerOf(FIG_01), 80, 0)
  const shown = await until(tooltips, 3000)
  await lift()
  assert.ok(shown > 0, "no tooltip appeared while dragging; touch input is not reaching the chart")
  assert.equal(await until(`return ${openTooltips} === 0`, 3000), true, "tooltip did not close on touchend")
  // useMinutes runs the same refresh on visibilitychange as on its one-minute timer.
  await js(`document.dispatchEvent(new Event("visibilitychange"))`)
  // It fades back in over a few seconds on this slow emulated page, so watch for a while.
  assert.equal(await until(`return ${openTooltips} > 0`, 6000), false, "tooltip came back after the minute refresh although nothing is touching the chart")
})

test("reduced motion stops the chart axis labels from sliding", async () => {
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] })
  await open("/status")
  await until(`return !!document.querySelector('${FIG_01} svg')`)
  assert.equal(await js(`return matchMedia("(prefers-reduced-motion: reduce)").matches`), true, "reduced motion emulation is off")
  const moving = await js(`
    return [...document.querySelectorAll('[role="img"] *')]
      .map((el) => getComputedStyle(el))
      .filter((s) => /\\b(top|left|opacity|all)\\b/.test(s.transitionProperty) && s.transitionDuration.split(",").some((d) => parseFloat(d) > 0))
      .map((s) => s.transitionProperty + " " + s.transitionDuration)`)
  assert.deepEqual([...new Set(moving)], [])
})

test("the colophon logo wall fits a 320px screen", async () => {
  await mobile(320, 700)
  await open("/about#colophon")
  await until(`return !!document.querySelector("#colophon ul a")`)
  assert.equal(await js(`return innerWidth`), 320, "viewport emulation is off")
  const overflowing = await js(`
    return [...document.querySelectorAll("#colophon ul a")]
      .filter((a) => a.scrollWidth > a.clientWidth + 1)
      .map((a) => a.textContent.trim() + " " + a.scrollWidth + ">" + a.clientWidth)`)
  assert.deepEqual(overflowing, [])
})

test("web fullscreen keeps the video above the site header", async () => {
  await open("/watch/tng-s03e26")
  assert.equal(await until(`return !!document.querySelector(".art-video-player")?.parentElement?.art`), true)
  try {
    await js(`document.querySelector(".art-video-player").parentElement.art.fullscreenWeb = true`)
    assert.equal(await until(`return document.querySelector(".art-video-player").getBoundingClientRect().top === 0`), true, "web fullscreen did not cover the viewport")
    const hit = await js(`
      const el = document.elementFromPoint(innerWidth / 2, 24)
      return { inPlayer: !!el?.closest(".art-video-player"), tag: el?.tagName, text: el?.textContent?.trim().slice(0, 80) }`)
    assert.equal(hit.inPlayer, true, `another element covers the fullscreen video: ${JSON.stringify(hit)}`)
  } finally {
    await js(`const art = document.querySelector(".art-video-player")?.parentElement?.art; if (art) art.fullscreenWeb = false`)
  }
})

test("saving the backup clock time updates the next-run display", async () => {
  await open("/admin/backups", "admin")
  const nextRun = `const dt = [...document.querySelectorAll("dt")].find((el) => el.textContent.includes("下次执行")); return dt?.nextElementSibling?.textContent?.trim()`
  assert.match(await js(nextRun), /03:00/, "fixture does not show the initial 03:00 schedule")
  await call("fill", { selector: "#schedule-time", value: "09:00" })
  assert.equal(await js(`return document.querySelector("#schedule-time").value`), "09:00", "clock input was not updated")
  await js(`document.querySelector("#schedule-time").form.querySelector('button[type="submit"]').click()`)
  assert.equal(await until(`return document.body.textContent.includes("自动备份设置已保存")`), true, "save did not finish")
  assert.match(await js(nextRun), /09:00/, "next-run display still uses the previous clock time")
})

test("changing blocked words rechecks paused danmaku in place", async () => {
  await open("/watch/tng-s03e26")
  assert.equal(await until(`const art = document.querySelector(".art-video-player")?.parentElement?.art; return art?.isReady && art.currentTime / art.duration >= 0.4`), true, "the fixture's 42% saved position was not applied")
  await call("evaluate", { code: `(async () => {
    const data = await import("/src/data/danmaku.ts")
    window.__reviewOldBlocked = data.getBlockedWords()
    data.setBlockedWords([])
    const art = document.querySelector(".art-video-player").parentElement.art
    art.muted = true
    await art.play()
  })()` })
  try {
    const shown = await until(`return !!document.querySelector('[data-state="emit"]')`)
    assert.equal(shown, true, `no seeded danmaku became visible: ${JSON.stringify(await js(`const art = document.querySelector(".art-video-player").parentElement.art; return { current: art.currentTime, playing: art.playing, stopped: art.plugins.artplayerPluginDanmuku.isStop, hidden: art.plugins.artplayerPluginDanmuku.isHide, readyState: art.video.readyState, visibility: document.visibilityState }`))}`)
    await js(`window.__reviewDanmaku = document.querySelector('[data-state="emit"]'); document.querySelector(".art-video-player").parentElement.art.pause()`)
    const visible = `return window.__reviewDanmaku?.isConnected && getComputedStyle(window.__reviewDanmaku).visibility === "visible" && window.__reviewDanmaku.dataset.state === "stop"`
    assert.equal(await until(visible), true)
    await call("evaluate", { code: `(async () => (await import("/src/data/danmaku.ts")).setBlockedWords(["unrelated-token"]))()` })
    assert.equal(await js(visible), true, "an unrelated word removed the paused danmaku")
    await call("evaluate", { code: `(async () => (await import("/src/data/danmaku.ts")).setBlockedWords([Array.from(window.__reviewDanmaku.textContent).slice(0, 20).join("")]))()` })
    assert.equal(await until(`return window.__reviewDanmaku?.style.visibility === "hidden"`), true, "matching word did not hide the active node")
    await call("evaluate", { code: `(async () => (await import("/src/data/danmaku.ts")).setBlockedWords([]))()` })
    assert.equal(await until(visible), true, "removing the word did not restore the same paused node")
  } finally {
    await call("evaluate", { code: `(async () => { document.querySelector(".art-video-player").parentElement.art.pause(); (await import("/src/data/danmaku.ts")).setBlockedWords(window.__reviewOldBlocked); delete window.__reviewOldBlocked; delete window.__reviewDanmaku })()` })
  }
})

test("the watch queue ignores another simulated member's private playlist", async () => {
  await open("/watch/movie-star-trek-ii-the-wrath-of-khan?playlist=p2")
  assert.equal(await until(`return document.querySelectorAll('a[href="/playlists/p2"]').length > 0`), true, "owner's private queue is not visible")
  await call("evaluate", { code: `(async () => { const { getState, actions } = await import("/src/data/store.ts"); getState().playlists.find((p) => p.id === "p2").owner = "fictional-other-member"; actions.setVisibility("p2", "private") })()` })
  assert.equal(await until(`return document.querySelectorAll('a[href="/playlists/p2"]').length === 0`), true, "another member's private playlist still supplies the queue")
})
