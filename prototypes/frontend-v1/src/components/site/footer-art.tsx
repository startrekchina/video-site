import { useEffect, useMemo, useRef, useState, type RefObject } from "react"

// Full-bleed line art for the band under the footer, which always sits beneath the fixed bottom fade. Purely visual:
// a ruled plane receding to a vanishing point below the page, so its far rows sink into the fade.

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

/** Centres of the page column's 1px border-x lines in band coordinates, snapped to device pixels as the borders are painted. */
function useColumnEdges(band: RefObject<HTMLDivElement | null>, column: RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState<readonly [number, number]>()
  useEffect(() => {
    // The column keeps its width while the window resizes and changes it alone when --content-width animates, so watch both.
    const ro = new ResizeObserver(() => {
      const snap = (x: number) => Math.round(x * devicePixelRatio) / devicePixelRatio
      const b = band.current!.getBoundingClientRect()
      const c = column.current!.getBoundingClientRect()
      setEdges([snap(c.left) - b.left + 0.5, snap(c.right) - b.left - 0.5])
    })
    ro.observe(band.current!)
    ro.observe(column.current!)
    return () => ro.disconnect()
  }, [band, column])
  return edges
}

/** The plane's rays and rows, centred on the page column; two rays start exactly where its border-x lines end. */
function perspective(w: number, h: number, [l, r]: readonly [number, number]) {
  const vx = (l + r) / 2
  const vy = h + 48
  // Whole cells from the centre to each border line, each about 96 px wide at the top edge.
  const k = Math.max(1, Math.round((r - l) / 2 / 96))
  const s = (r - l) / 2 / k
  // Enough rays that the outermost still cross the band's bottom corners.
  const n = Math.ceil((Math.max(vx, w - vx) * vy) / (s * (vy - h)))
  let path = ""
  for (let i = -n; i <= n; i++) path += `M${(vx + i * s).toFixed(2)} 0L${vx.toFixed(2)} ${vy}`
  // Rows where the cells' diagonals cross the rays (a distance point 350 px out), so every cell is the same square receding.
  for (let j = 1; ; j++) {
    const y = vy * (1 - 1 / (1 + (j * s) / 350))
    if (y > h) break
    path += `M0 ${y.toFixed(1)}H${w}`
  }
  return path
}

export function FooterArt() {
  const [ref, { w, h }] = useSize()
  const column = useRef<HTMLDivElement>(null)
  const edges = useColumnEdges(ref, column)
  const d = useMemo(() => (w > 0 && edges ? perspective(w, h, edges) : ""), [w, h, edges])
  return (
    // Dissolves on its own too, so pages without the fixed fade (sign-in) never show a hard bottom edge.
    <div
      ref={ref}
      aria-hidden
      className="relative -mx-2 h-[calc(var(--fade-bottom-height)+env(safe-area-inset-bottom,0px))] overflow-hidden select-none [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]"
    >
      {/* Zero-height copy of the page column, measured so the plane can meet its border-x lines. */}
      <div className="px-2">
        <div ref={column} className="mx-auto md:max-w-(--content-width)" />
      </div>
      {d && (
        <svg width={w} height={h} className="absolute inset-0 text-foreground" fill="none" stroke="currentColor" strokeWidth={0.75}>
          <path d={d} strokeOpacity={0.22} />
        </svg>
      )}
    </div>
  )
}
