import { useLayoutEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react"
import Markdown, { type Components } from "react-markdown"
import { Link } from "react-router"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tag } from "@/components/ui/tag"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { ADMINS, commentActions, formatCommentTime, formatFullTime, likesOf, type Comment, type SortKey, type Vote } from "./data"

// ---- people ----

/** Initial tile, same as the header's account button. */
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted font-mono leading-none text-muted-foreground uppercase inset-ring-1 inset-ring-foreground/10", className)}
    >
      {name.slice(0, 1)}
    </span>
  )
}

export function Handle({ name, className }: { name: string; className?: string }) {
  return <span className={cn("font-mono text-[13px] font-medium text-foreground", className)}>@{name}</span>
}

/** 管理员, 作者 (wrote the comment a conversation hangs off) and 我. */
export function Badges({ name, me, author }: { name: string; me: string; author?: boolean }) {
  return (
    <>
      {ADMINS.has(name) && <Tag className="py-0 text-[11px]">管理员</Tag>}
      {author && <Tag className="py-0 text-[11px]">作者</Tag>}
      {me === name && <Tag className="py-0 text-[11px]">我</Tag>}
    </>
  )
}

/** English, Geist Mono; relative under a week, absolute after. The full time sits in the tooltip. */
export function Stamp({ t, now, className }: { t: number; now: number; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time dateTime={new Date(t).toISOString()} className={cn("cursor-default font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums", className)}>
            {formatCommentTime(t, now)}
          </time>
        }
      />
      <TooltipContent className="font-mono">{formatFullTime(t)}</TooltipContent>
    </Tooltip>
  )
}

export function ReplyTarget({ name }: { name: string }) {
  return (
    <span className="text-xs text-muted-foreground">
      回复 <span className="font-mono text-[13px] text-foreground/80">@{name}</span>
    </span>
  )
}

// ---- body ----

const ALLOWED = ["p", "br", "strong", "em", "del", "code", "pre", "blockquote", "ul", "ol", "li", "a", "hr", "h1", "h2", "h3", "h4", "h5", "h6"]

const Heading = ({ children }: { children?: React.ReactNode }) => (
  <p>
    <strong>{children}</strong>
  </p>
)

/** Same-origin links stay in the app; anything else, `//host` included, opens outside. */
function appPath(href: string) {
  try {
    const url = new URL(href, window.location.origin)
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : null
  } catch {
    return null
  }
}

const COMPONENTS: Components = {
  a: ({ href, children }) => {
    // react-markdown empties unsafe URLs such as javascript:, which leaves just the text.
    if (!href) return <>{children}</>
    const path = appPath(href)
    return path ? (
      <Link to={path}>{children}</Link>
    ) : (
      <a href={href} target="_blank" rel="nofollow ugc noopener noreferrer">
        {children}
      </a>
    )
  },
  // Comments get no headings: they would outshout the page. Render them as a bold line.
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
}

/** Markdown subset: no raw HTML, no images or tables; single newlines break lines. */
export function CommentBody({ body, className }: { body: string; className?: string }) {
  return (
    <div className={cn("typeset typeset-comment max-w-[45rem]", className)}>
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} allowedElements={ALLOWED} unwrapDisallowed skipHtml components={COMPONENTS}>
        {body}
      </Markdown>
    </div>
  )
}

/** Caps long bodies at `max` and offers 展开全文. */
export function Clamp({ children, max = "8.5em", className }: { children: React.ReactNode; max?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOver(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={className}>
      <div ref={ref} style={open ? undefined : { maxHeight: max }} className={cn(!open && "overflow-hidden", !open && over && "mask-b-from-50%")}>
        {children}
      </div>
      {(over || open) && (
        <button type="button" aria-expanded={open} className="mt-1 text-xs text-muted-foreground link-underline hover:text-foreground" onClick={() => setOpen((o) => !o)}>
          {open ? "收起" : "展开全文"}
        </button>
      )}
    </div>
  )
}

// ---- actions ----

export function VoteButtons({ c, votes, className }: { c: Comment; votes: Record<string, Vote>; className?: string }) {
  const v = votes[c.id]
  const likes = likesOf(c, votes)
  return (
    <div className={cn("flex items-center", className)}>
      <Button
        variant="ghost"
        size="xs"
        aria-pressed={v === 1}
        aria-label={`赞${likes ? `，${likes} 人` : ""}`}
        onClick={() => commentActions.vote(c.id, 1)}
        className={cn("min-w-6 gap-1 px-1.5 text-muted-foreground", v === 1 && "text-foreground")}
      >
        <ThumbsUpIcon className={cn(v === 1 && "fill-current")} />
        {likes > 0 && <span className="font-mono text-xs tabular-nums">{likes}</span>}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-pressed={v === -1}
              aria-label="踩"
              onClick={() => commentActions.vote(c.id, -1)}
              className={cn("text-muted-foreground", v === -1 && "text-foreground")}
            >
              <ThumbsDownIcon className={cn(v === -1 && "fill-current")} />
            </Button>
          }
        />
        <TooltipContent>踩不显示数量，只影响排序</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function ReplyButton({ onClick, label = "回复" }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick} className="px-1.5 font-normal text-muted-foreground">
      {label}
    </Button>
  )
}

