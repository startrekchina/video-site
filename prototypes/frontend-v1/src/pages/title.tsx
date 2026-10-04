import type React from "react"
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon, CheckIcon, CircleCheckIcon, CircleIcon, ClockIcon, DatabaseIcon, HeartIcon, LayersIcon, PlayIcon } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router"

import { displayTitle, episodeCode, formatRuntime, getWork, MOVIES, SERIES, type Episode, type Work } from "@/data/catalog"
import { actions, useStore, workProgress, type Progress } from "@/data/store"
import { cn } from "@/lib/utils"
import { AddToPlaylist } from "@/components/site/add-to-playlist"
import { EpisodeStill } from "@/components/site/episode-still"
import { Poster, ProgressBar, WatchedBadge } from "@/components/site/media"
import { Page, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { IconTile } from "@/components/ui/icon-tile"
import { Button } from "@/components/ui/button"
import { Tag } from "@/components/ui/tag"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { NotFoundPage } from "./not-found"

function FavoriteButton({ slug }: { slug: string }) {
  const fav = useStore((s) => s.favorites.includes(slug))
  return (
    <Button variant="outline" onClick={() => actions.toggleFavorite(slug)} aria-pressed={fav}>
      <HeartIcon data-icon="inline-start" className={cn(fav && "fill-current text-red-500")} />
      {fav ? "已收藏" : "收藏"}
    </Button>
  )
}

function Overview({ work }: { work: Work }) {
  const zhMissing = !work.overviewZh
  return (
    <div className="typeset typeset-description text-muted-foreground">
      <p>
        {work.overviewZh ?? work.overviewEn}
        {zhMissing && (
          <Tag className="ml-2 align-middle" title="中文资料缺失，显示英文">
            EN
          </Tag>
        )}
      </p>
    </div>
  )
}

function Neighbour({ work, dir }: { work?: Work; dir: "prev" | "next" }) {
  if (!work) return null
  const label = `${dir === "prev" ? "上一部" : "下一部"}：${work.titleZh}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button className="size-7 border-none" variant="secondary" size="icon-sm" nativeButton={false} render={<Link to={`/title/${work.slug}`} aria-label={label} />}>
            {dir === "prev" ? <ArrowLeftIcon /> : <ArrowRightIcon />}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Detail-page chrome after the reference blog post: back link + neighbours, spacer strip, 4xl title. */
export function DetailTop({ back, backLabel, right, title }: { back: string; backLabel: string; right?: React.ReactNode; title: React.ReactNode }) {
  return (
    <>
      <div className="screen-line-bottom h-px" />
      <div className="flex items-center justify-between gap-2 p-2 pl-4">
        <Button
          className="h-7 min-w-0 gap-2 border-none px-0 tracking-wider text-muted-foreground hover:text-foreground hover:no-underline"
          variant="link"
          size="sm"
          nativeButton={false}
          render={<Link to={back} />}
        >
          <ArrowLeftIcon />
          <span className="truncate">{backLabel}</span>
        </Button>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      </div>
      <div className="screen-line-top screen-line-bottom py-px">
        <div className="h-4" />
      </div>
      <h1 className="screen-line-bottom px-4 text-4xl font-medium tracking-tight text-balance">{title}</h1>
    </>
  )
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 font-mono text-sm">
      <IconTile>{icon}</IconTile>
      <p className="min-w-0 text-balance">{children}</p>
    </div>
  )
}

function Header({ work, primary }: { work: Work; primary: React.ReactNode }) {
  const p = useStore((s) => workProgress(s, work.slug))
  const list = work.kind === "series" ? SERIES : MOVIES
  const i = list.indexOf(work)
  return (
    <>
      <DetailTop
        back={work.kind === "series" ? "/series" : "/movies"}
        backLabel={work.kind === "series" ? "剧集" : "电影"}
        right={
          <>
            <Neighbour work={list[i - 1]} dir="prev" />
            <Neighbour work={list[i + 1]} dir="next" />
          </>
        }
        title={work.titleZh}
      />
      <div className="screen-line-bottom grid grid-cols-[auto_1fr]">
        <figure className="group/poster relative border-r border-line p-2">
          <Poster src={work.poster} alt={`${work.titleZh} 海报`} className="w-28 transition-[filter] duration-300 sm:w-40 pointer-fine:grayscale group-hover/poster:grayscale-0" fetchPriority="high" loading="eager" />
        </figure>
        <div className="flex min-w-0 flex-col">
          <p className="screen-line-bottom px-4 py-3 text-muted-foreground text-balance">{work.titleEn}</p>
          <div className="grid content-start gap-2.5 p-4">
            <Meta icon={<CalendarIcon />}>{work.year}</Meta>
            {work.kind === "series" ? (
              <>
                <Meta icon={<LayersIcon />}>
                  {work.seasons.length} 季 · {p.total} 集
                </Meta>
                <Meta icon={<CircleCheckIcon />}>
                  已看 {p.watched}/{p.total}
                </Meta>
              </>
            ) : (
              <Meta icon={<ClockIcon />}>{formatRuntime(work.runtimeMin!)}</Meta>
            )}
            <Meta icon={<DatabaseIcon />}>
              TMDB {work.tmdbId}
            </Meta>
          </div>
          <div className="mt-auto flex flex-wrap gap-2 border-t border-line p-4 max-sm:hidden">{primary}</div>
        </div>
        <div className="col-span-2 flex flex-wrap gap-2 border-t border-line p-4 sm:hidden">{primary}</div>
      </div>
    </>
  )
}

function EpisodeRow({ ep }: { ep: Episode }) {
  const pr = useStore((s) => s.progress[ep.id])
  const watched = !!pr?.watched
  const inProgress = pr && !pr.watched && pr.positionSec > 0
  const zhMissing = !ep.titleZh
  return (
    <li className="group/ep relative flex items-stretch hover:bg-accent-muted">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground sm:w-16">
        <span className="tabular-nums">{String(ep.number).padStart(2, "0")}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-dashed border-line py-3 pr-2 pl-3 sm:gap-3 sm:pl-4">
        <EpisodeStill src={ep.still} />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 leading-snug font-medium">
            <Link to={`/watch/${ep.id}`} className="truncate outline-none after:absolute after:inset-0 focus-visible:underline">
              {displayTitle(ep)}
            </Link>
            {zhMissing && <Tag className="shrink-0">EN</Tag>}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground max-sm:line-clamp-1">{ep.overviewZh ?? ep.overviewEn}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{episodeCode(ep)}</span>
            <span className="whitespace-nowrap">{ep.runtimeMin} 分钟</span>
            {watched && <span className="max-sm:basis-full"><WatchedBadge /></span>}
            {inProgress && (
              <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-1 sm:basis-auto">
                <ProgressBar value={pr.positionSec / pr.durationSec} className="w-12 shrink-0 sm:w-16" />
                <span className="whitespace-nowrap">剩 {Math.round((pr.durationSec - pr.positionSec) / 60)} 分钟</span>
              </span>
            )}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative z-1 text-muted-foreground"
                aria-label={watched ? "标记为未看" : "标记为已看"}
                aria-pressed={watched}
                onClick={() => actions.setWatched(ep.id, !watched)}
              >
                {watched ? <CheckIcon className="text-success" /> : <CircleIcon />}
              </Button>
            }
          />
          <TooltipContent>{watched ? "标记为未看" : "标记为已看"}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  )
}

function SeriesBody({ work }: { work: Work }) {
  const [params, setParams] = useSearchParams()
  const progress = useStore((s) => s.progress)
  const seasonNo = Number(params.get("season")) || 1
  const season = work.seasons.find((s) => s.number === seasonNo) ?? work.seasons[0]
  const watchedIn = (n: number) => work.seasons.find((s) => s.number === n)!.episodes.filter((e) => progress[e.id]?.watched).length

  return (
    <Panel id="episodes">
      <PanelHeader className="flex-col items-stretch gap-0 px-0">
        <div className="px-4">
          <PanelTitle>
            第 {season.number} 季<PanelTitleSup>({season.episodes.length} 集)</PanelTitleSup>
          </PanelTitle>
        </div>
      </PanelHeader>
      {/* The hairline sits outside the scroller: its 200vw pseudo-element would otherwise widen the scroll range. */}
      <div className="screen-line-bottom">
        <nav className="no-scrollbar flex scroll-fade-x overflow-x-auto" aria-label="选择季">
          {work.seasons.map((s) => {
            const w = watchedIn(s.number)
            const active = s.number === season.number
            return (
              <button
                key={s.number}
                onClick={() => setParams({ season: String(s.number) }, { replace: true, preventScrollReset: true })}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex shrink-0 flex-col border-r border-line px-4 py-2 text-left text-muted-foreground transition-[color,background-color] ease-out outline-none hover:bg-accent-muted hover:text-foreground focus-visible:inset-ring-2 focus-visible:inset-ring-ring/50",
                  active && "bg-accent-muted text-foreground",
                )}
              >
                <span className="font-mono text-[.8125rem]/4 font-medium tracking-wide">S{String(s.number).padStart(2, "0")}</span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {w}/{s.episodes.length}
                </span>
              </button>
            )
          })}
        </nav>
      </div>
      <ol className="divide-y divide-line">
        {season.episodes.map((ep) => (
          <EpisodeRow key={ep.id} ep={ep} />
        ))}
      </ol>
    </Panel>
  )
}

/** Same rule as "continue watching": resume the latest unfinished episode, else the one after the latest watched. */
function resumeTarget(work: Work, progress: Record<string, Progress>): { ep: Episode; started: boolean } {
  const eps = work.seasons.flatMap((s) => s.episodes)
  const latest = eps.filter((e) => progress[e.id]).sort((a, b) => progress[b.id].updatedAt - progress[a.id].updatedAt)[0]
  if (!latest) return { ep: eps[0], started: false }
  if (!progress[latest.id].watched) return { ep: latest, started: true }
  const i = eps.indexOf(latest)
  return { ep: eps.slice(i + 1).find((e) => !progress[e.id]?.watched) ?? eps.find((e) => !progress[e.id]?.watched) ?? eps[0], started: true }
}

export function TitlePage() {
  const { slug } = useParams()
  const work = getWork(slug!)
  const progress = useStore((s) => s.progress)
  if (!work) return <NotFoundPage />

  if (work.kind === "movie") {
    const pr = progress[work.unitId!]
    const resume = pr && !pr.watched && pr.positionSec > 0
    return (
      <Page>
        <Header
          work={work}
          primary={
            <>
              <Button render={<Link to={`/watch/${work.unitId}`} />} nativeButton={false}>
                <PlayIcon className="fill-current" data-icon="inline-start" />
                {resume ? `继续播放 · 剩 ${Math.round((pr.durationSec - pr.positionSec) / 60)} 分钟` : "播放"}
              </Button>
              <FavoriteButton slug={work.slug} />
              <AddToPlaylist item={{ type: "work", slug: work.slug }} />
            </>
          }
        />
        <Separator />
        <Panel>
          <PanelHeader>
            <PanelTitle>简介</PanelTitle>
          </PanelHeader>
          <div className="p-4">
            <Overview work={work} />
            {resume && <ProgressBar value={pr.positionSec / pr.durationSec} className="mt-4" />}
            <div className="mt-4 flex items-center gap-2">
              {pr?.watched && <WatchedBadge />}
              <Button variant="ghost" size="sm" onClick={() => actions.setWatched(work.unitId!, !pr?.watched)}>
                {pr?.watched ? "标记为未看" : "标记为已看"}
              </Button>
            </div>
          </div>
        </Panel>
      </Page>
    )
  }

  const { ep: next, started } = resumeTarget(work, progress)
  return (
    <Page>
      <Header
        work={work}
        primary={
          <>
            <Button render={<Link to={`/watch/${next.id}`} />} nativeButton={false}>
              <PlayIcon className="fill-current" data-icon="inline-start" />
              {started ? `继续 ${episodeCode(next)}` : `从 ${episodeCode(next)} 开始`}
            </Button>
            <FavoriteButton slug={work.slug} />
            <AddToPlaylist item={{ type: "work", slug: work.slug }} />
          </>
        }
      />
      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>简介</PanelTitle>
        </PanelHeader>
        <div className="p-4">
          <Overview work={work} />
        </div>
      </Panel>
      <Separator />
      <SeriesBody work={work} />
    </Page>
  )
}
