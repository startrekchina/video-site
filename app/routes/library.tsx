import { useState } from "react";
import { data, Link, useNavigate } from "react-router";
import { GlobeIcon, HeartIcon, ListVideoIcon, LockIcon, PlusIcon } from "lucide-react";
import { pageRead } from "@/lib/member.server";
import { catalogCards } from "@/lib/catalog.server";
import { playlists } from "@/lib/library.server";
import { libraryRequest } from "@/lib/library-client";
import { pageTitle } from "@/lib/site";
import { WorkGrid } from "@/components/site/media";
import { Page, PageHeading, PageHeadingTagline, PageHeadingTitle, Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PlaylistRow } from "@/components/site/playlist-row";
import type { Route } from "./+types/library";
export async function loader({ request, context }: Route.LoaderArgs) {
  const current = await pageRead(request, context.cloudflare.env, context.identity, (db, userId) => Promise.all([catalogCards(db, userId), playlists(db, userId, "mine")]));
  const [{ works }, mine] = current.value;
  return data({ favorites: works.filter(work => work.favorite), mine }, { headers: current.headers });
}
export const meta = () => pageTitle("我的片库");
function NewPlaylistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate(), [title, setTitle] = useState(""), [visibility, setVisibility] = useState<"private" | "members">("private"), [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const result = await libraryRequest<{ id: string }>("/me/playlists", "POST", { title, visibility });
    setBusy(false);
    if ("error" in result) return toast.add({ title: result.error.message ?? "未创建片单，请稍后重试。", type: "error" });
    onOpenChange(false); setTitle(""); void navigate(`/playlists/${result.data.id}`);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>新建片单</DialogTitle><DialogDescription>片单里可以放整部作品，也可以放单集，并且可以调整顺序。</DialogDescription></DialogHeader>
    <form onSubmit={event => void submit(event)}><FieldGroup><Field><FieldLabel htmlFor="np-title">名称</FieldLabel><Input id="np-title" autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：TNG 必看 20 集" /></Field>
      <Field><FieldLabel>可见范围</FieldLabel><ToggleGroup value={[visibility]} onValueChange={value => value[0] && setVisibility(value[0] as typeof visibility)} variant="outline" className="w-full"><ToggleGroupItem value="private" className="flex-1"><LockIcon />仅自己</ToggleGroupItem><ToggleGroupItem value="members" className="flex-1"><GlobeIcon />站内公开</ToggleGroupItem></ToggleGroup></Field></FieldGroup>
      <DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={!title.trim() || busy}>创建</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
export default function Library({ loaderData: { favorites, mine } }: Route.ComponentProps) {
  const [creating, setCreating] = useState(false);
  return <Page><PageHeading><PageHeadingTagline>我的片库</PageHeadingTagline><PageHeadingTitle>收藏的作品和自己整理的片单。</PageHeadingTitle></PageHeading><div className="h-4" />
    <Panel><PanelHeader><PanelTitle>我的收藏<PanelTitleSup>({favorites.length})</PanelTitleSup></PanelTitle></PanelHeader>
      {favorites.length === 0 ? <Empty className="rounded-none py-12"><EmptyHeader><EmptyMedia variant="icon"><HeartIcon /></EmptyMedia><EmptyTitle>还没有收藏</EmptyTitle><EmptyDescription>在作品页点“收藏”，就能在这里快速找到它。</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" nativeButton={false} render={<Link to="/series" />}>浏览剧集</Button></EmptyContent></Empty> : <WorkGrid works={favorites} />}
    </Panel><Separator />
    <Panel><PanelHeader><PanelTitle>我的片单<PanelTitleSup>({mine.length})</PanelTitleSup></PanelTitle><div className="flex gap-2"><Button size="sm" onClick={() => setCreating(true)}><PlusIcon data-icon="inline-start" />新建</Button></div></PanelHeader>
      {mine.length === 0 ? <Empty className="rounded-none py-12"><EmptyHeader><EmptyMedia variant="icon"><ListVideoIcon /></EmptyMedia><EmptyTitle>还没有片单</EmptyTitle><EmptyDescription>把喜欢的单集和电影串成有序清单，比如“TNG 必看 20 集”，还可以分享给站内其他成员。</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setCreating(true)}>新建片单</Button></EmptyContent></Empty>
        : <ul className="divide-y divide-line">{mine.map(list => <PlaylistRow key={list.id} playlist={list} />)}</ul>}
      <PanelFooterLink to="/playlists">站内公开片单</PanelFooterLink>
    </Panel>
    <NewPlaylistDialog open={creating} onOpenChange={setCreating} />
  </Page>;
}
