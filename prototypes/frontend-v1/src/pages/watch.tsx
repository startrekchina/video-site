import { useEffect, useRef, useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronRightIcon, ListVideoIcon, PlayIcon, XIcon } from "lucide-react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"

import { displayTitle, episodeCode, getUnit, nextUnit, prevUnit, unitPoster, type Unit } from "@/data/catalog"
import { actions, useStore, type Playlist } from "@/data/store"
import { cn } from "@/lib/utils"
import { AddToPlaylist } from "@/components/site/add-to-playlist"
import { Poster, ProgressBar } from "@/components/site/media"
import { Page, Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DetailTop } from "./title"
import { Player, qualitySources, type SubtitleLang } from "@/components/site/player"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { ShimmeringText } from "@/components/ui/shimmering-text"
import { NotFoundPage } from "./not-found"
import { expandQueue } from "./playlist"
import { CommentsSection } from "./watch-comments"
import { DanmakuAdmin, DanmakuBlockWords } from "./watch-danmaku"

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
      <ShimmeringText text="正在准备播放…" className="[--color:var(--color-zinc-500)] [--shimmering-color:var(--color-zinc-100)]" />
    </div>
  )
}

function NextUp({ next, href, fromQueue, onCancel }: { next: Unit; href: string; fromQueue: boolean; onCancel: () => void }) {
  const navigate = useNavigate()
  const [left, setLeft] = useState(NEXT_COUNTDOWN)
  useEffect(() => {
    if (left <= 0) {
      navigate(href)
      return
    }
    const t = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left, navigate, href])

  const code = next.kind === "movie" ? "电影" : fromQueue ? `${next.work.code} ${episodeCode(next.episode)}` : episodeCode(next.episode)
  return (
    <div className="pointer-events-auto absolute right-3 bottom-16 flex w-[min(22rem,calc(100%-1.5rem))] gap-3 rounded-xl bg-zinc-950/85 p-3 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md">
      <Poster src={unitPoster(next)} alt="" className="w-14 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-white/60">
            {fromQueue ? "片单" : "下一集"} · {code} · {left} 秒后自动播放
          </div>
          <div className="truncate text-sm font-medium">{next.kind === "episode" ? displayTitle(next.episode) : next.work.titleZh}</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="bg-white text-zinc-950 hover:bg-white/85" render={<Link to={href} />} nativeButton={false}>
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

function StepButton({ unit, dir, search }: { unit?: Unit; dir: "prev" | "next"; search: string }) {
  if (!unit || unit.kind !== "episode") return null
  const label = `${dir === "prev" ? "上一集" : "下一集"} · ${episodeCode(unit.episode)}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button className="size-7 border-none" variant="secondary" size="icon-sm" nativeButton={false} render={<Link to={`/watch/${unit.id}${search}`} aria-label={label} />}>
            {dir === "prev" ? <ArrowLeftIcon /> : <ArrowRightIcon />}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Shown while a playlist plays in order, so the next item is no surprise when this one ends. */
function QueueBar({ playlist, watched, current, next }: { playlist: Playlist; watched: boolean[]; current: number; next?: Unit }) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    <div className={cn("screen-line-bottom grid", next && "sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
      <div className="flex min-w-0 items-center gap-4 px-4 py-3">
        <ListVideoIcon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-muted-foreground tabular-nums">
            按顺序播放 · {pad(current + 1)} / {pad(watched.length)}
            {!next && " · 最后一项"}
          </div>
          <Link to={`/playlists/${playlist.id}`} className="block truncate font-medium hover:underline">
            {playlist.title}
          </Link>
        </div>
        {/* One segment per item; long playlists fall back to a plain bar so segments stay visible. */}
        {watched.length <= 24 ? (
          <ol className="flex w-28 shrink-0 gap-0.5 sm:w-40" aria-hidden>
            {watched.map((w, i) => (
              <li key={i} className={cn("h-1 flex-1", i === current ? "bg-foreground" : w ? "bg-foreground/40" : "bg-foreground/10")} />
            ))}
          </ol>
        ) : (
          <ProgressBar value={(current + 1) / watched.length} className="w-28 shrink-0 sm:w-40" />
        )}
      </div>
      {next && (
        <Link
          to={`/watch/${next.id}?playlist=${playlist.id}`}
          className="group flex min-w-0 items-center gap-3 border-t border-line px-4 py-3 transition-[background-color] ease-out hover:bg-accent-muted sm:border-t-0 sm:border-l"
        >
          <Poster src={unitPoster(next)} alt="" className="w-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs text-muted-foreground">下一项 · {next.kind === "episode" ? `${next.work.code} ${episodeCode(next.episode)}` : `电影 · ${next.work.year}`}</div>
            <div className="truncate text-sm font-medium">{next.kind === "episode" ? displayTitle(next.episode) : next.work.titleZh}</div>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform ease-out group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  )
}

export function WatchPage() {
  const { unitId } = useParams()
  const unit = getUnit(unitId!)
  const viewer = useStore((s) => s.me?.username)
  const isAdmin = useStore((s) => s.me?.role === "admin")
  const pr = useStore((s) => (unitId ? s.progress[unitId] : undefined))
  const progress = useStore((s) => s.progress)
  const playlistId = useSearchParams()[0].get("playlist")
  const playlist = useStore((s) => s.playlists.find((p) => p.id === playlistId))
  const [ended, setEnded] = useState(false)
  const [sub, setSub] = useState<SubtitleLang>(() => (localStorage.getItem("proto-sub") as SubtitleLang) || "zh")
  const [startFraction] = useState(() => (pr && !pr.watched ? pr.positionSec / pr.durationSec : 0))
  const [quality, setQuality] = useState(() => localStorage.getItem("proto-quality"))
  const emitterSlot = useRef<HTMLDivElement>(null)

  useEffect(() => setEnded(false), [unitId])
  useEffect(() => localStorage.setItem("proto-sub", sub), [sub])
  useEffect(() => void (quality && localStorage.setItem("proto-quality", quality)), [quality])

  if (!unit) return <NotFoundPage />
  // ?playlist= only counts when the playlist is readable and holds this unit; otherwise this is a plain watch page.
  const queue = playlist ? expandQueue(playlist.items) : []
  const position = queue.findIndex((u) => u.id === unit.id)
  const inQueue = position >= 0
  const next = inQueue ? queue.slice(position + 1).find((u) => !progress[u.id]?.watched) : nextUnit(unit.id)
  const search = inQueue ? `?playlist=${playlist!.id}` : ""
  const dur = unit.runtimeMin * 60
  // The original title only when the heading shows a translation.
  const facts =
    unit.kind === "episode"
      ? [unit.episode.titleZh && unit.episode.titleEn, unit.episode.airDate && `${unit.episode.airDate} 首播`, `${unit.runtimeMin} 分钟`]
      : [unit.work.titleEn !== unit.work.titleZh && unit.work.titleEn, `${unit.work.year} 年`, `${unit.runtimeMin} 分钟`]
  const sources = qualitySources(unit)

  return (
    <Page>
      <DetailTop
        back={inQueue ? `/playlists/${playlist!.id}` : `/title/${unit.work.slug}${unit.kind === "episode" ? `?season=${unit.episode.season}` : ""}`}
        backLabel={inQueue ? playlist!.title : unit.work.titleZh}
        right={
          <>
            <span className="font-mono text-xs text-muted-foreground max-sm:hidden">
              {unit.kind === "episode" ? `${unit.work.code} · ${episodeCode(unit.episode)}` : `电影 · ${unit.work.year}`}
            </span>
            <StepButton unit={prevUnit(unit.id)} dir="prev" search={search} />
            <StepButton unit={nextUnit(unit.id)} dir="next" search={search} />
          </>
        }
        title={unit.kind === "episode" ? displayTitle(unit.episode) : unit.work.titleZh}
      />
      <div className="h-4" />
      {/* z-[41] keeps ArtPlayer's own layers (control bar z-60) under the sticky header (z-50) but above the bottom fade (z-40), as in the formal app. */}
      <div className="screen-line-top screen-line-bottom relative z-[41] bg-black">
        {/* Full width, height-capped so the controls stay above the fold (15rem is the header and title block); the video letterboxes inside the player. */}
        <div className="relative aspect-video w-full max-h-[max(22.5rem,calc(100svh-15rem))]">
          <TokenGate key={unit.id}>
            <Player
              unitKey={unit.id}
              startFraction={startFraction}
              subtitle={sub}
              onSubtitleChange={setSub}
              sources={sources}
              quality={quality}
              onQualityChange={setQuality}
              viewer={viewer ?? ""}
              onDanmakuError={(title) => toast.add({ title, type: "error" })}
              emitterSlot={emitterSlot}
              onReport={(f) => actions.reportProgress(unit.id, Math.round(f * dur), dur)}
              onEnded={() => setEnded(true)}
              endOverlay={ended && next ? <NextUp key={next.id} next={next} href={`/watch/${next.id}${search}`} fromQueue={inQueue} onCancel={() => setEnded(false)} /> : null}
            />
          </TokenGate>
        </div>
        <div ref={emitterSlot} className="px-2 pb-2 empty:hidden" />
      </div>

      {inQueue && <QueueBar playlist={playlist!} watched={queue.map((u) => !!progress[u.id]?.watched)} current={position} next={next} />}
      {/* Only what the player can't do: subtitles, next episode and resume already live in the player, the title bar and the season list. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Button variant="outline" size="sm" onClick={() => actions.setWatched(unit.id, !pr?.watched)}>
          {pr?.watched ? <CheckIcon className="text-success" data-icon="inline-start" /> : null}
          {pr?.watched ? "已看完" : "标记为已看"}
        </Button>
        <AddToPlaylist item={unit.kind === "episode" ? { type: "unit", id: unit.id } : { type: "work", slug: unit.work.slug }} size="sm" />
        <div className="ml-auto flex gap-2">
          <DanmakuBlockWords />
          {isAdmin && <DanmakuAdmin unitId={unit.id} />}
        </div>
      </div>
      <div className="screen-line-top screen-line-bottom flex flex-col gap-2 p-4">
        <p className="font-mono text-xs text-muted-foreground">{facts.filter(Boolean).join(" · ")}</p>
        <p className="text-pretty text-muted-foreground">{unit.kind === "episode" ? (unit.episode.overviewZh ?? unit.episode.overviewEn) : (unit.work.overviewZh ?? unit.work.overviewEn)}</p>
      </div>

      {unit.kind === "episode" && (
        <>
          <Separator />
          <SeasonList unit={unit} />
        </>
      )}

      <Separator />
      <CommentsSection key={`${unit.id}:${viewer}`} unitId={unit.id} kind={unit.kind} />

      {ended && !next && (inQueue || unit.kind === "episode") && (
        <div className="fixed inset-x-0 bottom-20 z-40 mx-auto flex w-fit items-center gap-3 rounded-xl bg-popover px-4 py-3 text-sm shadow-lg ring-1 ring-foreground/10">
          {inQueue ? (
            <>
              片单已播放完
              <Link to={`/playlists/${playlist!.id}`} className="link-underline">
                返回片单
              </Link>
            </>
          ) : (
            "这是本剧的最后一集"
          )}
          <Button size="icon-sm" variant="ghost" onClick={() => setEnded(false)} aria-label="关闭">
            <XIcon />
          </Button>
        </div>
      )}
    </Page>
  )
}
