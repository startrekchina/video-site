import { useState } from "react"
import { Link, Navigate } from "react-router"

import { WORKS, episodeCode, type Work } from "@/data/catalog"
import { useStore } from "@/data/store"
import { cn } from "@/lib/utils"
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isBackupOwner } from "@/pages/backups"
import { Stat } from "@/pages/status/shared"

// Owner-only, read-only view of what the last import left incomplete. Gaps are named by episode code only;
// storage object keys never reach this page. Fixes go through the offline import tool.

type Report = { work: Work; units: string[]; noVideo: string[]; noZh: string[]; noBilingual: string[]; multi: number }

// Fictional gaps, seeded so every visit shows the same report.
let seed = 7
const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
const NEW_SERIES = new Set(["DIS", "PIC", "LD", "PRO", "SNW", "SFA"])

const REPORT: Report[] = WORKS.map((work) => {
  const units = work.kind === "movie" ? ["正片"] : work.seasons.flatMap((s) => s.episodes.map(episodeCode))
  const notImported = work.code === "SFA" ? units.slice(-3) : []
  const noVideo = units.filter((u) => notImported.includes(u) || rand() < 0.006)
  const playable = units.filter((u) => !noVideo.includes(u))
  return {
    work,
    units,
    noVideo,
    noZh: playable.filter(() => work.code === "TAS" || rand() < 0.03),
    noBilingual: playable.filter(() => rand() < 0.01),
    multi: playable.filter(() => rand() < (NEW_SERIES.has(work.code) ? 0.9 : 0.3)).length,
  }
})

const LAST_IMPORT = { at: "10 月 17 日 21:40", rejected: 3 }

const sum = (f: (r: Report) => number) => REPORT.reduce((n, r) => n + f(r), 0)

function Count({ label, have, of }: { label: string; have: number; of: number }) {
  return (
    <span className={cn(have < of && "text-destructive")}>
      {label} {have}/{of}
    </span>
  )
}

function GapLine({ label, units, total }: { label: string; units: string[]; total: number }) {
  if (!units.length) return null
  const list = total > 1 && units.length === total ? `全部 ${total} 集` : units.length > 6 ? `${units.slice(0, 6).join("、")} 等 ${units.length} 集` : units.join("、")
  return (
    <p className="text-sm text-muted-foreground">
      {label}：<span className="font-mono">{list}</span>
    </p>
  )
}

export function LibraryReportPage() {
  const me = useStore((s) => s.me)
  const [filter, setFilter] = useState<"gaps" | "all">("gaps")
  if (!isBackupOwner(me)) return <Navigate to="/admin" replace />

  const rows = filter === "all" ? REPORT : REPORT.filter((r) => r.noVideo.length + r.noZh.length + r.noBilingual.length > 0)

  return (
    <Page narrow>
      <PageHeading>
        <PageHeadingTagline>站长运维 · 正式站</PageHeadingTagline>
        <PageHeadingTitle>片库完整性.</PageHeadingTitle>
        <PageHeadingDescription>只读报表，依据最近一次导入的结果。缺失的内容用离线导入工具补齐，这里不能修改。</PageHeadingDescription>
      </PageHeading>
      <div className="screen-line-bottom px-4 py-3 text-sm">
        <Link to="/admin" className="link-underline">
          返回管理后台
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
        <Stat label="可播放单元" value={sum((r) => r.units.length - r.noVideo.length)} />
        <Stat label="缺视频" value={sum((r) => r.noVideo.length)} />
        <Stat label="缺中文字幕" value={sum((r) => r.noZh.length)} />
        <Stat label="缺双语字幕" value={sum((r) => r.noBilingual.length)} />
      </dl>
      <p className="screen-line-top px-4 py-3 font-mono text-xs text-muted-foreground">
        最近导入 {LAST_IMPORT.at}（北京时间）· {LAST_IMPORT.rejected} 个文件未通过格式检查，详见导入工具日志
      </p>

      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>按作品</PanelTitle>
          <ToggleGroup aria-label="筛选" value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as typeof filter)} size="sm" variant="outline">
            <ToggleGroupItem value="gaps">有缺失</ToggleGroupItem>
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
          </ToggleGroup>
        </PanelHeader>
        <ul className="divide-y divide-line">
          {rows.map(({ work, units, noVideo, noZh, noBilingual, multi }) => {
            const playable = units.length - noVideo.length
            return (
              <li key={work.slug} className="flex flex-col gap-1.5 p-4">
                <div className="flex items-baseline gap-3">
                  <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{work.code || "电影"}</span>
                  <Link to={`/title/${work.slug}`} className="min-w-0 truncate font-medium hover:underline">
                    {work.titleZh}
                  </Link>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{work.year}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-11 font-mono text-xs text-muted-foreground">
                  <Count label="视频" have={playable} of={units.length} />
                  <Count label="中字" have={playable - noZh.length} of={playable} />
                  <Count label="双语" have={playable - noBilingual.length} of={playable} />
                  <span>多档清晰度 {multi}/{playable}</span>
                </div>
                <div className="pl-11">
                  <GapLine label="缺视频" units={noVideo} total={units.length} />
                  <GapLine label="缺中文字幕" units={noZh} total={playable} />
                  <GapLine label="缺双语字幕" units={noBilingual} total={playable} />
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>
    </Page>
  )
}
