import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, MessageSquareIcon, MessagesSquareIcon } from "lucide-react"
import { useRouteLoaderData } from "react-router"

import type { Comment, Reply, SortKey, Vote } from "@/lib/discussion"
import { libraryRequest } from "@/lib/library-client"
import { cn } from "@/lib/utils"
import type { loader as rootLoader } from "@/root"
import { Panel, PanelHeader, PanelTitle, PanelTitleSup } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { StatusButton } from "@/components/ui/status-button"
import { toast } from "@/components/ui/toast"

import { Composer, type ComposerHandle } from "./composer"
import { DiscussionLoading } from "./index"
import { ActionDivider, Avatar, Badges, Clamp, CommentBody, flash, Handle, NumberPager, reducedMotion, ReplyButton, ReplyTarget, revealTop, SortTabs, Stamp, VoteButtons } from "./parts"

// Watch-page discussion, built on the dual-pane study (Fig. B of proto/comments-ui): comments on the
// left, the open comment's conversation on the right. The pane sticks under the header while the list
// scrolls past and keeps its own composer at the foot. Below lg the conversation opens inline instead.

const PANE_ID = "comments-conversation"
const NEW_DRAFT = "new"
const WIDE = "(min-width: 64rem)"

type Target = { id: string; name: string }
type Pulse = { id: string; at: number } | null
type First = { order: string[]; items: Comment[]; pageSize: number; maxLength: number }
type Ctx = { now: number; admin: boolean; voting: Record<string, boolean>; onVote: (root: Comment, item: Comment | Reply, v: 1 | -1) => void; onDelete: (root: Comment, reply?: Reply) => void }

type Thread = {
  root: Comment
  ctx: Ctx
  pulse: Pulse
  loadingMore: boolean
  onMore: () => void
  onReply: (target: Reply | null) => void
  composer: React.ReactNode
}

const useWide = () =>
  useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(WIDE)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    () => window.matchMedia(WIDE).matches,
  )

/** Re-renders every `ms` so relative timestamps keep moving. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const merge = (shown: Reply[], more: Reply[]) => [...shown, ...more.filter((r) => !shown.some((s) => s.id === r.id))]
const failed = (message: string | undefined, fallback: string) => toast.add({ title: message ?? fallback, type: "error" })

/** Clicks on these inside a comment keep their own meaning instead of opening the conversation. */
const isControl = (t: EventTarget) => t instanceof Element && !!t.closest("a, button, input, textarea, [role=button]")

/** Highlights the element once when `pulse` names it, e.g. right after it was posted. */
function usePulse<T extends HTMLElement>(pulse: Pulse, id: string, reveal = false) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (pulse?.id !== id) return
    if (reveal) ref.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" })
    flash(ref.current)
  }, [pulse, id, reveal])
  return ref
}

function Meta({ item, now, author }: { item: Comment | Reply; now: number; author?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Handle name={item.author} className="break-all" />
      <Badges admin={item.admin} author={author} mine={item.mine} />
      {"replyTo" in item && item.replyTo && <ReplyTarget name={item.replyTo} />}
      <Stamp t={item.createdAt} now={now} />
    </div>
  )
}

/** Vote and reply actions, followed by delete for admins only (B 6.12.4). */
function Actions({ root, item, ctx, onReply, className, children }: { root: Comment; item: Comment | Reply; ctx: Ctx; onReply: () => void; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("-ml-1.5 flex flex-wrap items-center gap-1", className)}>
      <VoteButtons likes={item.likes} vote={item.vote} busy={ctx.voting[item.id]} onVote={(v) => ctx.onVote(root, item, v)} />
      <ActionDivider />
      <ReplyButton onClick={onReply} />
      {ctx.admin && <ReplyButton label="删除" onClick={() => ctx.onDelete(root, item.id === root.id ? undefined : (item as Reply))} />}
      {children}
    </div>
  )
}

