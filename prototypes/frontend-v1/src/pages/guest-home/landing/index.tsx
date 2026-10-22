import { useMediaQuery } from "@/lib/use-media-query"

import { GuestStarChart } from "../star-chart"
import { useLanding } from "./channels"
import { HolodeckLanding } from "./holodeck"
import { PassLanding } from "./pass"
import { TransmissionLanding } from "./transmission"
import { WarpLanding } from "./warp"

export { LANDINGS, useLanding } from "./channels"

// Landing page candidates, switched with the channel keys on the first screen, `?landing=` or the prototype
// console until one is chosen. Each replaces the first screen from md; below md every candidate is too
// cramped, so narrow screens all get the boarding pass. The guide's sections follow on every width.

const PAGES = { now: GuestStarChart, pass: PassLanding, warp: WarpLanding, transmission: TransmissionLanding, holodeck: HolodeckLanding }

export function GuestLanding() {
  const landing = useLanding()
  const wide = useMediaQuery("(min-width: 48rem)")
  const Landing = wide ? PAGES[landing] : PassLanding
  return <Landing />
}
