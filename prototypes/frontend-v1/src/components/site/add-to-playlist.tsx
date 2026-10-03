import { useRef, useState } from "react"
import { CheckIcon, ListPlusIcon, PlusIcon } from "lucide-react"

import { actions, useStore, type PlaylistItem } from "@/data/store"
import { Button } from "@/components/ui/button"
import { ChevronsUpDownIcon, type ChevronsUpDownIconHandle } from "@/components/ui/chevrons-up-down-icon"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"

export function AddToPlaylist({ item, label = "加入片单", size = "default", iconOnly }: { item: PlaylistItem; label?: string; size?: "default" | "sm" | "icon-sm"; iconOnly?: boolean }) {
  const me = useStore((s) => s.me)!
  const mine = useStore((s) => s.playlists.filter((p) => p.owner === me.username))
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState("")
  const chevrons = useRef<ChevronsUpDownIconHandle>(null)
  const has = (items: PlaylistItem[]) => items.some((i) => JSON.stringify(i) === JSON.stringify(item))

  return (
    <>
      <DropdownMenu onOpenChange={(open) => (open ? chevrons.current?.startAnimation() : chevrons.current?.stopAnimation())}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size={iconOnly ? "icon-sm" : size} aria-label={label}>
              <ListPlusIcon data-icon="inline-start" />
              {!iconOnly && (
                <>
                  {label}
                  <ChevronsUpDownIcon ref={chevrons} data-icon="inline-end" className="text-muted-foreground" />
                </>
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>加入到片单</DropdownMenuLabel>
            {mine.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">你还没有片单</div>}
            {mine.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => {
                  if (has(p.items)) return
                  actions.addToPlaylist(p.id, item)
                  toast.add({ title: "已加入片单", description: p.title, type: "success" })
                }}
              >
                <span className="flex-1 truncate">{p.title}</span>
                {has(p.items) ? <CheckIcon className="text-success" /> : <span className="font-mono text-xs text-muted-foreground">{p.items.length}</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <PlusIcon />
            新建片单…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建片单</DialogTitle>
            <DialogDescription>新片单默认私有，之后可以在片库里设为站内公开。</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!title.trim()) return
              const id = actions.createPlaylist(title.trim(), "private")
              actions.addToPlaylist(id, item)
              toast.add({ title: "已创建并加入片单", description: title.trim(), type: "success" })
              setTitle("")
              setCreating(false)
            }}
          >
            <Label htmlFor="pl-title">片单名称</Label>
            <Input id="pl-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：TNG 必看 20 集" />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                创建并加入
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
