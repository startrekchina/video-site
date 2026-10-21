import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRightIcon, FingerprintIcon, TicketIcon } from "lucide-react"
import { Link } from "react-router"

import { useStageHeader } from "@/lib/header-tone"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Page } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

import { GuideSections } from "../guide"
import { useDeparture } from "./entry"

// Candidate 全息甲板: the holodeck's bare grid room as a full-bleed stage. Amber lines run along the
// floor, ceiling and walls to the far wall, which carries the name; the arch's panel holds both ways
// in. The grid draws itself out from the far wall on arrival, and signing in or sending a code runs
// the program, the grid flaring and fading before the page changes. Reduced motion skips both.
// It follows the theme: in dark the room is black with glowing lines under the transparent header;
// in light it is paper with deeper amber lines and the header stays as on any page.

const RUN_MS = 1000

/**
 * The grid's line colour and glow per theme, and the filter the run flares from and back to. Brightening
 * lights the lines up on black but washes them out on paper, so there the glow swells instead. On paper
 * the far wall also gives off `light`, falling off along the surfaces towards the viewer.
 */
type Ink = { stroke: string; glow: string; flare: [string, string]; light?: string }
const INK: Record<"dark" | "light", Ink> = {
  dark: { stroke: "rgb(255 178 36)", glow: "drop-shadow(0 0 3px rgb(255 160 20 / 0.7))", flare: ["brightness(1)", "brightness(2.6)"] },
  light: {
    stroke: "rgb(205 142 24)",
    glow: "drop-shadow(0 0 3px rgb(255 190 80 / 0.6))",
    flare: ["drop-shadow(0 0 0 rgb(255 190 80 / 0))", "drop-shadow(0 0 8px rgb(255 190 80 / 1))"],
    light: "rgb(255 228 184)",
  },
}

/**
 * The room in grid squares, seen from its axis in one-point perspective: half-width X, half-height Y,
 * the far wall D squares away and `wall` of the stage wide, the vanishing point `vy` down the stage.
 */
const ROOMS = [
  { min: 1280, X: 6, Y: 3.5, D: 14, wall: 0.42, vy: 0.47 },
  { min: 640, X: 5, Y: 3.5, D: 12, wall: 0.56, vy: 0.36 },
  { min: 0, X: 3, Y: 4.5, D: 10, wall: 0.74, vy: 0.36 },
]

type Line = { d: string; run?: boolean; depth: number }
/** A surface and the line its light falls off along; `lit` is how much it catches, the floor the most. */
type Plane = { d: string; from: [number, number]; to: [number, number]; lit: number }

/**
 * Grid lines for a w × h stage: runs head out from the far wall towards the viewer, rings cross them.
 * Also the far wall and the surfaces running from it, whose light falls off from their far edge to the stage's.
 */
function grid(w: number, h: number): { lines: Line[]; wall: { d: string; c: [number, number]; r: number }; planes: Plane[] } {
  const { X, Y, D, wall, vy } = ROOMS.find((r) => w >= r.min)!
  const f = (Math.min(w * wall, 640) * D) / (2 * X)
  const [cx, cy] = [w / 2, h * vy]
  const at = (x: number, y: number, z: number) => `${(cx + (f * x) / z).toFixed(1)} ${(cy + (f * y) / z).toFixed(1)}`
  // How near a line at these offsets from the axis comes before it leaves the stage.
  const exit = (x: number, y: number) => Math.max(0.2, (f * Math.abs(x)) / cx, (f * y) / (h - cy), (-f * y) / cy)
  const lines: Line[] = []
  const steps = (from: number, to: number) => Array.from({ length: Math.floor(to - from) + 1 }, (_, i) => from + i)
  for (const x of steps(-X, X)) lines.push({ d: `M${at(x, -Y, D)}L${at(x, Y, D)}`, depth: 0 })
  for (const y of steps(-Y, Y)) lines.push({ d: `M${at(-X, y, D)}L${at(X, y, D)}`, depth: 0 })
  for (const y of [-Y, Y]) {
    for (const x of steps(-X, X)) lines.push({ d: `M${at(x, y, D)}L${at(x, y, exit(x, y))}`, run: true, depth: 0 })
    for (let z = D - 1; z >= exit(0, y); z--) lines.push({ d: `M${at(-X, y, z)}L${at(X, y, z)}`, depth: D - z })
  }
  for (const x of [-X, X]) {
    for (const y of steps(-Y + 1, Y - 1)) lines.push({ d: `M${at(x, y, D)}L${at(x, y, exit(x, y))}`, run: true, depth: 0 })
    for (let z = D - 1; z >= exit(x, 0); z--) lines.push({ d: `M${at(x, -Y, z)}L${at(x, Y, z)}`, depth: D - z })
  }
  const [left, right, top, bottom] = [cx - (f * X) / D, cx + (f * X) / D, cy - (f * Y) / D, cy + (f * Y) / D]
  // Corners of a surface, from its edge on the far wall out past the stage.
  const quad = (a: [number, number], b: [number, number]) => `M${at(...a, D)}L${at(...b, D)}L${at(...b, 0.05)}L${at(...a, 0.05)}Z`
  const planes: Plane[] = [
    { d: quad([-X, Y], [X, Y]), from: [cx, bottom], to: [cx, h], lit: 1 },
    { d: quad([-X, -Y], [X, -Y]), from: [cx, top], to: [cx, 0], lit: 0.6 },
    { d: quad([-X, -Y], [-X, Y]), from: [left, cy], to: [0, cy], lit: 0.8 },
    { d: quad([X, -Y], [X, Y]), from: [right, cy], to: [w, cy], lit: 0.8 },
  ]
  return { lines, wall: { d: `M${left} ${top}H${right}V${bottom}H${left}Z`, c: [cx, cy], r: right - cx }, planes }
}

