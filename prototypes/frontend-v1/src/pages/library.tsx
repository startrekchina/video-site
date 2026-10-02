import { useState } from "react"
import { GlobeIcon, HeartIcon, ListVideoIcon, LockIcon, PlusIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { getWork } from "@/data/catalog"
import { actions, useStore } from "@/data/store"
import { WorkGrid } from "@/components/site/media"
import { Page, PageHeading, PageHeadingTagline, PageHeadingTitle, Panel, PanelFooterLink, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { PlaylistRow } from "@/pages/playlist"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

function NewPlaylistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState("")
  const [vis, setVis] = useState<"private" | "public">("private")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建片单</DialogTitle>
          <DialogDescription>片单里可以放整部作品，也可以放单集，并且可以调整顺序。</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim()) return
            const id = actions.createPlaylist(title.trim(), vis)
            onOpenChange(false)
            setTitle("")
            navigate(`/playlists/${id}`)
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="np-title">名称</FieldLabel>
              <Input id="np-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：TNG 必看 20 集" />
            </Field>
            <Field>
              <FieldLabel>可见范围</FieldLabel>
              <ToggleGroup value={[vis]} onValueChange={(v) => v[0] && setVis(v[0] as typeof vis)} variant="outline" className="w-full">
                <ToggleGroupItem value="private" className="flex-1">
                  <LockIcon />
                  仅自己
                </ToggleGroupItem>
                <ToggleGroupItem value="public" className="flex-1">
                  <GlobeIcon />
                  站内公开
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function LibraryPage() {
  const me = useStore((s) => s.me)!
  const favorites = useStore((s) => s.favorites)
  const all = useStore((s) => s.playlists)
  const mine = all.filter((p) => p.owner === me.username)
  const [creating, setCreating] = useState(false)

  return (
    <Page>
      <PageHeading>
        <PageHeadingTagline>我的片库</PageHeadingTagline>
        <PageHeadingTitle>收藏的作品和自己整理的片单。</PageHeadingTitle>
      </PageHeading>
      <div className="h-4" />
      <Panel>
        <PanelHeader>
          <PanelTitle>
            我的收藏<PanelTitleSup>({favorites.length})</PanelTitleSup>
          </PanelTitle>
        </PanelHeader>
        {favorites.length === 0 ? (
          <Empty className="rounded-none py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HeartIcon />
              </EmptyMedia>
              <EmptyTitle>还没有收藏</EmptyTitle>
              <EmptyDescription>在作品页点“收藏”，就能在这里快速找到它。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" render={<Link to="/series" />} nativeButton={false}>
                浏览剧集
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <WorkGrid works={favorites.map((slug) => getWork(slug)).filter((w) => !!w)} />
        )}
      </Panel>
      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>
            我的片单<PanelTitleSup>({mine.length})</PanelTitleSup>
          </PanelTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              新建
            </Button>
          </div>
        </PanelHeader>
        {mine.length === 0 ? (
          <Empty className="rounded-none py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListVideoIcon />
              </EmptyMedia>
              <EmptyTitle>还没有片单</EmptyTitle>
              <EmptyDescription>把喜欢的单集和电影串成有序清单，比如“TNG 必看 20 集”，还可以分享给站内其他成员。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreating(true)}>新建片单</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((p) => (
              <PlaylistRow key={p.id} playlist={p} />
            ))}
          </ul>
        )}
        <PanelFooterLink to="/playlists">站内公开片单</PanelFooterLink>
      </Panel>
      <NewPlaylistDialog open={creating} onOpenChange={setCreating} />
    </Page>
  )
}
