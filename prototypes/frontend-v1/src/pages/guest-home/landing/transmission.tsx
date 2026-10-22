import { Page, Separator } from "@/components/site/panel"

import { GuideSections } from "../guide"
import { TitleBar } from "../star-chart"
import { UfpSeal } from "../ufp-seal"
import { ChannelKeys } from "./channels"

// Candidate 通讯: the star chart's frame with the LCARS "incoming communication" of
// lcars.computer/transmission in the plate's place and proportions, scaled as a whole with it (container
// units). LCARS stays on the screen; the title bar beneath is the chart's. Like the chart it follows the
// theme: black in dark, the page's paper in light, where the orange and blue text deepen to stay legible.

const ORANGE = "text-[#ec7a08] dark:text-[#f93]"

function Bar({ label, end }: { label: string; end?: boolean }) {
  return (
    <div className="flex h-[2.8cqw] gap-[0.4cqw]">
      <div className="w-[2.8cqw] rounded-l-full bg-[#c9c]" />
      {end && <div className="grow bg-[#c9c]" />}
      <span className={`self-center font-display text-[3cqw]/none font-medium whitespace-nowrap uppercase ${ORANGE}`}>{label}</span>
      {!end && <div className="grow bg-[#c9c]" />}
      <div className="w-[2.8cqw] rounded-r-full bg-[#c9c]" />
    </div>
  )
}

function Screen() {
  return (
    // mt-px: the dark screen would otherwise cover the section's top rule.
    <div aria-hidden className="@container mt-px select-none dark:bg-[#090909]">
      <div className="flex aspect-[9/5] flex-col p-[2.1cqw]">
        <Bar label="Subspace Comm Net 5765" end />
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <UfpSeal className="h-[24cqw] text-[#253381] dark:text-white" />
          <p className={`mt-[3cqw] font-display text-[5.8cqw]/[0.9] font-medium uppercase ${ORANGE}`}>Incoming Communication</p>
          <p className="mt-[0.8cqw] font-display text-[2.9cqw]/none font-medium text-[#36c] uppercase dark:text-[#9cf]">Starfleet Archive • Authorized Access Only</p>
        </div>
        <Bar label="Terminal Access" />
      </div>
    </div>
  )
}

export function TransmissionLanding() {
  return (
    <>
      <div className="mx-auto max-w-(--content-width)">
        <Separator />
        <section aria-labelledby="chart-title" className="screen-line-top screen-line-bottom border-x">
          {/* The keys sit on the screen's lower right, clear of the bottom bar. */}
          <div className="relative @container">
            <Screen />
            <ChannelKeys className="absolute right-[2.1cqw] bottom-[calc(4.9cqw+0.75rem)]" />
          </div>
          <TitleBar />
        </section>
      </div>
      <Page className="pt-0">
        <GuideSections />
      </Page>
    </>
  )
}
