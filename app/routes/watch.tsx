import { data, Link, useLocation, useNavigate, useNavigationType } from "react-router";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronRightIcon, ListVideoIcon, PlayIcon } from "lucide-react";
import { pageRead } from "@/lib/member.server";
import { catalog, pathUnit, singleParameter } from "@/lib/catalog.server";
import { playlistQueue } from "@/lib/library.server";
import { playbackSource } from "@/lib/playback.server";
import { settings } from "@/lib/settings.server";
import { useMarkWatched } from "@/lib/progress-client";
import { Button } from "@/components/ui/button";
import { displayTitle, episodeCode, formatRuntime, seasonHref, unitHref } from "@/lib/catalog";
import { pageTitle } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Page, Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Poster, ProgressBar } from "@/components/site/media";
import { Player } from "@/components/site/player";
import { AddToPlaylist } from "@/components/site/add-to-playlist";
import { Discussion } from "@/components/site/discussion";
import { DanmakuAdmin, DanmakuBlockWords } from "@/components/site/danmaku";
import type { DanmakuLimits } from "@/lib/danmaku-client";
import { DetailTop, Overview, StepLink } from "./title";
import type { Route } from "./+types/watch";
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const key = pathUnit(params);
  // Query input is read inside pageRead so that guests are sent to login before any input error.
  const current = await pageRead(request, context.cloudflare.env, context.identity, async (db, userId) => {
    const playlist = singleParameter(new URL(request.url), "playlist");
    return key && Promise.all([catalog(db, userId, "", key), playbackSource(db, key), playlist ? playlistQueue(db, userId, playlist, key) : null]);
  });
  if (!current.value) throw new Response(null, { status: 404 });
  const [works, source, queue] = current.value;
  const work = works[0], unit = work?.units.find(unit => key?.kind !== "series" || (unit.seasonNumber === key.season && unit.number === key.episode));
  if (!work || !unit) throw new Response(null, { status: 404 });
  // Neighbours follow season and episode order and skip units without a playable source.
  const at = work.units.indexOf(unit), previous = work.units.slice(0, at).findLast(item => item.playable)?.id, next = work.units.slice(at + 1).find(item => item.playable)?.id;
  // In a playlist queue (B 6.7.2) the queue decides what comes next; a unit outside the queue plays as usual.
  const danmaku: DanmakuLimits = { maxLength: settings.danmaku.maxLength, lockTime: settings.rateLimits.danmaku.minInterval, colors: settings.danmaku.colors,
    blockWordLimit: settings.danmaku.blockWordLimit, blockWordMaxLength: settings.danmaku.blockWordMaxLength };
  return data({ work, unit, source, previous, next, reportInterval: settings.progressReportInterval, danmaku, admin: current.member.role === "admin", ...queue ? { queue } : {} }, { headers: current.headers });
}
export function headers({ errorHeaders, parentHeaders }: Route.HeadersArgs) { return errorHeaders ?? parentHeaders; }
export const meta = ({ loaderData }: Route.MetaArgs) => pageTitle(
  loaderData?.work.kind === "series" ? `${episodeCode(loaderData.unit)} ${displayTitle(loaderData.unit)}` : null, loaderData?.work.titleZh);
