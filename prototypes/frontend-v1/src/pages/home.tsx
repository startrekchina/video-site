import type React from "react"
import { CalendarIcon, CircleCheckIcon, FilmIcon, PlayIcon, TicketIcon, TvIcon } from "lucide-react"
import { Link } from "react-router"

import { EPISODE_TOTAL, getUnit, getWork, MOVIES, SEASON_TOTAL, SERIES, unitPoster, unitTitle } from "@/data/catalog"
import { continueWatching, inviteQuotaLeft, useStore } from "@/data/store"
import { FigCaption, Panel, PanelContent, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { Poster, ResumeCard, WorkGrid } from "@/components/site/media"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { IconTile } from "@/components/ui/icon-tile"

const FEATURED = "star-trek-strange-new-worlds"

/** Profile-header layout from the reference: figure top-right, poster in the avatar slot, name row over a caption strip. */
function Hero() {
  const me = useStore((s) => s.me)!
  const top = useStore(continueWatching)[0]
  const u = top ? getUnit(top.unitId) : undefined
  const featured = getWork(FEATURED)!

  return (
    <div className="screen-line-bottom grid grid-cols-[auto_1fr] grid-rows-[1fr_auto] overflow-y-clip border-x after:z-1">
      <figure className="dot-grid relative col-span-2 flex min-h-40 items-center justify-center p-2 sm:col-span-1 sm:col-start-2 sm:p-4">
        <img src="/logo.png" alt="" className="size-24 select-none sm:size-28" draggable={false} />
        <FigCaption className="absolute right-2 bottom-2 sm:right-4 sm:bottom-4">Fig. 1.</FigCaption>
      </figure>

      <div className="flex flex-col sm:row-span-2 sm:row-start-1">
        <div className="screen-line-top mt-auto shrink-0 border-r border-line">
          <div className="group/avatar mx-0.5 my-0.75 flex">
            <Poster src={u ? unitPoster(u) : featured.poster} alt="" loading="eager" className="w-24 rounded-lg transition-[filter] duration-300 min-[24rem]:w-28 sm:w-36 pointer-fine:grayscale group-hover/avatar:grayscale-0" />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="z-1 mt-auto border-t border-line">
          <h1 className="-translate-x-px -translate-y-px truncate pl-4 text-[2rem]/none font-medium tracking-tight">{top ? "欢迎回来" : "欢迎登舰"}</h1>
          <p className="flex h-12.5 items-center border-t border-line py-1 pl-4 font-mono text-sm text-balance text-muted-foreground sm:h-9">
            {me.username} · {me.role === "admin" ? "管理员" : "成员"}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Primary action row, in the slot of the reference SocialLinks panel. */
function Actions() {
  const top = useStore(continueWatching)[0]
  const u = top ? getUnit(top.unitId) : undefined
  const featured = getWork(FEATURED)!
  return (
    <Panel>
      <h2 className="sr-only">快捷操作</h2>
      <PanelContent className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {u && top ? (
          <>
            <Button render={<Link to={`/watch/${u.id}`} />} nativeButton={false}>
              <PlayIcon className="fill-current" data-icon="inline-start" />
              {top.reason === "resume" ? "继续播放" : "播放下一集"}
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {top.reason === "resume" ? "上次看到" : "接着看"} · {unitTitle(u)}
            </span>
          </>
        ) : (
          <>
            <Button render={<Link to={`/title/${featured.slug}`} />} nativeButton={false}>
              从《{featured.titleZh}》开始
            </Button>
            <Button variant="outline" render={<Link to="/series" />} nativeButton={false}>
              浏览全部剧集
            </Button>
          </>
        )}
      </PanelContent>
    </Panel>
  )
}

function IntroItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 font-mono text-sm">
      <IconTile>{icon}</IconTile>
      <p className="min-w-0 text-balance">{children}</p>
    </div>
  )
}

/** Mono fact list with a dashed centre rule, after the reference Overview panel. */
function Overview() {
  const me = useStore((s) => s.me)!
  const progress = useStore((s) => s.progress)
  const quota = useStore(inviteQuotaLeft)
  const watched = Object.values(progress).filter((p) => p.watched).length
  const fresh = Object.keys(progress).length === 0
  return (
    <Panel className="relative screen-line-top-none">
      <h2 className="sr-only">概览</h2>
      <PanelContent className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
        <IntroItem icon={<TvIcon />}>
          {SERIES.length} 部剧集 · {SEASON_TOTAL} 季 · 约 {EPISODE_TOTAL} 集
        </IntroItem>
        <IntroItem icon={<FilmIcon />}>{MOVIES.length} 部电影 · 1979–2025</IntroItem>
        <IntroItem icon={<CircleCheckIcon />}>
          {fresh ? "点任意一集就能开始播放" : `已看完 ${watched} 个`}
          <span className="text-muted-foreground"> // 进度自动保存</span>
        </IntroItem>
        <IntroItem icon={<TicketIcon />}>剩余邀请额度 {quota === Infinity ? "不限" : quota}</IntroItem>
        <IntroItem icon={<CalendarIcon />}>加入于 {me.joinedAt}</IntroItem>
      </PanelContent>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 -z-1 w-px -translate-x-2.25 border-r border-dashed border-line max-sm:hidden" />
    </Panel>
  )
}

function ContinueWatching() {
  const items = useStore(continueWatching).slice(0, 6)
  return (
    <Panel id="continue">
      <PanelHeader>
        <PanelTitle>
          继续观看
          {items.length > 0 && <PanelTitleSup>({items.length})</PanelTitleSup>}
        </PanelTitle>
      </PanelHeader>
      {items.length === 0 ? (
        <Empty className="rounded-none py-10">
          <EmptyHeader>
            <EmptyTitle>还没有观看记录</EmptyTitle>
            <EmptyDescription>开始播放任意一集或一部电影，进度会自动保存在这里，换设备也能接着看。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="relative pt-4">
          <div className="pointer-events-none absolute inset-0 -z-1 grid grid-cols-1 gap-4 max-sm:hidden sm:grid-cols-2">
            <div className="border-r border-line" />
            <div className="border-l border-line" />
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.unitId} className="max-sm:screen-line-top max-sm:screen-line-bottom sm:nth-[2n+1]:screen-line-top sm:nth-[2n+1]:screen-line-bottom">
                <ResumeCard {...i} />
              </li>
            ))}
          </ul>
          <div className="h-4" />
        </div>
      )}
    </Panel>
  )
}

