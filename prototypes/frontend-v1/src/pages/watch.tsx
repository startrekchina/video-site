import { useEffect, useRef, useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronRightIcon, PlayIcon, XIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"

import { displayTitle, episodeCode, getUnit, nextUnit, prevUnit, unitPoster, type Unit } from "@/data/catalog"
import { actions, useStore } from "@/data/store"
import { cn } from "@/lib/utils"
import { AddToPlaylist } from "@/components/site/add-to-playlist"
import { Poster, ProgressBar } from "@/components/site/media"
import { Page, Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DetailTop } from "./title"
import { Player, SUBS, type SubtitleLang } from "@/components/site/player"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { ShimmeringText } from "@/components/ui/shimmering-text"
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { NotFoundPage } from "./not-found"
import { CommentsSection } from "./watch-comments"

const NEXT_COUNTDOWN = 10
const TOKEN_LATENCY_MS = 900

/** Holds the player back while the Worker signs a playback token (simulated). */
function TokenGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), TOKEN_LATENCY_MS)
    return () => clearTimeout(t)
  }, [])
  if (ready) return children
  return (
    <div className="absolute inset-0 flex items-center justify-center font-mono text-sm" role="status">
      <ShimmeringText text="正在签发播放凭证…" className="[--color:var(--color-zinc-500)] [--shimmering-color:var(--color-zinc-100)]" />
    </div>
  )
}

function NextUp({ next, onCancel }: { next: Unit; onCancel: () => void }) {
  const navigate = useNavigate()
  const [left, setLeft] = useState(NEXT_COUNTDOWN)
  useEffect(() => {
    if (left <= 0) {
      navigate(`/watch/${next.id}`)
      return
    }
    const t = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left, navigate, next.id])

  if (next.kind !== "episode") return null
  return (
    <div className="pointer-events-auto absolute right-3 bottom-16 flex w-[min(22rem,calc(100%-1.5rem))] gap-3 rounded-xl bg-zinc-950/85 p-3 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md">
      <Poster src={unitPoster(next)} alt="" className="w-14 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-white/60">
            下一集 · {episodeCode(next.episode)} · {left} 秒后自动播放
          </div>
          <div className="truncate text-sm font-medium">{displayTitle(next.episode)}</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="bg-white text-zinc-950 hover:bg-white/85" render={<Link to={`/watch/${next.id}`} />} nativeButton={false}>
            <PlayIcon className="fill-current" data-icon="inline-start" />
            立即播放
          </Button>
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={onCancel}>
            取消
          </Button>
        </div>
      </div>
      <div className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden bg-white/10">
        <div className="h-full bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${((NEXT_COUNTDOWN - left) / NEXT_COUNTDOWN) * 100}%` }} />
      </div>
    </div>
  )
}

function SeasonList({ unit }: { unit: Extract<Unit, { kind: "episode" }> }) {
  const progress = useStore((s) => s.progress)
  const season = unit.work.seasons.find((s) => s.number === unit.episode.season)!
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = listRef.current
    const cur = list?.querySelector<HTMLElement>('[aria-current="page"]')
    if (list && cur) list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 2 + cur.clientHeight / 2
  }, [unit.id])
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          第 {season.number} 季<PanelTitleSup>({season.episodes.length} 集)</PanelTitleSup>
        </PanelTitle>
      </PanelHeader>
      <ol ref={listRef} className="relative max-h-[26rem] divide-y divide-line overflow-y-auto [scrollbar-width:auto]">
        {season.episodes.map((ep) => {
          const p = progress[ep.id]
          const current = ep.id === unit.id
          return (
            <li key={ep.id}>
              <Link
                to={`/watch/${ep.id}`}
                aria-current={current ? "page" : undefined}
                className={cn("flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent-muted", current && "bg-accent")}
              >
                <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{String(ep.number).padStart(2, "0")}</span>
                <span className={cn("min-w-0 flex-1 truncate", current && "font-medium")}>{displayTitle(ep)}</span>
                {current ? (
                  <span className="font-mono text-[11px] text-muted-foreground">正在播放</span>
                ) : p?.watched ? (
                  <CheckIcon className="size-4 text-success" aria-label="已看完" />
                ) : p && p.positionSec > 0 ? (
                  <ProgressBar value={p.positionSec / p.durationSec} className="w-10" />
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">{ep.runtimeMin}′</span>
                )}
              </Link>
            </li>
          )
        })}
      </ol>
      <PanelFooterLink to={`/title/${unit.work.slug}?season=${season.number}`}>全部季</PanelFooterLink>
    </Panel>
  )
}

