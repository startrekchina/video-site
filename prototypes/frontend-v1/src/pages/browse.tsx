import { useState } from "react"
import { ArrowDownWideNarrowIcon, ArrowUpNarrowWideIcon, ChartNoAxesGanttIcon, LayoutGridIcon, SearchIcon } from "lucide-react"
import { NavLink } from "react-router"

import { MOVIES, SERIES, type WorkKind } from "@/data/catalog"
import { HeadingGap, Page, PageHeading, PageHeadingTagline, PageHeadingTitle } from "@/components/site/panel"
import { WorkGrid } from "@/components/site/media"
import { WorksTimeline } from "@/components/site/works-timeline"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type View = "grid" | "timeline"

const NAV = [
  { to: "/series", label: "剧集", n: SERIES.length },
  { to: "/movies", label: "电影", n: MOVIES.length },
]

export function BrowsePage({ kind }: { kind: WorkKind }) {
  const [q, setQ] = useState("")
  const [desc, setDesc] = useState(false)
  const [view, setView] = useState<View>("grid")
  const all = kind === "series" ? SERIES : MOVIES
  const s = q.trim().toLowerCase()
  const works = all
    .filter((w) => !s || w.titleZh.toLowerCase().includes(s) || w.titleEn.toLowerCase().includes(s) || w.code.toLowerCase() === s)
    .sort((a, b) => (desc ? b.year - a.year : a.year - b.year))

  return (
    <Page>
      <PageHeading>
        <PageHeadingTagline>{kind === "series" ? "剧集" : "电影"}</PageHeadingTagline>
        <PageHeadingTitle>
          {kind === "series" ? "从 1966 年的原初系列，到 2026 年的星际舰队学院。" : "从 1979 年的《无限太空》，到 2025 年的《31 区》。"}
        </PageHeadingTitle>
      </PageHeading>

      <HeadingGap />

      <div className="flex items-center justify-between">
        <nav className="flex items-center whitespace-nowrap" aria-label="分类">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className="border-r border-line p-4 font-mono text-[.8125rem]/4 font-medium tracking-wide text-muted-foreground uppercase transition-[color,background-color] ease-out hover:bg-accent-muted aria-[current=page]:bg-accent-muted aria-[current=page]:text-foreground"
            >
              {n.label} <span className="tabular-nums">({n.n})</span>
            </NavLink>
          ))}
        </nav>
        <div className="mr-2 flex items-center gap-1">
        <ToggleGroup value={[view]} onValueChange={(v) => v[0] && setView(v[0] as View)} size="sm" aria-label="视图">
          <ToggleGroupItem value="grid" aria-label="海报墙">
            <LayoutGridIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="timeline" aria-label="时间轴">
            <ChartNoAxesGanttIcon />
          </ToggleGroupItem>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                onClick={() => setDesc((d) => !d)}
                aria-label={desc ? "改为年份正序" : "改为年份倒序"}
              >
                {desc ? <ArrowDownWideNarrowIcon /> : <ArrowUpNarrowWideIcon />}
              </Button>
            }
          />
          <TooltipContent>{desc ? "当前：年份倒序" : "当前：年份正序"}</TooltipContent>
        </Tooltip>
        </div>
      </div>

      <div className="screen-line-top screen-line-bottom p-2">
        <InputGroup className="rounded-lg shadow-none">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="按中文或英文片名筛选…" aria-label="筛选作品" />
        </InputGroup>
      </div>

      {works.length === 0 ? (
        <div className="screen-line-bottom mt-4 p-4">
          <p className="font-mono text-sm">没有匹配“{q}”的作品。试试英文名或简称，例如 Voyager、DS9。</p>
        </div>
      ) : view === "timeline" ? (
        <WorksTimeline key={`${kind}-${desc}`} works={works} sweep={!desc} className="mt-4" />
      ) : (
        <WorkGrid works={works} eager={6} />
      )}
    </Page>
  )
}
