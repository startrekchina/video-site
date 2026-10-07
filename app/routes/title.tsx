import { data, Link } from "react-router";
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon, CircleCheckIcon, ClockIcon, DatabaseIcon, LayersIcon, PlayIcon } from "lucide-react";
import { pageMember } from "@/lib/member.server";
import { catalog, singleParameter } from "@/lib/catalog.server";
import { displayTitle, episodeCode, formatRuntime, resumeTarget, workProgress } from "@/lib/catalog";
import { EpisodeStill } from "@/components/site/episode-still";
import { Poster, ProgressBar, WatchedBadge } from "@/components/site/media";
import { Page, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { IconTile } from "@/components/ui/icon-tile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Episode } from "@/lib/catalog";
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
  return data({ work, season, previous: same[at - 1]?.slug, previousTitle: same[at - 1]?.titleZh, next: same[at + 1]?.slug, nextTitle: same[at + 1]?.titleZh }, { headers: current.headers });
}
export function DetailTop({ back, backLabel, title, children }: { back: string; backLabel: string; title: React.ReactNode; children?: React.ReactNode }) {
  return <><div className="screen-line-bottom h-px" /><div className="flex items-center justify-between gap-2 p-2 pl-4"><Button className="h-7 min-w-0 gap-2 border-none px-0 tracking-wider text-muted-foreground hover:text-foreground hover:no-underline" variant="link" size="sm" nativeButton={false} render={<Link to={back} />}><ArrowLeftIcon /><span className="truncate">{backLabel}</span></Button><div className="flex shrink-0 items-center gap-2">{children}</div></div><div className="screen-line-top screen-line-bottom py-px"><div className="h-4" /></div><h1 className="screen-line-bottom px-4 text-4xl font-medium tracking-tight text-balance">{title}</h1></>;
}
export function StepLink({ to, label, direction }: { to?: string; label: string; direction: "previous" | "next" }) {
  if (!to) return null;
  return <Tooltip><TooltipTrigger render={<Button className="size-7 border-none" variant="secondary" size="icon-sm" nativeButton={false} render={<Link to={to} aria-label={label} />}>{direction === "previous" ? <ArrowLeftIcon /> : <ArrowRightIcon />}</Button>} /><TooltipContent>{label}</TooltipContent></Tooltip>;
}
export function Overview({ item }: { item: Pick<Episode, "overviewZh" | "overviewEn"> }) {
  return <div className="typeset-description text-muted-foreground"><p>{item.overviewZh || item.overviewEn || "简介暂缺"}{!item.overviewZh && item.overviewEn && <Tag className="ml-2 align-middle" title="中文资料缺失，显示英文">EN</Tag>}</p></div>;
}
function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-4 font-mono text-sm"><IconTile>{icon}</IconTile><p className="min-w-0 text-balance">{children}</p></div>;
}
export default function Title({ loaderData: { work, season, previous, previousTitle, next, nextTitle } }: Route.ComponentProps) {
  const target = resumeTarget(work), progress = workProgress(work);
  const primary = target ? <Button nativeButton={false} render={<Link to={`/watch/${target.id}`} />}><PlayIcon className="fill-current" data-icon="inline-start" />{target.positionSeconds && !target.completed ? "继续播放" : "开始播放"}{work.kind === "series" && ` · ${episodeCode(target)}`}</Button> : <p className="text-muted-foreground">暂未挂接可播放片源。</p>;
  return <Page><DetailTop back={work.kind === "series" ? "/series" : "/movies"} backLabel={work.kind === "series" ? "剧集" : "电影"} title={work.titleZh}><StepLink to={previous && `/title/${previous}`} label={`上一部：${previousTitle}`} direction="previous" /><StepLink to={next && `/title/${next}`} label={`下一部：${nextTitle}`} direction="next" /></DetailTop>
    <div className="screen-line-bottom grid grid-cols-[auto_1fr]"><figure className="group/poster relative border-r border-line p-2"><Poster src={work.poster} alt={`${work.titleZh} 海报`} className="w-28 transition-[filter] duration-300 sm:w-40 pointer-fine:grayscale group-hover/poster:grayscale-0" fetchPriority="high" loading="eager" /></figure><div className="flex min-w-0 flex-col"><p className="screen-line-bottom px-4 py-3 text-muted-foreground text-balance">{work.titleEn}</p><div className="grid content-start gap-2.5 p-4"><Meta icon={<CalendarIcon />}>{work.year ?? "年份暂缺"}</Meta>{work.kind === "series" ? <><Meta icon={<LayersIcon />}>{work.seasons.length} 季 · {progress.total} 集</Meta><Meta icon={<CircleCheckIcon />}>已看 {progress.watched}/{progress.total}</Meta></> : <Meta icon={<ClockIcon />}>{formatRuntime(work.runtimeMin)}</Meta>}<Meta icon={<DatabaseIcon />}>TMDB {work.tmdbId}</Meta></div><div className="mt-auto flex flex-wrap gap-2 border-t border-line p-4 max-sm:hidden">{primary}</div></div><div className="col-span-2 flex flex-wrap gap-2 border-t border-line p-4 sm:hidden">{primary}</div></div>
    <Separator /><Panel><PanelHeader><PanelTitle>简介</PanelTitle></PanelHeader><div className="p-4"><Overview item={work} /></div></Panel>
    {work.kind === "series" && <><Separator /><Panel id="episodes"><PanelHeader><PanelTitle>第 {season?.number ?? "—"} 季<PanelTitleSup>({season?.episodes.length ?? 0} 集)</PanelTitleSup></PanelTitle></PanelHeader><div className="screen-line-bottom"><nav className="no-scrollbar flex scroll-fade-x overflow-x-auto" aria-label="选择季">{work.seasons.map(item => <Link key={item.id} replace preventScrollReset to={`?season=${item.number}`} aria-current={item.id === season?.id ? "true" : undefined} className="flex shrink-0 flex-col border-r border-line px-4 py-2 text-left text-muted-foreground transition-[color,background-color] outline-none hover:bg-accent-muted hover:text-foreground focus-visible:inset-ring-2 focus-visible:inset-ring-ring/50 aria-[current=true]:bg-accent-muted aria-[current=true]:text-foreground"><span className="font-mono text-[.8125rem]/4 font-medium tracking-wide">S{String(item.number).padStart(2, "0")}</span><span className="font-mono text-[11px] text-muted-foreground tabular-nums">{item.episodes.filter(unit => unit.completed).length}/{item.episodes.length}</span></Link>)}</nav></div><ol className="divide-y divide-line">{season?.episodes.map(unit => <li key={unit.id} className="group/ep relative flex items-stretch hover:bg-accent-muted"><div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground sm:w-16"><span className="tabular-nums">{String(unit.number).padStart(2, "0")}</span></div><div className="flex min-w-0 flex-1 items-center gap-2 border-l border-dashed border-line py-3 pr-2 pl-3 sm:gap-3 sm:pl-4"><EpisodeStill src={unit.still} /><div className="min-w-0 flex-1"><h3 className="flex items-center gap-2 leading-snug font-medium">{unit.playable ? <Link className="truncate outline-none after:absolute after:inset-0 focus-visible:underline" to={`/watch/${unit.id}`}>{displayTitle(unit)}</Link> : <span className="truncate">{displayTitle(unit)}</span>}{!unit.titleZh && unit.titleEn && <Tag className="shrink-0">EN</Tag>}</h3><p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground max-sm:line-clamp-1">{unit.overviewZh || unit.overviewEn}</p><div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground"><span className="whitespace-nowrap">{episodeCode(unit)}</span><span className="whitespace-nowrap">{formatRuntime(unit.runtimeMin)}</span>{!unit.playable && <span>片源暂缺</span>}{unit.completed && <span className="max-sm:basis-full"><WatchedBadge /></span>}{unit.positionSeconds > 0 && unit.durationSeconds !== null && !unit.completed && <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-1 sm:basis-auto"><ProgressBar value={unit.positionSeconds / unit.durationSeconds} className="w-12 shrink-0 sm:w-16" /><span className="whitespace-nowrap">剩 {Math.max(0, Math.round((unit.durationSeconds - unit.positionSeconds) / 60))} 分钟</span></span>}</div></div></div></li>)}</ol>{!season?.episodes.length && <p className="p-4 text-muted-foreground">本季暂无已导入的单集资料。</p>}</Panel></>}
  </Page>;
}
