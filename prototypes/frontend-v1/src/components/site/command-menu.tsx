import { useCallback, useState, useSyncExternalStore } from "react"
import {
  CornerDownLeftIcon,
  FilmIcon,
  HeartIcon,
  HouseIcon,
  ListVideoIcon,
  MoonStarIcon,
  SearchIcon,
  TicketIcon,
  TvIcon,
} from "lucide-react"
import { useNavigate } from "react-router"

import { MOVIES, SERIES } from "@/data/catalog"
import { useHotkey } from "@/lib/hotkeys"
import { toggleTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { SiteMark } from "@/components/site/site-mark"

// One palette per app; triggers in the header and mobile nav share this open state.
let open = false
const listeners = new Set<() => void>()
function setOpen(v: boolean | ((o: boolean) => boolean)) {
  open = typeof v === "function" ? v(open) : v
  listeners.forEach((l) => l())
}
function useOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => open,
  )
}

// Plain substring match on the item's keywords (Chinese title, English title, code), case-insensitive.
function filter(value: string, search: string, keywords?: string[]) {
  const q = search.trim().toLowerCase()
  if (!q) return 1
  const hay = [value, ...(keywords ?? [])].join(" ").toLowerCase()
  return hay.includes(q) ? 1 : 0
}

export function CommandMenuTrigger({ className }: { className?: string }) {
  return (
    <Button
      data-slot="command-menu-trigger"
      variant="ghost"
      size="sm"
      className={cn("gap-1.5 border-none px-1.5 text-muted-foreground select-none", className)}
      onClick={() => setOpen(true)}
    >
      <SearchIcon aria-hidden />
      <span className="font-sans text-sm/4 font-medium sm:hidden">搜索</span>
      <KbdGroup className="max-sm:hidden">
        <Kbd className="w-5 min-w-5">⌘</Kbd>
        <Kbd className="w-5 min-w-5">K</Kbd>
      </KbdGroup>
    </Button>
  )
}

export function CommandMenu() {
  const isOpen = useOpen()
  const navigate = useNavigate()
  const [highlighted, setHighlighted] = useState("")

  const toggle = useCallback(() => setOpen((o) => !o), [])
  const show = useCallback(() => setOpen(true), [])
  useHotkey("k", toggle, { mod: true })
  useHotkey("/", show)

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={setOpen}
      title="搜索"
      description="按中文或英文作品名搜索"
      filter={filter}
      value={highlighted}
      onValueChange={setHighlighted}
    >
      <CommandInput placeholder="输入作品名或命令…" />
      <div className="rounded-xl bg-background ring-1 ring-border">
        <CommandList className="min-h-80 scroll-fade">
          <CommandEmpty>没有找到匹配的作品</CommandEmpty>
          <CommandGroup heading="剧集">
            {SERIES.map((w) => (
              <CommandItem key={w.slug} value={w.slug} keywords={[w.titleZh, w.titleEn, w.code]} onSelect={() => go(`/title/${w.slug}`)}>
                <TvIcon />
                <span className="truncate">{w.titleZh}</span>
                <span className="truncate text-muted-foreground max-sm:hidden">{w.titleEn}</span>
                <CommandShortcut className="font-mono tracking-[0.2em] max-sm:hidden">{w.code}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="电影">
            {MOVIES.map((w) => (
              <CommandItem key={w.slug} value={w.slug} keywords={[w.titleZh, w.titleEn, String(w.year)]} onSelect={() => go(`/title/${w.slug}`)}>
                <FilmIcon />
                <span className="truncate">{w.titleZh}</span>
                <span className="truncate text-muted-foreground max-sm:hidden">{w.titleEn}</span>
                <CommandShortcut className="font-mono tracking-[0.2em] max-sm:hidden">{w.year}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="页面">
            <CommandItem value="page-home" keywords={["首页", "home"]} onSelect={() => go("/")}>
              <HouseIcon />
              首页
            </CommandItem>
            <CommandItem value="page-library" keywords={["收藏与片单", "片库", "library"]} onSelect={() => go("/library")}>
              <HeartIcon />
              收藏与片单
            </CommandItem>
            <CommandItem value="page-playlists" keywords={["站内公开片单", "playlist"]} onSelect={() => go("/playlists")}>
              <ListVideoIcon />
              站内公开片单
            </CommandItem>
            <CommandItem value="page-invites" keywords={["邀请", "invite"]} onSelect={() => go("/invites")}>
              <TicketIcon />
              邀请
            </CommandItem>
            <CommandItem
              value="action-theme"
              keywords={["切换深浅色", "主题", "dark", "theme"]}
              onSelect={() => {
                setOpen(false)
                toggleTheme()
              }}
            >
              <MoonStarIcon />
              切换深浅色
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </div>
      <CommandMenuFooter kind={kindOf(highlighted)} />
    </CommandDialog>
  )
}

type CommandKind = "work" | "page" | "command"

const ENTER_ACTION_LABELS: Record<CommandKind, string> = {
  work: "打开作品",
  page: "前往页面",
  command: "执行命令",
}

// Item values are prefixed by kind; anything unprefixed is a work slug.
function kindOf(value: string): CommandKind {
  if (value.startsWith("page-")) return "page"
  if (value.startsWith("action-")) return "command"
  return "work"
}

function CommandMenuFooter({ kind }: { kind: CommandKind }) {
  return (
    <>
      <div className="flex h-10" />
      <div className="absolute inset-x-0 bottom-0 flex h-10 items-center justify-between gap-2 rounded-b-2xl px-4 text-xs font-medium">
        <SiteMark compact className="opacity-60 grayscale" />
        <div className="flex items-center gap-2 max-sm:hidden">
          <span>{ENTER_ACTION_LABELS[kind]}</span>
          <Kbd>
            <CornerDownLeftIcon />
          </Kbd>
        </div>
      </div>
    </>
  )
}
