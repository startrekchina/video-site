import { data, Link } from "react-router";
import { pageMember } from "@/lib/member.server";
import { catalog } from "@/lib/catalog.server";
import { authorizePlayback } from "@/lib/playback.server";
import { csrfData } from "@/lib/security.server";
import { displayTitle, episodeCode } from "@/lib/catalog";
import { Page, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel";
import { Player } from "@/components/site/player";
import { DetailTop } from "./title";
import type { Route } from "./+types/watch";
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env, current = await pageMember(request, env);
  const works = await catalog(env.DB, current.member.user_id), work = works.find(work => work.units.some(unit => unit.id === params.id)), unit = work?.units.find(unit => unit.id === params.id);
  if (!work || !unit) throw new Response(null, { status: 404 });
  const headers = new Headers(current.headers);
  const authorization = unit.playable ? await authorizePlayback(request, env, unit.id, headers) : null;
  const csrf = await csrfData(request, env);
  csrf.headers.forEach((value, name) => headers.append(name, value));
  const playable = work.units.filter(unit => unit.playable), index = playable.findIndex(item => item.id === unit.id);
  return data({ work, unit, authorization, csrfToken: csrf.csrfToken, previous: playable[index - 1]?.id, next: playable[index + 1]?.id }, { headers });
}
export default function Watch({ loaderData: { work, unit, authorization, csrfToken, previous, next } }: Route.ComponentProps) {
  return <Page><DetailTop back={`/title/${work.slug}`} backLabel={work.titleZh} title={work.kind === "movie" ? work.titleZh : `${episodeCode(unit)} · ${displayTitle(unit)}`}>{previous && <Link to={`/watch/${previous}`}>上一集</Link>}{next && <Link to={`/watch/${next}`}>下一集</Link>}</DetailTop>
    {authorization ? <Player key={unit.id} unitId={unit.id} authorization={authorization} csrfToken={csrfToken} startSeconds={unit.completed ? 0 : unit.positionSeconds} /> : <p className="p-8">暂无可播放片源。</p>}
    <p className="p-4 text-sm text-muted-foreground">空格：播放/暂停 · 方向键：进度/音量 · F：全屏 · M：静音 · C：字幕</p>
    {work.kind === "series" && <><Separator /><Panel><PanelHeader><PanelTitle>第 {unit.seasonNumber} 季选集</PanelTitle></PanelHeader><ol className="max-h-[26rem] divide-y overflow-y-auto">{work.units.filter(item => item.seasonNumber === unit.seasonNumber).map(item => <li key={item.id} className="p-3">{item.playable ? <Link aria-current={item.id === unit.id ? "page" : undefined} className="flex gap-3 aria-[current=page]:font-medium" to={`/watch/${item.id}`}><span className="font-mono">{episodeCode(item)}</span><span>{displayTitle(item)}</span></Link> : <span className="text-muted-foreground">{episodeCode(item)} · {displayTitle(item)} · 片源暂缺</span>}</li>)}</ol></Panel></>}
  </Page>;
}
