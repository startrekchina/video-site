import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Artplayer from "artplayer"

import clipUrl from "@/media/test-clip.mp4"
import enVtt from "@/media/test-clip.en.vtt?url"
import zhVtt from "@/media/test-clip.zh.vtt?url"

export type SubtitleLang = "zh" | "en" | "off"

const SUBS: { lang: SubtitleLang; label: string; url: string }[] = [
  { lang: "zh", label: "中文", url: zhVtt },
  { lang: "en", label: "English", url: enVtt },
  { lang: "off", label: "关闭", url: "" },
]

const REPORT_INTERVAL_MS = 15_000

/**
 * ArtPlayer wrapper. Every unit plays the same synthetic clip; progress is reported as a fraction
 * so the parent can scale it to the unit's real runtime.
 */
export function Player({
  unitKey,
  startFraction,
  onReport,
  onEnded,
  endOverlay,
  subtitle,
  onSubtitleChange,
}: {
  unitKey: string
  startFraction: number
  onReport: (fraction: number) => void
  onEnded: () => void
  endOverlay: React.ReactNode
  subtitle: SubtitleLang
  onSubtitleChange: (l: SubtitleLang) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [layer, setLayer] = useState<HTMLElement | null>(null)
  const cb = useRef({ onReport, onEnded, onSubtitleChange })
  cb.current = { onReport, onEnded, onSubtitleChange }
  const subRef = useRef(subtitle)
  subRef.current = subtitle

  useEffect(() => {
    if (!container.current) return
    const overlay = document.createElement("div")
    overlay.className = "absolute inset-0 pointer-events-none"
    const initial = SUBS.find((s) => s.lang === subRef.current)!

    const art = new Artplayer({
      container: container.current,
      url: clipUrl,
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
    })

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
      art.destroy(false)
      setLayer(null)
    }
    // Re-create per unit; startFraction is read once at mount by design.
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
