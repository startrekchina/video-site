import { data, Link, useLocation, useNavigate, useNavigationType } from "react-router";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, PlayIcon } from "lucide-react";
import { pageRead } from "@/lib/member.server";
import { catalog } from "@/lib/catalog.server";
import { playbackSource } from "@/lib/playback.server";
import { settings } from "@/lib/settings.server";
import { useMarkWatched } from "@/lib/progress-client";
import { Button } from "@/components/ui/button";
import { displayTitle, episodeCode, formatRuntime, type Episode } from "@/lib/catalog";
import { pageTitle } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Page, Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Poster, ProgressBar } from "@/components/site/media";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Player } from "@/components/site/player";
import { DetailTop, Overview, StepLink } from "./title";
import type { Route } from "./+types/watch";
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const current = await pageRead(request, context.cloudflare.env, context.identity,
    (db, userId) => Promise.all([catalog(db, userId, "", { unitId: params.id }), playbackSource(db, params.id)]));
  const [works, source] = current.value;
  const work = works[0], unit = work?.units.find(unit => unit.id === params.id);
  if (!work || !unit) throw new Response(null, { status: 404 });
  // Neighbours follow season and episode order and skip units without a playable source.
  const at = work.units.indexOf(unit), previous = work.units.slice(0, at).findLast(item => item.playable)?.id, next = work.units.slice(at + 1).find(item => item.playable)?.id;
  return data({ work, unit, source, previous, next, reportInterval: settings.progressReportInterval }, { headers: current.headers });
}
export function headers({ errorHeaders, parentHeaders }: Route.HeadersArgs) { return errorHeaders ?? parentHeaders; }
export const meta = ({ loaderData }: Route.MetaArgs) => pageTitle(
  loaderData?.work.kind === "series" ? `${episodeCode(loaderData.unit)} ${displayTitle(loaderData.unit)}` : null, loaderData?.work.titleZh);
