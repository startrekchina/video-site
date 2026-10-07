import { data, Form, Link, useSearchParams } from "react-router";
import { pageMember } from "@/lib/member.server";
import { catalog, singleParameter } from "@/lib/catalog.server";
import { WorkGrid } from "@/components/site/media";
import { WorksTimeline } from "@/components/site/works-timeline";
import { HeadingGap, Page, PageHeading, PageHeadingTagline, PageHeadingTitle } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Route } from "./+types/catalog";
export async function loader({ request, context }: Route.LoaderArgs) {
  const current = await pageMember(request, context.cloudflare.env), url = new URL(request.url);
  const query = singleParameter(url, "q") ?? "";
  const kind = url.pathname === "/search" ? "search" : url.pathname === "/movies" ? "movie" : "series";
  const works = (await catalog(context.cloudflare.env.DB, current.member.user_id, query)).filter(work => kind === "search" || work.kind === kind);
  const totals = await context.cloudflare.env.DB.prepare("SELECT kind, count(*) AS n FROM works GROUP BY kind").all<{ kind: string; n: number }>();
  return data({ works, kind, query, totals: Object.fromEntries(totals.results.map(row => [row.kind, row.n])) }, { headers: current.headers });
}
export default function Catalog({ loaderData: { works, kind, query, totals } }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const timeline = params.get("view") === "timeline", descending = params.get("order") === "desc";
  const toggle = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next, { preventScrollReset: true }); };
  return <Page><PageHeading><PageHeadingTagline>{kind === "search" ? "全站搜索" : kind === "series" ? "剧集" : "电影"}</PageHeadingTagline><PageHeadingTitle>{kind === "search" ? "按中文或英文作品名查找剧集和电影。" : kind === "series" ? "从 1966 年的原初系列，到 2026 年的星际舰队学院。" : "从 1979 年的《无限太空》，到 2025 年的《31 区》。"}</PageHeadingTitle></PageHeading><HeadingGap />
    <div className="flex flex-wrap items-center justify-between"><nav aria-label="分类" className="flex"><Link className="border-r p-4 font-mono text-sm" to="/series">剧集 ({totals.series ?? 0})</Link><Link className="border-r p-4 font-mono text-sm" to="/movies">电影 ({totals.movie ?? 0})</Link></nav><div className="mr-2 flex gap-1"><Button variant="ghost" size="sm" aria-pressed={!timeline} onClick={() => toggle("view", "grid")}>海报墙</Button><Button variant="ghost" size="sm" aria-pressed={timeline} onClick={() => toggle("view", "timeline")}>时间轴</Button><Button variant="ghost" size="sm" onClick={() => toggle("order", descending ? "asc" : "desc")} aria-label={descending ? "改为年份正序" : "改为年份倒序"}>{descending ? "↓" : "↑"}</Button></div></div>
    <Form className="screen-line-top screen-line-bottom flex gap-2 p-2" method="get"><Input key={query} name="q" defaultValue={query} maxLength={100} placeholder="按中文或英文片名筛选…" aria-label="筛选作品" /><input type="hidden" name="view" value={timeline ? "timeline" : "grid"} /><input type="hidden" name="order" value={descending ? "desc" : "asc"} /><Button type="submit">搜索</Button></Form>
    {!works.length ? <p className="p-4">{query ? `没有匹配“${query}”的作品。` : "片库暂时为空。"}</p> : timeline ? <WorksTimeline works={descending ? [...works].reverse() : works} /> : <WorkGrid works={descending ? [...works].reverse() : works} eager={6} />}</Page>;
}
