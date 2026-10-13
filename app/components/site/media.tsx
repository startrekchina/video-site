import type React from "react"
import { CheckIcon } from "lucide-react"
import { Link } from "react-router"

import { formatRuntime, type WorkCard } from "@/lib/catalog"
import { workProgress } from "@/lib/catalog"
import { useState } from "react"
import { cn } from "@/lib/utils"

export function Poster({ src, alt, className, ...props }: React.ComponentProps<"img"> & { src: string; alt: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <div className={cn("diagonal-stripes relative aspect-2/3 overflow-hidden rounded-poster bg-muted", className)}>
      {src && failed !== src && <img onError={() => setFailed(src)} src={src} alt={alt} loading="lazy" decoding="async" {...props} className="relative size-full object-cover select-none" draggable={false} />}
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
    <span className={cn("inline-flex items-center gap-1 rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground", className)}>
      <CheckIcon className="size-3 text-success" />
      已看完
    </span>
  )
}

/** Grid tile used in catalog sections, after the reference PostItem: padded, hover wash, greyscale until hover on fine pointers. */
export function WorkTile({ work, className, loading }: { work: WorkCard; className?: string; loading?: "eager" | "lazy" }) {
  const p = workProgress(work)
  const fav = work.favorite
  const frac = p.total ? p.watched / p.total : 0
  return (
    <div className={cn("group/tile relative flex h-full flex-col gap-2 p-2 transition-[background-color] ease-out hover:bg-accent-muted", className)}>
      <div className="relative">
        <Poster
          src={work.poster}
          alt={work.titleZh}
          loading={loading}
          className="transition-[filter] duration-300 ease-[cubic-bezier(0.42,0,0.58,1)] pointer-fine:grayscale group-hover/tile:grayscale-0 group-has-focus-visible/tile:grayscale-0"
        />
        {work.code && (
          <span className="absolute top-2 left-2 rounded-md bg-zinc-950/65 px-1.5 py-0.5 font-mono text-[10px]/none tracking-wider text-white backdrop-blur-sm">
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
          {work.kind === "series" ? ` · ${work.seasonCount} 季` : work.runtimeMin ? ` · ${formatRuntime(work.runtimeMin)}` : ""}
        </p>
      </div>
    </div>
  )
}

const COLS = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"

/**
 * Poster grid with the reference hairline treatment: column rules drawn by an overlay grid,
 * a full-bleed rule under every row. `rows` caps it at that many full rows from md up
 * (4, 5 and 6 columns); smaller screens show the md count.
 */
export function WorkGrid({ works, rows, eager = 0 }: { works: WorkCard[]; rows?: number; eager?: number }) {
  const shown = rows ? works.slice(0, rows * 6) : works
  const reveal = (i: number) => (!rows || i < rows * 4 ? "" : i < rows * 5 ? "hidden lg:block" : "hidden xl:block")
  // Rule i (0-based) sits on the right edge of column i; show it only when column i+1 exists.
  const rule = (i: number) =>
    cn(
      "border-r border-line",
      i >= 1 && "max-sm:hidden",
      i >= 2 && "sm:max-md:hidden",
      i >= 3 && "md:max-lg:hidden",
      i >= 4 && "lg:max-xl:hidden",
    )
  return (
    <div className="relative pt-4">
      <div className={cn("pointer-events-none absolute inset-0 -z-1", COLS)}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={rule(i)} />
        ))}
      </div>
      <div className="screen-line-bottom h-px" />
      <ul className={COLS}>
        {shown.map((w, i) => (
          <li key={w.slug} className={cn("screen-line-bottom", reveal(i))}>
            <WorkTile work={w} loading={i < eager ? "eager" : "lazy"} />
          </li>
        ))}
      </ul>
      <div className="h-4" />
    </div>
  )
}
