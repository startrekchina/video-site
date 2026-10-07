import type React from "react"
import { useRef, useState } from "react"
import { PlayIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { episodeCode } from "@/lib/catalog"
import { useStageHeader } from "@/lib/header-tone"
import { Poster, ProgressBar } from "@/components/site/media"
import { Button } from "@/components/ui/button"
import { ScrollFadeEffect } from "@/components/ui/scroll-fade-effect"
import { cn } from "@/lib/utils"

import type { Episode, Work } from "@/lib/catalog"

// Home hero (影院): a full-bleed dark stage that breaks out of the column once and sits under a
// transparent header. Stills are out of scope for v1, so the backdrop is the item's own poster,
// blurred into ambient colour. The stage is drawn as one plate: a title strip, the current item as a
// framed figure, and the home page's 继续观看 list as a ruled scale along the bottom.

type Stage = {
  key: string
  poster: string
  eyebrow: string
  title: string
  sub: string
  overview: string
  frac: number | null
  meta: string
  /** Short annotation beside the item's number on the scale: when it was last watched, or why it is there. */
  note: string
  thumb: [string, string]
  primary: { label: string; to: string }
  secondary: { label: string; to: string }
}

function makeStages(items: { work: Work; unit: Episode }[]): Stage[] {
  return items.map(({ work, unit }) => ({ key: unit.id, poster: work.poster,
    eyebrow: [work.code || "电影", work.year].filter(Boolean).join(" · "), title: work.titleZh,
    sub: unit.titleZh || unit.titleEn || episodeCode(unit), overview: unit.overviewZh || unit.overviewEn || work.overviewZh || work.overviewEn || "简介暂缺",
    frac: unit.positionSeconds ? unit.positionSeconds / unit.durationSeconds : null,
    meta: Math.ceil((unit.durationSeconds - unit.positionSeconds) / 60) + " 分钟",
    note: unit.updatedAt ? new Date(unit.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
    thumb: [work.code || "电影", work.kind === "series" ? episodeCode(unit) : String(work.year ?? "")],
    primary: { label: unit.positionSeconds ? "继续播放" : "开始播放", to: "/watch/" + unit.id },
    secondary: { label: "作品详情", to: "/title/" + work.slug },
  }));
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Hairline frame with brighter corners, the figure box of the line drawing. */
function Plate({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative border border-white/15 bg-white/3", className)}>
      <span aria-hidden className="absolute -top-px -left-px size-2.5 border-t border-l border-white/80" />
      <span aria-hidden className="absolute -top-px -right-px size-2.5 border-t border-r border-white/80" />
      <span aria-hidden className="absolute -bottom-px -left-px size-2.5 border-b border-l border-white/80" />
      <span aria-hidden className="absolute -right-px -bottom-px size-2.5 border-r border-b border-white/80" />
      {children}
    </div>
  )
}

// Minor ticks hang from the rule every 12px. Mark widths are whole multiples of 12px, so every
// mark's own tick lands on the minor rhythm and the ticks scroll with the marks.
const TICKS: React.CSSProperties = {
  backgroundImage: "linear-gradient(to right, currentColor 0 1px, transparent 1px)",
  backgroundSize: "12px 6px",
  backgroundRepeat: "repeat-x",
}

/**
 * 继续观看 as a ruled scale inside the column. Each item owns one span between two long ticks; the
 * span is filled along the rule as far as it has been watched. The current item has the brightest tick.
 */
function Scale({ label, stages, index, onPick }: { label: string; stages: Stage[]; index: number; onPick: (i: number) => void }) {
  return (
    <div className="pt-6 pb-4 sm:pt-8 sm:pb-6">
      <div className="mb-3 px-4 font-mono text-xs text-white/60">{label}</div>
      <ScrollFadeEffect orientation="horizontal" className="no-scrollbar flex px-4 [--mask-width:3rem]">
        {stages.map((x, i) => {
          const active = i === index
          return (
            <button
              key={x.key}
              type="button"
              aria-pressed={active}
              aria-label={`${active ? "播放" : "切换到"}：${x.title} ${x.thumb[1]}`}
              onClick={() => onPick(i)}
              style={TICKS}
              className={cn(
                "group/mark relative flex w-30 shrink-0 flex-col items-start border-t border-white/25 pt-5 pr-3 pb-2 text-left text-white/25 outline-none transition-colors sm:w-36",
                "hover:bg-white/4 focus-visible:bg-white/8",
              )}
            >
              {x.frac !== null && (
                <span aria-hidden className={cn("absolute -top-px left-0 h-0.5", active ? "bg-white" : "bg-white/45")} style={{ width: `${Math.min(1, x.frac) * 100}%` }} />
              )}
              <span aria-hidden className={cn("absolute -top-px left-0 w-px transition-colors", active ? "h-4 bg-white" : "h-3 bg-white/40 group-hover/mark:bg-white/80")} />
              <span className="flex w-full items-center gap-2 font-mono text-[10px] tracking-wider">
                <span className={cn("flex items-center gap-1", active ? "text-white" : "text-white/45")}>
                  {active && <PlayIcon aria-hidden className="size-2.5 fill-current" />}
                  {pad(i + 1)}
                </span>
                {x.note && <span className="ml-auto truncate text-white/40">{x.note}</span>}
              </span>
              <span className={cn("mt-1 line-clamp-2 text-xs/snug font-medium transition-colors", active ? "text-white" : "text-white/60 group-hover/mark:text-white/85")}>{x.title}</span>
              <span className="mt-0.5 font-mono text-[10px] text-white/40">{x.thumb[1]}</span>
            </button>
          )
        })}
        {/* The rule runs on to the column's content edge; its first long tick closes the last span. */}
        <div aria-hidden style={TICKS} className="relative min-w-12 flex-1 border-t border-white/25 text-white/20">
          <span className="absolute -top-px left-0 h-3 w-px bg-white/40" />
        </div>
      </ScrollFadeEffect>
    </div>
  )
}

export function HeroTheatre({ items, label }: { items: { work: Work; unit: Episode }[]; label: string }) {
  const stages = makeStages(items)
  const [selected, setSelected] = useState(0)
  const [announce, setAnnounce] = useState("")
  const navigate = useNavigate()
  const ref = useRef<HTMLElement>(null)
  useStageHeader(ref)
  if (!stages.length) return <section className="border p-8"><h1 className="text-2xl">欢迎登舰</h1><p className="mt-4 text-muted-foreground">暂时没有可播放的推荐内容。</p></section>
  const index = Math.min(selected, stages.length - 1)
  const s = stages[index]

  const pick = (i: number) => {
    const x = stages[i]
    if (i === index) {
      navigate(x.primary.to)
      return
    }
    setSelected(i)
    setAnnounce(`已切换到 ${x.title}，${x.sub}`)
  }

  return (
    <section ref={ref} aria-labelledby="hero-title" className="dark relative isolate -mx-2 -mt-(--header-height) overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-1">
        {s.poster && <img
          key={s.key}
          src={s.poster}
          alt=""
          className="absolute inset-0 size-full scale-125 animate-in object-cover opacity-60 blur-3xl saturate-150 duration-700 fade-in motion-reduce:animate-none"
        />}
        <div className="absolute inset-0 bg-linear-to-b from-background/20 via-background/55 to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_25%_35%,transparent_0%,var(--background)_80%)]" />
        <div className="dot-grid absolute inset-0" />
      </div>

      <div className="mx-auto w-[calc(100%-1rem)] border-x border-white/10 md:max-w-(--content-width)">
        <div
          key={s.key}
          className={cn(
            "grid animate-in grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4 px-4 pt-[calc(var(--header-height)+--spacing(6))] duration-500 fade-in [grid-template-areas:'poster_head'_'body_body'] motion-reduce:animate-none",
            "sm:grid-rows-[1fr_auto] sm:gap-x-8 sm:gap-y-0 sm:pt-[calc(var(--header-height)+--spacing(14))] sm:[grid-template-areas:'poster_head'_'poster_body']",
          )}
        >
          <Link
            to={s.primary.to}
            className="group/poster block w-24 self-end outline-none [grid-area:poster] focus-visible:ring-1 focus-visible:ring-white/70 min-[24rem]:w-28 sm:w-48"
            aria-label={`${s.primary.label}：${s.title}`}
          >
            <Plate className="p-1.5 sm:p-2">
              <div className="relative">
                <Poster src={s.poster} alt="" loading="eager" fetchPriority="high" />
                <span className="absolute inset-0 flex items-center justify-center rounded-poster transition-colors group-hover/poster:bg-black/30">
                  <span className="flex size-12 scale-90 items-center justify-center rounded-full bg-white/90 text-zinc-950 opacity-0 transition group-hover/poster:scale-100 group-hover/poster:opacity-100 max-sm:hidden">
                    <PlayIcon className="size-5 translate-x-px fill-current" />
                  </span>
                </span>
              </div>
            </Plate>
          </Link>

          <div className="flex min-w-0 flex-col justify-end [grid-area:head]">
            <div className="font-mono text-xs tracking-wide text-white/70">{s.eyebrow}</div>
            <h1 id="hero-title" className="mt-1.5 text-2xl/tight font-medium tracking-tight text-balance text-white sm:mt-2 sm:text-3xl/tight md:text-[2.5rem]/tight">
              {s.title}
            </h1>
            <p className="mt-1 line-clamp-2 text-sm text-white/80 sm:line-clamp-1 sm:text-lg">{s.sub}</p>
          </div>

          <div className="flex min-w-0 flex-col [grid-area:body]">
            <p className="line-clamp-2 max-w-prose text-sm/relaxed text-white/65 sm:mt-3">{s.overview}</p>
            {s.frac !== null && <ProgressBar value={s.frac} className="mt-4 max-w-xs bg-white/15 [&>div]:bg-white" />}
            <div className={cn("font-mono text-xs text-white/65", s.frac !== null ? "mt-2" : "mt-3")}>{s.meta}</div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button size="lg" className="h-11 px-4 text-base" render={<Link to={s.primary.to} />} nativeButton={false}>
                <PlayIcon className="fill-current" data-icon="inline-start" />
                {s.primary.label}
              </Button>
              <Button size="lg" variant="ghost" className="h-11 px-4 text-base text-white/85 hover:bg-white/10" render={<Link to={s.secondary.to} />} nativeButton={false}>
                {s.secondary.label}
              </Button>
            </div>
          </div>
        </div>

        <Scale label={label} stages={stages} index={index} onPick={pick} />
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  )
}
