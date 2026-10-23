import { data } from "react-router";
import { ListVideoIcon } from "lucide-react";
import { pageRead } from "@/lib/member.server";
import { playlists } from "@/lib/library.server";
import { pageTitle } from "@/lib/site";
import { HeadingGap, Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle } from "@/components/site/panel";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PlaylistRow } from "@/components/site/playlist-row";
import type { Route } from "./+types/playlists";
export async function loader({ request, context }: Route.LoaderArgs) {
  const current = await pageRead(request, context.cloudflare.env, context.identity, (db, userId) => playlists(db, userId, "members"));
  return data({ lists: current.value }, { headers: current.headers });
}
export const meta = () => pageTitle("站内公开片单");
export default function Playlists({ loaderData: { lists } }: Route.ComponentProps) {
  return <Page><PageHeading><PageHeadingTagline>站内公开片单</PageHeadingTagline><PageHeadingTitle>其他成员整理并公开的片单。</PageHeadingTitle><PageHeadingDescription>只有站内成员能看到。想分享自己的片单，在片单页把可见范围改成“站内公开”。</PageHeadingDescription></PageHeading><HeadingGap />
    {lists.length === 0 ? <Empty className="screen-line-bottom rounded-none py-12"><EmptyHeader><EmptyMedia variant="icon"><ListVideoIcon /></EmptyMedia><EmptyTitle>还没有站内公开片单</EmptyTitle><EmptyDescription>成员把片单设为站内公开后，会出现在这里。</EmptyDescription></EmptyHeader></Empty>
      : <ul className="*:screen-line-bottom">{lists.map(list => <PlaylistRow key={list.id} playlist={list} />)}</ul>}<div className="h-4" />
  </Page>;
}
