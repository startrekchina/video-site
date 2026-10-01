import type React from "react"
import { CheckIcon, PlayIcon } from "lucide-react"
import { Link } from "react-router"

import { displayTitle, episodeCode, formatRuntime, getUnit, unitPoster, type Work } from "@/data/catalog"
import { useStore, workProgress, type Progress } from "@/data/store"
import { cn } from "@/lib/utils"

export function Poster({ src, alt, className, ...props }: React.ComponentProps<"img"> & { src: string; alt: string }) {
  return (
    <div className={cn("diagonal-stripes relative aspect-2/3 overflow-hidden rounded-md bg-muted", className)}>
      <img src={src} alt={alt} loading="lazy" decoding="async" {...props} className="relative size-full object-cover select-none" draggable={false} />
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] inset-ring-1 inset-ring-foreground/10" />
    </div>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div
      className={cn("h-1 w-full overflow-hidden bg-foreground/10", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div className="h-full bg-foreground" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  )
}

export function WatchedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground dark:bg-zinc-900", className)}>
      <CheckIcon className="size-3 text-success" />
      已看完
    </span>
  )
}

/** Grid tile used in catalog sections, after the reference PostItem: padded, hover wash, greyscale until hover on fine pointers. */
export function WorkTile({ work, className, loading }: { work: Work; className?: string; loading?: "eager" | "lazy" }) {
  const p = useStore((s) => workProgress(s, work.slug))
  const fav = useStore((s) => s.favorites.includes(work.slug))
  const frac = p.total ? p.watched / p.total : 0
  return (
    <div className={cn("group/tile relative flex h-full flex-col gap-2 p-2 transition-[background-color] ease-out hover:bg-accent-muted", className)}>
      <div className="relative">
        <Poster
          src={work.poster}
          alt={work.titleZh}
          loading={loading}
          className="rounded-xl transition-[filter] duration-300 ease-[cubic-bezier(0.42,0,0.58,1)] pointer-fine:grayscale group-hover/tile:grayscale-0 group-has-focus-visible/tile:grayscale-0"
        />
        {work.code && (
          <span className="absolute top-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px]/none tracking-wider text-white backdrop-blur-sm">
            {work.code}
          </span>
        )}
        {frac > 0 && <ProgressBar value={frac} className="absolute inset-x-2 bottom-2 w-auto bg-white/25 [&>div]:bg-white" />}
      </div>
      <div className="flex min-w-0 flex-col gap-1 p-2">
        <h3 className="text-base/snug font-medium text-balance">
          <Link to={`/title/${work.slug}`} className="outline-none focus-visible:underline">
            <span className="absolute inset-0" aria-hidden />
            {work.titleZh}
          </Link>
          {fav && (
            <span className="pointer-events-none ml-2 inline-block size-2 -translate-y-px rounded-full bg-info">
              <span className="sr-only">（已收藏）</span>
            </span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground">
          {work.year}
          {work.kind === "series" ? ` · ${work.seasons.length} 季` : work.runtimeMin ? ` · ${formatRuntime(work.runtimeMin)}` : ""}
        </p>
      </div>
    </div>
  )
}

const COLS = { 2: "grid-cols-2", 3: "sm:grid-cols-3", 4: "md:grid-cols-4", 5: "lg:grid-cols-5", 6: "xl:grid-cols-6" } as const

/**
 * Poster grid with the reference hairline treatment: column rules drawn by an overlay grid,
 * a full-bleed rule under every row. `wide` adds lg/xl columns for PageWide layouts.
 */
export function WorkGrid({ works, wide, eager = 0 }: { works: Work[]; wide?: boolean; eager?: number }) {
  const cols = wide ? [2, 3, 4, 5, 6] : [2, 3, 4]
  const max = cols[cols.length - 1]
  // Rule i (0-based) sits on the right edge of column i; show it only when column i+1 exists.
  const rule = (i: number) =>
    cn(
      "border-r border-line",
      i >= 1 && "max-sm:hidden",
      i >= 2 && "sm:max-md:hidden",
      i >= 3 && "md:max-lg:hidden",
      i >= 4 && "lg:max-xl:hidden",
      !wide && i >= 3 && "hidden",
    )
  return (
    <div className="relative pt-4">
      <div className={cn("pointer-events-none absolute inset-0 -z-1 grid", cols.map((c) => COLS[c as keyof typeof COLS]))}>
        {Array.from({ length: max - 1 }, (_, i) => (
          <div key={i} className={rule(i)} />
        ))}
      </div>
      <div className="screen-line-bottom h-px" />
      <ul className={cn("grid", cols.map((c) => COLS[c as keyof typeof COLS]))}>
        {works.map((w, i) => (
          <li key={w.slug} className="screen-line-bottom">
            <WorkTile work={w} loading={i < eager ? "eager" : "lazy"} />
          </li>
        ))}
      </ul>
      <div className="h-4" />
    </div>
  )
}

/** Horizontal card for "continue watching". */
export function ResumeCard({ unitId, progress, reason }: { unitId: string; progress: Progress | null; reason: "resume" | "next" }) {
  const u = getUnit(unitId)
  if (!u) return null
  const left = progress ? Math.max(1, Math.round((progress.durationSec - progress.positionSec) / 60)) : u.runtimeMin
  return (
    <Link to={`/watch/${unitId}`} className="group/resume flex items-stretch gap-3 p-3 outline-none transition-[background-color] ease-out hover:bg-accent-muted focus-visible:bg-accent-muted">
      <div className="relative w-16 shrink-0">
        <Poster src={unitPoster(u)} alt="" className="rounded-md transition-[filter] duration-300 pointer-fine:grayscale group-hover/resume:grayscale-0 group-focus-visible/resume:grayscale-0" />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/resume:opacity-100">
          <span className="flex size-8 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-sm">
            <PlayIcon className="size-4 translate-x-px fill-current" />
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-muted-foreground">
            {u.kind === "episode" ? `${u.work.code} · ${episodeCode(u.episode)}` : `电影 · ${u.work.year}`}
          </div>
          <div className="truncate text-sm font-medium">{u.kind === "episode" ? displayTitle(u.episode) : u.work.titleZh}</div>
          {u.kind === "episode" && <div className="truncate text-xs text-muted-foreground">{u.work.titleZh}</div>}
        </div>
        <div className="flex flex-col gap-1.5">
          {progress && reason === "resume" && <ProgressBar value={progress.positionSec / progress.durationSec} />}
          <div className="font-mono text-[11px] text-muted-foreground">{reason === "next" ? "下一集 · 未开始" : `剩余 ${left} 分钟`}</div>
        </div>
      </div>
    </Link>
  )
}
