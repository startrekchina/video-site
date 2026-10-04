import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, MessageSquareIcon, MessagesSquareIcon } from "lucide-react"
import { useLocation } from "react-router"

import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/lib/use-media-query"
import { Panel, PanelHeader, PanelTitle, PanelTitleSup } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

import { Composer, type ComposerHandle } from "./composer"
import { commentActions, REPLY_BATCH, useCommentFeed, useMe, useNow, type Comment, type Feed } from "./data"
import { ActionDivider, Avatar, Badges, Clamp, CommentBody, fakeLatency, flash, Handle, NumberPager, reducedMotion, ReplyButton, ReplyTarget, revealTop, SortTabs, Stamp, VoteButtons } from "./parts"

// Watch-page discussion, built on the dual-pane study (Fig. B of proto/comments-ui): comments on the
// left, the open comment's conversation on the right. The pane sticks under the header while the list
// scrolls past and keeps its own composer at the foot. Below lg the conversation opens inline instead.

const PANE_ID = "comments-conversation"
const NEW_DRAFT = "new"

type Ctx = { feed: Feed; now: number; me: string }
type Pulse = { id: string; at: number } | null

type Thread = {
  root: Comment
  ctx: Ctx
  limit: number
  pulse: Pulse
  onMore: () => void
  onReply: (target: string | null) => void
  composer: React.ReactNode
}

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

function Meta({ c, ctx, author }: { c: Comment; ctx: Ctx; author?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Handle name={c.author} className="break-all" />
      <Badges name={c.author} me={ctx.me} author={author} />
      {c.replyTo && <ReplyTarget name={c.replyTo} />}
      <Stamp t={c.createdAt} now={ctx.now} />
    </div>
  )
}

function ReplyItem({ c, root, ctx, pulse, onReply, className }: { c: Comment; root: Comment; ctx: Ctx; pulse: Pulse; onReply: () => void; className?: string }) {
  const ref = usePulse<HTMLLIElement>(pulse, c.id, true)
  return (
    <li ref={ref} className={cn("flex gap-2.5 py-2.5", className)}>
      <Avatar name={c.author} size={24} className="mt-px" />
      <div className="min-w-0 flex-1">
        <Meta c={c} ctx={ctx} author={c.author === root.author} />
        <Clamp max="7.5em" className="mt-0.5">
          <CommentBody body={c.body} />
        </Clamp>
        <div className="mt-1 -ml-1.5 flex items-center gap-1">
          <VoteButtons c={c} votes={ctx.feed.votes} />
          <ActionDivider />
          <ReplyButton onClick={onReply} />
        </div>
      </div>
    </li>
  )
}