function ReplyItem({ c, root, ctx, pulse, onReply, className }: { c: Reply; root: Comment; ctx: Ctx; pulse: Pulse; onReply: () => void; className?: string }) {
  const ref = usePulse<HTMLLIElement>(pulse, c.id, true)
  return (
    <li ref={ref} className={cn("flex gap-2.5 py-2.5", className)}>
      <Avatar name={c.author} size={24} className="mt-px" />
      <div className="min-w-0 flex-1">
        <Meta item={c} now={ctx.now} author={c.author === root.author} />
        <Clamp max="7.5em" className="mt-0.5">
          <CommentBody body={c.body} />
        </Clamp>
        <Actions root={root} item={c} ctx={ctx} onReply={onReply} className="mt-1" />
      </div>
    </li>
  )
}

/** Replies in posting order, a batch at a time: a conversation reads top to bottom whatever the comment sort is. */
function Replies({ root, ctx, pulse, loadingMore, onMore, onReply, inset, empty }: Thread & { inset: string; empty: React.ReactNode }) {
  if (!root.replyCount) return empty
  const rest = root.replyCount - root.replies.length
  return (
    <>
      <ol aria-label={`@${root.author} 的评论下的回复`}>
        {root.replies.map((r) => (
          <ReplyItem key={r.id} c={r} root={root} ctx={ctx} pulse={pulse} onReply={() => onReply(r)} className={inset} />
        ))}
      </ol>
      {rest > 0 && (
        <div className={cn("pb-2", inset)}>
          <Button variant="ghost" size="xs" disabled={loadingMore} onClick={onMore} className="-ml-1.5 font-normal text-muted-foreground">
            <ChevronDownIcon />
            显示更多回复
            <span className="font-mono tabular-nums">（还有 {rest} 条）</span>
          </Button>
        </div>
      )}
    </>
  )
}

/**
 * Grid cell for the pane. It tracks its own edges as `--pane-top` and `--pane-bottom`, so the pane can fill
 * the visible part of the column above the bottom fade: the reply box is on screen before the pane sticks,
 * and where the list runs out the pane shrinks instead of sliding its header up under the site header.
 */
function PaneSlot({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      el.style.setProperty("--pane-top", `${r.top}px`)
      el.style.setProperty("--pane-bottom", `${r.bottom}px`)
    }
    update()
    // Content above the section (season list, clamps) can move it without a scroll.
    const ro = new ResizeObserver(update)
    ro.observe(document.body)
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [])
  return (
    <div className="relative min-h-96">
      <div ref={ref} className="absolute inset-0">
        {children}
      </div>
    </div>
  )
}

const PANE_TOP = "max(var(--pane-top, 0px), var(--header-height))"
const PANE_HEIGHT = `max(24rem, min(var(--pane-bottom, 100svh) - ${PANE_TOP}, 100svh - ${PANE_TOP} - var(--fade-bottom-height)))`

/** Wide screens: the open conversation, sticky beside the list, with the reply box docked at its foot. */
function ConversationPane({ thread }: { thread: Thread }) {
  const { root, ctx } = thread
  return (
    <section id={PANE_ID} aria-labelledby={`${PANE_ID}-title`} style={{ height: PANE_HEIGHT }} className="sticky top-(--header-height) flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <MessagesSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h3 id={`${PANE_ID}-title`} className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
          对话
          <span className="truncate font-mono text-xs font-normal text-muted-foreground">@{root.author}</span>
        </h3>
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{root.replyCount} 条回复</span>
      </header>
      <div key={root.id} className="min-h-0 flex-1 overflow-y-auto motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0">
        <article aria-label={`@${root.author} 的评论`} className="flex gap-2.5 border-b border-line bg-accent-muted px-4 py-3">
          <Avatar name={root.author} size={24} className="mt-px" />
          <div className="min-w-0 flex-1">
            <Meta item={root} now={ctx.now} />
            <Clamp max="11em" className="mt-0.5">
              <CommentBody body={root.body} />
            </Clamp>
            <Actions root={root} item={root} ctx={ctx} onReply={() => thread.onReply(null)} className="mt-1" />
          </div>
        </article>
        <Replies {...thread} inset="px-4" empty={<p className="px-4 py-8 text-center text-sm text-muted-foreground">还没有回复，来说第一句吧。</p>} />
      </div>
      <div className="shrink-0 border-t border-line p-3">{thread.composer}</div>
    </section>
  )
}