export default function Watch({ loaderData: { work, unit, source, previous, next, reportInterval } }: Route.ComponentProps) {
  // Each unit owns its subtitle state and progress start; changing units never restarts the old player.
  return <WatchContent key={unit.id} work={work} unit={unit} source={source} previous={previous} next={next} reportInterval={reportInterval} />;
}
function WatchContent({ work, unit, source, previous, next, reportInterval }: Route.ComponentProps["loaderData"]) {
  const [tracks, setTracks] = useState(source?.tracks ?? []);
  const [subtitle, setSubtitle] = useState(source?.tracks.find(track => track.language.startsWith("zh"))?.id ?? source?.tracks[0]?.id ?? "off");
  const list = useRef<HTMLOListElement>(null), episodes = work.units.filter(item => item.seasonNumber === unit.seasonNumber);
  const previousUnit = work.units.find(item => item.id === previous), nextUnit = work.units.find(item => item.id === next);
  // Reports and manual marks share one revision; reloaded page data only ever moves it forward.
  const revision = useRef(unit.revision), [completed, setCompleted] = useState(unit.completed), [ended, setEnded] = useState(false);
  // Only a fresh in-app step from the next-up prompt tries to autoplay; reloads and history moves (POP) do not.
  const location = useLocation(), autoplay = useNavigationType() === "PUSH" && (location.state as { autoplay?: unknown } | null)?.autoplay === true;
  useEffect(() => { revision.current = Math.max(revision.current, unit.revision); setCompleted(unit.completed); }, [unit.revision, unit.completed]);
  useEffect(() => { const current = list.current?.querySelector<HTMLElement>('[aria-current="page"]'); if (list.current && current) list.current.scrollTop = current.offsetTop - list.current.offsetTop - list.current.clientHeight / 2 + current.clientHeight / 2; }, [unit.id]);
  return <Page data-watch-page><DetailTop back={`/title/${work.slug}${work.kind === "series" ? `?season=${unit.seasonNumber}` : ""}`} backLabel={work.titleZh} title={work.kind === "movie" ? work.titleZh : displayTitle(unit)}><span className="font-mono text-xs text-muted-foreground max-sm:hidden">{work.kind === "series" ? [work.code, episodeCode(unit)].filter(Boolean).join(" · ") : `电影 · ${work.year ?? "—"}`}</span><StepLink to={previous && `/watch/${previous}`} label={previousUnit ? `上一集 · ${episodeCode(previousUnit)}` : "上一集"} direction="previous" /><StepLink to={next && `/watch/${next}`} label={nextUnit ? `下一集 · ${episodeCode(nextUnit)}` : "下一集"} direction="next" /></DetailTop>
    <div className="h-4" />{source ? <Player unitId={unit.id} source={source} startSeconds={unit.completed ? 0 : unit.positionSeconds} autoplay={autoplay} progress={{ revision, interval: reportInterval, duration: unit.durationSeconds, onSaved: saved => setCompleted(saved.completed) }} subtitle={subtitle} onSubtitleChange={setSubtitle} onTracksChange={setTracks} onEnded={nextUnit ? () => setEnded(true) : undefined}>{ended && nextUnit && <NextUp unit={nextUnit} poster={work.poster} onCancel={() => setEnded(false)} />}</Player> : <p className="p-8">{work.kind === "series" ? "这一集片源暂缺，可在下方选择其他集。" : "片源暂缺。"}</p>}<div className="h-4" />
    <div className="screen-line-top screen-line-bottom grid md:grid-cols-[1fr_16rem]"><div className="min-w-0 p-4"><div className="font-mono text-xs text-muted-foreground">{work.kind === "series" ? `${work.titleZh} · 第 ${unit.seasonNumber} 季 第 ${unit.number} 集` : `电影 · ${work.year ?? "—"}`}</div><div className="mt-2"><Overview item={work.kind === "series" ? unit : work} /></div>{source && <div className="mt-4 flex flex-wrap items-center gap-2"><Tabs className="min-w-0 max-w-full" value={subtitle} onValueChange={value => setSubtitle(String(value))}><TabsList aria-label="字幕" className="no-scrollbar max-w-full justify-start overflow-x-auto">{tracks.map(track => <TabsTrigger key={track.id} value={track.id} className="px-3">{track.displayName}</TabsTrigger>)}<TabsTrigger value="off" className="px-3">关闭</TabsTrigger><TabsIndicator /></TabsList></Tabs><WatchedButton unitId={unit.id} completed={completed} revision={revision} onChange={setCompleted} /></div>}{unit.positionSeconds > 0 && unit.durationSeconds && !unit.completed && <div className="mt-4 flex items-center gap-3 font-mono text-xs text-muted-foreground"><ProgressBar value={unit.positionSeconds / unit.durationSeconds} className="max-w-48" />上次看到 {Math.round(unit.positionSeconds / unit.durationSeconds * 100)}%</div>}</div>
      <aside className="border-t border-line p-4 md:border-t-0 md:border-l max-sm:hidden" aria-label="键盘快捷键"><div className="mb-2 text-sm font-medium">键盘快捷键<span className="ml-2 font-normal text-muted-foreground">点击播放器后可用</span></div><dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">{[["空格", "播放 / 暂停"], ["← →", "快退 / 快进"], ["↑ ↓", "音量"], ["F", "全屏"], ["M", "静音"], ["C", "切换字幕"]].map(([key, value]) => <div key={key} className="contents"><dt><Kbd>{key}</Kbd></dt><dd className="text-muted-foreground">{value}</dd></div>)}</dl></aside>
    </div>
    {work.kind === "series" && <><Separator /><Panel><PanelHeader><PanelTitle>第 {unit.seasonNumber} 季<PanelTitleSup>({episodes.length} 集)</PanelTitleSup></PanelTitle></PanelHeader><ol ref={list} className="no-scrollbar relative max-h-80 scroll-fade overflow-y-auto divide-y divide-line">{episodes.map(item => <li key={item.id}>{item.playable ? <Link aria-current={item.id === unit.id ? "page" : undefined} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent-muted", item.id === unit.id && "bg-accent")} to={`/watch/${item.id}`}><span className="w-6 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{String(item.number).padStart(2, "0")}</span><span className={cn("min-w-0 flex-1 truncate", item.id === unit.id && "font-medium")}>{displayTitle(item)}</span>{item.id === unit.id ? <span className="font-mono text-[11px] text-muted-foreground">正在播放</span> : item.completed ? <CheckIcon className="size-4 text-success" aria-label="已看完" /> : item.positionSeconds > 0 && item.durationSeconds ? <ProgressBar value={item.positionSeconds / item.durationSeconds} className="w-10" /> : <span className="font-mono text-[11px] text-muted-foreground">{formatRuntime(item.runtimeMin)}</span>}</Link> : <span className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground"><span className="w-6 shrink-0 font-mono text-xs">{String(item.number).padStart(2, "0")}</span><span className="min-w-0 flex-1 truncate">{displayTitle(item)}</span><span className="font-mono text-[11px]">片源暂缺</span></span>}</li>)}</ol><PanelFooterLink to={`/title/${work.slug}?season=${unit.seasonNumber}`}>全部季</PanelFooterLink></Panel></>}
  </Page>;
}
const nextCountdown = 10;
// Counts down to the next unit; the step there carries the autoplay intent, and a blocked autoplay leaves the player's own play button.
function NextUp({ unit, poster, onCancel }: { unit: Episode; poster: string; onCancel: () => void }) {
  const navigate = useNavigate(), [left, setLeft] = useState(nextCountdown);
  useEffect(() => {
    if (left <= 0) { void navigate(`/watch/${unit.id}`, { state: { autoplay: true } }); return; }
    const timer = setTimeout(() => setLeft(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return <div className="absolute right-3 bottom-16 z-50 flex w-[min(22rem,calc(100%-1.5rem))] gap-3 rounded-xl bg-zinc-950/85 p-3 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md"><Poster src={poster} alt="" className="w-14 shrink-0" /><div className="flex min-w-0 flex-1 flex-col gap-2"><div className="min-w-0"><div className="font-mono text-[11px] text-white/60">下一集 · {episodeCode(unit)} · {left} 秒后自动播放</div><div className="truncate text-sm font-medium">{displayTitle(unit)}</div></div><div className="flex gap-2"><Button size="sm" className="bg-white text-zinc-950 hover:bg-white/85" nativeButton={false} render={<Link to={`/watch/${unit.id}`} state={{ autoplay: true }} />}><PlayIcon className="fill-current" data-icon="inline-start" />立即播放</Button><Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={onCancel}>取消</Button></div></div><div className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden bg-white/10"><div className="h-full bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${(nextCountdown - left) / nextCountdown * 100}%` }} /></div></div>;
}
function WatchedButton({ unitId, completed, revision, onChange }: { unitId: string; completed: boolean; revision: { current: number }; onChange: (completed: boolean) => void }) {
  const { mark, busy } = useMarkWatched();
  async function toggle() {
    const result = await mark(unitId, !completed, revision.current);
    if (result && "saved" in result) { revision.current = result.saved.revision; onChange(result.saved.completed); }
    if (result && "conflict" in result) revision.current = result.conflict;
  }
  return <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void toggle()}>{completed && <CheckIcon className="text-success" data-icon="inline-start" />}{completed ? "已看完" : "标记为已看"}</Button>;
}
