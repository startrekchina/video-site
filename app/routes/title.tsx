import { data, Link } from "react-router";
import { pageMember } from "@/lib/member.server";
import { catalog, singleParameter } from "@/lib/catalog.server";
import { displayTitle, episodeCode, resumeTarget, workProgress } from "@/lib/catalog";
import { EpisodeStill } from "@/components/site/episode-still";
import { Poster, ProgressBar, WatchedBadge } from "@/components/site/media";
import { Page, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import type { Route } from "./+types/title";
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const current = await pageMember(request, context.cloudflare.env);
  const works = await catalog(context.cloudflare.env.DB, current.member.user_id), index = works.findIndex(work => work.slug === params.id);
  if (index < 0) throw new Response(null, { status: 404 });
  const work = works[index], raw = singleParameter(new URL(request.url), "season");
  const number = raw === null ? work.seasons[0]?.number : /^\d+$/u.test(raw) ? Number(raw) : NaN;
  const season = work.seasons.find(season => season.number === number);
  if (raw !== null && !season) throw new Response(null, { status: 400 });
  const same = works.filter(candidate => candidate.kind === work.kind), at = same.findIndex(candidate => candidate.slug === work.slug);
  return data({ work, season, previous: same[at - 1]?.slug, next: same[at + 1]?.slug }, { headers: current.headers });
}
export function DetailTop({ back, backLabel, title, children }: { back: string; backLabel: string; title: React.ReactNode; children?: React.ReactNode }) {
  return <><div className="screen-line-bottom flex items-center justify-between p-4"><Link to={back} className="text-sm text-muted-foreground">← {backLabel}</Link><div className="flex gap-3">{children}</div></div><div className="screen-line-top screen-line-bottom h-4" /><h1 className="screen-line-bottom px-4 text-4xl font-medium tracking-tight text-balance">{title}</h1></>;
}
export default function Title({ loaderData: { work, season, previous, next } }: Route.ComponentProps) {
  const target = resumeTarget(work), progress = workProgress(work);
  return <Page><DetailTop back={work.kind === "series" ? "/series" : "/movies"} backLabel={work.kind === "series" ? "剧集" : "电影"} title={work.titleZh}>{previous && <Link to={`/title/${previous}`} aria-label="上一部">←</Link>}{next && <Link to={`/title/${next}`} aria-label="下一部">→</Link>}</DetailTop>
    <div className="screen-line-bottom grid grid-cols-[auto_1fr]"><figure className="border-r border-line p-2"><Poster src={work.poster} alt={`${work.titleZh} 海报`} className="w-28 sm:w-40" loading="eager" /></figure><div className="flex min-w-0 flex-col"><p className="screen-line-bottom px-4 py-3 text-muted-foreground">{work.titleEn}</p><div className="grid gap-3 p-4 font-mono text-sm"><p>{work.year ?? "年份暂缺"}</p><p>{work.kind === "series" ? `${work.seasons.length} 季 · ${progress.total} 集 · 已看 ${progress.watched}` : `${Math.ceil(work.runtimeMin ?? 0)} 分钟`}</p><p>TMDB {work.tmdbId}</p></div><div className="mt-auto border-t p-4">{target ? <Button nativeButton={false} render={<Link to={`/watch/${target.id}`} />}>{target.positionSeconds ? "继续播放" : "开始播放"}{work.kind === "series" && ` · ${episodeCode(target)}`}</Button> : <p className="text-muted-foreground">暂未挂接可播放片源。</p>}</div></div></div>
    <Separator /><Panel><PanelHeader><PanelTitle>简介</PanelTitle></PanelHeader><p className="p-4 text-muted-foreground">{work.overviewZh || work.overviewEn || "简介暂缺"}{!work.overviewZh && work.overviewEn && <Tag className="ml-2">EN</Tag>}</p></Panel>
    {work.kind === "series" && <><Separator /><Panel><PanelHeader><PanelTitle>第 {season?.number ?? "—"} 季<PanelTitleSup>({season?.episodes.length ?? 0} 集)</PanelTitleSup></PanelTitle></PanelHeader><nav className="screen-line-bottom flex overflow-x-auto" aria-label="选择季">{work.seasons.map(item => <Link key={item.id} preventScrollReset to={`?season=${item.number}`} aria-current={item.id === season?.id ? "true" : undefined} className="shrink-0 border-r p-4 font-mono hover:bg-accent-muted aria-[current=true]:bg-accent-muted">S{String(item.number).padStart(2, "0")}</Link>)}</nav><ol className="divide-y divide-line">{season?.episodes.map(unit => <li key={unit.id} className="flex gap-3 p-3"><span className="flex w-10 shrink-0 items-center justify-center font-mono text-xs">{String(unit.number).padStart(2, "0")}</span><EpisodeStill src={unit.still} /><div className="min-w-0 flex-1"><h3 className="font-medium">{unit.playable ? <Link className="hover:underline focus-visible:underline" to={`/watch/${unit.id}`}>{displayTitle(unit)}</Link> : displayTitle(unit)}{!unit.titleZh && <Tag className="ml-2">EN</Tag>}</h3><p className="line-clamp-2 text-sm text-muted-foreground">{unit.overviewZh || unit.overviewEn}</p><div className="mt-2 flex flex-wrap gap-2 font-mono text-xs text-muted-foreground"><span>{episodeCode(unit)} · {Math.ceil(unit.runtimeMin)} 分钟</span>{!unit.playable && <span>片源暂缺</span>}{unit.completed && <WatchedBadge />}{unit.positionSeconds > 0 && !unit.completed && <ProgressBar value={unit.positionSeconds / unit.durationSeconds} className="w-16" />}</div></div></li>)}</ol>{!season?.episodes.length && <p className="p-4 text-muted-foreground">本季暂无已导入的单集资料。</p>}</Panel></>}
  </Page>;
}
