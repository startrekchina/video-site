import { curveMonotoneX } from "@visx/curve"
import { useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Area } from "@/components/charts/area"
import { AreaChart } from "@/components/charts/area-chart"
import { Bar } from "@/components/charts/bar"
import { Background } from "@/components/charts/background"
import { BarChart } from "@/components/charts/bar-chart"
import { BarXAxis } from "@/components/charts/bar-x-axis"
import { Line } from "@/components/charts/line"
import { LineChart } from "@/components/charts/line-chart"
import { ChartTooltip } from "@/components/charts/tooltip"
import { XAxis } from "@/components/charts/x-axis"
import { YAxis } from "@/components/charts/y-axis"

// The site's conventions over bklit charts (src/components/charts): monochrome series told apart by
// weight and dash, Geist Mono labels, the site's 8px dot field in place of grid lines.

export type Series = { key: string; label: string; tone?: keyof typeof TONES }

const TONES = {
  strong: { color: "var(--chart-1)", dashed: false },
  soft: { color: "var(--chart-2)", dashed: false },
  dashed: { color: "var(--chart-2)", dashed: true },
}

const PLOT_MARGIN = { top: 12, right: 12, bottom: 32, left: 64 }
// Twice the site's dot-grid rhythm (16px), so the field reads as graph paper rather than a tint; faded towards the plot edges.
const DOTS = <Background pattern="dots" color="var(--chart-4)" scale={1.6} radius={0.75} />
// Ticks are round values; drop the reading format's all-zero decimals ("400.0 GB") so labels fit the left margin.
const tick = (format: (v: number) => string) => (v: number) => format(v).replace(/\.0+(?=\D*$)/, "")

/** Time series over `data` rows keyed by `date`; `area` shades the single series. */
export function TimeChart({
  data,
  series,
  format,
  area,
  className,
  "aria-label": ariaLabel,
}: {
  data: Record<string, unknown>[]
  series: Series[]
  format: (v: number) => string
  area?: boolean
  className?: string
  "aria-label": string
}) {
  const reduced = useReducedMotion()
  const Chart = area ? AreaChart : LineChart
  return (
    <div role="img" aria-label={ariaLabel} className={cn("font-mono", className)}>
      <Chart data={data} aspectRatio="" className="h-full" margin={PLOT_MARGIN} animationDuration={reduced ? 0 : 900} yDomainTween={!reduced}>
        {DOTS}
        {series.map((s) => {
          const tone = TONES[s.tone ?? "strong"]
          return area ? (
            <Area key={s.key} animate={!reduced} dataKey={s.key} fill={tone.color} fillOpacity={0.14} strokeWidth={1.5} fadeEdges={false} />
          ) : (
            <Line key={s.key} animate={!reduced} dataKey={s.key} stroke={tone.color} strokeWidth={1.5} fadeEdges={false} curve={curveMonotoneX} dashFromIndex={tone.dashed ? 0 : undefined} dashArray="3,3" />
          )
        })}
        <YAxis numTicks={4} formatValue={tick(format)} />
        <XAxis numTicks={5} />
        <ChartTooltip rows={(p) => series.map((s) => ({ color: TONES[s.tone ?? "strong"].color, label: s.label, value: format(p[s.key] as number) }))} />
      </Chart>
    </div>
  )
}

/** Category bars, e.g. requests per bucket or operations by type. */
export function Bars({
  data,
  xKey,
  series,
  format,
  stacked,
  className,
  "aria-label": ariaLabel,
}: {
  data: Record<string, unknown>[]
  xKey: string
  series: Series[]
  format: (v: number) => string
  stacked?: boolean
  className?: string
  "aria-label": string
}) {
  const reduced = useReducedMotion()
  return (
    <div role="img" aria-label={ariaLabel} className={cn("font-mono", className)}>
      <BarChart data={data} xDataKey={xKey} aspectRatio="" className="h-full" margin={PLOT_MARGIN} stacked={stacked} animationDuration={reduced ? 0 : 900}>
        {DOTS}
        {series.map((s) => (
          <Bar key={s.key} animate={!reduced} dataKey={s.key} fill={TONES[s.tone ?? "strong"].color} lineCap="butt" />
        ))}
        <YAxis numTicks={4} formatValue={tick(format)} />
        <BarXAxis maxLabels={4} />
        <ChartTooltip rows={(p) => series.map((s) => ({ color: TONES[s.tone ?? "strong"].color, label: s.label, value: format(p[s.key] as number) }))} />
      </BarChart>
    </div>
  )
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground normal-case">
      {series.map((s) => {
        const tone = TONES[s.tone ?? "strong"]
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn("w-4 border-t-[1.5px]", tone.dashed && "border-dashed")} style={{ borderColor: tone.color }} />
            {s.label}
          </li>
        )
      })}
    </ul>
  )
}

/** Shares as square-ended bars, largest first as given; ruled rows that run to the edges of a flush cell. */
export function ShareList({ rows }: { rows: { key: string; share: number }[] }) {
  return (
    <ul className="grid grid-cols-[auto_1fr_auto] gap-x-3 divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key} className="col-span-3 grid grid-cols-subgrid items-center px-4 py-3">
          <span className="font-mono text-xs">{r.key}</span>
          <span className="h-1 bg-muted">
            <span className="block h-full bg-foreground" style={{ width: `${Math.max(r.share * 100, 0.5)}%` }} />
          </span>
          <span className="text-right font-mono text-xs tabular-nums">{r.share > 0 && r.share < 1e-4 ? "<0.01" : (r.share * 100).toFixed(r.share < 0.01 ? 2 : 1)}%</span>
        </li>
      ))}
    </ul>
  )
}
