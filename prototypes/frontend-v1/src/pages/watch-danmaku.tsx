import { useState } from "react"
import { ListIcon, ShieldIcon, XIcon } from "lucide-react"

import {
  BLOCK_WORD_LIMIT,
  BLOCK_WORD_MAX_LENGTH,
  charCount,
  danmakuActions,
  MODE_LABELS,
  setBlockedWords,
  useBlockedWords,
  useDanmakuList,
} from "@/data/danmaku"
import { formatFullTime } from "@/pages/watch-comments/data"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tag } from "@/components/ui/tag"
import { toast } from "@/components/ui/toast"

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`

/** Viewer-local keyword filter; stored in this browser only and never sent to the server. */
export function DanmakuBlockWords() {
  const words = useBlockedWords()
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const w = draft.trim()
    if (!w) return
    if (charCount(w) > BLOCK_WORD_MAX_LENGTH) return setError(`每个屏蔽词最多 ${BLOCK_WORD_MAX_LENGTH} 字。`)
    if (words.some((x) => x.toLowerCase() === w.toLowerCase())) return setError("已经屏蔽过这个词。")
    if (words.length >= BLOCK_WORD_LIMIT) return setError(`最多 ${BLOCK_WORD_LIMIT} 个屏蔽词。`)
    setBlockedWords([...words, w])
    setDraft("")
    setError(null)
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <ShieldIcon data-icon="inline-start" />
        屏蔽词{words.length > 0 && <span className="font-mono text-muted-foreground">{words.length}</span>}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 gap-3 p-3">
        <div>
          <div className="text-sm font-medium">弹幕屏蔽词</div>
          <p className="mt-0.5 text-xs text-muted-foreground">包含这些词的弹幕不再显示，只对这台设备上的你生效。</p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输入要屏蔽的词" aria-label="屏蔽词" aria-invalid={!!error} className="h-8" />
          <Button type="submit" size="sm" variant="secondary" disabled={!draft.trim()}>
            添加
          </Button>
        </form>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {words.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="已屏蔽的词">
            {words.map((w) => (
              <li key={w}>
                <Tag className="gap-1 pr-1">
                  {w}
                  <button type="button" className="rounded-sm text-muted-foreground hover:text-foreground" aria-label={`移除屏蔽词 ${w}`} onClick={() => setBlockedWords(words.filter((x) => x !== w))}>
                    <XIcon className="size-3" />
                  </button>
                </Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">还没有屏蔽词</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Admin-only list: the only place a sender is shown. Deletion is permanent, as with discussions. */
export function DanmakuAdmin({ unitId }: { unitId: string }) {
  const list = useDanmakuList(unitId)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const sorted = [...list].sort((a, b) => a.time - b.time)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListIcon data-icon="inline-start" />
        弹幕管理<span className="font-mono text-muted-foreground">{list.length}</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => (setOpen(o), setConfirming(null))}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>本{unitId.startsWith("movie-") ? "片" : "集"}弹幕</DialogTitle>
            <DialogDescription>按视频时间排列，只有管理员能看到发送者。删除后无法恢复，已打开本页的成员刷新后不再看到。</DialogDescription>
          </DialogHeader>
          {sorted.length === 0 ? (
            <p className="py-6 text-center font-mono text-sm text-muted-foreground">暂无弹幕</p>
          ) : (
            <ol className="-mx-2 max-h-[min(28rem,60svh)] divide-y divide-line overflow-y-auto">
              {sorted.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-2 py-2 text-sm">
                  <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{clock(d.time)}</span>
                  <span className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/20" style={{ backgroundColor: d.color }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{d.text}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground" title={formatFullTime(d.createdAt)}>
                      {d.author} · {MODE_LABELS[d.mode]}
                    </span>
                  </span>
                  {confirming === d.id ? (
                    <span className="flex shrink-0 gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                        取消
                      </Button>
                      <Button
                        size="xs"
                        className="bg-destructive text-white hover:bg-destructive/85"
                        onClick={() => {
                          danmakuActions.remove(unitId, d.id)
                          setConfirming(null)
                          toast.add({ title: "弹幕已删除。", type: "success" })
                        }}
                      >
                        确认删除
                      </Button>
                    </span>
                  ) : (
                    <Button size="xs" variant="ghost" className="shrink-0 text-muted-foreground" onClick={() => setConfirming(d.id)} aria-label={`删除弹幕：${d.text}`}>
                      删除
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
