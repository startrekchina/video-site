import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Artplayer from "artplayer"
import artplayerPluginDanmuku, { type Danmu, type Option as DanmakuOption, type Result as DanmakuPlugin } from "artplayer-plugin-danmuku"

import type { Unit } from "@/data/catalog"
import { DANMAKU_COLORS, DANMAKU_LOCK_SECONDS, DANMAKU_MAX_LENGTH, danmakuActions, isBlocked, subscribeBlockedWords } from "@/data/danmaku"
import clipUrl from "@/media/test-clip.mp4"
import clip1080 from "@/media/test-clip.1080p.mp4"
import clip480 from "@/media/test-clip.480p.mp4"
import clip720 from "@/media/test-clip.720p.mp4"
import zhCnBilingualVtt from "@/media/test-clip.zh-CN.bilingual.vtt?url"
import zhCnVtt from "@/media/test-clip.zh-CN.main.vtt?url"
import zhTwBilingualVtt from "@/media/test-clip.zh-TW.bilingual.vtt?url"
import zhTwVtt from "@/media/test-clip.zh-TW.main.vtt?url"

/** A track's `language.trackKey`, as the import names it, or off. */
export type SubtitleLang = "zh-CN.main" | "zh-CN.bilingual" | "zh-TW.main" | "zh-TW.bilingual" | "off"

const SUBS: { lang: SubtitleLang; label: string; url: string }[] = [
  { lang: "zh-CN.main", label: "简中", url: zhCnVtt },
  { lang: "zh-CN.bilingual", label: "简英", url: zhCnBilingualVtt },
  { lang: "zh-TW.main", label: "繁中", url: zhTwVtt },
  { lang: "zh-TW.bilingual", label: "繁英", url: zhTwBilingualVtt },
  { lang: "off", label: "关闭", url: "" },
]

/** One verified MP4 of a unit. */
export type QualitySource = { label: string; url: string }

/**
 * Which tiers each unit has, simulating per-episode uploads: TNG, SNW and the films carry three
 * tiers, TOS two, every other unit only its original file (so no quality control is shown).
 * Ordered as the server would: the original first, then tiers high to low; the first is the default.
 */
export function qualitySources(unit: Unit): QualitySource[] {
  const original = { label: "原画", url: clip1080 }
  const p720 = { label: "720p", url: clip720 }
  const p480 = { label: "480p", url: clip480 }
  if (unit.kind === "movie" || unit.work.code === "TNG" || unit.work.code === "SNW") return [original, p720, p480]
  if (unit.work.code === "TOS") return [original, p480]
  return [{ label: "原画", url: clipUrl }]
}

/** The remembered tier when this unit has it, otherwise the highest. */
function pickQuality(sources: QualitySource[], remembered: string | null) {
  return sources.find((s) => s.label === remembered) ?? sources[0]
}

const DANMAKU_SETTINGS_KEY = "proto-danmaku"
const DANMAKU_SETTING_FIELDS = ["visible", "opacity", "speed", "fontSize", "margin", "modes", "antiOverlap", "synchronousPlayback", "mode", "color"] as const

function savedDanmakuSettings(): Partial<DanmakuOption> {
  try {
    const v = JSON.parse(localStorage.getItem(DANMAKU_SETTINGS_KEY) ?? "{}")
    return v && typeof v === "object" ? v : {}
  } catch {
    return {}
  }
}

const REPORT_INTERVAL_MS = 15_000
// The plugin's in-bar emitter is a fixed 260px; with every control shown the bar needs ~800px.
// shortcut: measured with the 60 s clip's time text; measure the bar instead once durations reach hours.
const EMITTER_MIN_WIDTH = 820

/**
 * ArtPlayer wrapper. Every unit plays the same synthetic clip (at whichever quality tiers it has);
 * progress is reported as a fraction so the parent can scale it to the unit's real runtime.
 */
