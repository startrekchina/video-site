import { useEffect, useRef, useState } from "react";
import { ArrowDownWideNarrowIcon, ArrowUpNarrowWideIcon, ChartNoAxesGanttIcon, LayoutGridIcon, SearchIcon } from "lucide-react";
import { data, Form, NavLink, useSearchParams, useSubmit, type ShouldRevalidateFunctionArgs } from "react-router";
import { pageMember } from "@/lib/member.server";
import { catalogCards, singleParameter } from "@/lib/catalog.server";
import { presentationNavigation } from "@/lib/catalog";
import { WorkGrid } from "@/components/site/media";
import { WorksTimeline } from "@/components/site/works-timeline";
import { HeadingGap, Page, PageHeading, PageHeadingTagline, PageHeadingTitle } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Route } from "./+types/catalog";
export async function loader({ request, context }: Route.LoaderArgs) {
  const current = await pageMember(request, context.cloudflare.env), url = new URL(request.url);
  const query = singleParameter(url, "q") ?? "";
  const kind = url.pathname === "/search" ? "search" : url.pathname === "/movies" ? "movie" : "series";
  const { works, totals } = await catalogCards(context.cloudflare.env.DB, current.member.user_id, query, kind === "search" ? null : kind);
  return data({ works, kind, query, totals }, { headers: current.headers });
}
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return !args.formMethod && presentationNavigation(args.currentUrl, args.nextUrl) ? false : args.defaultShouldRevalidate;
}
export default function Catalog({ loaderData: { works, kind, query, totals } }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const submit = useSubmit(), form = useRef<HTMLFormElement>(null), submitted = useRef(query), [filter, setFilter] = useState(query);
  // A completed request must not overwrite text typed during its debounce window.
  useEffect(() => { if (filter === submitted.current) setFilter(query); submitted.current = query; }, [query]);
  useEffect(() => { if (filter === query) return; const timer = setTimeout(() => { if (form.current) { submitted.current = filter; void submit(form.current, { replace: true, preventScrollReset: true }); } }, 200); return () => clearTimeout(timer); }, [filter, query, submit]);
  const timeline = params.get("view") === "timeline", descending = params.get("order") === "desc";
  const toggle = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next, { preventScrollReset: true }); };
  return <Page><PageHeading><PageHeadingTagline>{kind === "search" ? "全站搜索" : kind === "series" ? "剧集" : "电影"}</PageHeadingTagline><PageHeadingTitle>{kind === "search" ? "按中文或英文作品名查找剧集和电影。" : kind === "series" ? "从 1966 年的原初系列，到 2026 年的星际舰队学院。" : "从 1979 年的《无限太空》，到 2025 年的《31 区》。"}</PageHeadingTitle></PageHeading><HeadingGap />
    <div className="flex items-center justify-between"><nav aria-label="分类" className="flex items-center whitespace-nowrap">{[{ to: "/series", label: "剧集", n: totals.series }, { to: "/movies", label: "电影", n: totals.movie }].map(item => <NavLink key={item.to} className="border-r border-line p-4 font-mono text-[.8125rem]/4 font-medium tracking-wide text-muted-foreground uppercase transition-[color,background-color] hover:bg-accent-muted aria-[current=page]:bg-accent-muted aria-[current=page]:text-foreground" to={item.to}>{item.label} ({item.n ?? 0})</NavLink>)}</nav><div className="mr-2 flex items-center gap-1"><ToggleGroup value={[timeline ? "timeline" : "grid"]} onValueChange={value => value[0] && toggle("view", String(value[0]))} size="sm" aria-label="视图"><ToggleGroupItem value="grid" aria-label="海报墙"><LayoutGridIcon /></ToggleGroupItem><ToggleGroupItem value="timeline" aria-label="时间轴"><ChartNoAxesGanttIcon /></ToggleGroupItem></ToggleGroup><Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => toggle("order", descending ? "asc" : "desc")} aria-label={descending ? "改为年份正序" : "改为年份倒序"}>{descending ? <ArrowDownWideNarrowIcon /> : <ArrowUpNarrowWideIcon />}</Button>} /><TooltipContent>{descending ? "当前：年份倒序" : "当前：年份正序"}</TooltipContent></Tooltip></div></div>
    <Form ref={form} className="screen-line-top screen-line-bottom p-2" method="get"><InputGroup className="rounded-lg shadow-none"><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput name="q" value={filter} onChange={event => setFilter(event.target.value)} maxLength={100} placeholder="按中文或英文片名筛选…" aria-label="筛选作品" /></InputGroup><input type="hidden" name="view" value={timeline ? "timeline" : "grid"} /><input type="hidden" name="order" value={descending ? "desc" : "asc"} /></Form>
    {!works.length ? <p className="screen-line-bottom mt-4 p-4 font-mono text-sm">{query ? `没有匹配“${query}”的作品。试试中文或英文作品名。` : "片库暂时为空。"}</p> : timeline ? <WorksTimeline key={`${kind}-${descending}`} works={descending ? [...works].reverse() : works} sweep={!descending} className="mt-4" /> : <WorkGrid works={descending ? [...works].reverse() : works} eager={6} />}</Page>;
}
