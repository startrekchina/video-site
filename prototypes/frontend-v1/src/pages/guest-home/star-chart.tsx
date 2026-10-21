import { useState } from "react"
import { ArrowRightIcon, FingerprintIcon, MoveRightIcon, TicketIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { actions } from "@/data/store"
import { useVariant } from "@/lib/use-variant"
import { cn } from "@/lib/utils"
import { Page, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

import { GuestGuide, GuideSections } from "./guide"
import { UfpSeal } from "./ufp-seal"

// The landing page (星图) as one sheet of the site's line drawings. From md, a full-width
// stellar-cartography plate (sector grid with graduated edges, star field, the Romulan Neutral Zone as
// a hatched band, Sol held in a targeting bracket on long crosshairs) over a thin title block that
// holds the name and both ways in: passkey sign-in and an invite code field, then the guide's sections
// as on the other candidates. Below md the plate is too small to read, so narrow screens get the guide
// page instead.
// Follows the site theme. LCARS lives inside the plate only (condensed Antonio labels, amber system
// brackets, the red and cyan target); everything else uses the site's own faces. Says nothing about
// the catalogue; /about carries the rest.
// Candidate atlas (?chart=atlas) adds the furniture of a printed atlas plate: range rings round Sol, a
// legend with a scale bar, a galactic band in the star field and a grey second tier of star names.
// Candidate quadrant (?chart=quadrant) restyles the plate after the series' Alpha/Beta Quadrant charts, as
// the region map of mewho.com/titan draws them: a lettered grid of square sectors with each power's space
// filled cell by cell, names in condensed type and the Federation's emblem, and Sol locked the way the map
// marks a selected object.

export const CHARTS = [
  { key: "now", label: "现状" },
  { key: "atlas", label: "距离环 + 图例" },
  { key: "territory", label: "+ 疆域" },
  { key: "quadrant", label: "象限图" },
] as const
export const useChart = () => useVariant("chart", CHARTS.map((c) => c.key))

const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// Printed-atlas magnitudes: four dot sizes, the brightest ringed. Hairline specks would read as dust
// on paper, so the faintest class is still 1.5px. Positions are shares of the plate.
const STARS = (() => {
  const rnd = rng(11)
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
  const star = (x: number, y: number) => {
    const m = rnd()
    return { x, y, size: m < 0.6 ? 1.5 : m < 0.86 ? 2 : m < 0.96 ? 3 : 4.5, opacity: 0.45 + rnd() * 0.45 }
  }
  const stars = Array.from({ length: 170 }, () => star(rnd() * 100, rnd() * 100))
  for (const [cx, cy] of [[12, 64], [60, 24], [90, 52], [42, 86]])
    for (let i = 0; i < 10; i++) stars.push(star(cx + gauss() * 1.5, cy + gauss() * 3))
  return stars
})()

// Atlas field: a sparse even scatter plus the galactic band, a diagonal through Sol (the Sun sits in the
// galactic plane) from the upper left to the lower right, which keeps the legend's corner and the
// nebula's quiet. Band stars are fainter and never ringed, and none fall inside the target.
const ATLAS_STARS = (() => {
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

// Grey second tier under the amber systems. The two nearest sit inside the rings their distances
// belong in (Alpha Centauri 4.4 ly, Wolf 359 7.9 ly); the rest are only placed.
const NEAR = [
  { name: "Alpha Centauri", x: "41%", y: "calc(50% + 40px)", flip: true },
  { name: "Wolf 359", x: "38%", y: "calc(50% - 90px)" },
  { name: "Andoria", x: "78%", y: "62%" },
  { name: "Tellar", x: "54%", y: "88%" },
]

// A nebula drawn the way a survey map draws relief: three nested, slightly lumpy contours.
const CONTOURS = [1, 0.7, 0.42].map((k, i) => {
  const pts = Array.from({ length: 72 }, (_, j) => {
    const a = (j / 72) * 2 * Math.PI
    const r = k * (1 + 0.13 * Math.sin(3 * a + i) + 0.07 * Math.sin(5 * a + 2 * i))
    return `${(r * 84 * Math.cos(a)).toFixed(1)},${(r * 50 * Math.sin(a)).toFixed(1)}`
  })
  return `M${pts.join(" L")} Z`
})

// Named systems: x/y place the marker's left edge and vertical centre on the plate. Nimbus III sits
// inside the Neutral Zone band, Romulus beyond it, as in the films.
const SYSTEMS = [
  { name: "Romulus", x: "3%", y: "25%" },
  { name: "Nimbus III", x: "calc(25% + 10px)", y: "calc(50% - 30px)" },
  { name: "Qo'noS", x: "60%", y: "14%" },
  { name: "Vulcan", x: "62%", y: "76%" },
  { name: "Bajor", x: "82%", y: "86%" },
]

const NAME =
  "font-display text-sm/none font-semibold tracking-wide whitespace-nowrap text-[#cf6a00] uppercase [text-shadow:0_0_2px_var(--background),0_0_4px_var(--background),0_0_6px_var(--background)] dark:text-[#ffb547]"

// The quadrant candidate names systems in plain light type, as the series' charts do.
const SYSTEM_NAME =
  "font-display text-[15px]/none font-medium tracking-wide whitespace-nowrap text-foreground [text-shadow:0_0_2px_var(--background),0_0_4px_var(--background),0_0_6px_var(--background)]"

// The target's palette, after the films' charts; deeper on paper so the cyan holds up against white.
const RED = "fill-[#d8322b] dark:fill-[#ef4b3f]"
const CYAN = "fill-[#1f9fa9] dark:fill-[#9ff1e4]"

/** A star held in amber brackets, after the films' charts. */
function Bracket() {
  const r = 9.5
  const arc = (from: number, to: number) => {
    const p = (a: number) => `${r * Math.sin((a * Math.PI) / 180)},${-r * Math.cos((a * Math.PI) / 180)}`
    return `M${p(from)} A${r} ${r} 0 0 1 ${p(to)}`
  }
  return (
    <span className="relative block size-6 shrink-0 text-[#f0a020] dark:text-[#f5c53a]">
      <span className="absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-foreground" />
      <svg className="absolute inset-0 size-full" viewBox="-12 -12 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={arc(35, 145)} />
        <path d={arc(215, 325)} />
      </svg>
    </span>
  )
}

/**
 * Sol in the targeting bracket: two red LCARS brackets with cyan blocks in their spines and a cyan post
 * outside each, drawn edge to edge in a 94 by 60 box --tg tall, so the horizontal crosshair meets the
 * posts exactly.
 */
function Target() {
  const half = (
    <>
      <rect x="-47" y="-21" width="4" height="42" rx="1" className={CYAN} />
      <path d="M-22 -30H-35A6 6 0 0 0 -41 -24V24A6 6 0 0 0 -35 30H-22V23H-33V-23H-22Z" className={RED} />
      <rect x="-43" y="-15" width="10" height="8" className={CYAN} />
      <rect x="-43" y="7" width="10" height="8" className={CYAN} />
    </>
  )
  return (
    <>
      <div className="absolute top-[calc(50%-0.25px)] right-[calc(50%+var(--tg)*47/60)] left-0 h-[1.5px] bg-[#1f9fa9] dark:bg-[#9ff1e4]" />
      <div className="absolute top-[calc(50%-0.25px)] right-0 left-[calc(50%+var(--tg)*47/60)] h-[1.5px] bg-[#1f9fa9] dark:bg-[#9ff1e4]" />
      <div className="absolute top-0 bottom-[calc(50%+var(--tg)/2+6px)] left-[calc(50%-0.25px)] w-[1.5px] bg-[#5c9f63] dark:bg-[#b9e6a2]" />
      <div className="absolute top-[calc(50%+var(--tg)/2+6px)] bottom-0 left-[calc(50%-0.25px)] w-[1.5px] bg-[#5c9f63] dark:bg-[#b9e6a2]" />

      <svg
        className="absolute top-1/2 left-1/2 h-(--tg) w-[calc(var(--tg)*94/60)] -translate-1/2 animate-in duration-500 ease-out fade-in zoom-in-150 motion-reduce:animate-none"
        viewBox="-47 -30 94 60"
      >
        {half}
        <g transform="scale(-1 1)">{half}</g>
      </svg>
      <span className="absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full bg-foreground" />
      <span className={cn(NAME, "absolute bottom-[calc(50%+5px)] left-[calc(50%+var(--tg)*47/60+6px)]")}>Sol</span>

      {/* Sol's position read off the graduated edges. */}
      <div className="absolute top-0 left-1/2 h-1 w-[calc(var(--tg)*94/60)] -translate-x-1/2 bg-[#d8322b] dark:bg-[#ef4b3f]" />
      <div className="absolute bottom-0 left-1/2 h-1 w-[calc(var(--tg)*94/60)] -translate-x-1/2 bg-[#d8322b] dark:bg-[#ef4b3f]" />
      <div className="absolute top-1/2 left-0 h-(--tg) w-1 -translate-y-1/2 bg-[#d8322b] dark:bg-[#ef4b3f]" />
      <div className="absolute top-1/2 right-0 h-(--tg) w-1 -translate-y-1/2 bg-[#d8322b] dark:bg-[#ef4b3f]" />
    </>
  )
}

const LABEL = "font-display text-[10px] leading-none tracking-wider text-muted-foreground uppercase"
const HALO = "[text-shadow:0_0_2px_var(--background),0_0_4px_var(--background)]"
// Labels the rings may run through cut the line, as the sector codes do.
const KNOCKOUT = "bg-background px-0.5"
const RING_TEXT = "text-[#1f9fa9] dark:text-[#9ff1e4]"

/**
 * The atlas candidate's furniture. Scale: one major column is 10 ly, so a ring of n ly is n * 5% of the
 * plate wide and the rings cross the horizontal crosshair on grid lines. Ring labels sit west of Sol,
 * clear of the sector codes.
 */
function Atlas() {
  return (
    <>
      {/* Viewbox units are light years; the stroke and dashes stay in screen pixels. */}
      <svg className={cn("absolute top-1/2 left-1/2 aspect-square w-3/4 -translate-1/2 overflow-visible", RING_TEXT)} viewBox="-15 -15 30 30" fill="none">
        {[5, 10, 15].map((ly) => (
          <circle key={ly} r={ly} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {[5, 10, 15].map((ly) => (
        <span key={ly} className={cn("absolute top-[calc(50%+4px)]", KNOCKOUT, LABEL, RING_TEXT)} style={{ right: `calc(${50 + ly * 2.5}% + 3px)` }}>
          {ly} ly
        </span>
      ))}
      <span className={cn("absolute top-[calc(50%+5px)] right-3 flex items-center gap-1", LABEL, HALO)}>
        Galactic core
        <MoveRightIcon className="size-3.5" />
      </span>

      {NEAR.map(({ name, x, y, flip }) => (
        <div key={name} className={cn("absolute flex -translate-y-1/2 items-center gap-1.5", flip && "-translate-x-full flex-row-reverse")} style={{ left: x, top: y }}>
          <span className="size-[3px] shrink-0 rounded-full bg-foreground" />
          <span className={cn(LABEL, KNOCKOUT, "whitespace-nowrap")}>{name}</span>
        </div>
      ))}
    </>
  )
}

const BORDER_DASH = "10 3 2 3"

/** Atlas-plate legend in the empty lower-left cell, drawn over the territory tints. */
function Legend({ borders }: { borders: boolean }) {
  return (
    <div className={cn("absolute bottom-4 left-4 flex flex-col gap-2 border bg-background p-2.5", LABEL)}>
      <div className="text-foreground">Legend</div>
      <div className="flex items-center gap-2">
        <span className="flex w-8 items-center justify-between">
          {[1.5, 2, 3].map((s) => (
            <span key={s} className="rounded-full bg-foreground/70" style={{ width: s, height: s }} />
          ))}
          <span className="size-[4.5px] rounded-full bg-foreground/70 shadow-[0_0_0_2px_var(--background),0_0_0_3px_var(--foreground)]" />
        </span>
        Star magnitude
      </div>
      <div className="flex items-center gap-2">
        <span className="-my-1.5 flex w-8 justify-center">
          <Bracket />
        </span>
        Named system
      </div>
      <div className="flex items-center gap-2">
        <svg className={cn("h-px w-8", RING_TEXT)} fill="none">
          <line x2="100%" stroke="currentColor" strokeOpacity={0.55} strokeDasharray="5 4" />
        </svg>
        Range from Sol
      </div>
      {borders && (
        <div className="flex items-center gap-2">
          <svg className="h-px w-8 text-muted-foreground" fill="none">
            <line x2="100%" stroke="currentColor" strokeDasharray={BORDER_DASH} />
          </svg>
          Border
        </div>
      )}
      {/* 5 ly at the rings' scale: 12.5% of the plate's width. */}
      <div className="mt-1 flex w-[12.5cqw] flex-col gap-1">
        <div className="flex h-1 border border-muted-foreground">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={cn("flex-1", i % 2 === 0 && "bg-muted-foreground")} />
          ))}
        </div>
        <div className="flex justify-between">
          <span>0</span>
          <span>5 ly</span>
        </div>
      </div>
    </div>
  )
}

/** Catmull-Rom through the given points, sampled so it can feed both a polyline and a clip polygon. */
const spline = (pts: number[][], steps = 8) =>
  pts
    .slice(0, -1)
    .flatMap((p1, i) => {
      const [p0, p2] = [pts[i - 1] ?? p1, pts[i + 1]]
      const p3 = pts[i + 2] ?? p2
      return Array.from({ length: steps }, (_, s) => {
        const t = s / steps
        return [0, 1].map(
          (k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t ** 3),
        )
      })
    })
    .concat([pts.at(-1)!])

// Territory candidate geometry, in shares of the plate. The Neutral Zone bends along the Romulan
// border and is widest open at Sol's latitude, where its west edge meets the 10 ly ring on the grid
// line; Nimbus III stays inside it. The Klingon border runs above the Mutara Nebula with Qo'noS behind it.
const zoneWest = (y: number) => 20 + 5 * Math.sin((Math.PI * y) / 100)
const ROMULAN_EDGE = Array.from({ length: 21 }, (_, i) => [zoneWest(i * 5), i * 5])
const FEDERATION_EDGE = ROMULAN_EDGE.map(([x, y]) => [x + 5, y])
const KLINGON_EDGE = spline([[57, 0], [56, 14], [61, 25], [70, 26], [78, 20], [88, 16], [100, 14]])

const polygon = (pts: number[][]) => `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(",")})`
const polyline = (pts: number[][]) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")

const REGION = "absolute font-display text-[13px] leading-tight tracking-[0.3em] whitespace-nowrap text-muted-foreground/80 uppercase"

/**
 * The powers: the bent Neutral Zone, the Klingon border as a dash-dot line, the two rivals tinted in
 * their canonical colours (Federation space stays plain paper) and each power named in wide-spaced type.
 * The tints lie over the labels beneath them so knocked-out label boxes don't show as white patches.
 */
function Territory() {
  return (
    <>
      <div className="absolute inset-0 diagonal-stripes" style={{ clipPath: polygon([...ROMULAN_EDGE, ...FEDERATION_EDGE.toReversed()]) }} />
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">
        <polyline points={polyline(ROMULAN_EDGE)} className="stroke-border" vectorEffect="non-scaling-stroke" />
        <polyline points={polyline(FEDERATION_EDGE)} className="stroke-border" vectorEffect="non-scaling-stroke" />
        <polyline points={polyline(KLINGON_EDGE)} className="stroke-muted-foreground" strokeDasharray={BORDER_DASH} vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute -translate-1/2 rotate-180 bg-background py-1.5 font-display text-[10px] tracking-[0.25em] whitespace-nowrap text-muted-foreground uppercase [writing-mode:vertical-rl]"
        style={{ left: `${zoneWest(68) + 2.5}%`, top: "68%" }}
      >
        Neutral Zone
      </span>

      <span className={cn(REGION, "top-[13%] left-[3%] -translate-y-1/2")}>
        Romulan
        <br />
        Star Empire
      </span>
      <span className={cn(REGION, "top-[26px] right-[18px]")}>Klingon Empire</span>
      <span className={cn(REGION, "right-[18px] bottom-[18px]")}>United Federation of Planets</span>

      <div className="absolute inset-0 bg-[#5c9f63]/7 dark:bg-[#b9e6a2]/6" style={{ clipPath: polygon([[0, 0], ...ROMULAN_EDGE, [0, 100]]) }} />
      <div className="absolute inset-0 bg-[#d8322b]/5 dark:bg-[#ef4b3f]/7" style={{ clipPath: polygon([...KLINGON_EDGE, [100, 0]]) }} />
    </>
  )
}

// Quadrant candidate's sectors, after the Alpha/Beta region map of mewho.com/titan (the Star Trek: Star
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
const QUADRANT_SYSTEMS = [
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

// Minor grid: dotted hairlines, --sub per major cell each way, cut from a dotted fill by a mask of
// 1px stripes.
const minorLines = (axis: "x" | "y"): React.CSSProperties => ({
  backgroundImage: `repeating-linear-gradient(to ${axis === "x" ? "bottom" : "right"}, var(--color-border) 0 1px, transparent 1px 4px)`,
  maskImage: `linear-gradient(to ${axis === "x" ? "right" : "bottom"}, #000 0 1px, transparent 1px)`,
  maskSize: axis === "x" ? "calc(100% / var(--gx) / var(--sub)) 100%" : "100% calc(100% / var(--gy) / var(--sub))",
})

// Graduated edge: a 9px tick at every minor grid line and 5px ticks in between, pointing inwards.
const ruler = (edge: "top" | "bottom" | "left" | "right"): React.CSSProperties => {
  const across = edge === "top" || edge === "bottom"
  const line = `linear-gradient(to ${across ? "right" : "bottom"}, currentColor 0 1px, transparent 1px)`
  const step = `100% / var(${across ? "--gx" : "--gy"}) / var(--sub)`
  return {
    backgroundImage: `${line}, ${line}`,
    backgroundSize: across ? `calc(${step}) 9px, calc(${step} / 4) 5px` : `9px calc(${step}), 5px calc(${step} / 4)`,
    backgroundRepeat: across ? "repeat-x" : "repeat-y",
    backgroundPosition: { top: "0 0", bottom: "0 100%", left: "0 0", right: "100% 0" }[edge],
  }
}

/**
 * The chart: four major columns by two rows, so Sol sits on the centre intersection and the title
 * block's dividers below continue the plate's vertical lines (the centre one as the crosshair). Always
 * 2:1 (the quadrant 9:5, for its 18 by 10 sectors), so the cells stay square; on short screens the title
 * block drops below the first screen.
 */
function Plate() {
  const chart = useChart()
  const territory = chart === "territory"
  const atlas = chart === "atlas" || territory
  const quadrant = chart === "quadrant"
  return (
    <div
      aria-hidden
      className={cn(
        "@container relative isolate overflow-hidden select-none [--gx:4] [--gy:2] [--sub:4] [--tg:3rem] lg:[--tg:4.5rem]",
        // The series' charts are black; on paper the quadrant stays a printed sheet. Its header elbows
        // meet the meridian at the foot of row 01, or lower where the rows are shorter than the header.
        quadrant ? "aspect-[9/5] [--meridian:max(10%,4rem)] dark:bg-black" : "aspect-[2/1]",
      )}
    >
      <div className="absolute inset-0 [--star:0.7] dark:[--star:0.85]">
        {/* The quadrant takes the atlas's denser field; its brightest stars glow rather than ring. */}
        {(atlas || quadrant ? ATLAS_STARS : STARS).map((s, i) => (
          <span
            key={i}
            className={cn(
              "absolute -translate-1/2 rounded-full bg-foreground",
              s.size > 4 && (quadrant ? "shadow-[0_0_6px_1px_var(--foreground)]" : "shadow-[0_0_0_2px_var(--background),0_0_0_3px_var(--foreground)]"),
            )}
            style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, opacity: `calc(var(--star) * ${s.opacity})` }}
          />
        ))}
      </div>

      {quadrant ? <Quadrant /> : <Sheet atlas={atlas} territory={territory} />}

      {(quadrant ? QUADRANT_SYSTEMS : SYSTEMS).map((s) => (
        <div key={s.name} className="absolute flex -translate-y-1/2 items-center gap-1" style={{ left: s.x, top: s.y }}>
          {/* The series' charts mark systems with a plain dot and stations with a triangle, at the bracket's
              width so the names stay put. */}
          {quadrant ? (
            <span className="flex size-6 shrink-0 items-center justify-center">
              <span className={"station" in s && s.station ? "size-2 bg-foreground [clip-path:polygon(50%_0,100%_100%,0_100%)]" : "size-1.5 rounded-full bg-foreground"} />
            </span>
          ) : (
            <Bracket />
          )}
          <span className={quadrant ? SYSTEM_NAME : NAME}>{s.name}</span>
        </div>
      ))}

      {!quadrant && <Target />}
    </div>
  )
}

/** The line-drawing plates' grid, graduated edges, sector codes, Neutral Zone and nebula, with the atlas layers. */
function Sheet({ atlas, territory }: { atlas: boolean; territory: boolean }) {
  return (
    <>
      <div className="absolute inset-0 opacity-80" style={minorLines("x")} />
      <div className="absolute inset-0 opacity-80" style={minorLines("y")} />
      {/* The centre lines are the target's crosshairs. */}
      {[1, 3].map((k) => (
        <div key={k} className="absolute inset-y-0 w-px bg-border" style={{ left: `calc(${k} * 100% / var(--gx))` }} />
      ))}

      {!territory && (
        <div className="absolute inset-y-0 left-1/4 w-12 border-x diagonal-stripes">
          <span className="absolute top-9 left-1/2 -translate-x-1/2 rotate-180 bg-background py-1.5 font-display text-[10px] tracking-[0.25em] whitespace-nowrap text-muted-foreground uppercase [writing-mode:vertical-rl]">
            Neutral Zone
          </span>
        </div>
      )}

      {/* Centred 88px above the crosshair: half the contours, the label and a 16px gap. */}
      <div className="absolute top-[calc(50%-88px)] left-[84%] -translate-1/2">
        <svg className="h-[120px] w-[200px] overflow-visible text-muted-foreground/70" viewBox="-100 -60 200 120" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1 3">
          {CONTOURS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
        <span className={cn("absolute top-full left-1/2 -translate-x-1/2 font-display text-[10px] tracking-[0.25em] whitespace-nowrap text-muted-foreground uppercase", atlas && KNOCKOUT)}>
          Mutara Nebula
        </span>
      </div>

      {(["top", "bottom", "left", "right"] as const).map((edge) => (
        <div key={edge} className="absolute inset-0 text-muted-foreground/70" style={ruler(edge)} />
      ))}

      {Array.from({ length: 8 }, (_, i) => {
        const [c, r] = [i % 4, Math.floor(i / 4)]
        // The centre intersection is Sol's.
        if (c === 2 && r === 1) return null
        return (
          <span
            key={i}
            className="absolute bg-background px-0.5 font-display text-[10px] leading-none tracking-wider text-muted-foreground/70"
            // Codes on the edges step in past the ticks.
            style={{ left: `calc(${c} * 100% / var(--gx) + ${c === 0 ? 12 : 5}px)`, top: `calc(${r} * 100% / var(--gy) + ${r === 0 ? 12 : 5}px)` }}
          >
            {1124 + r * 20 + c}
          </span>
        )
      })}

      {atlas && <Atlas />}
      {territory && <Territory />}
      {atlas && <Legend borders={territory} />}
    </>
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
  const navigate = useNavigate()
  return (
    <div className={cn("flex flex-col gap-3 p-4", className)}>
      <FieldTag n="02" color="bg-[#cc99cc]">
        成员登录
      </FieldTag>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="secondary"
          size="sm"
          className="shadow-[inset_0_0_1px] shadow-foreground/20"
          onClick={() => {
            actions.login()
            navigate("/")
          }}
        >
          <FingerprintIcon data-icon="inline-start" />
          通行密钥登录
        </Button>
        <Link to="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          密码登录
        </Link>
      </div>
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
        navigate(`/register?code=${encodeURIComponent(code.trim().toUpperCase())}`)
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

export function GuestStarChart() {
  return (
    <>
      <div className="md:hidden">
        <GuestGuide />
      </div>
      <div className="mx-auto max-md:hidden md:max-w-(--content-width)">
        <Separator />
        <section aria-labelledby="chart-title" className="screen-line-top screen-line-bottom border-x">
          <div className="screen-line-bottom flex h-9 items-center justify-between gap-4 px-4 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            <span>Stellar cartography</span>
            <span>Fig. 01</span>
          </div>

          <Plate />

          <div className="screen-line-top grid grid-cols-4">
            <div className="col-span-2 flex flex-col gap-3 p-4">
              <FieldTag n="01" color="bg-[#ff9c00]">
                站名
              </FieldTag>
              <div className="mt-auto flex flex-col gap-1">
                <hgroup className="flex flex-wrap items-baseline gap-x-3">
                  <h1 id="chart-title" className="text-2xl font-medium tracking-tight">
                    星际舰队档案馆
                  </h1>
                  <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground uppercase">Starfleet Archive</p>
                </hgroup>
                <p className="text-sm text-pretty text-muted-foreground">
                  <Link to="/about" className="link-underline text-foreground">
                    关于本站
                  </Link>
                </p>
              </div>
            </div>
            <SignIn className="border-l" />
            <InviteCode className="border-l" />
          </div>
        </section>
      </div>
      <Page className="pt-0 max-md:hidden">
        <GuideSections />
      </Page>
    </>
  )
}
