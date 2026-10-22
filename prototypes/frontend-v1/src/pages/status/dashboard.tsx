import type React from "react"
import { useMemo, useState } from "react"

import {
  COLOS,
  D1_SIZE,
  deployedAt,
  DEPLOYS,
  fmtBytes,
  fmtClock,
  fmtCount,
  fmtDay,
  fmtMbps,
  fmtMs,
  fmtPct,
  outcomes,
  r2Operations,
  RANGES,
  STATUS_CODES,
  telemetry,
  useMinutes,
  type Range,
} from "@/data/status"
import { cn } from "@/lib/utils"
import { Bars, Legend, ShareList, TimeChart, type Series } from "@/components/site/charts"
import { Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { Figure, Footnote, LiveBadge, Stat } from "./shared"

// The status board: a title block of eight readings over numbered figures, then one panel per
// Cloudflare product the site runs on (Workers, R2, D1), deployments and edge breakdowns. One range
// switch drives every series. Uses the wide column.

const WALL: Series[] = [
  { key: "p50", label: "p50" },
  { key: "p95", label: "p95", tone: "soft" },
  { key: "p99", label: "p99", tone: "dashed" },
]
const CPU: Series[] = [
  { key: "cpuP50", label: "p50" },
  { key: "cpuP99", label: "p99", tone: "dashed" },
]
const D1_TIME: Series[] = [
  { key: "d1P50", label: "p50" },
  { key: "d1P90", label: "p90", tone: "dashed" },
]
const QUERIES: Series[] = [
  { key: "reads", label: "读取" },
  { key: "writes", label: "写入", tone: "soft" },
]

const share = <T extends { count: number }>(rows: T[]) => {
  const total = rows.reduce((n, r) => n + r.count, 0)
  return rows.map((r) => ({ ...r, share: r.count / total }))
}

export function Dashboard() {
  const [range, setRange] = useState<Range>("24h")
  const [now] = useState(Date.now)
  const live = useMinutes()
  const { buckets, totals: t } = useMemo(() => telemetry(range, now), [range, now])
  const { label: rangeLabel, bucket } = RANGES[range]
  const rows = buckets.map((b) => ({ ...b, date: new Date(b.t) }))
  const per = bucket === 1 ? "1h" : "1d"

  return (
    <>
      {/* Grid cells paint the background over the bottom screen line (z -1), so lift it above them as the footer does. */}
      <Panel className="after:z-1">
        <div className="screen-line-bottom flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <ToggleGroup variant="outline" size="sm" value={[range]} onValueChange={(v) => v[0] && setRange(v[0] as Range)} aria-label="时间范围">
            {Object.entries(RANGES).map(([key, r]) => (
              <ToggleGroupItem key={key} value={key}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <LiveBadge at={live.at} />
        </div>
        <dl className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
          <Stat label="R2 下行流量" value={fmtBytes(t.bytes)} />
          <Stat label="下行速率 · 1m" value={fmtMbps(live.mbps)} />
          <Stat label="下行峰值 · 1h" value={fmtMbps(t.peakMbps)} />
          <Stat label="请求数" value={fmtCount(t.requests)} />
          <Stat label="错误率" value={fmtPct(t.errors / t.requests, 3)} />
          <Stat label="接口延迟 p95" value={fmtMs(t.p95)} />
          <Stat label="CPU 时间 p99" value={fmtMs(t.cpuP99)} />
          <Stat label="D1 查询" value={fmtCount(t.reads + t.writes)} />
        </dl>
      </Panel>

      <Separator />
      <Figure n="01" title="R2 下行流量" aside={<span className="normal-case">sum / {per}</span>}>
        <TimeChart className="h-60 md:h-80" area data={rows} series={[{ key: "bytes", label: "下行" }]} format={fmtBytes} aria-label={`过去 ${rangeLabel} R2 下行流量`} />
      </Figure>

      <Separator />
      <div className="grid md:grid-cols-2">
        <Figure n="02" title="下行速率" aside={<span className="normal-case">avg / 1m · last 60m</span>}>
          <TimeChart className="h-48 md:h-60" data={live.history.map((m) => ({ date: new Date(m.t), mbps: m.mbps }))} series={[{ key: "mbps", label: "速率" }]} format={(v) => `${Math.round(v)} Mbps`} aria-label={`最近 60 分钟下行速率，${fmtClock(live.at)} 为 ${fmtMbps(live.mbps)}`} />
        </Figure>
        <Figure n="03" title="接口延迟 · wall time" aside={<Legend series={WALL} />} className="md:border-l">
          <TimeChart className="h-48 md:h-60" data={rows} series={WALL} format={fmtMs} aria-label={`过去 ${rangeLabel}接口延迟`} />
        </Figure>
      </div>

      <Separator />
      <Section title="Workers">
        <Cell n="04" title={`请求 / ${per}`}>
          <Bars className="h-48 md:h-60" data={rows} xKey="date" series={[{ key: "requests", label: "请求" }]} format={fmtCount} aria-label={`过去 ${rangeLabel}每 ${per} 请求数`} />
        </Cell>
        <Cell n="05" title="CPU 时间" aside={<Legend series={CPU} />}>
          <TimeChart className="h-48 md:h-60" data={rows} series={CPU} format={fmtMs} aria-label={`过去 ${rangeLabel} CPU 时间`} />
        </Cell>
        <Cell n="06" title="调用结果" flush className="md:col-span-2">
          <ShareList rows={share(outcomes(t))} />
        </Cell>
      </Section>

      <Separator />
      <Section title="R2">
        <Cell n="07" title="操作类型" flush>
          <ShareList rows={share(r2Operations(t))} />
        </Cell>
        <Cell n="08" title="传输" flush>
          <dl className="grid flex-1 grid-cols-2 gap-px bg-line">
            <Stat label="下行" value={fmtBytes(t.bytes)} />
            <Stat label="上行" value={fmtBytes(t.upload)} />
            <Stat label="Class B 操作 · 读取" value={fmtCount(t.classB)} />
            <Stat label="Class A 操作 · 写入与列举" value={fmtCount(t.classA)} />
          </dl>
        </Cell>
      </Section>

      <Separator />
      <Section title="D1">
        <Cell n="09" title={`查询 / ${per}`} aside={<Legend series={QUERIES} />}>
          <Bars className="h-48 md:h-60" stacked data={rows} xKey="date" series={QUERIES} format={fmtCount} aria-label={`过去 ${rangeLabel}每 ${per} D1 查询数`} />
        </Cell>
        <Cell n="10" title="查询耗时" aside={<Legend series={D1_TIME} />}>
          <TimeChart className="h-48 md:h-60" data={rows} series={D1_TIME} format={fmtMs} aria-label={`过去 ${rangeLabel} D1 查询耗时`} />
        </Cell>
        <dl className="grid grid-cols-2 gap-px bg-line md:col-span-2 md:grid-cols-4">
          <Stat label="读取行" value={fmtCount(t.rowsRead)} />
          <Stat label="写入行" value={fmtCount(t.rowsWritten)} />
          <Stat label="查询耗时 p90" value={fmtMs(t.d1P90)} />
          <Stat label="数据库大小" value={fmtBytes(D1_SIZE)} />
        </dl>
      </Section>

      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>部署</PanelTitle>
          <span className="font-mono text-xs text-muted-foreground">最近 {DEPLOYS.length} 次</span>
        </PanelHeader>
        <ol>
          {DEPLOYS.map((d) => {
            const at = deployedAt(d, now)
            return (
              <li key={d.version} className="grid gap-x-6 gap-y-1 px-4 py-3 not-last:screen-line-bottom sm:grid-cols-[8rem_1fr_auto] sm:items-baseline">
                <span className="font-mono text-xs text-muted-foreground">
                  {fmtDay(at)} {fmtClock(at)}
                </span>
                <span className="min-w-0 truncate font-mono text-sm">{d.message}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {d.commit} · 版本 {d.version} · {d.via}
                </span>
              </li>
            )
          })}
        </ol>
      </Panel>

      <Separator />
      <Section title="边缘">
        <Cell n="11" title="边缘节点" flush>
          <ShareList rows={COLOS} />
        </Cell>
        <Cell n="12" title="状态码" flush>
          <ShareList rows={STATUS_CODES} />
        </Cell>
      </Section>
      <Footnote />
    </>
  )
}

/** One Cloudflare product: a panel title over a two-column grid of figure cells. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel className="after:z-1">
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
      </PanelHeader>
      <div className="grid gap-px bg-line md:grid-cols-2">{children}</div>
    </Panel>
  )
}

/** `flush` drops the padding so ruled lists and stat grids run to the cell edges. */
function Cell({ n, title, aside, flush, className, children }: { n: string; title: string; aside?: React.ReactNode; flush?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col bg-background", className)}>
      <h3 className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase shadow-[inset_0_-1px_var(--line)]">
        <span>
          Fig. {n} · <span className="normal-case">{title}</span>
        </span>
        {aside}
      </h3>
      <div className={flush ? "flex flex-1 flex-col" : "p-4"}>{children}</div>
    </section>
  )
}
