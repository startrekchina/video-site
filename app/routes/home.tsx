import { data } from "react-router";
import { currentMember } from "@/lib/member.server";
import { catalog, homeStages } from "@/lib/catalog.server";
import { GuestStarChart } from "@/components/site/guest-home/star-chart";
import { HeroTheatre } from "@/components/site/theatre";
import { WorkGrid } from "@/components/site/media";
import { Panel, PanelFooterLink, PanelHeader, PanelTitle, Separator } from "@/components/site/panel";
import type { Route } from "./+types/home";
export async function loader({ request, context }: Route.LoaderArgs) {
  const current = await currentMember(request, context.cloudflare.env);
  if (!current) return data({ works: null, stage: null });
  const works = await catalog(context.cloudflare.env.DB, current.member.user_id);
  return data({ works, stage: homeStages(works) }, { headers: current.headers });
}
export default function Home({ loaderData: { works, stage } }: Route.ComponentProps) {
  if (!works || !stage) return <GuestStarChart />;
  return <><HeroTheatre {...stage} /><div className="mx-auto md:max-w-(--content-width)">{works.some(work => work.favorite) && <><Separator /><Panel><PanelHeader><PanelTitle>我的收藏</PanelTitle></PanelHeader><WorkGrid works={works.filter(work => work.favorite)} rows={1} /></Panel></>}{["series", "movie"].map(kind => <div key={kind}><Separator /><Panel><PanelHeader><PanelTitle>{kind === "series" ? "剧集" : "电影"}</PanelTitle></PanelHeader><WorkGrid works={works.filter(work => work.kind === kind)} rows={2} /><PanelFooterLink to={kind === "series" ? "/series" : "/movies"}>全部{kind === "series" ? "剧集" : "电影"}</PanelFooterLink></Panel></div>)}</div></>;
}
