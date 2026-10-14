import { useEffect, useRef, useState } from "react";
import { CornerDownLeftIcon, FilmIcon, HouseIcon, MoonStarIcon, SearchIcon, TicketIcon, TvIcon, UserIcon } from "lucide-react";
import { useNavigate } from "react-router";
import { toggleTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SiteMark } from "./site-mark";
import type { SearchWork } from "./site-shell";

export function CommandMenu({ open, onOpenChange, works }: { open: boolean; onOpenChange: (open: boolean) => void; works: SearchWork[] }) {
  const navigate = useNavigate(), input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(0);
  const q = query.trim().toLowerCase();
  const entries = [
    ...[...works].sort((a, b) => a.kind === b.kind ? 0 : a.kind === "series" ? -1 : 1).map(work => ({ id: `work-${work.slug}`, group: work.kind === "series" ? "剧集" : "电影", label: work.titleZh, extra: work.titleEn, hint: work.code || String(work.year ?? ""), icon: work.kind === "series" ? TvIcon : FilmIcon, to: `/title/${work.slug}`, keywords: `${work.titleZh} ${work.titleEn} ${work.code}`, kind: "打开作品" })),
    ...[{ label: "首页", to: "/", icon: HouseIcon }, { label: "剧集", to: "/series", icon: TvIcon }, { label: "电影", to: "/movies", icon: FilmIcon }, { label: "邀请", to: "/invites", icon: TicketIcon }, { label: "账号与安全", to: "/account", icon: UserIcon }].map(page => ({ ...page, id: `page-${page.to}`, group: "页面", extra: "", hint: "", keywords: page.label, kind: "前往页面" })),
    { id: "theme", group: "命令", label: "切换深浅色", extra: "", hint: "D", icon: MoonStarIcon, to: "", keywords: "切换深浅色 theme", kind: "执行命令" },
  ].filter(entry => !q || entry.keywords.toLowerCase().includes(q));
  const active = Math.min(selected, Math.max(0, entries.length - 1));
  const choose = (index: number) => { const entry = entries[index]; if (!entry) return; onOpenChange(false); if (entry.to) navigate(entry.to); else toggleTheme(); };
  useEffect(() => { if (!open) { setQuery(""); setSelected(0); } }, [open]);
  useEffect(() => { list.current?.querySelector(`#command-option-${active}`)?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [active, query]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent initialFocus={input} data-slot="command-dialog-content" className="gap-0 rounded-2xl bg-surface p-1 outline-none max-sm:top-16 max-sm:translate-y-0 sm:max-w-lg" showCloseButton={false} showOverlay={false}>
    <DialogHeader className="sr-only"><DialogTitle>搜索</DialogTitle><DialogDescription>按中文或英文作品名搜索</DialogDescription></DialogHeader>
    <div className="flex h-12 items-center gap-2 px-3"><SearchIcon className="size-5 shrink-0 text-muted-foreground" /><input ref={input} role="combobox" aria-label="搜索作品或命令" aria-controls="command-results" aria-expanded={open} aria-autocomplete="list" aria-activedescendant={entries.length ? `command-option-${active}` : undefined} className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm" placeholder="输入作品名或命令…" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected(entries.length ? (active + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length : 0); } else if (event.key === "Enter") { event.preventDefault(); choose(active); } }} /><Kbd className="text-xs">Esc</Kbd></div>
    <div className="rounded-xl bg-background ring-1 ring-border"><div ref={list} id="command-results" role="listbox" aria-label="搜索结果" className="no-scrollbar min-h-[min(20rem,calc(100dvh-12rem))] max-h-[min(20rem,calc(100dvh-12rem))] scroll-fade scroll-py-2 overflow-y-auto px-2">
      {!entries.length && <p className="py-8 text-center font-mono text-sm">没有找到匹配的作品</p>}
      {["剧集", "电影", "页面", "命令"].map(group => entries.some(entry => entry.group === group) && <div key={group} role="group" aria-label={group} className="mt-2 mb-1"><div className="px-2 py-2 text-xs font-medium text-muted-foreground">{group}</div>{entries.map((entry, index) => entry.group === group && <div key={entry.id} id={`command-option-${index}`} role="option" aria-selected={index === active} onPointerMove={() => setSelected(index)} onClick={() => choose(index)} className={cn("flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm select-none [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground", index === active && "bg-accent text-accent-foreground")}><entry.icon /><span className="truncate">{entry.label}</span><span className="truncate text-muted-foreground max-sm:hidden">{entry.extra}</span><span className="ml-auto font-mono text-xs tracking-[0.2em] text-muted-foreground max-sm:hidden">{entry.hint}</span></div>)}</div>)}
    </div></div>
    <div className="flex h-10 items-center justify-between gap-2 px-3 text-xs font-medium"><SiteMark compact className="opacity-60 grayscale" /><div className="flex items-center gap-2 max-sm:hidden"><span>{entries[active]?.kind ?? "打开作品"}</span><Kbd><CornerDownLeftIcon /></Kbd></div></div>
  </DialogContent></Dialog>;
}