export function Player({
  unitKey,
  startFraction,
  onReport,
  onEnded,
  endOverlay,
  subtitle,
  onSubtitleChange,
  sources,
  quality,
  onQualityChange,
  viewer,
  onDanmakuError,
  emitterSlot,
}: {
  unitKey: string
  startFraction: number
  onReport: (fraction: number) => void
  onEnded: () => void
  endOverlay: React.ReactNode
  subtitle: SubtitleLang
  onSubtitleChange: (l: SubtitleLang) => void
  sources: QualitySource[]
  quality: string | null
  onQualityChange: (label: string) => void
  viewer: string
  onDanmakuError: (message: string) => void
  /** Strip below the player that holds the danmaku input when the player is too narrow for it. */
  emitterSlot: React.RefObject<HTMLDivElement | null>
}) {
  const container = useRef<HTMLDivElement>(null)
  const [layer, setLayer] = useState<HTMLElement | null>(null)
  const cb = useRef({ onReport, onEnded, onSubtitleChange, onQualityChange, onDanmakuError })
  cb.current = { onReport, onEnded, onSubtitleChange, onQualityChange, onDanmakuError }
  const subRef = useRef(subtitle)
  subRef.current = subtitle

  useEffect(() => {
    if (!container.current) return
    const overlay = document.createElement("div")
    overlay.className = "absolute inset-0 pointer-events-none"
    const initial = SUBS.find((s) => s.lang === subRef.current)!
    const current = pickQuality(sources, quality)

    const art = new Artplayer({
      container: container.current,
      url: current.url,
      lang: "zh-cn",
      theme: "#fafafa",
      volume: 0.6,
      autoplay: false,
      setting: true,
      playbackRate: true,
      aspectRatio: false,
      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      hotkey: true,
      mutex: true,
      backdrop: true,
      playsInline: true,
      lock: true,
      fastForward: true,
      autoOrientation: true,
      miniProgressBar: true,
      moreVideoAttr: { preload: "metadata", crossOrigin: "anonymous" },
      subtitle: {
        url: initial.url,
        type: "vtt",
        encoding: "utf-8",
        escape: true,
        style: { fontSize: "clamp(14px, 3.2vw, 28px)" },
      },
      layers: [{ name: "proto-end", html: overlay, style: { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "30" } }],
      // A unit with a single file gets no quality control at all.
      controls:
        sources.length > 1
          ? [
              {
                name: "proto-quality",
                position: "right",
                index: 10,
                style: { marginRight: "10px" },
                html: current.label,
                selector: sources.map((s) => ({ html: s.label, url: s.url, default: s === current })),
                async onSelect(item) {
                  // switchQuality keeps the position, play/pause state and playback rate.
                  await art.switchQuality(item.url as string)
                  art.notice.show = `清晰度：${item.html}`
                  cb.current.onQualityChange(item.html as string)
                  return item.html as string
                },
              },
            ]
          : [],
      settings: [
        {
          name: "subtitle-lang",
          html: "字幕",
          width: 180,
          tooltip: initial.label,
          selector: SUBS.map((s) => ({ html: s.label, lang: s.lang, default: s.lang === initial.lang })),
          onSelect(item) {
            cb.current.onSubtitleChange(item.lang as SubtitleLang)
            return item.html as string
          },
        },
      ],
      plugins: [
        artplayerPluginDanmuku({
          danmuku: async () => danmakuActions.list(unitKey).map((d) => ({ id: d.id, text: d.text, time: d.time, mode: d.mode, color: d.color })),
          speed: 7,
          fontSize: 22,
          opacity: 0.9,
          margin: [10, "25%"],
          ...savedDanmakuSettings(),
          COLOR: DANMAKU_COLORS,
          maxLength: DANMAKU_MAX_LENGTH,
          lockTime: DANMAKU_LOCK_SECONDS,
          // Blocked words and deletions apply at display time, so changes take effect without a reload.
          beforeVisible: (d: Danmu & { id?: string }) => !isBlocked(d.text) && (!d.id || danmakuActions.exists(unitKey, d.id)),
          beforeEmit(d: Danmu & { id?: string }) {
            const r = danmakuActions.send({ unitId: unitKey, author: viewer, text: d.text, mode: d.mode ?? 0, color: d.color ?? DANMAKU_COLORS[0], time: d.time ?? art.currentTime })
            if (!r.ok) {
              cb.current.onDanmakuError(r.reason)
              return false
            }
            d.id = r.item.id
            return true
          },
        }),
      ],
    })
    const danmaku = art.plugins.artplayerPluginDanmuku as DanmakuPlugin

    const saveDanmakuSettings = () => {
      const o = danmaku.option
      const picked = Object.fromEntries(DANMAKU_SETTING_FIELDS.map((k) => [k, k === "visible" ? !danmaku.isHide : o[k]]))
      localStorage.setItem(DANMAKU_SETTINGS_KEY, JSON.stringify(picked))
    }
    art.on("artplayerPluginDanmuku:config", saveDanmakuSettings)
    art.on("artplayerPluginDanmuku:show", saveDanmakuSettings)
    art.on("artplayerPluginDanmuku:hide", saveDanmakuSettings)
    const offRemoved = danmakuActions.onRemoved((id) => id === unitKey && danmaku.reset(true))
    const offBlocked = subscribeBlockedWords(() => danmaku.reset(true))

    // The plugin's own narrow fallback hangs the input below the player, outside our fixed-height box.
    const placeEmitter = () => {
      const slot = emitterSlot.current
      if (!slot || art.fullscreen || art.fullscreenWeb) return
      danmaku.mount(art.width < EMITTER_MIN_WIDTH ? slot : art.template.$controlsCenter)
    }
    art.on("ready", placeEmitter)
    art.on("resize", placeEmitter)

    let seeked = false
    art.on("ready", () => {
      if (!seeked && startFraction > 0 && startFraction < 0.98) {
        seeked = true
        art.seek = startFraction * art.duration
        art.notice.show = `从上次的位置继续（${Math.round(startFraction * 100)}%）`
      }
    })

    const report = () => art.duration && cb.current.onReport(art.currentTime / art.duration)
    const timer = window.setInterval(() => art.playing && report(), REPORT_INTERVAL_MS)
    art.on("video:pause", report)
    art.on("video:seeked", report)
    art.on("video:ended", () => {
      report()
      cb.current.onEnded()
    })
    const onHide = () => document.visibilityState === "hidden" && report()
    document.addEventListener("visibilitychange", onHide)

    art.hotkey.add("KeyF", () => (art.fullscreen = !art.fullscreen))
    art.hotkey.add("KeyM", () => (art.muted = !art.muted))
    art.hotkey.add("KeyC", () => {
      const i = SUBS.findIndex((s) => s.lang === subRef.current)
      const next = SUBS[(i + 1) % SUBS.length]
      cb.current.onSubtitleChange(next.lang)
      art.notice.show = `字幕：${next.label}`
    })

    ;(container.current as HTMLDivElement & { art?: Artplayer }).art = art
    setLayer(overlay)

    return () => {
      report()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onHide)
      offRemoved()
      offBlocked()
      art.destroy(false)
      setLayer(null)
    }
    // Re-create per unit; startFraction, sources and quality are read once at mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitKey])

  useEffect(() => {
    const art = (container.current as (HTMLDivElement & { art?: Artplayer }) | null)?.art
    if (!art) return
    const s = SUBS.find((x) => x.lang === subtitle)!
    if (s.lang === "off") art.subtitle.show = false
    else {
      if (art.subtitle.url !== s.url) void art.subtitle.switch(s.url, { name: s.label, type: "vtt" })
      art.subtitle.show = true
    }
    art.setting.update({ name: "subtitle-lang", html: "字幕", tooltip: s.label, selector: SUBS.map((x) => ({ html: x.label, lang: x.lang, default: x.lang === s.lang })) } as never)
  }, [subtitle, layer])

  return (
    <>
      <div ref={container} className="size-full" />
      {layer && createPortal(endOverlay, layer)}
    </>
  )
}

export { SUBS }
