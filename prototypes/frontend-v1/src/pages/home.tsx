import { getWork, MOVIES, SERIES } from "@/data/catalog"
import { useStore } from "@/data/store"
import { Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { WorkGrid } from "@/components/site/media"
import { HeroTheatre } from "@/pages/home-hero/theatre"

function Shelf({ id, title, works, to, cta, rows = 2 }: { id: string; title: string; works: typeof SERIES; to: string; cta: string; rows?: number }) {
  return (
    <Panel id={id}>
      <PanelHeader>
        <PanelTitle>
          {title}
          <PanelTitleSup>({works.length})</PanelTitleSup>
        </PanelTitle>
      </PanelHeader>
      <WorkGrid works={works} rows={rows} />
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
      <Shelf id="favorites" title="我的收藏" works={works} to="/library" cta="我的片库" rows={1} />
      <Separator />
    </>
  )
}

export function HomePage() {
  return (
    <>
      <HeroTheatre />
      <div className="mx-auto md:max-w-(--content-width)">
        <Separator />
        <Favorites />
        <Shelf id="series" title="剧集" works={SERIES} to="/series" cta="全部剧集" />
        <Separator />
        <Shelf id="movies" title="电影" works={MOVIES} to="/movies" cta="全部电影" />
      </div>
    </>
  )
}
