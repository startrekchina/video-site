import { data, Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { pageMember } from "@/lib/member.server";
import { catalog } from "@/lib/catalog.server";
import { authorizePlayback } from "@/lib/playback.server";
import { csrfData } from "@/lib/security.server";
import { displayTitle, episodeCode, formatRuntime } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { Page, Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { ProgressBar } from "@/components/site/media";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Player } from "@/components/site/player";
import { DetailTop, Overview, StepLink } from "./title";
import type { Route } from "./+types/watch";
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env, current = await pageMember(request, env);
  const works = await catalog(env.DB, current.member.user_id, "", { unitId: params.id }), work = works[0], unit = work?.units.find(unit => unit.id === params.id);
  if (!work || !unit) throw new Response(null, { status: 404 });
  const headers = new Headers(current.headers);
  const authorization = unit.playable ? await authorizePlayback(request, env, unit.id, headers) : null;
  const csrf = await csrfData(request, env);
  csrf.headers.forEach((value, name) => headers.append(name, value));
  const playable = work.units.filter(unit => unit.playable), index = playable.findIndex(item => item.id === unit.id);
  return data({ work, unit, authorization, csrfToken: csrf.csrfToken, previous: playable[index - 1]?.id, next: playable[index + 1]?.id }, { headers });
}
export default function Watch({ loaderData: { work, unit, authorization, csrfToken, previous, next } }: Route.ComponentProps) {
  // Each unit owns its subtitle state and progress start; changing units never restarts the old player.
  return <WatchContent key={unit.id} work={work} unit={unit} authorization={authorization} csrfToken={csrfToken} previous={previous} next={next} />;
}
function WatchContent({ work, unit, authorization, csrfToken, previous, next }: Route.ComponentProps["loaderData"]) {
  const [subtitle, setSubtitle] = useState(authorization?.tracks.find(track => track.language.startsWith("zh"))?.id ?? authorization?.tracks[0]?.id ?? "off");
  const list = useRef<HTMLOListElement>(null), episodes = work.units.filter(item => item.seasonNumber === unit.seasonNumber);
  const previousUnit = work.units.find(item => item.id === previous), nextUnit = work.units.find(item => item.id === next);
  useEffect(() => { const current = list.current?.querySelector<HTMLElement>('[aria-current="page"]'); if (list.current && current) list.current.scrollTop = current.offsetTop - list.current.offsetTop - list.current.clientHeight / 2 + current.clientHeight / 2; }, [unit.id]);
  return <Page data-watch-page><DetailTop back={`/title/${work.slug}${work.kind === "series" ? `?season=${unit.seasonNumber}` : ""}`} backLabel={work.titleZh} title={work.kind === "movie" ? work.titleZh : displayTitle(unit)}><span className="font-mono text-xs text-muted-foreground max-sm:hidden">{work.kind === "series" ? `${work.code} · ${episodeCode(unit)}` : `电影 · ${work.year ?? "—"}`}</span><StepLink to={previous && `/watch/${previous}`} label={previousUnit ? `上一集 · ${episodeCode(previousUnit)}` : "上一集"} direction="previous" /><StepLink to={next && `/watch/${next}`} label={nextUnit ? `下一集 · ${episodeCode(nextUnit)}` : "下一集"} direction="next" /></DetailTop>
    <div className="h-4" />{authorization ? <Player unitId={unit.id} authorization={authorization} csrfToken={csrfToken} startSeconds={unit.completed ? 0 : unit.positionSeconds} subtitle={subtitle} onSubtitleChange={setSubtitle} /> : <p className="p-8">暂无可播放片源。</p>}<div className="h-4" />
    <div className="screen-line-top screen-line-bottom grid md:grid-cols-[1fr_16rem]"><div className="min-w-0 p-4"><div className="font-mono text-xs text-muted-foreground">{work.kind === "series" ? `${work.titleZh} · 第 ${unit.seasonNumber} 季 第 ${unit.number} 集` : `电影 · ${work.year ?? "—"}`}</div><div className="mt-2"><Overview item={work.kind === "series" ? unit : work} /></div>{authorization && <div className="mt-4 flex flex-wrap items-center gap-2"><Tabs className="min-w-0 max-w-full" value={subtitle} onValueChange={value => setSubtitle(String(value))}><TabsList aria-label="字幕" className="no-scrollbar max-w-full justify-start overflow-x-auto">{authorization.tracks.map(track => <TabsTrigger key={track.id} value={track.id} className="px-3">{track.displayName}</TabsTrigger>)}<TabsTrigger value="off" className="px-3">关闭</TabsTrigger><TabsIndicator /></TabsList></Tabs></div>}{unit.positionSeconds > 0 && unit.durationSeconds && !unit.completed && <div className="mt-4 flex items-center gap-3 font-mono text-xs text-muted-foreground"><ProgressBar value={unit.positionSeconds / unit.durationSeconds} className="max-w-48" />已保存进度 {Math.round(unit.positionSeconds / unit.durationSeconds * 100)}%</div>}</div>
      <aside className="border-t border-line p-4 md:border-t-0 md:border-l max-sm:hidden" aria-label="键盘快捷键"><div className="mb-2 text-sm font-medium">键盘快捷键</div><dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">{[["空格", "播放 / 暂停"], ["← →", "快退 / 快进"], ["↑ ↓", "音量"], ["F", "全屏"], ["M", "静音"], ["C", "切换字幕"]].map(([key, value]) => <div key={key} className="contents"><dt><Kbd>{key}</Kbd></dt><dd className="text-muted-foreground">{value}</dd></div>)}</dl></aside>
    </div>
    {work.kind === "series" && <><Separator /><Panel><PanelHeader><PanelTitle>第 {unit.seasonNumber} 季<PanelTitleSup>({episodes.length} 集)</PanelTitleSup></PanelTitle></PanelHeader><ol ref={list} className="no-scrollbar relative max-h-80 scroll-fade overflow-y-auto divide-y divide-line">{episodes.map(item => <li key={item.id}>{item.playable ? <Link aria-current={item.id === unit.id ? "page" : undefined} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent-muted", item.id === unit.id && "bg-accent")} to={`/watch/${item.id}`}><span className="w-6 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{String(item.number).padStart(2, "0")}</span><span className={cn("min-w-0 flex-1 truncate", item.id === unit.id && "font-medium")}>{displayTitle(item)}</span>{item.id === unit.id ? <span className="font-mono text-[11px] text-muted-foreground">正在播放</span> : item.completed ? <CheckIcon className="size-4 text-success" aria-label="已看完" /> : item.positionSeconds > 0 && item.durationSeconds ? <ProgressBar value={item.positionSeconds / item.durationSeconds} className="w-10" /> : <span className="font-mono text-[11px] text-muted-foreground">{formatRuntime(item.runtimeMin)}</span>}</Link> : <span className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground"><span className="w-6 shrink-0 font-mono text-xs">{String(item.number).padStart(2, "0")}</span><span className="min-w-0 flex-1 truncate">{displayTitle(item)}</span><span className="font-mono text-[11px]">片源暂缺</span></span>}</li>)}</ol><PanelFooterLink to={`/title/${work.slug}?season=${unit.seasonNumber}`}>全部季</PanelFooterLink></Panel></>}
  </Page>;
}