/** Replies in posting order: a conversation reads top to bottom whatever the comment sort is. */
function Replies({ root, ctx, limit, pulse, onMore, onReply, inset, empty }: Thread & { inset: string; empty: React.ReactNode }) {
  const all = ctx.feed.repliesOf(root.id)
  if (!all.length) return empty
  const shown = all.slice(0, limit)
  const rest = all.length - shown.length
  return (
    <>
      <ol aria-label={`@${root.author} 的评论下的回复`}>
        {shown.map((r) => (
          <ReplyItem key={r.id} c={r} root={root} ctx={ctx} pulse={pulse} onReply={() => onReply(r.author)} className={inset} />
        ))}
      </ol>
      {rest > 0 && (
        <div className={cn("pb-2", inset)}>
          <Button variant="ghost" size="xs" onClick={onMore} className="-ml-1.5 font-normal text-muted-foreground">
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
  const count = ctx.feed.repliesOf(root.id).length
  return (
    <section id={PANE_ID} aria-labelledby={`${PANE_ID}-title`} style={{ height: PANE_HEIGHT }} className="sticky top-(--header-height) flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <MessagesSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h3 id={`${PANE_ID}-title`} className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
          对话
          <span className="truncate font-mono text-xs font-normal text-muted-foreground">@{root.author}</span>
        </h3>
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{count} 条回复</span>
      </header>
      <div key={root.id} className="min-h-0 flex-1 overflow-y-auto motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0">
        <article aria-label={`@${root.author} 的评论`} className="flex gap-2.5 border-b border-line bg-accent-muted px-4 py-3">
          <Avatar name={root.author} size={24} className="mt-px" />
          <div className="min-w-0 flex-1">
            <Meta c={root} ctx={ctx} />
            <Clamp max="11em" className="mt-0.5">
              <CommentBody body={root.body} />
            </Clamp>
            <div className="mt-1 -ml-1.5 flex items-center gap-1">
              <VoteButtons c={root} votes={ctx.feed.votes} />
              <ActionDivider />
              <ReplyButton onClick={() => thread.onReply(null)} />
            </div>
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
  const replies = ctx.feed.repliesOf(c.id).length
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
        <Meta c={c} ctx={ctx} />
        <Clamp className="mt-1">
          <CommentBody body={c.body} />
        </Clamp>
        <div className="mt-1.5 -ml-1.5 flex flex-wrap items-center gap-1">
          <VoteButtons c={c} votes={ctx.feed.votes} />
          <ActionDivider />
          <ReplyButton onClick={onReply} />
          {replies > 0 && (
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
              <span className="font-mono tabular-nums">{replies}</span>
              条回复
              {wide ? <ChevronRightIcon /> : open ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
          )}
        </div>
        {children}
      </div>
    </article>
  )
}

export function CommentsSection({ unitId, kind }: { unitId: string; kind: "episode" | "movie" }) {
  const me = useMe()!.username
  const feed = useCommentFeed(unitId, me)
  const now = useNow()
  const wide = useMediaQuery("(min-width: 64rem)")
  const [picked, setPicked] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<Record<string, string | null>>({})
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [pulse, setPulse] = useState<Pulse>(null)
  const [announcement, setAnnouncement] = useState("")
  const section = useRef<HTMLElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const replyBox = useRef<ComposerHandle>(null)
  const { hash, key } = useLocation()
  const ctx: Ctx = { feed, now, me }

  useEffect(() => {
    if (hash !== "#comments") return
    // The layout scrolls to the top after every route change, so the jump waits for it.
    const t = setTimeout(() => section.current?.scrollIntoView({ block: "start" }), 120)
    return () => clearTimeout(t)
  }, [hash, key])

  // Wide: a conversation is always open, by default the first on the page that is not your own fresh
  // post, so posting does not swap out what you were reading. Narrow: an accordion, closed by default.
  const mineFresh = (c: Comment) => !!c.fresh && c.author === me
  const open = feed.items.find((c) => c.id === picked) ?? (wide ? (feed.items.find((c) => !mineFresh(c)) ?? feed.items[0]) : undefined)

  const bind = (id: string) => ({
    value: drafts[id] ?? "",
    onValueChange: (v: string) => setDrafts((d) => ({ ...d, [id]: v })),
    sending: !!sending[id],
  })

  // Committed synchronously so the box can take focus inside the tap: iOS only raises the keyboard then.
  const reply = (root: Comment, target: string | null) => {
    flushSync(() => {
      setPicked(root.id)
      setTargets((t) => ({ ...t, [root.id]: target && target !== root.author ? target : null }))
    })
    replyBox.current?.focus()
  }

  // Tracked per box rather than in the box, which remounts when you switch threads mid-send: the post
  // still lands, the box stays held until it does, and text typed meanwhile is not wiped.
  const send = async (id: string, body: string, post: () => Comment) => {
    setSending((s) => ({ ...s, [id]: true }))
    await fakeLatency()
    const c = post()
    setDrafts((d) => (d[id] === body ? { ...d, [id]: "" } : d))
    setSending((s) => ({ ...s, [id]: false }))
    setPulse({ id: c.id, at: Date.now() })
  }

  const postRoot = async (body: string) => {
    await send(NEW_DRAFT, body, () => commentActions.post({ unitId, author: me, body }))
    feed.setPage(1)
    setAnnouncement("评论已发送")
  }

  const postReply = async (root: Comment, body: string) => {
    const replyTo = targets[root.id] ?? null
    await send(root.id, body, () => commentActions.post({ unitId, author: me, body, parentId: root.id, replyTo }))
    setTargets((t) => ((t[root.id] ?? null) === replyTo ? { ...t, [root.id]: null } : t))
    setLimits((l) => ({ ...l, [root.id]: Infinity }))
    setAnnouncement("回复已发送")
  }

  const threadOf = (root: Comment): Thread => ({
    root,
    ctx,
    limit: limits[root.id] ?? REPLY_BATCH,
    pulse,
    onMore: () => setLimits((l) => ({ ...l, [root.id]: (l[root.id] ?? REPLY_BATCH) + REPLY_BATCH })),
    onReply: (target) => reply(root, target),
    composer: (
      <Composer
        ref={replyBox}
        key={root.id}
        dense
        replyTo={targets[root.id] ?? root.author}
        onCancel={targets[root.id] ? () => setTargets((t) => ({ ...t, [root.id]: null })) : undefined}
        placeholder="接着聊聊…"
        onSubmit={(body) => postReply(root, body)}
        {...bind(root.id)}
      />
    ),
  })

  const from = (feed.page - 1) * feed.pageSize + 1
  const to = Math.min(feed.topCount, feed.page * feed.pageSize)

  return (
    <Panel ref={section} id="comments" aria-labelledby="comments-title">
      <PanelHeader className="flex-wrap gap-y-1">
        <PanelTitle id="comments-title">
          {kind === "episode" ? "本集讨论" : "本片讨论"}
          {feed.topCount > 0 && <PanelTitleSup>({feed.topCount})</PanelTitleSup>}
        </PanelTitle>
        {feed.topCount > 1 && <SortTabs value={feed.sort} onChange={feed.setSort} />}
      </PanelHeader>

      {/* The composer heads the list column, so it keeps a writing width and the pane starts higher. */}
      <div className={cn("grid", wide && open && "grid-cols-[minmax(0,1fr)_28rem]")}>
        <div className={cn("min-w-0", wide && open && "border-r border-line")}>
          <div className="flex gap-3 border-b border-line p-4">
            <Avatar name={me} size={32} className="max-sm:hidden" />
            <Composer className="min-w-0 flex-1" placeholder={kind === "episode" ? "这集最打动你的是什么？" : "这部电影最打动你的是什么？"} onSubmit={postRoot} {...bind(NEW_DRAFT)} />
          </div>
          {feed.topCount === 0 ? (
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
            <ol ref={list} aria-label="评论" className="divide-y divide-line">
              {feed.items.map((c) => {
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
          )}
        </div>
        {wide && open && (
          <PaneSlot>
            <ConversationPane thread={threadOf(open)} />
          </PaneSlot>
        )}
      </div>

      {feed.pageCount > 1 && (
        <div className="screen-line-top flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {from}–{to} / {feed.topCount} 条评论
          </span>
          <NumberPager
            page={feed.page}
            count={feed.pageCount}
            onChange={(p) => {
              feed.setPage(p)
              setTimeout(() => revealTop(list.current))
            }}
          />
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </Panel>
  )
}