function Grid({ run, ink }: { run: boolean; ink: Ink }) {
  const box = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<[number, number]>([0, 0])
  const room = useMemo(() => (size[0] ? grid(...size) : null), [size])
  const lines = room?.lines ?? []
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width, e.contentRect.height]))
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [])

  // Arrival, once the first layout has lines: runs draw out from the far wall, rings light up behind them,
  // and the room's light comes up as they reach the viewer.
  const played = useRef(false)
  useEffect(() => {
    if (played.current || !room) return
    played.current = true
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    for (const p of svg.current!.querySelectorAll<SVGPathElement>("path[data-depth]")) {
      const depth = Number(p.dataset.depth)
      if (p.dataset.run) p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1400, easing: "cubic-bezier(0.3, 0.5, 0.2, 1)", fill: "backwards" })
      else p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: depth ? 200 + depth * 90 : 0, fill: "backwards" })
    }
    svg.current!.querySelector("[data-light]")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 500, fill: "backwards" })
  }, [room])

  useEffect(() => {
    if (!run) return
    const { glow, flare: [rest, peak] } = ink
    svg.current!.animate([{ filter: `${glow} ${rest}` }, { filter: `${glow} ${peak}`, offset: 0.3 }, { filter: `${glow} ${rest}`, opacity: 0 }], {
      duration: RUN_MS * 0.9,
      easing: "ease-in",
      fill: "forwards",
    })
  }, [run, ink])

  return (
    // On paper the lines fade towards the viewer, so the room recedes to the lit far wall.
    <div ref={box} aria-hidden className="absolute inset-0 -z-1 [mask-image:radial-gradient(ellipse_65%_70%_at_50%_var(--vy),black_20%,rgb(0_0_0/0.2))] dark:[mask-image:none]">
      <svg ref={svg} viewBox={`0 0 ${size[0]} ${size[1]}`} className="size-full fill-none" style={{ stroke: ink.stroke, filter: ink.glow }}>
        {ink.light && room && (
          // One stage per page, so the gradient ids stay unique.
          <g data-light stroke="none">
            <defs>
              <radialGradient id="holodeck-wall" gradientUnits="userSpaceOnUse" cx={room.wall.c[0]} cy={room.wall.c[1]} r={room.wall.r}>
                <stop stopColor={ink.light} stopOpacity={0.7} />
                <stop offset={1} stopColor={ink.light} stopOpacity={0.35} />
              </radialGradient>
              {room.planes.map((p, i) => (
                <linearGradient key={i} id={`holodeck-plane-${i}`} gradientUnits="userSpaceOnUse" x1={p.from[0]} y1={p.from[1]} x2={p.to[0]} y2={p.to[1]}>
                  <stop stopColor={ink.light} stopOpacity={0.35 * p.lit} />
                  <stop offset={1} stopColor={ink.light} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <path d={room.wall.d} fill="url(#holodeck-wall)" />
            {room.planes.map((p, i) => (
              <path key={i} d={p.d} fill={`url(#holodeck-plane-${i})`} />
            ))}
          </g>
        )}
        {lines.map((l, i) => (
          <path key={i} d={l.d} data-run={l.run || undefined} data-depth={l.depth} pathLength={1} strokeDasharray={l.run ? 1 : undefined} strokeOpacity={l.depth || l.run ? 0.7 : 0.45} />
        ))}
      </svg>
    </div>
  )
}

// Amber labels, deeper on paper so they stay readable.
const AMBER = "text-amber-700 dark:text-[rgb(255_190_80)]"

function Label({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-mono">{n}</span>
      {children}
    </div>
  )
}

/** Both ways in, disabled once the program runs. */
function EntryFields({ entry }: { entry: ReturnType<typeof useDeparture> }) {
  const { code, setCode, submit, passkey, leaving } = entry
  return (
    <div className="mt-4 flex flex-col gap-4 max-xl:sm:grid max-xl:sm:grid-cols-2">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label n="01">持有邀请码</Label>
        <InputGroup className="h-9 dark:bg-black/30">
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
            disabled={leaving}
            className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" size="icon-xs" aria-label="继续注册" disabled={leaving}>
              <ArrowRightIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex flex-col gap-2">
        <Label n="02">已是成员</Label>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="secondary" size="sm" className="shadow-[inset_0_0_1px] shadow-foreground/20" onClick={passkey} disabled={leaving}>
            <FingerprintIcon data-icon="inline-start" />
            通行密钥登录
          </Button>
          <Link to="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            密码登录
          </Link>
        </div>
      </div>
    </div>
  )
}

export function HolodeckLanding() {
  const dark = useTheme() === "dark"
  const stage = useRef<HTMLElement>(null)
  const noStage = useRef<HTMLElement>(null)
  // The transparent stage header carries dark tokens, so only the dark room takes it.
  useStageHeader(dark ? stage : noStage)
  const entry = useDeparture(RUN_MS)
  const run = entry.leaving
  return (
    <>
      <section
        ref={stage}
        aria-labelledby="holodeck-title"
        className="relative isolate -mx-2 -mt-(--header-height) min-h-[min(100svh,54rem)] overflow-hidden bg-(--stage) text-foreground [--halo:rgb(255_240_216)] [--stage:var(--background)] [--vy:36%] xl:[--vy:47%] dark:[--halo:black] dark:[--stage:black]"
      >
        {/* --vy is the vanishing point, as ROOMS places it, for what the page lays over the room. */}
        <Grid run={run} ink={dark ? INK.dark : INK.light} />
        {/* Keeps the transparent header's links legible over the ceiling grid. */}
        <div aria-hidden className="absolute inset-x-0 top-0 -z-1 hidden h-[calc(var(--header-height)*2)] bg-linear-to-b from-black via-black/70 to-transparent dark:block" />
        <div className={cn("relative mx-auto h-[min(100svh,54rem)] min-h-[40rem] w-[calc(100%-1rem)] transition-opacity duration-700 md:max-w-(--content-width)", run && "opacity-0")}>
          {/* On the far wall, centred on the vanishing point, haloed in the far wall's colour to lift it off the lines. */}
          <div className="absolute top-(--vy) left-1/2 w-[min(34rem,68vw)] -translate-1/2 text-center [text-shadow:0_0_12px_var(--halo),0_0_24px_var(--halo)]">
            <p className={cn("font-mono text-[11px] tracking-[0.3em] uppercase", AMBER)}>Holodeck 3 · 程序就绪</p>
            <h1 id="holodeck-title" className="mt-3 text-4xl font-medium tracking-tight sm:text-6xl">
              星际舰队档案馆
            </h1>
            <p className="mt-2 font-mono text-xs tracking-[0.5em] text-muted-foreground uppercase">Starfleet Archive</p>
            <p className="mx-auto mt-5 max-w-sm text-sm/relaxed text-balance text-muted-foreground">
              <Link to="/about" className="link-underline text-foreground">
                关于本站
              </Link>
            </p>
          </div>
          {/* The arch's panel by the entrance: beside the far wall on wide screens, on the floor below it otherwise. */}
          <div className="absolute inset-x-0 bottom-20 mx-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[rgb(205_142_24/0.3)] bg-background/85 p-4 shadow-[0_24px_60px_-28px_rgb(150_100_20/0.35)] backdrop-blur-sm xl:inset-x-auto xl:top-(--vy) xl:right-4 xl:bottom-auto xl:w-72 xl:-translate-y-1/2 dark:border-[rgb(255_178_36/0.35)] dark:bg-black/80 dark:shadow-[0_0_40px_-12px_rgb(255_160_20/0.45)]">
            <div className={cn("flex items-center justify-between gap-4 font-mono text-[11px] tracking-wider uppercase", AMBER)}>
              <span>拱门 · Arch</span>
              <span>{run ? "运行程序" : "计算机待命"}</span>
            </div>
            <EntryFields entry={entry} />
          </div>
        </div>
      </section>
      <Page className="pt-0">
        <GuideSections />
      </Page>
    </>
  )
}
