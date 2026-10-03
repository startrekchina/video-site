import { Link } from "react-router"

import type { Work } from "@/data/catalog"
import { cn } from "@/lib/utils"
import {
  TimescaleAge,
  TimescaleContent,
  TimescaleHeader,
  TimescaleIntroScroll,
  TimescaleItem,
  TimescaleRail,
  TimescaleRoot,
  TimescaleTick,
  TimescaleTrack,
  TimescaleViewport,
  TimescaleYear,
} from "@/components/ui/timescale"

import { Poster } from "./media"

function Timeline({ works, ...props }: { works: Work[] } & React.ComponentProps<typeof TimescaleRoot>) {
  const series = works[0]?.kind === "series"
  return (
    <TimescaleRoot {...props}>
      <TimescaleHeader>
        <TimescaleAge>{series ? "简称" : "序号"}</TimescaleAge>
        <TimescaleYear>首映</TimescaleYear>
      </TimescaleHeader>

      <TimescaleViewport>
        <TimescaleTrack>
          <TimescaleRail />
          {works.map((w, i) => (
            <TimescaleItem key={w.slug}>
              <TimescaleTick />
              <TimescaleAge className="font-mono">{series ? w.code : String(i + 1).padStart(2, "0")}</TimescaleAge>
              <TimescaleYear className="font-mono">{w.year}</TimescaleYear>
              <TimescaleContent>
                <Link
                  to={`/title/${w.slug}`}
                  className="group/tl flex gap-3 rounded-lg p-1 outline-none transition-[background-color] ease-out hover:bg-accent-muted focus-visible:inset-ring-2 focus-visible:inset-ring-ring/50"
                >
                  <Poster
                    src={w.poster}
                    alt=""
                    className="w-16 shrink-0 transition-[filter] duration-300 pointer-fine:grayscale group-hover/tl:grayscale-0 group-focus-visible/tl:grayscale-0"
                  />
                  <div className="flex min-w-0 flex-col gap-1 py-1">
                    <span className="font-medium text-balance">{w.titleZh}</span>
                    <span className="text-xs text-muted-foreground">{w.titleEn}</span>
                    <span className="mt-auto font-mono text-xs text-muted-foreground">
                      {w.kind === "series" ? `${w.seasons.length} 季` : w.runtimeMin ? `${w.runtimeMin} 分钟` : null}
                    </span>
                  </div>
                </Link>
              </TimescaleContent>
            </TimescaleItem>
          ))}
        </TimescaleTrack>
      </TimescaleViewport>
    </TimescaleRoot>
  )
}

/** Works plotted by premiere year; horizontal on desktop, vertical on phones (after chanhdai.com/timeline). */
export function WorksTimeline({ works, sweep, className }: { works: Work[]; sweep?: boolean; className?: string }) {
  return (
    <div className={cn("screen-line-top screen-line-bottom", className)}>
      <div className="h-3" />
      {sweep ? (
        <TimescaleIntroScroll>
          <Timeline works={works} orientation="horizontal" className="hidden md:flex" />
        </TimescaleIntroScroll>
      ) : (
        <Timeline works={works} orientation="horizontal" className="hidden md:flex" />
      )}
      <Timeline works={works} orientation="vertical" className="px-4 md:hidden" />
    </div>
  )
}
