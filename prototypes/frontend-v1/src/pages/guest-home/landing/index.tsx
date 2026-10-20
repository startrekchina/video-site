import { useVariant } from "@/lib/use-variant"

import { GuestStarChart } from "../star-chart"
import { LcarsLanding } from "./lcars"
import { PassLanding } from "./pass"
import { TerminalLanding } from "./terminal"
import { WarpLanding } from "./warp"

// Landing page candidates, switched with `?landing=` or the prototype console until one is chosen.
// Each replaces the first screen; the guide's sections follow on every width.

export const LANDINGS = [
  { key: "now", label: "现状：星图" },
  { key: "pass", label: "登舰证" },
  { key: "lcars", label: "LCARS" },
  { key: "warp", label: "曲速" },
  { key: "terminal", label: "舰载电脑" },
] as const

export const useLanding = () => useVariant("landing", LANDINGS.map((l) => l.key))

const PAGES = { now: GuestStarChart, pass: PassLanding, lcars: LcarsLanding, warp: WarpLanding, terminal: TerminalLanding }

export function GuestLanding() {
  const Landing = PAGES[useLanding()]
  return <Landing />
}