export default function Watch({ loaderData: { work, unit, source, previous, next, reportInterval, danmaku, admin, queue } }: Route.ComponentProps) {
  // Each unit owns its progress start; changing units never restarts the old player.
  return <WatchContent key={unit.id} work={work} unit={unit} source={source} previous={previous} next={next} reportInterval={reportInterval} danmaku={danmaku} admin={admin} queue={queue} />;
}
function WatchContent({ work, unit, source, previous, next, reportInterval, danmaku, admin, queue }: Route.ComponentProps["loaderData"]) {
  const list = useRef<HTMLOListElement>(null), episodes = work.units.filter(item => item.seasonNumber === unit.seasonNumber);
  const previousUnit = work.units.find(item => item.id === previous), nextUnit = work.units.find(item => item.id === next);
  // Reports and manual marks share one revision; reloaded page data only ever moves it forward.
  const revision = useRef(unit.revision), [completed, setCompleted] = useState(unit.completed), [ended, setEnded] = useState(false);
  // Only a fresh in-app step from the next-up prompt tries to autoplay; reloads and history moves (POP) do not.
  const location = useLocation(), autoplay = useNavigationType() === "PUSH" && (location.state as { autoplay?: unknown } | null)?.autoplay === true;
  // Stepping by episode keeps the queue; the next page drops it when that unit is outside the playlist.
  const search = queue ? `?playlist=${queue.id}` : "";
  // The original title only when the heading shows a translation. Air dates stay TMDB calendar text; a Date could shift the day by time zone.
  const facts = [work.kind === "series" ? unit.titleZh && unit.titleEn : work.titleEn !== work.titleZh && work.titleEn,
    work.kind === "movie" ? work.year && `${work.year} 年` : unit.airDate && `${unit.airDate} 首播`, unit.runtimeMin != null && formatRuntime(unit.runtimeMin)].filter(Boolean);
  useEffect(() => { revision.current = Math.max(revision.current, unit.revision); setCompleted(unit.completed); }, [unit.revision, unit.completed]);
  useEffect(() => { const current = list.current?.querySelector<HTMLElement>('[aria-current="page"]'); if (list.current && current) list.current.scrollTop = current.offsetTop - list.current.offsetTop - list.current.clientHeight / 2 + current.clientHeight / 2; }, [unit.id]);
  return <Page data-watch-page><DetailTop back={queue ? `/playlists/${queue.id}` : work.kind === "series" ? seasonHref(work, unit.seasonNumber) : work.href} backLabel={queue ? queue.title : work.titleZh} title={work.kind === "movie" ? work.titleZh : displayTitle(unit)}><span className="font-mono text-xs text-muted-foreground max-sm:hidden">{work.kind === "series" ? [work.code, episodeCode(unit)].filter(Boolean).join(" · ") : `电影 · ${work.year ?? "—"}`}</span><StepLink to={previousUnit && `${unitHref(work, previousUnit)}${search}`} label={previousUnit ? `上一集 · ${episodeCode(previousUnit)}` : "上一集"} direction="previous" /><StepLink to={nextUnit && `${unitHref(work, nextUnit)}${search}`} label={nextUnit ? `下一集 · ${episodeCode(nextUnit)}` : "下一集"} direction="next" /></DetailTop>
    <div className="h-4" />{source ? <Player unitId={unit.id} source={source} startSeconds={unit.completed ? 0 : unit.positionSeconds} autoplay={autoplay} progress={{ revision, interval: reportInterval, duration: unit.durationSeconds, onSaved: saved => setCompleted(saved.completed) }} danmaku={danmaku} onEnded={queue || nextUnit ? () => setEnded(true) : undefined}>{ended && (queue
      ? queue.next ? <NextUp to={`${queue.next.href}?playlist=${queue.id}`} label={`片单 · ${queue.next.label}`} title={queue.next.title} poster={queue.next.poster} onCancel={() => setEnded(false)} /> : <QueueEnd playlist={queue} poster={work.poster} onClose={() => setEnded(false)} />
      : nextUnit && <NextUp to={unitHref(work, nextUnit)} label={`下一集 · ${episodeCode(nextUnit)}`} title={displayTitle(nextUnit)} poster={work.poster} onCancel={() => setEnded(false)} />)}</Player> : <p className="p-8">{work.kind === "series" ? "这一集片源暂缺，可在下方选择其他集。" : "片源暂缺。"}</p>}
    {queue && <QueueBar queue={queue} />}
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">{source && <WatchedButton unitId={unit.id} completed={completed} revision={revision} onChange={setCompleted} />}<AddToPlaylist item={work.kind === "series" ? { unitId: unit.id } : { workId: work.slug }} size="sm" />{source && <div className="ml-auto flex gap-2"><DanmakuBlockWords limits={danmaku} />{admin && <DanmakuAdmin unitId={unit.id} kind={work.kind === "series" ? "episode" : "movie"} />}</div>}</div>
    <div className="screen-line-top screen-line-bottom flex flex-col gap-2 p-4">{facts.length > 0 && <p className="font-mono text-xs text-muted-foreground">{facts.join(" · ")}</p>}<Overview item={work.kind === "series" ? unit : work} /></div>
    {work.kind === "series" && <><Separator /><Panel><PanelHeader><PanelTitle>第 {unit.seasonNumber} 季<PanelTitleSup>({episodes.length} 集)</PanelTitleSup></PanelTitle></PanelHeader><ol ref={list} className="no-scrollbar relative max-h-80 scroll-fade overflow-y-auto divide-y divide-line">{episodes.map(item => <li key={item.id}>{item.playable ? <Link aria-current={item.id === unit.id ? "page" : undefined} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent-muted", item.id === unit.id && "bg-accent")} to={unitHref(work, item)}><span className="w-6 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{String(item.number).padStart(2, "0")}</span><span className={cn("min-w-0 flex-1 truncate", item.id === unit.id && "font-medium")}>{displayTitle(item)}</span>{item.id === unit.id ? <span className="font-mono text-[11px] text-muted-foreground">正在播放</span> : item.completed ? <CheckIcon className="size-4 text-success" aria-label="已看完" /> : item.positionSeconds > 0 && item.durationSeconds ? <ProgressBar value={item.positionSeconds / item.durationSeconds} className="w-10" /> : <span className="font-mono text-[11px] text-muted-foreground">{formatRuntime(item.runtimeMin)}</span>}</Link> : <span className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground"><span className="w-6 shrink-0 font-mono text-xs">{String(item.number).padStart(2, "0")}</span><span className="min-w-0 flex-1 truncate">{displayTitle(item)}</span><span className="font-mono text-[11px]">片源暂缺</span></span>}</li>)}</ol><PanelFooterLink to={seasonHref(work, unit.seasonNumber)}>全部季</PanelFooterLink></Panel></>}
    <Separator /><Discussion unitId={unit.id} kind={work.kind === "series" ? "episode" : "movie"} />
  </Page>;
}
const queueSegmentsMax = 24;
// The queue's place counts finished units too (B 6.7.2); the right cell is the end prompt's next unit and is absent at the queue's end.
function QueueBar({ queue: { id, title, position, watched, next } }: { queue: NonNullable<Route.ComponentProps["loaderData"]["queue"]> }) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return <div className={cn("screen-line-bottom grid", next && "sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]")}>
    <div className="flex min-w-0 items-center gap-4 px-4 py-3"><ListVideoIcon className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="font-mono text-xs text-muted-foreground tabular-nums">{`按顺序播放 · ${pad(position + 1)} / ${pad(watched.length)}${next ? "" : " · 最后一项"}`}</div><Link to={`/playlists/${id}`} className="block truncate font-medium hover:underline">{title}</Link></div>
      {/* One segment per unit; long queues fall back to a plain bar so segments stay visible. */}
      {watched.length <= queueSegmentsMax ? <ol className="flex w-28 shrink-0 gap-0.5 sm:w-40" aria-hidden>{watched.map((done, index) => <li key={index} className={cn("h-1 flex-1", index === position ? "bg-foreground" : done ? "bg-foreground/40" : "bg-foreground/10")} />)}</ol> : <ProgressBar value={(position + 1) / watched.length} className="w-28 shrink-0 sm:w-40" />}</div>
    {next && <Link to={`${next.href}?playlist=${id}`} className="group flex min-w-0 items-center gap-3 border-t border-line px-4 py-3 transition-[background-color] ease-out hover:bg-accent-muted sm:border-t-0 sm:border-l"><Poster src={next.poster} alt="" className="w-7 shrink-0" /><div className="min-w-0 flex-1"><div className="font-mono text-xs text-muted-foreground">{`下一项 · ${next.label}${next.year ? ` · ${next.year}` : ""}`}</div><div className="truncate text-sm font-medium">{next.title}</div></div><ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform ease-out group-hover:translate-x-0.5" /></Link>}
  </div>;
}
const nextCountdown = 10;
// Overlay on the player for what follows this unit.
function PlayerCard({ poster, children }: { poster: string; children: React.ReactNode }) {
  return <div className="absolute right-3 bottom-16 z-50 flex w-[min(22rem,calc(100%-1.5rem))] gap-3 rounded-xl bg-zinc-950/85 p-3 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md"><Poster src={poster} alt="" className="w-14 shrink-0" /><div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div></div>;
}
const cardPrimary = "bg-white text-zinc-950 hover:bg-white/85", cardGhost = "text-white hover:bg-white/10 hover:text-white";
// Counts down to the next unit; the step there carries the autoplay intent, and a blocked autoplay leaves the player's own play button.
function NextUp({ to, label, title, poster, onCancel }: { to: string; label: string; title: string; poster: string; onCancel: () => void }) {
  const navigate = useNavigate(), [left, setLeft] = useState(nextCountdown);
  useEffect(() => {
    if (left <= 0) { void navigate(to, { state: { autoplay: true } }); return; }
    const timer = setTimeout(() => setLeft(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return <PlayerCard poster={poster}><div className="min-w-0"><div className="font-mono text-[11px] text-white/60">{label} · {left} 秒后自动播放</div><div className="truncate text-sm font-medium">{title}</div></div><div className="flex gap-2"><Button size="sm" className={cardPrimary} nativeButton={false} render={<Link to={to} state={{ autoplay: true }} />}><PlayIcon className="fill-current" data-icon="inline-start" />立即播放</Button><Button size="sm" variant="ghost" className={cardGhost} onClick={onCancel}>取消</Button></div><div className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden bg-white/10"><div className="h-full bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${(nextCountdown - left) / nextCountdown * 100}%` }} /></div></PlayerCard>;
}
// The end of a playlist queue: no natural next unit and no loop, only the way back to the playlist (B 6.7.2).
function QueueEnd({ playlist, poster, onClose }: { playlist: { id: string; title: string }; poster: string; onClose: () => void }) {
  return <PlayerCard poster={poster}><div className="min-w-0"><div className="truncate font-mono text-[11px] text-white/60">{playlist.title}</div><div className="text-sm font-medium">片单已播放完</div></div><div className="flex gap-2"><Button size="sm" className={cardPrimary} nativeButton={false} render={<Link to={`/playlists/${playlist.id}`} />}>返回片单</Button><Button size="sm" variant="ghost" className={cardGhost} onClick={onClose}>关闭</Button></div></PlayerCard>;
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
