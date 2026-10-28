import { useState } from "react"
import { ArrowRightIcon, FingerprintIcon, TicketIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { cn } from "@/lib/utils"
import { Page, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

import { GuideSections, usePasskeySignIn } from "./guide"
import { BoardingPass } from "./pass"
import { UfpSeal } from "./ufp-seal"

// The landing page (星图) as one sheet of the site's line drawings. From md, a full-width chart of the
// Alpha and Beta Quadrants after the series' own, as the region map of mewho.com/titan draws them: a
// lettered grid of square sectors with each power's space filled cell by cell, names in condensed type,
// the Federation's emblem, and Sol locked the way the map marks a selected object. Under it a thin title
// block holds the name and both ways in (passkey sign-in and an invite code field), then the guide's
// sections. Below md the plate is too small to read, so narrow screens get the boarding pass instead.
// Follows the site theme. LCARS lives inside the plate only (condensed Antonio labels, the quadrant
// header, the powers' tints); everything else uses the site's own faces. Says nothing about the
// catalogue; /about carries the rest.
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// Printed-atlas magnitudes in four dot sizes, the brightest glowing: a sparse even scatter plus the
// galactic band, a fainter diagonal from the upper left to the lower right. Nothing falls just below the
// centre, where Sol's name sits. Positions are shares of the plate.
const STARS = (() => {
  const rnd = rng(23)
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
  const stars: { x: number; y: number; size: number; opacity: number }[] = []
  const add = (x: number, y: number, faint = false) => {
    if (x < 0 || x > 100 || y < 0 || y > 100 || (Math.abs(x - 50) < 6 && Math.abs(y - 50) < 9)) return
    const m = rnd()
    const size = faint ? (m < 0.75 ? 1.5 : m < 0.95 ? 2 : 3) : m < 0.6 ? 1.5 : m < 0.86 ? 2 : m < 0.96 ? 3 : 4.5
    stars.push({ x, y, size, opacity: (faint ? 0.35 : 0.45) + rnd() * 0.45 })
  }
  const band = (x: number) => 50 + 0.5 * (x - 50)
  for (let i = 0; i < 90; i++) add(rnd() * 100, rnd() * 100)
  for (let i = 0; i < 300; i++) {
    const x = rnd() * 100
    add(x, band(x) + gauss() * (i < 220 ? 5 : 14), true)
  }
  for (const [cx, cy] of [[15, 32.5], [60, 24], [70, 60], [90, 70]])
    for (let i = 0; i < 10; i++) add(cx + gauss() * 1.5, cy + gauss() * 3)
  return stars
})()

// Systems are named in plain light type, as the series' charts do.
const SYSTEM_NAME =
  "font-display text-[15px]/none font-medium tracking-wide whitespace-nowrap text-foreground [text-shadow:0_0_2px_var(--background),0_0_4px_var(--background),0_0_6px_var(--background)]"

// The sectors, after the Alpha/Beta region map of mewho.com/titan (the Star Trek: Star
// Charts layout): galactic core up, the meridian through Sol the Alpha/Beta border, Alpha west. Columns
// are the unlettered margin that carries the row codes, then AA to AQ, so Sol, where AH, AI, 04 and 05
// meet, is on the plate's centre line. Each cell is a power and a brightness from 1 to 3: Federation (F),
// Romulan (R), Klingon (K), Cardassian (C).
const SECTORS = [
  ". . . . . . . . . F1 F1 F1 F1 R1 R1 R2 . .",
  ". . . . . . . . F2 F3 F1 F1 R1 R3 R1 R1 . .",
  ". . . . . . . F3 F3 F3 F3 F1 R1 R3 R3 R3 R2 .",
  ". . F1 F1 F3 F3 F3 F2 F2 F1 F1 F1 R1 R2 R3 R2 R3 .",
  ". C2 C2 F1 F3 F3 F2 F1 F1 F1 F1 . R2 R1 R2 R2 R2 R2",
  "C1 C1 C1 . F1 F1 F1 F1 F1 F1 F1 . . . . . R1 .",
  "C1 C2 C2 C2 C1 F1 F1 F1 F1 F2 F1 F1 F1 F1 . . . F1",
  "C2 C3 C2 C2 F1 F1 F1 F1 F1 F1 F1 F2 F1 F1 . . . .",
  ". . . . . F1 F1 F1 F1 F1 F1 F1 . K1 K2 K2 K2 K2",
  ". . . . . . F1 F1 F1 F1 F1 K2 K1 K3 K3 K3 K2 K2",
].map((row) => row.split(" "))
const TINT: Record<string, string> = {
  F: "bg-[#7f8fbf]/45 dark:bg-[#8794bd]/60",
  R: "bg-[#5c9f63]/40 dark:bg-[#3e9d78]/50",
  K: "bg-[#d8322b]/30 dark:bg-[#c0281f]/50",
  C: "bg-[#c08f2a]/40 dark:bg-[#a88128]/50",
}
const LEVEL = [0, 0.35, 0.65, 1]
// A point on that grid, counting columns from AA's left edge and rows from 01's top.
const cell = (c: number, r: number) => ({ left: `${((c + 1) * 100) / 18}%`, top: `${r * 10}%` })
// The named systems and stations (the mark centred on the point): Vulcan by 40 Eridani just across the
// meridian, Nimbus III in the gap where the three powers meet, Bajor off the Cardassian border with Deep
// Space 9 beside it; the starbases where the region map has them.
const at = (name: string, c: number, r: number, station = false) => ({ name, x: `calc(${cell(c, r).left} - 12px)`, y: cell(c, r).top, station })
const SYSTEMS = [
  at("Romulus", 12.8, 4.5),
  at("Nimbus III", 10.3, 5),
  at("Qo'noS", 13.8, 8.8),
  at("Vulcan", 8.3, 5.2),
  at("Bajor", 3.3, 7),
  at("Deep Space 9", 3.82, 6.44, true),
  at("Starbase 375", 5.79, 6.14, true),
  at("Starbase 11", 6.34, 9.36, true),
  at("Deep Space K-7", 9.5, 9.1, true),
  at("Starbase 10", 8.75, 1.85, true),
  at("Starbase 24", 13.16, 7.68, true),
]
const SOL_SECTORS = { cols: [7, 8], rows: [3, 4] }

const CODE = "absolute font-display text-[11px] leading-none tracking-wider text-muted-foreground"
// The lock on Sol, as the region map marks a selected object: a hairline across the whole plate through it
// with a tracing curve swept past, and the object's dot and name in orange. Sol is on the meridian, so the
// meridian stands in for the lock's vertical. Its sector codes are lit to match.
const LOCK = "stroke-[#d97a45] dark:stroke-[#f6b993]"
const LOCKED = "bg-[#e0531f] dark:bg-[#ff7d4f]"
const SOL_CODE = cn(LOCKED, "rounded-full px-1.5 py-0.5 text-black")
const POWER = "absolute font-display text-[clamp(13px,1.8cqw,22px)] leading-none font-medium tracking-wide whitespace-nowrap text-foreground/85 uppercase"
const PILL = "absolute top-7 flex h-6 items-center rounded-full bg-[#4d5a85] px-3 font-display text-sm tracking-wider text-white uppercase dark:bg-[#36406a]"
const ELBOW = "absolute top-10 h-[calc(var(--meridian)-2.5rem)] border-t-[3px] border-[#4d5a85]"

/**
 * The quadrant chart: filled sectors on a hairline grid, lettered columns and numbered rows, the powers
 * named in their own space with the Federation's emblem under its name, and an LCARS header naming the
 * quadrant on each side, both elbows running into the meridian (--meridian, set by the plate), and the
 * lock on Sol.
 */
function Quadrant() {
  return (
    <>
      <div className="absolute inset-0 grid grid-cols-18 grid-rows-10">
        {SECTORS.flatMap((row, r) => row.map((s, c) => <span key={`${r}-${c}`} className={TINT[s[0]]} style={{ opacity: LEVEL[Number(s[1])] }} />))}
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-size-[calc(100%/18)_10%]" />
      {/* The meridian carries on from the header elbows in their colour. */}
      <div className="absolute top-(--meridian) bottom-0 left-1/2 w-[3px] -translate-x-1/2 bg-[#4d5a85]" />
      {/* In plate columns and rows, Sol at 9, 4. */}
      <svg viewBox="0 0 18 10" fill="none" className="absolute inset-0 size-full">
        <path d="M0 4H18" vectorEffect="non-scaling-stroke" className={LOCK} />
        <path d="M9.7 0C9.6 1.5 8.85 2.8 8.9 3.8C8.94 4.6 12.5 7.2 15.4 10" vectorEffect="non-scaling-stroke" className={cn(LOCK, "opacity-70")} />
      </svg>

      {Array.from({ length: 17 }, (_, c) => (
        <span key={c} className={cn(CODE, "top-1.5 -translate-x-1/2", SOL_SECTORS.cols.includes(c) && SOL_CODE)} style={{ left: cell(c + 0.5, 0).left }}>
          A{String.fromCharCode(65 + c)}
        </span>
      ))}
      {Array.from({ length: 10 }, (_, r) => (
        <span key={r} className={cn(CODE, "left-1.5 -translate-y-1/2", SOL_SECTORS.rows.includes(r) && SOL_CODE)} style={{ top: cell(0, r + 0.5).top }}>
          {String(r + 1).padStart(2, "0")}
        </span>
      ))}

      {/* As on the region map: Alpha's pill from AA, Beta's running off the plate. */}
      <div className={cn(PILL, "left-[6.5%] w-[30.3%]")}>Alpha Quadrant</div>
      <div className={cn(ELBOW, "right-[calc(50%-1.5px)] left-[36.8%] rounded-tr-xl border-r-[3px]")} />
      <div className={cn(PILL, "-right-6 left-[83.3%]")}>Beta Quadrant</div>
      <div className={cn(ELBOW, "right-[16.7%] left-[calc(50%-1.5px)] rounded-tl-xl border-l-[3px]")} />

      <span className={cn(POWER, "-translate-y-1/2")} style={cell(2.4, 3.55)}>
        United Federation of Planets
      </span>
      <UfpSeal className="absolute w-[7.8%] -translate-1/2 text-[#253381] opacity-90 dark:text-white" style={cell(4.26, 4.75)} />
      <span className={cn(POWER, "-translate-1/2")} style={cell(13.7, 2.8)}>
        Romulan Star Empire
      </span>
      <span className={cn(POWER, "-translate-y-1/2")} style={cell(0.25, 6.5)}>
        Cardassian Union
      </span>
      <span className={cn(POWER, "-translate-1/2")} style={cell(12.7, 9.6)}>
        Klingon Empire
      </span>

      <span className={cn(LOCKED, "absolute top-[40%] left-1/2 size-2 -translate-1/2 rounded-full")} />
      <span className={cn(SYSTEM_NAME, "absolute top-[calc(40%+6px)] left-[calc(50%+8px)] text-[#e0531f] dark:text-[#ff7d4f]")}>Sol</span>
    </>
  )
}

/**
 * The plate: 18 by 10 square sectors at 9:5, Sol on the centre line, which the title block's middle
 * divider carries on below. Its height follows the width, so on short screens the title block drops
 * below the first screen. The series' charts are black; on paper the plate stays a printed sheet. Its
 * header elbows meet the meridian at the foot of row 01, or lower where the rows are shorter than the
 * header.
 */
function Plate() {
  return (
    <div aria-hidden className="@container relative isolate aspect-[9/5] overflow-hidden select-none [--meridian:max(10%,4rem)] dark:bg-black">
      <div className="absolute inset-0 [--star:0.7] dark:[--star:0.85]">
        {STARS.map((s, i) => (
          <span
            key={i}
            className={cn("absolute -translate-1/2 rounded-full bg-foreground", s.size > 4 && "shadow-[0_0_6px_1px_var(--foreground)]")}
            style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, opacity: `calc(var(--star) * ${s.opacity})` }}
          />
        ))}
      </div>

      <Quadrant />

      {SYSTEMS.map((s) => (
        <div key={s.name} className="absolute flex -translate-y-1/2 items-center gap-1" style={{ left: s.x, top: s.y }}>
          {/* The series' charts mark systems with a plain dot and stations with a triangle. */}
          <span className="flex size-6 shrink-0 items-center justify-center">
            <span className={s.station ? "size-2 bg-foreground [clip-path:polygon(50%_0,100%_100%,0_100%)]" : "size-1.5 rounded-full bg-foreground"} />
          </span>
          <span className={SYSTEM_NAME}>{s.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Title block field label with a small LCARS-coloured number. */
function FieldTag({ n, color, children }: { n: string; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn("rounded-full px-1.5 font-mono text-[10px] leading-4 font-medium text-black", color)}>{n}</span>
      {children}
    </div>
  )
}

function SignIn({ className }: { className?: string }) {
  const { busy, signIn } = usePasskeySignIn()
  return (
    <div className={cn("flex flex-col gap-3 p-4", className)}>
      <FieldTag n="02" color="bg-[#cc99cc]">
        成员登录
      </FieldTag>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="secondary" size="sm" className="shadow-[inset_0_0_1px] shadow-foreground/20" disabled={busy} onClick={signIn}>
          <FingerprintIcon data-icon="inline-start" />
          通行密钥登录
        </Button>
        <Link to="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          密码登录
        </Link>      </div>
    </div>
  )
}

/** Submitting carries the code into the register page, which checks it. */
function InviteCode({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [code, setCode] = useState("")
  return (
    <form
      className={cn("flex flex-col gap-3 p-4", className)}
      onSubmit={(e) => {
        e.preventDefault()
        navigate(`/register?code=${encodeURIComponent(code.trim())}`)
      }}
    >
      <FieldTag n="03" color="bg-[#9ea8ff]">
        邀请码注册
      </FieldTag>
      <InputGroup className="mt-auto h-8">
        <InputGroupAddon>
          <TicketIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="输入邀请码"
          aria-label="邀请码"
          autoComplete="off"
          spellCheck={false}
          required
          className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" size="icon-xs" aria-label="继续注册">
            <ArrowRightIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

/** The thin bar under the plate: the name, then both ways in. Its middle rule carries on the quadrant boundary. */
function TitleBar() {
  return (
    <div className="screen-line-top grid grid-cols-4">
      <div className="col-span-2 flex flex-col gap-3 p-4">
        <FieldTag n="01" color="bg-[#ff9c00]">
          站名
        </FieldTag>
        <div className="mt-auto flex flex-col gap-1">
          <h1 id="chart-title" className="text-2xl font-medium tracking-tight">
            星际舰队档案馆
          </h1>
          <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground uppercase">Starfleet Archive</p>
        </div>
      </div>
      <SignIn className="border-l" />
      <InviteCode className="border-l" />
    </div>
  )
}

export function GuestStarChart() {
  return (
    <>
      <div className="mx-auto max-md:hidden md:max-w-(--content-width)">
        <Separator />
        <section aria-labelledby="chart-title" className="screen-line-top screen-line-bottom border-x">
          <div className="screen-line-bottom flex h-9 items-center justify-between gap-4 px-4 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            <span>Stellar cartography</span>
            <span>Fig. 01</span>
          </div>
          <Plate />
          <TitleBar />
        </section>
      </div>
      <Page className="pt-0">
        <BoardingPass className="md:hidden" />
        <GuideSections />
      </Page>
    </>
  )
}
