import { useEffect, useMemo, useRef, useState } from "react"

import { useVariant } from "@/lib/use-variant"
import { hash, mulberry32 } from "@/pages/watch-comments/data"

// Full-bleed line art for the band under the footer, which always sits beneath the fixed bottom fade. Purely
// visual; candidates are switched with `?art=` (kept for the tab) or the prototype console until one is chosen.

export const ARTS = [
  { key: "a", label: "扭索纹" },
  { key: "b", label: "透视网格" },
  { key: "c", label: "层峦" },
  { key: "d", label: "等高线" },
  { key: "e", label: "流线" },
  { key: "f", label: "示波器刻度" },
] as const
export const useArt = () => useVariant("art", ARTS.map((a) => a.key))

function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

type Size = { w: number; h: number }
type Pt = readonly [number, number]

const TAU = Math.PI * 2
const poly = (pts: Pt[]) => "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")
/** Sample positions `step` px apart across [0, w], ending exactly on w. */
const across = (w: number, step: number) => Array.from({ length: Math.ceil(w / step) + 1 }, (_, i) => Math.min(i * step, w))

const DRAWINGS = { a: Guilloche, b: Perspective, c: Ridges, d: Contours, e: Streams }

export function FooterArt() {
  const art = useArt()
  const [ref, { w, h }] = useSize()
  const Drawing = art === "f" ? null : DRAWINGS[art]
  return (
    // Dissolves on its own too, so pages without the fixed fade (sign-in) never show a hard bottom edge.
    <div
      ref={ref}
      aria-hidden
      className="relative -mx-2 h-[calc(var(--fade-bottom-height)+env(safe-area-inset-bottom,0px))] overflow-hidden select-none [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]"
    >
      {!Drawing ? (
        <Graticule />
      ) : (
        w > 0 && (
          <svg width={w} height={h} className="absolute inset-0 text-foreground" fill="none" stroke="currentColor" strokeWidth={0.75}>
            <Drawing w={w} h={h} />
          </svg>
        )
      )}
    </div>
  )
}

/** Banknote-style rope: phase-shifted sine strands whose envelope swells and pinches along the band. */
function Guilloche({ w }: Size) {
  const strands = useMemo(() => {
    const n = 18
    const cy = 30
    const env = (x: number) => 0.2 + 0.8 * Math.abs(Math.cos((Math.PI * (x - w / 2)) / 240))
    return Array.from({ length: n }, (_, k) => {
      const p = (TAU * k) / n
      return poly(across(w, 2).map((x) => [x, cy + env(x) * (16 * Math.sin((TAU * x) / 160 + p) + 5 * Math.sin((TAU * x) / 53 - 2 * p))] as const))
    })
  }, [w])
  return strands.map((d, i) => <path key={i} d={d} strokeOpacity={0.16} />)
}

/** A ruled plane receding to a vanishing point below the page, so its far rows sink into the fade. */
function Perspective({ w, h }: Size) {
  const d = useMemo(() => {
    const vx = w / 2
    const vy = h + 48
    const s = 56
    // Rays starting up to 2·vx beyond either edge still reach the band before they converge.
    const n = Math.ceil((3 * vx) / s)
    let path = ""
    for (let i = -n; i <= n; i++) path += `M${(vx + i * s).toFixed(1)} 0L${vx} ${vy}`
    for (let j = 1; ; j++) {
      const y = vy * (1 - 1 / (1 + 0.16 * j))
      if (y > h) break
      path += `M0 ${y.toFixed(1)}H${w}`
    }
    return path
  }, [w, h])
  return <path d={d} strokeOpacity={0.22} />
}

/** Mountain ranges rising out of the fade, far ones first; each nearer range is filled with the page colour so it hides what lies behind. */
function Ridges({ w, h }: Size) {
  const layers = useMemo(() => {
    const rand = mulberry32(hash("footer-ridges"))
    return Array.from({ length: 6 }, (_, l) => {
      const base = 22 + l * 10
      const amp = 16 + l * 3
      // Ridged noise: 1 − |sin| peaks in sharp crests and bottoms out in round valleys.
      const octaves = Array.from({ length: 4 }, (_, o) => ({ f: ((0.8 + rand() * 0.6) * 2 ** o) / 90, p: rand() * TAU, a: 0.5 ** o }))
      const crest = across(w, 2).map((x) => [x, base - (amp * octaves.reduce((sum, { f, p, a }) => sum + a * (1 - Math.abs(Math.sin(x * f + p))), 0)) / 1.875] as const)
      return { crest: poly(crest), opacity: 0.18 + l * 0.045 }
    })
  }, [w])
  return layers.map((l, i) => (
    <g key={i}>
      <path d={`${l.crest}V${h}H0Z`} className="fill-background" stroke="none" />
      <path d={l.crest} strokeOpacity={l.opacity} />
    </g>
  ))
}

// Marching-squares segments for each corner mask (tl tr br bl, high bit first), as pairs of the cell edges they cross.
const CASES = ["", "LB", "BR", "LR", "TR", "TRLB", "TB", "LT", "LT", "TB", "LTBR", "TR", "LR", "BR", "LB", ""]