function Shelf({ id, title, works, to, cta, limit = 8 }: { id: string; title: string; works: typeof SERIES; to: string; cta: string; limit?: number }) {
  return (
    <Panel id={id}>
      <PanelHeader>
        <PanelTitle>
          {title}
          <PanelTitleSup>({works.length})</PanelTitleSup>
        </PanelTitle>
      </PanelHeader>
      <WorkGrid works={works.slice(0, limit)} />
      <PanelFooterLink to={to}>{cta}</PanelFooterLink>
    </Panel>
  )
}

function Favorites() {
  const favs = useStore((s) => s.favorites)
  const works = favs.map((f) => getWork(f)!).filter(Boolean)
  if (works.length === 0) return null
  return (
    <>
      <Shelf id="favorites" title="我的收藏" works={works} to="/library" cta="我的片库" limit={4} />
      <Separator />
    </>
  )
}

export function HomePage() {
  return (
    <div className="mx-auto md:max-w-3xl">
      <Hero />
      <Separator />
      <Actions />
      <Overview />
      <Separator />
      <ContinueWatching />
      <Separator />
      <Favorites />
      <Shelf id="series" title="剧集" works={SERIES} to="/series" cta="全部剧集" />
      <Separator />
      <Shelf id="movies" title="电影" works={MOVIES} to="/movies" cta="全部电影" />
    </div>
  )
}
