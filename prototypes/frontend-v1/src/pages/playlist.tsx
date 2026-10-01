import { ArrowDownIcon, ArrowUpIcon, GlobeIcon, LockIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"

import { displayTitle, episodeCode, getUnit, getWork, unitPoster } from "@/data/catalog"
import { actions, useStore, type Playlist, type PlaylistItem } from "@/data/store"
import { Poster, WatchedBadge } from "@/components/site/media"
import { HeadingGap, Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { SwipeAction, SwipeActions, SwipeContent, SwipeItem, SwipeRoot } from "@/components/ui/swipe-actions"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tag } from "@/components/ui/tag"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { NotFoundPage } from "./not-found"

function resolve(item: PlaylistItem) {
  if (item.type === "work") {
    const w = getWork(item.slug)!
    return { key: `w:${w.slug}`, href: `/title/${w.slug}`, play: w.kind === "movie" ? `/watch/${w.unitId}` : `/title/${w.slug}`, poster: w.poster, kicker: w.kind === "movie" ? `电影 · ${w.year}` : `整部剧集 · ${w.seasons.length} 季`, title: w.titleZh, sub: w.titleEn, unitId: w.unitId }
  }
  const u = getUnit(item.id)!
  if (u.kind === "movie") return { key: `u:${u.id}`, href: `/watch/${u.id}`, play: `/watch/${u.id}`, poster: u.work.poster, kicker: `电影 · ${u.work.year}`, title: u.work.titleZh, sub: u.work.titleEn, unitId: u.id }
  return { key: `u:${u.id}`, href: `/watch/${u.id}`, play: `/watch/${u.id}`, poster: unitPoster(u), kicker: `${u.work.code} · ${episodeCode(u.episode)}`, title: displayTitle(u.episode), sub: u.work.titleZh, unitId: u.id }
}

export function VisibilityTag({ v }: { v: Playlist["visibility"] }) {
  return (
    <Tag className="gap-1">
      {v === "public" ? <GlobeIcon /> : <LockIcon />}
      {v === "public" ? "站内公开" : "私有"}
    </Tag>
  )
}

export function PlaylistRow({ playlist: p }: { playlist: Playlist }) {
  const posters = p.items.slice(0, 4).map((i) => resolve(i).poster)
  return (
    <li className="relative flex items-center gap-4 p-4 transition-[background-color] ease-out hover:bg-accent-muted">
      <div className="relative h-16 w-20 shrink-0">
        {posters.length === 0 && <div className="size-full rounded border border-dashed" />}
        {posters.map((src, i) => (
          <div key={i} className="absolute top-0 w-11" style={{ left: i * 10, zIndex: 4 - i }}>
            <Poster src={src} alt="" className="rounded-sm shadow-sm" />
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <Link to={`/playlists/${p.id}`} className="font-medium after:absolute after:inset-0">
          {p.title}
        </Link>
        {p.description && <div className="truncate text-sm text-muted-foreground">{p.description}</div>}
        <div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <VisibilityTag v={p.visibility} />
          <span>{p.items.length} 项</span>
          <span>· {p.owner}</span>
          <span className="max-sm:hidden">· 更新于 {p.updatedAt}</span>
        </div>
      </div>
    </li>
  )
}

export function PlaylistPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useStore((s) => s.me)!
  const p = useStore((s) => s.playlists.find((x) => x.id === id))
  const progress = useStore((s) => s.progress)
  if (!p) return <NotFoundPage />
  const own = p.owner === me.username
  const items = p.items.map(resolve)
  const firstPlayable = items.find((i) => i.unitId && !progress[i.unitId]?.watched) ?? items[0]

  return (
    <Page>
      <PageHeading>
        <PageHeadingTagline>
          片单 · <span className="font-mono">{p.owner}</span>
        </PageHeadingTagline>
        <PageHeadingTitle>{p.title}</PageHeadingTitle>
        {p.description && <PageHeadingDescription>{p.description}</PageHeadingDescription>}
      </PageHeading>
      <div className="h-4" />
      <Panel className="screen-line-top">
        <div className="flex flex-wrap items-center gap-2 p-4">
          {firstPlayable && (
            <Button render={<Link to={firstPlayable.play} />} nativeButton={false}>
              <PlayIcon className="fill-current" data-icon="inline-start" />
              按顺序播放
            </Button>
          )}
          {own ? (
            <>
              <ToggleGroup value={[p.visibility]} onValueChange={(v) => v[0] && actions.setVisibility(p.id, v[0] as Playlist["visibility"])} variant="outline" size="sm" aria-label="可见范围">
                <ToggleGroupItem value="private">
                  <LockIcon />
                  私有
                </ToggleGroupItem>
                <ToggleGroupItem value="public">
                  <GlobeIcon />
                  站内公开
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="flex-1" />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  actions.deletePlaylist(p.id)
                  navigate("/library")
                }}
              >
                <Trash2Icon data-icon="inline-start" />
                删除片单
              </Button>
            </>
          ) : (
            <VisibilityTag v={p.visibility} />
          )}
        </div>
      </Panel>
      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>
            条目<PanelTitleSup>({items.length})</PanelTitleSup>
          </PanelTitle>
        </PanelHeader>
        {items.length === 0 ? (
          <Empty className="rounded-none py-12">
            <EmptyHeader>
              <EmptyTitle>片单还是空的</EmptyTitle>
              <EmptyDescription>在作品页或播放页点“加入片单”添加条目。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SwipeRoot render={<ol className="divide-y divide-line" />}>
            {items.map((it, i) => (
              <SwipeItem key={it.key} disabled={!own} render={<li className="relative overflow-hidden" />}>
                {own && (
                  <>
                    <SwipeActions side="left">
                      <SwipeAction aria-label="上移" disabled={i === 0} onClick={() => actions.moveItem(p.id, i, i - 1)}>
                        <ArrowUpIcon />
                        上移
                      </SwipeAction>
                      <SwipeAction aria-label="下移" disabled={i === items.length - 1} onClick={() => actions.moveItem(p.id, i, i + 1)}>
                        <ArrowDownIcon />
                        下移
                      </SwipeAction>
                    </SwipeActions>
                    <SwipeActions side="right" fullSwipe>
                      <SwipeAction className="bg-destructive text-white" onClick={() => actions.removeItem(p.id, i)}>
                        <Trash2Icon />
                        移除
                      </SwipeAction>
                    </SwipeActions>
                  </>
                )}
                <SwipeContent className="relative flex items-center transition-[background-color] ease-out hover:bg-accent-muted">
                  <span className="w-12 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <div className="flex min-w-0 flex-1 items-center gap-3 border-l border-dashed border-line py-3 pr-2 pl-3">
                    <Poster src={it.poster} alt="" className="w-9 shrink-0 rounded-sm" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-muted-foreground">{it.kicker}</div>
                      <Link to={it.href} draggable={false} className="block truncate font-medium after:absolute after:inset-0">
                        {it.title}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{it.sub}</div>
                    </div>
                    {it.unitId && progress[it.unitId]?.watched && <WatchedBadge className="max-sm:hidden" />}
                    {own && (
                      <div className="relative z-1 flex">
                        {/* Touch screens reorder by swiping right; the buttons stay for pointer and keyboard users. */}
                        <Button variant="ghost" size="icon-sm" className="pointer-coarse:hidden" aria-label="上移" disabled={i === 0} onClick={() => actions.moveItem(p.id, i, i - 1)}>
                          <ArrowUpIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="pointer-coarse:hidden" aria-label="下移" disabled={i === items.length - 1} onClick={() => actions.moveItem(p.id, i, i + 1)}>
                          <ArrowDownIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="移除" onClick={() => actions.removeItem(p.id, i)}>
                          <XIcon />
                        </Button>
                      </div>
                    )}
                  </div>
                </SwipeContent>
              </SwipeItem>
            ))}
          </SwipeRoot>
        )}
      </Panel>
    </Page>
  )
}

export function PublicPlaylistsPage() {
  const lists = useStore((s) => s.playlists.filter((p) => p.visibility === "public"))
  return (
    <Page>
      <PageHeading>
        <PageHeadingTagline>站内公开片单</PageHeadingTagline>
        <PageHeadingTitle>其他成员整理并公开的片单。</PageHeadingTitle>
        <PageHeadingDescription>只有站内成员能看到。想分享自己的片单，在片单页把可见范围改成“站内公开”。</PageHeadingDescription>
      </PageHeading>
      <HeadingGap />
      <ul className="*:screen-line-bottom">
        {lists.map((p) => (
          <PlaylistRow key={p.id} playlist={p} />
        ))}
      </ul>
      <div className="h-4" />
    </Page>
  )
}
