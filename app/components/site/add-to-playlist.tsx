import { useState } from "react"
import { CheckIcon, ChevronsUpDownIcon, ListPlusIcon, PlusIcon } from "lucide-react"

import { libraryRequest } from "@/lib/library-client"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"

type Mine = { id: string; title: string; count: number; has: boolean }

// The member's playlists load each time the menu opens, so pages never read lists nobody opens.
export function AddToPlaylist({ item, size = "default" }: { item: { workId: string } | { unitId: string }; size?: "default" | "sm" }) {
  const [mine, setMine] = useState<Mine[] | "loading" | "failed">("loading")
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)

  async function load() {
    // Marks from an earlier open or another work must not decide this add.
    setMine("loading")
    const result = await libraryRequest<Mine[]>(`/me/playlists?${new URLSearchParams(item)}`, "GET")
    setMine("data" in result ? result.data : "failed")
  }
  async function add(list: Mine) {
    if (list.has || busy) return
    setBusy(true)
    const result = await libraryRequest(`/me/playlists/${list.id}/items`, "POST", item)
    setBusy(false)
    if ("error" in result) return toast.add({ title: result.error.message ?? "未加入片单，请稍后重试。", type: "error" })
    setMine((current) => (Array.isArray(current) ? current.map((entry) => (entry.id === list.id ? { ...entry, has: true, count: entry.count + 1 } : entry)) : current))
    toast.add({ title: "已加入片单。", type: "success" })
  }
  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    const result = await libraryRequest("/me/playlists", "POST", { title, visibility: "private", item })
    setBusy(false)
    if ("error" in result) return toast.add({ title: result.error.message ?? "未创建片单，请稍后重试。", type: "error" })
    toast.add({ title: "已创建并加入片单。", type: "success" })
    setTitle("")
    setCreating(false)
  }

  return (
    <>
      {/* A static chevron: the prototype's animated one would load motion on every title and watch page. */}
      <DropdownMenu onOpenChange={(open) => open && void load()}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size={size}>
              <ListPlusIcon data-icon="inline-start" />
              加入片单
              <ChevronsUpDownIcon data-icon="inline-end" className="text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>加入到片单</DropdownMenuLabel>
            {!Array.isArray(mine) || mine.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">{mine === "loading" ? "正在读取片单…" : mine === "failed" ? "片单读取失败，请重新打开。" : "你还没有片单"}</div>
            ) : (
              mine.map((list) => (
                <DropdownMenuItem key={list.id} disabled={busy} onClick={() => void add(list)}>
                  <span className="flex-1 truncate">{list.title}</span>
                  {list.has ? <CheckIcon className="text-success" /> : <span className="font-mono text-xs text-muted-foreground">{list.count}</span>}
                </DropdownMenuItem>
              ))
            )}
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
          <form className="grid gap-2" onSubmit={(event) => void create(event)}>
            <Label htmlFor="pl-title">片单名称</Label>
            <Input id="pl-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：TNG 必看 20 集" />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!title.trim() || busy}>
                创建并加入
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
