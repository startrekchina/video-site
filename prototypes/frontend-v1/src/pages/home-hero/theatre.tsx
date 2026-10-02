import { useRef, useState } from "react"
import { PlayIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { episodeCode, formatRuntime } from "@/data/catalog"
import { useStageHeader } from "@/lib/header-tone"
import { Poster } from "@/components/site/media"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { ago, firstUnitId, fraction, kicker, minutesLeft, overview, pickHref, playLabel, poster, startWorks, subtitle, timecode, useQueue, watchHref } from "./data"

// Home hero (影院): a full-bleed dark stage that breaks out of the column once and sits under a
// transparent header. Stills are out of scope for v1, so the backdrop is the item's own poster,
// blurred into ambient colour. The thumbnail strip is the home page's 继续观看 list.

export type Stage = {
  key: string
  poster: string
  eyebrow: string
  title: string
  sub: string
  overview: string
  frac: number | null
  meta: string
  thumb: [string, string]
  primary: { label: string; to: string }
  secondary: { label: string; to: string }
}

export function useStages(): { stages: Stage[]; label: string } {
  const queue = useQueue()
  if (queue.length)
    return {
      label: `继续观看 · ${queue.length}`,
      stages: queue.map((item) => {
        const u = item.unit
        return {
          key: u.id,
          poster: poster(u),
          eyebrow: `${item.reason === "next" ? "下一集" : "继续观看"} · ${kicker(u)}`,
          title: u.work.titleZh,
          sub: subtitle(u),
          overview: overview(u),
          frac: item.reason === "resume" ? fraction(item) : null,
          meta: [item.reason === "next" ? `${minutesLeft(item)} 分钟` : `${timecode(item)} · 剩余 ${minutesLeft(item)} 分钟`, ago(item.progress?.updatedAt)].filter(Boolean).join(" · "),
          thumb: u.kind === "episode" ? [u.work.code, episodeCode(u.episode)] : ["电影", String(u.work.year)],
          primary: { label: playLabel(item), to: watchHref(u) },
          secondary: { label: u.kind === "episode" ? "选集" : "作品详情", to: pickHref(u) },
        }
      }),
    }
  return {
    label: "推荐起点",
    stages: startWorks().map(({ work, why }) => ({
      key: work.slug,
      poster: work.poster,
      eyebrow: `欢迎登舰 · ${work.code || "电影"} · ${work.year}`,
      title: work.titleZh,
      sub: why,
      overview: work.overviewZh ?? work.overviewEn,
      frac: null,
      meta: work.kind === "series" ? `${work.seasons.length} 季 · ${work.seasons.reduce((n, s) => n + s.episodes.length, 0)} 集` : formatRuntime(work.runtimeMin!),
      thumb: [work.code || "电影", String(work.year)],
      primary: { label: "播放第 1 集", to: `/watch/${firstUnitId(work)}` },
      secondary: { label: "作品详情", to: `/title/${work.slug}` },
    })),
  }
}

export function HeroTheatre() {
  const { stages, label } = useStages()
  const [selected, setSelected] = useState(0)
  const [announce, setAnnounce] = useState("")
  const navigate = useNavigate()
  const ref = useRef<HTMLElement>(null)
  useStageHeader(ref)
  const s = stages[Math.min(selected, stages.length - 1)]
  // On phones the strip already shows the selected poster, so the stage poster only appears when there is no strip.
  const strip = stages.length > 1

  return (
    <section ref={ref} aria-labelledby="hero-title" className="dark relative isolate -mx-2 -mt-(--header-height) overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-1">
        <img
          key={s.key}
          src={s.poster}
          alt=""
          className="absolute inset-0 size-full scale-125 animate-in object-cover opacity-60 blur-3xl saturate-150 duration-700 fade-in motion-reduce:animate-none"
        />
        <div className="absolute inset-0 bg-linear-to-b from-background/20 via-background/55 to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_25%_35%,transparent_0%,var(--background)_80%)]" />
        <div className="dot-grid absolute inset-0" />
      </div>

      <div className="mx-auto w-[calc(100%-1rem)] border-x border-white/10 md:max-w-(--content-width)">
        <div
          key={s.key}
          className={cn(
            "grid animate-in gap-x-4 gap-y-4 px-4 pb-6 duration-500 fade-in motion-reduce:animate-none",
            "pt-[calc(var(--header-height)+--spacing(6))]",
            strip ? "grid-cols-1 [grid-template-areas:'head'_'body']" : "grid-cols-[auto_minmax(0,1fr)] [grid-template-areas:'poster_head'_'body_body']",
            "sm:grid-cols-[auto_minmax(0,1fr)] sm:grid-rows-[1fr_auto] sm:gap-x-8 sm:gap-y-0 sm:pt-[calc(var(--header-height)+--spacing(14))] sm:pb-10 sm:[grid-template-areas:'poster_head'_'poster_body']",
          )}
        >
          <Link
            to={s.primary.to}
            className={cn("group/poster relative block w-24 self-end outline-none [grid-area:poster] min-[24rem]:w-28 sm:w-52", strip && "max-sm:hidden")}
            aria-label={`${s.primary.label}：${s.title}`}
          >
            <Poster src={s.poster} alt="" loading="eager" fetchPriority="high" className="shadow-2xl shadow-black/60 ring-1 ring-white/15" />
            <span className="absolute inset-0 flex items-center justify-center rounded-poster transition-colors group-hover/poster:bg-black/30">
              <span className="flex size-12 scale-90 items-center justify-center rounded-full bg-white/90 text-zinc-950 opacity-0 transition group-hover/poster:scale-100 group-hover/poster:opacity-100">
                <PlayIcon className="size-5 translate-x-px fill-current" />
              </span>
            </span>
          </Link>

          <div className="flex min-w-0 flex-col justify-end [grid-area:head]">
            <div className="font-mono text-xs tracking-wide text-white/70">{s.eyebrow}</div>
            <h1 id="hero-title" className={cn("mt-1.5 font-medium tracking-tight text-balance text-white sm:mt-2 sm:text-3xl/tight md:text-[2.5rem]/tight", strip ? "text-[1.75rem]/tight" : "text-2xl/tight")}>
              {s.title}
            </h1>
            <p className="mt-1 truncate text-sm text-white/80 sm:text-lg">{s.sub}</p>
          </div>

          <div className="flex min-w-0 flex-col [grid-area:body]">
            <p className="line-clamp-2 max-w-prose text-sm/relaxed text-white/65 sm:mt-3">{s.overview}</p>
            {s.frac !== null && (
              <div className="mt-4 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white" style={{ width: `${s.frac * 100}%` }} />
              </div>
            )}
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

        {stages.length > 1 && (
          <div className="border-t border-white/10 px-4 pt-3 pb-4">
            <div className="mb-2 font-mono text-xs text-white/60">{label}</div>
            <div className="no-scrollbar -m-1 flex gap-3 overflow-x-auto p-1">
              {stages.map((x, i) => {
                const active = i === selected
                return (
                  <button
                    key={x.key}
                    type="button"
                    aria-pressed={active}
                    aria-label={active ? `播放：${x.title}` : `切换到：${x.title}`}
                    onClick={() => {
                      if (active) {
                        navigate(x.primary.to)
                        return
                      }
                      setSelected(i)
                      setAnnounce(`已切换到 ${x.title}，${x.sub}`)
                    }}
                    className="group/thumb flex w-14 shrink-0 flex-col gap-1.5 text-left outline-none sm:w-16"
                  >
                    <span
                      className={cn(
                        "relative block rounded-poster transition",
                        active
                          ? "ring-2 ring-white ring-offset-2 ring-offset-black"
                          : "opacity-55 group-hover/thumb:opacity-100 group-focus-visible/thumb:opacity-100 group-focus-visible/thumb:ring-2 group-focus-visible/thumb:ring-white/60",
                      )}
                    >
                      <Poster src={x.poster} alt="" />
                      {x.frac !== null && (
                        <span className="absolute inset-x-1.5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-white/30">
                          <span className="block h-full bg-white" style={{ width: `${x.frac * 100}%` }} />
                        </span>
                      )}
                      {active && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-poster bg-black/25">
                          <span className="flex size-7 items-center justify-center rounded-full bg-white/90 text-zinc-950 shadow-lg transition group-hover/thumb:scale-110">
                            <PlayIcon className="size-3.5 translate-x-px fill-current" />
                          </span>
                        </span>
                      )}
                    </span>
                    <span className={cn("font-mono text-[10px]/tight transition-colors", active ? "text-white" : "text-white/55 group-hover/thumb:text-white/80")}>
                      <span className="block truncate">{x.thumb[0]}</span>
                      <span className="block truncate">{x.thumb[1]}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  )
}
