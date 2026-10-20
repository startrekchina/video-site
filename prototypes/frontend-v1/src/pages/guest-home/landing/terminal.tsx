import { Link } from "react-router"

import { Page } from "@/components/site/panel"

import { GuideSections } from "../guide"
import { useEntry } from "./entry"

// Candidate 舰载电脑: the ship's computer greets the visitor. Its lines come up one by one, then a prompt
// takes the invite code; the sign-in choices sit beneath as bracketed commands. The input and commands
// are there from the start, only the greeting animates.

const LINES = [
  "正在识别来访者……",
  "身份未识别。",
  "本馆是《星际迷航》中文粉丝的私人观看站，只对受邀成员开放，不开放申请。",
  "持有邀请码请在下方输入；已是成员可用通行密钥登录。",
]

const COMMAND = "rounded px-1 py-0.5 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"

export function TerminalLanding() {
  const { code, setCode, submit, passkey } = useEntry()
  return (
    <Page className="pt-0">
      <section aria-labelledby="terminal-title" className="dot-grid screen-line-bottom px-3 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border bg-background font-mono shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b px-4 py-2 text-[11px] tracking-wider text-muted-foreground uppercase sm:px-6">
            <span>Computer · 访客终端</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-[#ff9c00] motion-reduce:animate-none" />
              在线
            </span>
          </div>
          <div className="px-4 py-6 text-sm/relaxed sm:px-6 sm:py-8">
            <h1 id="terminal-title" className="text-xl/tight font-medium sm:text-2xl">
              星际舰队档案馆 <span className="text-muted-foreground max-sm:block max-sm:text-base">Starfleet Archive</span>
            </h1>
            <div className="mt-5 flex flex-col gap-1.5 text-muted-foreground">
              {LINES.map((l, i) => (
                <p
                  key={l}
                  className="flex gap-2 animate-in fill-mode-both fade-in slide-in-from-left-1 motion-reduce:animate-none"
                  style={{ animationDelay: `${250 + i * 500}ms` }}
                >
                  <span aria-hidden className="text-[#ff9c00]">›</span>
                  <span className={i === LINES.length - 1 ? "text-foreground" : undefined}>{l}</span>
                </p>
              ))}
            </div>

            <form onSubmit={submit} className="mt-6 flex items-center gap-3 border-y border-dashed py-3 text-base">
              <label htmlFor="terminal-code" className="shrink-0 text-muted-foreground">
                邀请码 ▸
              </label>
              <input
                id="terminal-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="在此输入"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent tracking-[0.2em] uppercase caret-[#ff9c00] outline-none placeholder:tracking-normal placeholder:text-muted-foreground/40"
              />
              <button type="submit" className={COMMAND}>
                [ 继续 ↵ ]
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              <button type="button" onClick={passkey} className={COMMAND}>
                [ 通行密钥登录 ]
              </button>
              <Link to="/login" className={COMMAND}>
                [ 密码登录 ]
              </Link>
              <Link to="/about" className={COMMAND}>
                [ 关于本站 ]
              </Link>
            </div>
          </div>
        </div>
      </section>
      <GuideSections />
    </Page>
  )
}
