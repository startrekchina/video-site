import type React from "react"

import { fmtClock } from "@/data/status"
import { cn } from "@/lib/utils"
import { Panel } from "@/components/site/panel"

/** A title-block cell, as in the footer: small label over a mono reading. */
export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xl tabular-nums">{value}</dd>
    </div>
  )
}

export function StatusDot({ live, className }: { live?: boolean; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-success", live && "animate-pulse motion-reduce:animate-none", className)} />
}

export function LiveBadge({ at }: { at: number }) {
  return (
    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
      <StatusDot live className="size-1.5" />
      数据截至 {fmtClock(at)} UTC+8
    </span>
  )
}

/** A chart plate with the drawing's "Fig. nn" strip on top, like the guest star chart. */
export function Figure({ n, title, aside, className, children }: { n: string; title: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <Panel className={className}>
      <div className="screen-line-bottom flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        <span>
          Fig. {n} · <span className="normal-case">{title}</span>
        </span>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </Panel>
  )
}

export function Footnote() {
  return <p className="px-4 py-3 font-mono text-xs text-muted-foreground">数据来源 Cloudflare</p>
}
