import type React from "react"
import { Link } from "react-router"

import { cn } from "@/lib/utils"
import { Page } from "@/components/site/panel"

import { GuideSections } from "../guide"
import { useEntry } from "./entry"

// Candidate LCARS: the first screen is a ship's console in the TNG-era LCARS idiom, black whatever the
// theme: an elbowed frame whose sidebar blocks are the sign-in buttons, condensed Antonio labels, and the
// invite code as a capped input bar. The palette is the one the star chart already uses.

const ORANGE = "bg-[#ff9c00]"

/** A sidebar block: LCARS buttons are flat colour slabs with a small label in the bottom-right corner. */
function Slab({ n, color, className, children }: { n: string; color: string; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("flex h-full min-h-14 flex-col justify-between p-2 text-right text-black transition-[filter] group-hover:brightness-110", color, className)}>
      <span className="text-[10px] leading-none tracking-wider opacity-70">{n}</span>
      <span className="text-sm leading-tight tracking-wide uppercase sm:text-base">{children}</span>
    </span>
  )
}

const FOCUS = "group outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"

// Readouts for the empty corner of the console: deterministic digits, no meaning.
const READOUT = Array.from({ length: 24 }, (_, i) => String((i * 7919 + 4243) % 100000).padStart(5, "0"))

export function LcarsLanding() {
  const { code, setCode, submit, passkey } = useEntry()
  return (
    <Page className="pt-0">
      <section aria-labelledby="lcars-title" className="dark bg-black p-2 font-display text-white sm:p-4">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] sm:grid-cols-[9rem_minmax(0,1fr)]">
          {/* Top elbow: the sidebar turns into the header bar with a wide outer and a tight inner curve. */}
          <div className={cn("h-16 rounded-tl-[2.5rem] sm:h-20 sm:rounded-tl-[3.5rem]", ORANGE)} />
          <div className="flex items-start gap-1.5">
            {/* Bars tuck 1px under the sidebar block so no hairline seam shows where the grid lands on a fractional pixel. */}
            <div className={cn("relative -ml-px h-5 flex-1", ORANGE)}>
              <div className="absolute top-full left-0 size-6 bg-[radial-gradient(circle_at_100%_100%,transparent_1.5rem,#ff9c00_calc(1.5rem_+_1px))]" />
            </div>
            <span className="-mt-1 px-1 text-xl leading-none tracking-wider whitespace-nowrap text-[#ff9c00] uppercase sm:text-3xl">Starfleet Archive</span>
            <div className="h-5 w-6 rounded-r-full bg-[#cc99cc] sm:w-12" />
          </div>

          <nav aria-label="成员登录" className="flex flex-col gap-1.5 pt-1.5">
            <button type="button" onClick={passkey} className={FOCUS}>
              <Slab n="02-1" color="bg-[#cc99cc]">
                通行密钥
              </Slab>
            </button>
            <Link to="/login" className={FOCUS}>
              <Slab n="02-2" color="bg-[#9ea8ff]">
                密码登录
              </Slab>
            </Link>
            <Link to="/about" className={FOCUS}>
              <Slab n="03" color="bg-[#ffcc99]">
                关于本站
              </Slab>
            </Link>
            <span aria-hidden className="min-h-10 flex-1 bg-[#ff9966]" />
          </nav>

          <div className="px-4 py-6 sm:px-10 sm:py-10">
            <div className="text-sm tracking-[0.2em] text-[#ff9c00] uppercase">访客终端 · Access 04-0019</div>
            <h1 id="lcars-title" className="mt-3 font-sans text-4xl font-medium tracking-tight sm:text-6xl">
              欢迎登舰
            </h1>
            <p className="mt-4 max-w-lg font-sans text-base/relaxed text-balance text-white/70">
              《星际迷航》中文粉丝的私人观看站，只对受邀成员开放，不开放申请。持有邀请码请在下方登记。
            </p>

            <form onSubmit={submit} className="mt-8 flex h-12 max-w-lg items-stretch gap-1.5">
              {/* Narrow screens keep only the cap, so the field itself gets the width. */}
              <label htmlFor="lcars-code" className={cn("flex w-5 items-center rounded-l-full text-black uppercase sm:w-auto sm:pr-3 sm:pl-5", ORANGE)}>
                <span className="max-sm:sr-only">邀请码</span>
              </label>
              <input
                id="lcars-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="输入邀请码"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 border-2 border-[#ff9c00] bg-black px-3 font-mono text-lg tracking-[0.2em] text-white uppercase outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-white/35 focus:border-[#ffcc99]"
              />
              <button type="submit" className="rounded-r-full bg-[#9ea8ff] pr-5 pl-4 text-black uppercase outline-none hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                继续
              </button>
            </form>

            <div aria-hidden className="mt-10 grid max-w-lg grid-cols-6 gap-x-4 gap-y-1 text-xs tracking-wider text-[#9ea8ff]/70 max-sm:hidden">
              {READOUT.map((n, i) => (
                <span key={i} className={cn(i % 7 === 3 && "text-[#ff9c00]", i % 11 === 5 && "text-[#cc99cc]")}>
                  {n}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom elbow, mirroring the top. */}
          <div className={cn("h-12 rounded-bl-[2.5rem] sm:rounded-bl-[3.5rem]", ORANGE)} />
          <div className="flex items-end gap-1.5">
            <div className={cn("relative -ml-px h-3 flex-1", ORANGE)}>
              <div className="absolute bottom-full left-0 size-6 bg-[radial-gradient(circle_at_100%_0%,transparent_1.5rem,#ff9c00_calc(1.5rem_+_1px))]" />
            </div>
            <div className="h-3 w-16 bg-[#cc6666] sm:w-32" />
            <div className="h-3 w-6 rounded-r-full bg-[#ffcc99] sm:w-12" />
          </div>
        </div>
      </section>
      <GuideSections />
    </Page>
  )
}
