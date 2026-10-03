import { useImperativeHandle, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { BoldIcon, CodeIcon, EyeIcon, ItalicIcon, LinkIcon, ListIcon, SendHorizontalIcon, StrikethroughIcon, TextQuoteIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { StatusButton, type ButtonStatus } from "@/components/ui/status-button"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { MAX_LENGTH } from "./data"
import { EmojiPicker } from "./emoji"
import { CommentBody, revealClear } from "./parts"

type Edit = { value: string; start: number; end: number }

function surround(e: Edit, before: string, after: string, placeholder: string): Edit {
  const sel = e.value.slice(e.start, e.end) || placeholder
  const value = e.value.slice(0, e.start) + before + sel + after + e.value.slice(e.end)
  return { value, start: e.start + before.length, end: e.start + before.length + sel.length }
}

function prefixLines(e: Edit, prefix: string, placeholder: string): Edit {
  const lineStart = e.value.lastIndexOf("\n", e.start - 1) + 1
  const sel = e.value.slice(lineStart, e.end) || placeholder
  const block = sel
    .split("\n")
    .map((l) => prefix + l)
    .join("\n")
  const value = e.value.slice(0, lineStart) + block + e.value.slice(Math.max(e.end, lineStart))
  return { value, start: lineStart + prefix.length, end: lineStart + block.length }
}

const TOOLS: { key: string; label: string; icon: React.ReactNode; apply: (e: Edit) => Edit; wide?: boolean }[] = [
  { key: "bold", label: "粗体", icon: <BoldIcon />, apply: (e) => surround(e, "**", "**", "粗体") },
  { key: "italic", label: "斜体", icon: <ItalicIcon />, apply: (e) => surround(e, "*", "*", "斜体") },
  { key: "strike", label: "删除线", icon: <StrikethroughIcon />, apply: (e) => surround(e, "~~", "~~", "删除线"), wide: true },
  {
    key: "code",
    label: "代码",
    wide: true,
    icon: <CodeIcon />,
    apply: (e) => (e.value.slice(e.start, e.end).includes("\n") ? surround(e, "```\n", "\n```", "") : surround(e, "`", "`", "code")),
  },
  { key: "quote", label: "引用", icon: <TextQuoteIcon />, apply: (e) => prefixLines(e, "> ", "引用") },
  { key: "list", label: "列表", icon: <ListIcon />, apply: (e) => prefixLines(e, "- ", "列表项"), wide: true },
  {
    key: "link",
    label: "链接",
    icon: <LinkIcon />,
    apply: (e) => {
      const text = e.value.slice(e.start, e.end) || "链接文字"
      const value = e.value.slice(0, e.start) + `[${text}](https://)` + e.value.slice(e.end)
      const urlAt = e.start + text.length + 3
      return { value, start: urlAt, end: urlAt + 8 }
    },
  },
]

const CHEATSHEET: [string, string][] = [
  ["**粗体**", "粗体"],
  ["*斜体*", "斜体"],
  ["~~删除线~~", "删除线"],
  ["`代码`", "行内代码"],
  ["> 引用", "引用"],
  ["- 列表", "列表"],
  ["[文字](网址)", "链接"],
]

function MarkdownHint({ compact }: { compact?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" aria-label="Markdown 语法" className="shrink-0 px-1.5 font-mono text-[11px] font-normal text-muted-foreground" />}
      >
        <span className={cn(compact ? "hidden" : "max-sm:hidden")}>Markdown</span>
        <span className={cn(!compact && "sm:hidden")}>MD</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 gap-2 p-3">
        <div className="text-xs font-medium">支持的 Markdown</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {CHEATSHEET.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-foreground">{k}</dt>
              <dd className="text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">换行直接回车。不支持图片、表格和 HTML。</p>
      </PopoverContent>
    </Popover>
  )
}

export type ComposerHandle = { focus: () => void }

export type ComposerProps = {
  /** Posts the body. The owner clears its draft, and only if it still holds what was sent. */
  onSubmit: (body: string) => Promise<void>
  placeholder?: string
  /** Reply composer: shows who is being answered. */
  replyTo?: string | null
  /** Shown as × next to the reply target, and fired by Esc on an empty box. */
  onCancel?: () => void
  /** Docked one-liner for the conversation: grows as you type, tools collapse to icons. */
  dense?: boolean
  /** Controlled draft, so a half-written reply survives switching threads or layouts. */
  value: string
  onValueChange: (value: string) => void
  /** A send started by an earlier mount of this box is still in flight: show it and hold the box. */
  sending?: boolean
  ref?: React.Ref<ComposerHandle>
  className?: string
}

export function Composer({ onSubmit, placeholder = "说点什么…", replyTo, onCancel, dense, value, onValueChange, sending, ref, className }: ComposerProps) {
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState<ButtonStatus>("idle")
  const ta = useRef<HTMLTextAreaElement>(null)
  const len = value.length
  const over = len > MAX_LENGTH
  const empty = !value.trim()
  const busy = status === "loading" || !!sending

  useImperativeHandle(ref, () => ({
    focus() {
      flushSync(() => setPreview(false))
      const el = ta.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(el.value.length, el.value.length)
      revealClear(el)
    },
  }))

  const apply = (fn: (e: Edit) => Edit) => {
    const el = ta.current
    if (!el) return
    const next = fn({ value, start: el.selectionStart, end: el.selectionEnd })
    onValueChange(next.value)
    setPreview(false)
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(next.start, next.end)
    })
  }

  const insert = (text: string) => apply((e) => ({ value: e.value.slice(0, e.start) + text + e.value.slice(e.end), start: e.start + text.length, end: e.start + text.length }))

  // The send button and ⌘↵ share this path, so both show the spinner and the check.
  const submit = async () => {
    if (status !== "idle" || sending || empty || over) return
    setStatus("loading")
    await onSubmit(value)
    setPreview(false)
    setStatus("success")
  }

  const sendLabel = replyTo ? "回复" : "发送"
  return (
    <div
      className={cn(
        "group/composer rounded-lg border border-input bg-background transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        over && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        className,
      )}
    >
      {replyTo && (
        <div className="flex h-7 items-center gap-2 border-b border-line pr-1 pl-3 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            回复 <span className="font-mono text-[13px] text-foreground">@{replyTo}</span>
          </span>
          {onCancel && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-xs" aria-label="改为回复作者" onClick={onCancel}>
                    <XIcon />
                  </Button>
                }
              />
              <TooltipContent>改为回复作者</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      {preview ? (
        <div className={cn("overflow-y-auto px-3 py-2.5", dense ? "max-h-40 min-h-10" : "max-h-80 min-h-20")}>
          {empty ? <p className="text-sm text-muted-foreground">没有可预览的内容</p> : <CommentBody body={value} />}
        </div>
      ) : (
        <textarea
          ref={ta}
          value={value}
          readOnly={busy}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
            if (e.key === "Escape" && onCancel && !value) onCancel()
          }}
          placeholder={placeholder}
          aria-label={replyTo ? `回复 @${replyTo}` : "写评论"}
          rows={dense ? 1 : 3}
          className={cn(
            "block field-sizing-content w-full resize-none bg-transparent px-3 py-2.5 text-sm/relaxed outline-none placeholder:text-muted-foreground",
            dense ? "max-h-40 min-h-10" : "max-h-80 min-h-20",
          )}
        />
      )}
      <div className="flex items-center gap-1 border-t border-line px-1.5 py-1">
        {/* Tools give way first on narrow screens: they scroll sideways, the send side never moves. */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <div className="flex shrink-0 items-center gap-0.5">
            {TOOLS.map((t) => (
              <Tooltip key={t.key}>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon-xs" aria-label={t.label} disabled={preview || busy} className={cn("text-muted-foreground", t.wide && "max-sm:hidden")} onClick={() => apply(t.apply)}>
                      {t.icon}
                    </Button>
                  }
                />
                <TooltipContent>{t.label}</TooltipContent>
              </Tooltip>
            ))}
            <span className="mx-1 h-4 w-px bg-border max-sm:hidden" aria-hidden />
          </div>
          <EmojiPicker onPick={insert} finalFocus={ta} disabled={preview || busy} />
          <MarkdownHint compact={dense} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn("font-mono text-[11px] text-muted-foreground tabular-nums", over && "text-destructive", !len && "max-sm:hidden")} aria-live="polite">
            {len}/{MAX_LENGTH}
          </span>
          <Toggle
            size="sm"
            pressed={preview}
            onPressedChange={setPreview}
            disabled={busy}
            aria-label="预览"
            className="h-6 min-w-6 gap-1 px-1.5 text-xs text-muted-foreground aria-pressed:text-foreground"
          >
            <EyeIcon className="size-3.5" />
            {!dense && <span className="max-sm:hidden">预览</span>}
          </Toggle>
          <Tooltip>
            <TooltipTrigger
              render={
                <StatusButton
                  size="xs"
                  status={sending && status === "idle" ? "loading" : status}
                  onStatusChange={setStatus}
                  disabled={status === "idle" && !sending && (empty || over)}
                  onClick={submit}
                  successLabel={dense ? <span className="sr-only">已发送</span> : "已发送"}
                  aria-label={dense ? sendLabel : undefined}
                  className="px-2"
                >
                  {dense ? <SendHorizontalIcon /> : sendLabel}
                </StatusButton>
              }
            />
            <TooltipContent className="flex items-center gap-2 pr-2 pl-3">
              {sendLabel}
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </KbdGroup>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