/** Narrow screens: the conversation unfolds under its comment, reply box last. */
function InlineThread({ thread }: { thread: Thread }) {
  return (
    <div className="mt-2 border-l border-line">
      <Replies {...thread} inset="pl-3" empty={null} />
      <div className="pt-1 pb-0.5 pl-3">{thread.composer}</div>
    </div>
  )
}

function CommentRow({
  c,
  ctx,
  wide,
  open,
  pulse,
  onOpen,
  onReply,
  children,
}: {
  c: Comment
  ctx: Ctx
  wide: boolean
  open: boolean
  pulse: Pulse
  onOpen: () => void
  onReply: () => void
  children?: React.ReactNode
}) {
  const ref = usePulse<HTMLElement>(pulse, c.id)
  const pickable = wide && !open
  return (
    <article
      ref={ref}
      onClick={pickable ? (e) => !isControl(e.target) && window.getSelection()?.isCollapsed !== false && onOpen() : undefined}
      className={cn(
        "relative flex gap-3 px-4 py-4 transition-colors",
        pickable && "cursor-pointer hover:bg-accent-muted/60",
        // The open comment is tied to the pane by a bar riding the column rule.
        wide && open && "bg-accent-muted after:absolute after:inset-y-0 after:-right-px after:w-0.5 after:bg-foreground",
      )}
    >
      <Avatar name={c.author} size={32} />
      <div className="min-w-0 flex-1">
        <Meta item={c} now={ctx.now} />
        <Clamp className="mt-1">
          <CommentBody body={c.body} />
        </Clamp>
        <Actions root={c} item={c} ctx={ctx} onReply={onReply} className="mt-1.5">
          {c.replyCount > 0 && (
            <Button
              variant={wide && open ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={wide ? open : undefined}
              aria-expanded={wide ? undefined : open}
              aria-controls={wide ? PANE_ID : undefined}
              onClick={onOpen}
              className={cn("ml-auto gap-1 px-1.5 font-normal text-muted-foreground", open && "text-foreground")}
            >
              <MessagesSquareIcon />
              <span className="font-mono tabular-nums">{c.replyCount}</span>
              条回复
              {wide ? <ChevronRightIcon /> : open ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
          )}
        </Actions>
        {children}
      </div>
    </article>
  )
}

export default function DiscussionSection({ unitId, kind }: { unitId: string; kind: "episode" | "movie" }) {
  const member = useRouteLoaderData<typeof rootLoader>("root")?.member
  const wide = useWide()
  const now = useNow()
  const base = `/units/${unitId}`
  const [sort, setSort] = useState<SortKey>("smart")
  // Fixed when the sort is chosen; posts and votes never reshuffle it (B 6.12.3). null until the first load.
  const [order, setOrder] = useState<string[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [limits, setLimits] = useState({ pageSize: 10, maxLength: 1000 })
  const [comments, setComments] = useState<Record<string, Comment>>({})
  // Your own new comments, pinned to the top of page one whatever the sort. Kept apart from the order, so a sort
  // answered after a post cannot drop it.
  const [fresh, setFresh] = useState<string[]>([])
  // Comments found deleted here, kept for the same reason: a late sort answer must not bring them back.
  const [removed, setRemoved] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageRetry, setPageRetry] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<Record<string, Target | null>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [voting, setVoting] = useState<Record<string, boolean>>({})
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<{ root: Comment; reply?: Reply } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [pulse, setPulse] = useState<Pulse>(null)
  const [announcement, setAnnouncement] = useState("")
  const list = useRef<HTMLOListElement>(null)
  const replyBox = useRef<ComposerHandle>(null)
  const latest = useRef(0)
  const reading = useRef<string | null>(null)
  // Async steps read the conversation as it is now, not as it was when they started.
  const known = useRef(comments)
  known.current = comments
  // When each comment last changed on this page, so a sort answer only replaces what stayed untouched since it was asked.
  const changes = useRef(0)
  const changed = useRef(new Map<string, number>())
  // The newest load of each conversation while it runs, the only one whose answers count: an older one still on its
  // way would add what is left after its own cursor to replies already read past it.
  const loads = useRef(new Map<string, object>())
  // Conversations with a reply on its way, whose load to the end starts only once it is sent.
  const posting = useRef(new Set<string>())

  const cache = (items: Comment[]) => setComments((c) => ({ ...c, ...Object.fromEntries(items.map((item) => [item.id, item])) }))
  const patch = (id: string, change: (c: Comment) => Comment) => {
    changed.current.set(id, ++changes.current)
    setComments((c) => (c[id] ? { ...c, [id]: change(c[id]) } : c))
  }

  const load = async (next: SortKey) => {
    const ticket = ++latest.current, asked = changes.current, before = known.current
    const result = await libraryRequest<First>(`${base}/comments?sort=${next}`, "GET")
    if (ticket !== latest.current) return
    if ("error" in result) {
      if (order) failed(result.error.message, "讨论未加载，请稍后重试。")
      else setUnavailable(true)
      return
    }
    const { data } = result
    // The answer is a snapshot from when it was asked: it refreshes every comment except those changed here since. One
    // still loading replies keeps its own, since that batch lands after its cursor and would leave a gap in the first.
    const newer = data.items.filter((item) => (changed.current.get(item.id) ?? 0) <= asked)
    const loading = newer.filter((item) => loads.current.has(item.id)).map((item) => item.id)
    // Comments read before it that it does not carry are dropped, so their page reads them again; your pinned posts
    // show at once and stay, and so does a conversation still sending or loading, or changed here since: it is newer.
    const listed = data.items.map((item) => item.id)
    const kept = (id: string) => listed.includes(id) || fresh.includes(id) || !before[id] || loads.current.has(id) || posting.current.has(id) || (changed.current.get(id) ?? 0) > asked
    setComments((c) => ({
      ...Object.fromEntries(Object.entries(c).filter(([id]) => kept(id))),
      ...Object.fromEntries(newer.map((item) => [item.id, loading.includes(item.id) ? { ...item, replies: c[item.id].replies, replyCount: c[item.id].replyCount } : item])),
    }))
    // Your posts from before the request that it no longer lists were deleted elsewhere.
    setRemoved((r) => [...r, ...fresh.filter((id) => !data.order.includes(id))])
    setLimits({ pageSize: data.pageSize, maxLength: data.maxLength })
    setOrder(data.order)
    setSort(next)
    setPage(1)
    setUnavailable(false)
  }
  useEffect(() => {
    void load("smart")
  }, [])

  const all = order ? [...new Set([...fresh, ...order])].filter((id) => !removed.includes(id)) : []
  const pageCount = Math.max(1, Math.ceil(all.length / limits.pageSize))
  const current = Math.min(page, pageCount)
  const visible = all.slice((current - 1) * limits.pageSize, current * limits.pageSize)
  const missing = visible.filter((id) => !comments[id]).join(",")
  const items = visible.flatMap((id) => (comments[id] ? [comments[id]] : []))

  // A page beyond the first load reads its comments by ID, so it shows exactly what the fixed order says.
  useEffect(() => {
    setPageError(null)
    if (!missing) return
    let live = true
    void libraryRequest<{ items: Comment[] }>(`${base}/comments?ids=${missing}`, "GET").then((result) => {
      if (!live) return
      if ("error" in result) return setPageError(result.error.message ?? "评论未加载，请稍后重试。")
      cache(result.data.items)
      // Comments deleted since the order was taken leave the list instead of a gap.
      const gone = missing.split(",").filter((id) => !result.data.items.some((item) => item.id === id))
      if (gone.length) setRemoved((r) => [...r, ...gone])
    })
    return () => {
      live = false
    }
  }, [missing, pageRetry])

  // Posting can move the open conversation off the page; keep reading it from the cache.
  // Narrow layouts retain its row so the inline conversation stays available too.
  const open = (picked && all.includes(picked) ? comments[picked] : undefined) ?? (wide ? (items.find((c) => !fresh.includes(c.id)) ?? items[0]) : undefined)
  reading.current = open?.id ?? null
  const rows = !wide && open && !visible.includes(open.id) ? [...items, open] : items

  const bind = (id: string) => ({
    value: drafts[id] ?? "",
    onValueChange: (v: string) => setDrafts((d) => ({ ...d, [id]: v })),
    sending: !!sending[id],
    maxLength: limits.maxLength,
  })

  // Committed synchronously so the box can take focus inside the tap: iOS only raises the keyboard then.
  const reply = (root: Comment, target: Reply | null) => {
    flushSync(() => {
      setPicked(root.id)
      setTargets((t) => ({ ...t, [root.id]: target && target.author !== root.author ? { id: target.id, name: target.author } : null }))
    })
    replyBox.current?.focus()
  }

  // Loads the next batch of a conversation, or with `all` whatever is left of it. `all` asks the server at least
  // once, since others may have replied since the count was read. False when no batch reached the server.
  const more = async (id: string, all = false) => {
    const root = known.current[id]
    if (!root) return true
    const mine = {}
    loads.current.set(id, mine)
    setLoadingMore((l) => ({ ...l, [id]: true }))
    try {
      for (let last = root.replies.at(-1), wanted = all || root.replyCount > root.replies.length, reached = false; wanted; reached = true) {
        const result = await libraryRequest<{ items: Reply[]; rest: number }>(`${base}/comments/${id}/replies?afterAt=${last?.createdAt ?? 0}&afterId=${last?.id ?? "0"}`, "GET")
        // Taken over by a newer load, which reads to the end: the load-more button waits while one runs, so only a posted reply starts one.
        if (loads.current.get(id) !== mine) return true
        if ("error" in result) {
          failed(result.error.message, "回复未加载，请稍后重试。")
          return reached
        }
        const { items, rest } = result.data
        // Merged into the conversation as it is now, so replies deleted or added meanwhile stay that way.
        patch(id, (c) => {
          const replies = merge(c.replies, items)
          return { ...c, replies, replyCount: replies.length + rest }
        })
        last = items.at(-1) ?? last
        wanted = all && rest > 0
      }
      return true
    } finally {
      if (loads.current.get(id) === mine) {
        loads.current.delete(id)
        setLoadingMore((l) => ({ ...l, [id]: false }))
      }
    }
  }

  // Tracked per box rather than in the box, which remounts when you switch threads mid-send: the post
  // still lands, the box stays held until it does, and text typed meanwhile is not wiped. A failure keeps
  // the draft for a retry (B 6.12.2).
  const send = async <T extends { id: string }>(id: string, body: string, path: string, extra: object = {}) => {
    setSending((s) => ({ ...s, [id]: true }))
    setAnnouncement("正在发送…")
    const result = await libraryRequest<T>(path, "POST", { bodyMarkdown: body, ...extra })
    setSending((s) => ({ ...s, [id]: false }))
    if ("error" in result) {
      setAnnouncement("")
      failed(result.error.message, "未发送，请稍后重试。")
      return null
    }
    setDrafts((d) => (d[id] === body ? { ...d, [id]: "" } : d))
    setPulse({ id: result.data.id, at: Date.now() })
    return result.data
  }

  const postRoot = async (body: string) => {
    const c = await send<Comment>(NEW_DRAFT, body, `${base}/comments`)
    if (!c) return false
    cache([c])
    setPicked(reading.current)
    setFresh((f) => [c.id, ...f])
    setPage(1)
    setAnnouncement("评论已发送")
    return true
  }

  const postReply = async (root: Comment, body: string) => {
    posting.current.add(root.id)
    try {
      const target = targets[root.id] ?? null
      const r = await send<Reply>(root.id, body, `${base}/comments/${root.id}/replies`, target ? { replyTo: target.id } : {})
      if (!r) return false
      setTargets((t) => ((t[root.id] ?? null)?.id === target?.id ? { ...t, [root.id]: null } : t))
      // The new reply ends the conversation: it loads with whatever came before it. If no batch gets through it is
      // only counted, so the load-more control still brings the rest in order instead of paging past it.
      if (!(await more(root.id, true))) patch(root.id, (c) => ({ ...c, replyCount: c.replyCount + 1 }))
      setAnnouncement("回复已发送")
      return true
    } finally {
      posting.current.delete(root.id)
    }
  }

  const vote = async (root: Comment, item: Comment | Reply, value: 1 | -1) => {
    const next = item.vote === value ? 0 : value
    const isRoot = item.id === root.id
    setVoting((v) => ({ ...v, [item.id]: true }))
    const result = await libraryRequest<{ likes: number; vote: Vote }>(`${base}/${isRoot ? "comments" : "replies"}/${item.id}/vote`, next ? "PUT" : "DELETE", next ? { value: next } : {})
    setVoting((v) => ({ ...v, [item.id]: false }))
    if ("error" in result) return failed(result.error.message, "未保存，请稍后重试。")
    const saved = result.data
    patch(root.id, (c) => (isRoot ? { ...c, ...saved } : { ...c, replies: c.replies.map((x) => (x.id === item.id ? { ...x, ...saved } : x)) }))
  }

  const remove = async () => {
    if (!deleting) return
    const { root, reply } = deleting
    setRemoving(true)
    // Changed from the moment it is sent: a sort read before then still counts the reply, so it leaves this
    // conversation alone, while one read after it already leaves the reply out.
    if (reply) changed.current.set(root.id, ++changes.current)
    const result = await libraryRequest(`${base}/${reply ? `replies/${reply.id}` : `comments/${root.id}`}`, "DELETE")
    setRemoving(false)
    // Already gone is as good as deleted: the page drops it either way.
    if ("error" in result && result.error.status !== 404) return failed(result.error.message, "未删除，请稍后重试。")
    setDeleting(null)
    // A reply such a refresh already dropped is already off the count too.
    if (reply) patch(root.id, (c) => (c.replies.some((x) => x.id === reply.id) ? { ...c, replies: c.replies.filter((x) => x.id !== reply.id), replyCount: c.replyCount - 1 } : c))
    else {
      setRemoved((r) => [...r, root.id])
      setPicked((p) => (p === root.id ? null : p))
    }
    toast.add({ title: reply ? "回复已删除。" : "评论已删除。", type: "success" })
  }

  const ctx: Ctx = { now, admin: member?.role === "admin", voting, onVote: (root, item, v) => void vote(root, item, v), onDelete: (root, reply) => setDeleting({ root, reply }) }

  const threadOf = (root: Comment): Thread => ({
    root,
    ctx,
    pulse,
    loadingMore: !!loadingMore[root.id],
    onMore: () => void more(root.id),
    onReply: (target) => reply(root, target),
    composer: (
      <Composer
        ref={replyBox}
        key={root.id}
        dense
        replyTo={targets[root.id]?.name ?? root.author}
        onCancel={targets[root.id] ? () => setTargets((t) => ({ ...t, [root.id]: null })) : undefined}
        placeholder="接着聊聊…"
        onSubmit={(body) => postReply(root, body)}
        {...bind(root.id)}
      />
    ),
  })

  if (!order && !unavailable) return <DiscussionLoading kind={kind} />

  const from = (current - 1) * limits.pageSize + 1
  const to = Math.min(all.length, current * limits.pageSize)

  return (
    <Panel id="comments" aria-labelledby="comments-title">
      <PanelHeader className="flex-wrap gap-y-1">
        <PanelTitle id="comments-title">
          {kind === "episode" ? "本集讨论" : "本片讨论"}
          {all.length > 0 && <PanelTitleSup>({all.length})</PanelTitleSup>}
        </PanelTitle>
        {all.length > 1 && <SortTabs value={sort} onChange={(s) => { setPicked(null); void load(s) }} />}
      </PanelHeader>

      {unavailable ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareIcon />
            </EmptyMedia>
            <EmptyTitle>讨论暂时无法加载</EmptyTitle>
            <EmptyDescription>请稍后再试。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void load(sort)}>
              重试
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        // The composer heads the list column, so it keeps a writing width and the pane starts higher.
        <div className={cn("grid", wide && open && "grid-cols-[minmax(0,1fr)_28rem]")}>
          <div className={cn("min-w-0", wide && open && "border-r border-line")}>
            <div className="flex gap-3 border-b border-line p-4">
              <Avatar name={member?.username ?? ""} size={32} className="max-sm:hidden" />
              <Composer className="min-w-0 flex-1" placeholder={kind === "episode" ? "这集最打动你的是什么？" : "这部电影最打动你的是什么？"} onSubmit={postRoot} {...bind(NEW_DRAFT)} />
            </div>
            {all.length === 0 ? (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageSquareIcon />
                  </EmptyMedia>
                  <EmptyTitle>还没有讨论</EmptyTitle>
                  <EmptyDescription>看完有什么想说的，来写第一条吧。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <ol ref={list} aria-label="评论" aria-busy={!!missing && !pageError} className="divide-y divide-line">
                  {rows.map((c) => {
                    const isOpen = c.id === open?.id
                    return (
                      <li key={c.id}>
                        <CommentRow c={c} ctx={ctx} wide={wide} open={isOpen} pulse={pulse} onOpen={() => setPicked(!wide && isOpen ? null : c.id)} onReply={() => reply(c, null)}>
                          {!wide && isOpen && <InlineThread thread={threadOf(c)} />}
                        </CommentRow>
                      </li>
                    )
                  })}
                </ol>
                {missing && pageError && (
                  <Empty role="alert" className="py-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageSquareIcon />
                      </EmptyMedia>
                      <EmptyTitle>评论暂时无法加载</EmptyTitle>
                      <EmptyDescription>{pageError}</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setPageError(null)
                          setPageRetry((n) => n + 1)
                        }}
                      >
                        重试
                      </Button>
                    </EmptyContent>
                  </Empty>
                )}
              </>
            )}
          </div>
          {wide && open && (
            <PaneSlot>
              <ConversationPane thread={threadOf(open)} />
            </PaneSlot>
          )}
        </div>
      )}

      {pageCount > 1 && (
        <div className="screen-line-top flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {from}–{to} / {all.length} 条评论
          </span>
          <NumberPager
            page={current}
            count={pageCount}
            onChange={(p) => {
              setPicked(null)
              setPage(p)
              setTimeout(() => revealTop(list.current))
            }}
          />
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <Dialog open={!!deleting} onOpenChange={(value) => !value && !removing && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleting?.reply ? "删除这条回复？" : "删除这条评论？"}</DialogTitle>
            <DialogDescription>
              {deleting?.reply
                ? "回复和它收到的赞踩会被删除，无法恢复。"
                : deleting?.root.replyCount
                  ? `评论和它下面的 ${deleting.root.replyCount} 条回复会一起删除，无法恢复。`
                  : "评论和它收到的赞踩会被删除，无法恢复。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={removing} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <StatusButton variant="destructive" status={removing ? "loading" : "idle"} onClick={() => void remove()}>
              删除
            </StatusButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