function StepButton({ unit, dir }: { unit?: Unit; dir: "prev" | "next" }) {
  if (!unit || unit.kind !== "episode") return null
  const label = `${dir === "prev" ? "上一集" : "下一集"} · ${episodeCode(unit.episode)}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button className="size-7 border-none" variant="secondary" size="icon-sm" nativeButton={false} render={<Link to={`/watch/${unit.id}`} aria-label={label} />}>
            {dir === "prev" ? <ArrowLeftIcon /> : <ArrowRightIcon />}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const KEYS: [string, string][] = [
  ["空格", "播放 / 暂停"],
  ["← →", "快退 / 快进"],
  ["↑ ↓", "音量"],
  ["F", "全屏"],
  ["M", "静音"],
  ["C", "切换字幕"],
]

export function WatchPage() {
  const { unitId } = useParams()
  const unit = getUnit(unitId!)
  const viewer = useStore((s) => s.me?.username)
  const pr = useStore((s) => (unitId ? s.progress[unitId] : undefined))
  const [ended, setEnded] = useState(false)
  const [sub, setSub] = useState<SubtitleLang>(() => (localStorage.getItem("proto-sub") as SubtitleLang) || "zh")
  const [startFraction] = useState(() => (pr && !pr.watched ? pr.positionSec / pr.durationSec : 0))

  useEffect(() => setEnded(false), [unitId])
  useEffect(() => localStorage.setItem("proto-sub", sub), [sub])

  if (!unit) return <NotFoundPage />
  const next = nextUnit(unit.id)
  const dur = unit.runtimeMin * 60

  return (
    <Page>
      <DetailTop
        back={`/title/${unit.work.slug}${unit.kind === "episode" ? `?season=${unit.episode.season}` : ""}`}
        backLabel={unit.work.titleZh}
        right={
          <>
            <span className="font-mono text-xs text-muted-foreground max-sm:hidden">
              {unit.kind === "episode" ? `${unit.work.code} · ${episodeCode(unit.episode)}` : `电影 · ${unit.work.year}`}
            </span>
            <StepButton unit={prevUnit(unit.id)} dir="prev" />
            <StepButton unit={next} dir="next" />
          </>
        }
        title={unit.kind === "episode" ? displayTitle(unit.episode) : unit.work.titleZh}
      />
      <div className="h-4" />
      <div className="screen-line-top screen-line-bottom bg-black">
        {/* Height-capped so the controls stay above the fold: 15rem is the header and title block above the player. */}
        <div className="relative mx-auto aspect-video w-full max-w-[max(40rem,calc((100svh-15rem)*16/9))]">
          <TokenGate key={unit.id}>
            <Player
              unitKey={unit.id}
              startFraction={startFraction}
              subtitle={sub}
              onSubtitleChange={setSub}
              onReport={(f) => actions.reportProgress(unit.id, Math.round(f * dur), dur)}
              onEnded={() => setEnded(true)}
              endOverlay={ended && next ? <NextUp key={next.id} next={next} onCancel={() => setEnded(false)} /> : null}
            />
          </TokenGate>
        </div>
      </div>

      <div className="h-4" />
      <div className="screen-line-top screen-line-bottom grid md:grid-cols-[1fr_16rem]">
        <div className="min-w-0 p-4">
          <div className="font-mono text-xs text-muted-foreground">{unit.kind === "episode" ? `${unit.work.titleZh} · 第 ${unit.episode.season} 季 第 ${unit.episode.number} 集` : `电影 · ${unit.work.year}`}</div>
          <p className="mt-2 text-muted-foreground">{unit.kind === "episode" ? (unit.episode.overviewZh ?? unit.episode.overviewEn) : (unit.work.overviewZh ?? unit.work.overviewEn)}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Tabs value={sub} onValueChange={(v) => setSub(v as SubtitleLang)}>
              <TabsList aria-label="字幕">
                {SUBS.map((s) => (
                  <TabsTrigger key={s.lang} value={s.lang} className="px-3">
                    {s.label}
                  </TabsTrigger>
                ))}
                <TabsIndicator />
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={() => actions.setWatched(unit.id, !pr?.watched)}>
              {pr?.watched ? <CheckIcon className="text-success" data-icon="inline-start" /> : null}
              {pr?.watched ? "已看完" : "标记为已看"}
            </Button>
            <AddToPlaylist item={unit.kind === "episode" ? { type: "unit", id: unit.id } : { type: "work", slug: unit.work.slug }} size="sm" />
            {next && (
              <Button variant="ghost" size="sm" render={<Link to={`/watch/${next.id}`} />} nativeButton={false}>
                下一集
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            )}
          </div>
          {pr && !pr.watched && pr.positionSec > 0 && (
            <div className="mt-4 flex items-center gap-3 font-mono text-xs text-muted-foreground">
              <ProgressBar value={pr.positionSec / pr.durationSec} className="max-w-48" />
              已保存进度 {Math.round((pr.positionSec / pr.durationSec) * 100)}%
            </div>
          )}
        </div>
        <aside className="border-t border-line p-4 md:border-t-0 md:border-l max-sm:hidden" aria-label="键盘快捷键">
          <div className="mb-2 text-sm font-medium">键盘快捷键</div>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
            {KEYS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      {unit.kind === "episode" && (
        <>
          <Separator />
          <SeasonList unit={unit} />
        </>
      )}

      <Separator />
      <CommentsSection key={`${unit.id}:${viewer}`} unitId={unit.id} kind={unit.kind} />

      {ended && !next && unit.kind === "episode" && (
        <div className="fixed inset-x-0 bottom-20 z-40 mx-auto flex w-fit items-center gap-3 rounded-xl bg-popover px-4 py-3 text-sm shadow-lg ring-1 ring-foreground/10">
          这是本剧的最后一集
          <Button size="icon-sm" variant="ghost" onClick={() => setEnded(false)} aria-label="关闭">
            <XIcon />
          </Button>
        </div>
      )}
    </Page>
  )
}
