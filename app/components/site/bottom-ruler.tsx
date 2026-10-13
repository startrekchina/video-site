import { useEffect, useState } from "react"

// Tick ruler in the spirit of cali.so's ArcRulers: one shallow arc (radius
// width²/320, apex 40px above the clipped baseline) drawn twice with dash
// patterns — a 5px stroke every 48px and a 2.5px stroke every 12px hanging
// toward the viewport edge. pathLength normalizes dash math to px.
const HEIGHT = 64
const APEX_Y = 55.5
const RISE = 40

export function BottomRuler() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth)
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])
  if (!width) return null
  const radius = (width * width) / 320
  const baselineY = APEX_Y + RISE
  const d = `M 0 ${baselineY} A ${radius} ${radius} 0 0 1 ${width} ${baselineY}`
  // Half a period off so a tick straddles the arc's apex.
  const dashOffset = -(width / 2 - 0.5)
  return (
    <svg className="absolute inset-x-0 bottom-0 block" width={width} height={HEIGHT} aria-hidden>
      <path
        d={d}
        pathLength={width}
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeDasharray="1 47"
        strokeDashoffset={dashOffset}
        className="text-foreground/20"
      />
      <path
        d={d}
        pathLength={width}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeDasharray="1 11"
        strokeDashoffset={dashOffset}
        transform="translate(0 1.25)"
        className="text-foreground/15"
      />
    </svg>
  )
}
