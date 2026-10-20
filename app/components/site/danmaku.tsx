import { useState } from "react";
import { ListIcon, ShieldIcon, XIcon } from "lucide-react";
import type { AdminDanmaku } from "@/lib/danmaku.server";
import { forgetDanmaku, setBlockedWords, useBlockedWords, type DanmakuLimits } from "@/lib/danmaku-client";
import { libraryRequest } from "@/lib/library-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tag } from "@/components/ui/tag";
import { toast } from "@/components/ui/toast";
import { NumberPager, Stamp } from "./discussion/parts";

const modes = ["滚动", "顶部", "底部"];
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// This device's block list; it never leaves the browser (B 6.17).
export function DanmakuBlockWords({ limits }: { limits: DanmakuLimits }) {
  const words = useBlockedWords(), [draft, setDraft] = useState(""), [error, setError] = useState<string | null>(null);
  const add = () => {
    const word = draft.trim();
    if (!word) return;
    if ([...word].length > limits.blockWordMaxLength) return setError(`每个屏蔽词最多 ${limits.blockWordMaxLength} 字。`);
    if (words.some(item => item.toLowerCase() === word.toLowerCase())) return setError("已经屏蔽过这个词。");
    if (words.length >= limits.blockWordLimit) return setError(`最多 ${limits.blockWordLimit} 个屏蔽词。`);
    setBlockedWords([...words, word]); setDraft(""); setError(null);
  };
  return <Popover>
    <PopoverTrigger render={<Button variant="outline" size="sm" />}><ShieldIcon data-icon="inline-start" />屏蔽词{words.length > 0 && <span className="font-mono text-muted-foreground">{words.length}</span>}</PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-72 gap-3 p-3">
      <div><div className="text-sm font-medium">弹幕屏蔽词</div><p className="mt-0.5 text-xs text-muted-foreground">包含这些词的弹幕不再显示，只对这台设备上的你生效。</p></div>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); add(); }}>
        <Input value={draft} onChange={event => setDraft(event.target.value)} placeholder="输入要屏蔽的词" aria-label="屏蔽词" aria-invalid={!!error} className="h-8" />
        <Button type="submit" size="sm" variant="secondary" disabled={!draft.trim()}>添加</Button>
      </form>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {words.length > 0 ? <ul className="flex flex-wrap gap-1.5" aria-label="已屏蔽的词">{words.map(word => <li key={word}><Tag className="gap-1 pr-1">{word}
        <button type="button" className="rounded-sm text-muted-foreground hover:text-foreground" aria-label={`移除屏蔽词 ${word}`} onClick={() => setBlockedWords(words.filter(item => item !== word))}><XIcon className="size-3" /></button></Tag></li>)}</ul>
        : <p className="font-mono text-xs text-muted-foreground">还没有屏蔽词</p>}
    </PopoverContent>
  </Popover>;
}

type Listing = { items: AdminDanmaku[]; total: number; pageSize: number };
// The only place a sender is shown; deletion is final, and members with the page open keep seeing it until they reload (B 6.17).
export function DanmakuAdmin({ unitId, kind }: { unitId: string; kind: "episode" | "movie" }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false), [confirming, setConfirming] = useState<string | null>(null), [deleting, setDeleting] = useState(false);
  const path = `/units/${unitId}/danmaku`;
  async function load(target: number) {
    setLoading(true); setConfirming(null);
    const result = await libraryRequest<Listing>(`${path}/admin?page=${target}`, "GET");
    setLoading(false);
    if ("error" in result) { toast.add({ title: result.error.message ?? "弹幕列表加载失败，请稍后重试。", type: "error" }); return; }
    // A deletion can empty the last page; step back to the one that still has rows.
    const last = Math.max(1, Math.ceil(result.data.total / result.data.pageSize));
    if (target > last) { void load(last); return; }
    setPage(target); setListing(result.data);
  }
  async function remove(id: string) {
    setDeleting(true);
    const result = await libraryRequest(`${path}/${id}`, "DELETE");
    setDeleting(false); setConfirming(null);
    // A target someone else already deleted is gone either way.
    if ("error" in result && result.error.status !== 404) { toast.add({ title: result.error.message ?? "未删除，请稍后重试。", type: "error" }); return; }
    forgetDanmaku(id);
    toast.add({ title: "弹幕已删除。", type: "success" });
    await load(page);
  }
  const count = listing ? Math.ceil(listing.total / listing.pageSize) : 0;
  return <>
    <Button variant="outline" size="sm" onClick={() => { setOpen(true); void load(1); }}><ListIcon data-icon="inline-start" />弹幕管理</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); setConfirming(null); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>本{kind === "movie" ? "片" : "集"}弹幕{listing && <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">{listing.total}</span>}</DialogTitle>
          <DialogDescription>按视频时间排列，只有管理员能看到发送者。删除后无法恢复，已打开本页的成员刷新后不再看到。</DialogDescription>
        </DialogHeader>
        {!listing ? <p className="py-6 text-center font-mono text-sm text-muted-foreground">{loading ? "加载中…" : "弹幕列表加载失败。"}</p>
          : listing.items.length === 0 ? <p className="py-6 text-center font-mono text-sm text-muted-foreground">暂无弹幕</p>
          : <ol className="-mx-2 max-h-[min(28rem,60svh)] divide-y divide-line overflow-y-auto" aria-busy={loading}>{listing.items.map(item => <li key={item.id} className="flex items-center gap-3 px-2 py-2 text-sm">
            <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{clock(item.time)}</span>
            <span className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/20" style={{ backgroundColor: item.color }} aria-hidden />
            <span className="min-w-0 flex-1"><span className="block truncate">{item.text}</span>
              <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground"><span className="truncate">{item.author} · {modes[item.mode]}</span><Stamp t={item.createdAt} now={Date.now()} className="text-[11px]" /></span></span>
            {confirming === item.id ? <span className="flex shrink-0 gap-1"><Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>取消</Button>
              <Button size="xs" className="bg-destructive text-white hover:bg-destructive/85" disabled={deleting} onClick={() => void remove(item.id)}>确认删除</Button></span>
              : <Button size="xs" variant="ghost" className="shrink-0 text-muted-foreground" onClick={() => setConfirming(item.id)} aria-label={`删除弹幕：${item.text}`}>删除</Button>}
          </li>)}</ol>}
        <NumberPager page={page} count={count} onChange={target => void load(target)} label="弹幕分页" className="mx-auto" />
      </DialogContent>
    </Dialog>
  </>;
}
