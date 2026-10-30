import { data, Link, useNavigate } from "react-router";
import { ArrowDownIcon, ArrowUpIcon, GlobeIcon, LockIcon, PlayIcon, Trash2Icon, XIcon } from "lucide-react";
import { pageRead } from "@/lib/member.server";
import { playlistPage } from "@/lib/library.server";
import { useLibraryWrite } from "@/lib/library-client";
import { pageTitle } from "@/lib/site";
import { Poster, WatchedBadge } from "@/components/site/media";
import { Page, PageHeading, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SwipeAction, SwipeActions, SwipeContent, SwipeItem, SwipeRoot } from "@/components/ui/swipe-actions";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VisibilityTag } from "@/components/site/playlist-row";
import type { Route } from "./+types/playlist";
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const current = await pageRead(request, context.cloudflare.env, context.identity, (db, userId) => playlistPage(db, userId, params.id));
  if (!current.value) throw new Response(null, { status: 404 });
  return data(current.value, { headers: current.headers });
}
export const meta = ({ loaderData }: Route.MetaArgs) => pageTitle(loaderData?.playlist.title);
export default function Playlist({ loaderData: { playlist, items, start, queued } }: Route.ComponentProps) {
  const navigate = useNavigate(), { run, busy } = useLibraryWrite(), base = `/me/playlists/${playlist.id}`, own = playlist.own;
  // A move sends the whole new order with the revision it was based on; the server takes it whole or refuses it.
  const move = (from: number, to: number) => { const ids = items.map(item => item.id); ids.splice(to, 0, ...ids.splice(from, 1)); void run(`${base}/items`, "PUT", { itemIds: ids, expectedRevision: playlist.revision }); };
  const remove = (id: string) => void run(`${base}/items/${id}`, "DELETE");
  async function destroy() { const result = await run(base, "DELETE", undefined, false); if (result && "data" in result) void navigate("/library", { replace: true }); }
  const play = <><PlayIcon className="fill-current" data-icon="inline-start" />按顺序播放</>;
  return <Page><PageHeading><PageHeadingTagline>片单 · <span className="font-mono">{playlist.owner}</span></PageHeadingTagline><PageHeadingTitle>{playlist.title}</PageHeadingTitle></PageHeading><div className="h-4" />
    <Panel className="screen-line-top"><div className="flex flex-wrap items-center gap-2 p-4">
      {start ? <Button nativeButton={false} render={<Link to={`${start}?playlist=${playlist.id}`} />}>{play}</Button> : queued > 0 && <Button onClick={() => toast.add({ title: "已全部看完。", type: "info" })}>{play}</Button>}
      {own ? <><ToggleGroup value={[playlist.visibility]} onValueChange={value => { if (value[0] && value[0] !== playlist.visibility) void run(base, "PATCH", { visibility: value[0] }); }} variant="outline" size="sm" aria-label="可见范围" disabled={busy}><ToggleGroupItem value="private"><LockIcon />私有</ToggleGroupItem><ToggleGroupItem value="members"><GlobeIcon />站内公开</ToggleGroupItem></ToggleGroup>
        <div className="flex-1" /><Button variant="destructive" size="sm" disabled={busy} onClick={() => void destroy()}><Trash2Icon data-icon="inline-start" />删除片单</Button></> : <VisibilityTag visibility={playlist.visibility} />}
    </div></Panel><Separator />
    <Panel><PanelHeader><PanelTitle>条目<PanelTitleSup>({items.length})</PanelTitleSup></PanelTitle></PanelHeader>
      {items.length === 0 ? <Empty className="rounded-none py-12"><EmptyHeader><EmptyTitle>片单还是空的</EmptyTitle><EmptyDescription>在作品页或播放页点“加入片单”添加条目。</EmptyDescription></EmptyHeader></Empty>
        : <SwipeRoot render={<ol className="divide-y divide-line" />}>{items.map((item, i) => <SwipeItem key={item.id} disabled={!own} render={<li className="relative overflow-hidden" />}>
          {own && <><SwipeActions side="left"><SwipeAction aria-label="上移" disabled={i === 0 || busy} onClick={() => move(i, i - 1)}><ArrowUpIcon />上移</SwipeAction><SwipeAction aria-label="下移" disabled={i === items.length - 1 || busy} onClick={() => move(i, i + 1)}><ArrowDownIcon />下移</SwipeAction></SwipeActions>
            <SwipeActions side="right" fullSwipe><SwipeAction className="bg-destructive text-white" disabled={busy} onClick={() => remove(item.id)}><Trash2Icon />移除</SwipeAction></SwipeActions></>}
          <SwipeContent className="relative flex items-center transition-[background-color] ease-out hover:bg-accent-muted"><span className="w-12 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex min-w-0 flex-1 items-center gap-3 border-l border-dashed border-line py-3 pr-2 pl-3"><Poster src={item.poster} alt="" sizes="36px" className="w-9 shrink-0" /><div className="min-w-0 flex-1"><div className="font-mono text-xs text-muted-foreground">{item.kicker}</div><Link to={item.href} draggable={false} className="block truncate font-medium after:absolute after:inset-0">{item.title}</Link><div className="truncate text-xs text-muted-foreground">{item.sub}</div></div>
              {item.watched && <WatchedBadge className="max-sm:hidden" />}
              {/* Touch screens reorder by swiping right; the buttons stay for pointer and keyboard users. */}
              {own && <div className="relative z-1 flex"><Button variant="ghost" size="icon-sm" className="pointer-coarse:hidden" aria-label="上移" disabled={i === 0 || busy} onClick={() => move(i, i - 1)}><ArrowUpIcon /></Button><Button variant="ghost" size="icon-sm" className="pointer-coarse:hidden" aria-label="下移" disabled={i === items.length - 1 || busy} onClick={() => move(i, i + 1)}><ArrowDownIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="移除" disabled={busy} onClick={() => remove(item.id)}><XIcon /></Button></div>}
            </div></SwipeContent></SwipeItem>)}</SwipeRoot>}
    </Panel>
  </Page>;
}