export function ActionDivider() {
  return <span className="mx-1 h-3 w-px bg-line" aria-hidden />
}

// ---- sort ----

export const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: "smart", label: "智能", hint: "赞多、踩少、回复多的靠前，新评论两天内有加权" },
  { key: "new", label: "最新", hint: "按发表时间，新的在前" },
  { key: "old", label: "最早", hint: "按发表时间，早的在前" },
]

export function SortTabs({ value, onChange, className }: { value: SortKey; onChange: (s: SortKey) => void; className?: string }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as SortKey)} className={className}>
      <TabsList aria-label="评论排序">
        {SORTS.map((s) => (
          <Tooltip key={s.key}>
            <TooltipTrigger render={<TabsTrigger value={s.key} className="px-3" />}>{s.label}</TooltipTrigger>
            <TooltipContent>{s.hint}</TooltipContent>
          </Tooltip>
        ))}
        <TabsIndicator />
      </TabsList>
    </Tabs>
  )
}

// ---- pagination ----

/** 1 … 4 5 6 … 12: first, last, and the neighbours of the current page. */
export function pageWindow(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const set = new Set([1, count, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p))
  if (page >= count - 2) [count - 3, count - 2, count - 1].forEach((p) => set.add(p))
  const pages = [...set].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b)
  const out: (number | "gap")[] = []
  pages.forEach((p, i) => {
    if (i && p - pages[i - 1] > 1) out.push("gap")
    out.push(p)
  })
  return out
}

/** Segmented box like the subtitle switch: 1px rules between cells, current cell grey. */
export function NumberPager({ page, count, onChange, label = "评论分页", className }: { page: number; count: number; onChange: (p: number) => void; label?: string; className?: string }) {
  if (count <= 1) return null
  const cell = "flex h-8 min-w-8 items-center justify-center px-2 font-mono text-xs tabular-nums outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ring"
  const step = "text-muted-foreground hover:bg-accent-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
  return (
    <nav aria-label={label} className={cn("flex w-fit items-stretch divide-x divide-border overflow-hidden rounded-lg border bg-background dark:bg-input/30", className)}>
      <button type="button" className={cn(cell, step)} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">
        <ChevronLeftIcon className="size-3.5" />
      </button>
      {pageWindow(page, count).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className={cn(cell, "text-muted-foreground")}>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-label={`第 ${p} 页`}
            aria-current={p === page ? "page" : undefined}
            onClick={() => onChange(p)}
            className={cn(cell, p === page ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent-muted hover:text-foreground")}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" className={cn(cell, step)} disabled={page >= count} onClick={() => onChange(page + 1)} aria-label="下一页">
        <ChevronRightIcon className="size-3.5" />
      </button>
    </nav>
  )
}

// ---- helpers ----

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** Scrolls `el` to just under the header if its top has gone above the viewport. */
export function revealTop(el: HTMLElement | null) {
  if (!el) return
  if (el.getBoundingClientRect().top < 64) el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" })
}

/** Centers `el` unless it already sits clear of the sticky header and the bottom fade. */
export function revealClear(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  if (r.top >= 64 && r.bottom <= window.innerHeight - 96) return
  el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" })
}

/** Brief highlight that fades back to the element's own background. */
export function flash(el: HTMLElement | null) {
  if (!el || reducedMotion()) return
  const style = getComputedStyle(el)
  el.animate({ backgroundColor: [style.getPropertyValue("--border").trim(), style.backgroundColor] }, { duration: 1600, easing: "ease-out" })
}

export function fakeLatency(ms = 500) {
  return new Promise((r) => setTimeout(r, ms))
}