/** Iso-lines of `field` over the band at each of `levels`, sampled on an `s` px grid. */
function isolines(field: (x: number, y: number) => number, { w, h }: Size, levels: number[], s = 5) {
  const cols = Math.ceil(w / s)
  const rows = Math.ceil(h / s)
  const v = Array.from({ length: rows + 1 }, (_, j) => Array.from({ length: cols + 1 }, (_, i) => field(i * s, j * s)))
  let path = ""
  for (const level of levels) {
    const t = (a: number, b: number) => (level - a) / (b - a)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const [tl, tr, br, bl] = [v[j][i], v[j][i + 1], v[j + 1][i + 1], v[j + 1][i]]
        const mask = (+(tl > level) << 3) | (+(tr > level) << 2) | (+(br > level) << 1) | +(bl > level)
        // Saddles: when the cell centre is high, the two high corners join through it, so cut off the low ones instead.
        const c = CASES[(mask === 5 || mask === 10) && tl + tr + br + bl > 4 * level ? 15 - mask : mask]
        const [x, y] = [i * s, j * s]
        const at = (e: string): Pt =>
          e === "T" ? [x + s * t(tl, tr), y] : e === "R" ? [x + s, y + s * t(tr, br)] : e === "B" ? [x + s * t(bl, br), y + s] : [x, y + s * t(tl, bl)]
        for (let k = 0; k < c.length; k += 2) path += poly([at(c[k]), at(c[k + 1])])
      }
    }
  }
  return path
}

const steps = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)

/** Survey-map contours over a field of hills and hollows. */
function Contours({ w, h }: Size) {
  const d = useMemo(() => {
    const rand = mulberry32(hash("footer-contours"))
    const n = Math.ceil(w / 120)
    const hills = Array.from({ length: n }, (_, i) => {
      const sx = 60 + rand() * 80
      return {
        x: ((i + 0.2 + rand() * 0.6) * w) / n,
        y: h * (0.05 + rand() * 0.5),
        sx,
        sy: sx * (0.45 + rand() * 0.3),
        a: (rand() < 0.3 ? -0.7 : 1) * (0.6 + rand() * 0.6),
      }
    })
    const height = (x: number, y: number) => hills.reduce((sum, p) => sum + p.a * Math.exp(-(((x - p.x) / p.sx) ** 2 + ((y - p.y) / p.sy) ** 2)), 0)
    return isolines(height, { w, h }, steps(-1.05, 1.55, 0.1))
  }, [w, h])
  return <path d={d} strokeOpacity={0.22} strokeLinecap="round" />
}

/** Ruled lines of a stream parting around hidden stones: streamlines of potential flow past cylinders. */
function Streams({ w, h }: Size) {
  const d = useMemo(() => {
    const rand = mulberry32(hash("footer-streams"))
    const n = Math.max(2, Math.round(w / 240))
    const stones = Array.from({ length: n }, (_, i) => ({ x: ((i + 0.2 + rand() * 0.6) * w) / n, y: h * (0.15 + rand() * 0.35), r: 8 + rand() * 16 }))
    const stream = (x: number, y: number) => {
      let psi = y
      for (const st of stones) {
        const [dx, dy] = [x - st.x, y - st.y]
        const d2 = dx * dx + dy * dy
        // The dipole term flips inside a stone; hold the stone at its dividing streamline so nothing is drawn there.
        if (d2 < st.r * st.r) return st.y
        psi -= (st.r * st.r * dy) / d2
      }
      return psi
    }
    return isolines(stream, { w, h }, steps(2.5, h + 20, 5), 3)
  }, [w, h])
  return <path d={d} strokeOpacity={0.22} strokeLinecap="round" />
}

/**
 * Oscilloscope graticule built on the page's own lines: a copy of the footer column whose border-x runs on as the frame,
 * the footer's bottom rule as the top edge, and divisions on the bottom ruler's 48 / 12 px rhythm.
 */
function Graticule() {
  const [ref, { w, h }] = useSize()
  const col = w + 2 // border-box width; the border-x lines are the frame
  // Whole divisions near 48 px, a multiple of 4 so the title block's 2- and 4-column dividers land on grid lines;
  // 1152 and 768 px columns come out at exactly 48, matching the ruler.
  const n = 4 * Math.max(1, Math.round(col / 192))
  const div = col / n
  const axisY = Math.floor(div)
  const d = useMemo(() => {
    if (!w) return { grid: "", axes: "" }
    // Border-box x → centre of that device-independent pixel in the svg, which starts inside the left border.
    const px = (x: number) => Math.floor(x) - 0.5
    const cx = px(col / 2)
    const ay = axisY + 0.5
    let grid = ""
    for (let k = 1; k < n; k++) if (k !== n / 2) grid += `M${px(k * div)} 0V${h}`
    let axes = `M${cx} 0V${h}M0 ${ay}H${w}`
    for (let j = 1; j * (div / 4) < Math.max(col, h); j++) {
      if (j % 4 === 0) continue
      const t = j * (div / 4)
      const a = j % 4 === 2 ? 4 : 2
      if (t < h) axes += `M${cx - a} ${Math.floor(t) + 0.5}h${a * 2}`
      if (t < col) axes += `M${px(t)} ${ay - a}v${a * 2}`
    }
    return { grid, axes }
  }, [w, h, col, n, div, axisY])
  return (
    <>
      {/* Beyond the frame only the horizontal axis carries on, like the page's full-bleed rules. */}
      <div className="absolute inset-x-0 h-px bg-line" style={{ top: axisY }} />
      <div className="h-full px-2">
        <div ref={ref} className="relative mx-auto h-full border-x md:max-w-(--content-width)">
          {w > 0 && (
            <svg width={w} height={h} className="absolute inset-0" fill="none" strokeWidth={1} shapeRendering="crispEdges">
              <path d={d.grid} className="stroke-foreground" strokeOpacity={0.3} strokeDasharray={`1 ${(div / 8 - 1).toFixed(2)}`} />
              <path d={d.axes} className="stroke-foreground" strokeOpacity={0.25} />
            </svg>
          )}
        </div>
      </div>
    </>
  )
}
