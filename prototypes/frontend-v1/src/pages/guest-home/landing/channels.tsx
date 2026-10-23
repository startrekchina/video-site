import { useEffect, useRef } from "react"
import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useSearchParams } from "react-router"

import { useVariant } from "@/lib/use-variant"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const LANDINGS = [
  { key: "now", label: "星图" },
  { key: "pass", label: "登舰证" },
  { key: "warp", label: "曲速" },
  { key: "transmission", label: "通讯" },
  { key: "holodeck", label: "全息甲板" },
] as const

export const useLanding = () => useVariant("landing", LANDINGS.map((l) => l.key))

// The boarding pass is every candidate's narrow layout, not a channel of its own.
const CHANNELS = LANDINGS.filter((l) => l.key !== "pass")

// Each candidate draws its own keys, so a switch remounts them; a focused key hands focus to its successor.
let carryFocus = false

/** A bridge viewscreen's channel keys: numbers only, the name on hover or focus. Placed by each candidate. */
export function ChannelKeys({ className }: { className?: string }) {
  const landing = useLanding()
  const [, setParams] = useSearchParams()
  const group = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!carryFocus) return
    // A frame later, once the group has registered its keys; focusing earlier leaves its roving tab stop unset.
    const raf = requestAnimationFrame(() => {
      carryFocus = false
      group.current?.querySelector<HTMLElement>("[data-checked]")?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  // z-41: above the page's bottom fade, which covers the first screen's corner on short screens.
  return (
    <RadioGroup
      ref={group}
      aria-label="首页画面"
      value={landing}
      onValueChange={(v) => {
        carryFocus = !!group.current?.contains(document.activeElement)
        // Cross-faded as a view transition: fading the candidate itself would hold the keys under the bottom fade
        // until it ends. Reduced motion swaps at once.
        const viewTransition = !matchMedia("(prefers-reduced-motion: reduce)").matches
        setParams({ landing: String(v) }, { replace: true, preventScrollReset: true, viewTransition })
      }}
      className={cn("z-41 flex gap-1", className)}
    >
      {CHANNELS.map((c, i) => (
        <Tooltip key={c.key}>
          <TooltipTrigger
            render={
              <Radio.Root
                value={c.key}
                aria-label={c.label}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md border bg-background/80 font-mono text-[11px] text-muted-foreground backdrop-blur-sm transition-colors outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-checked:border-foreground data-checked:bg-foreground data-checked:text-background"
              >
                {String(i + 1).padStart(2, "0")}
              </Radio.Root>
            }
          />
          <TooltipContent>{c.label}</TooltipContent>
        </Tooltip>
      ))}
    </RadioGroup>
  )
}
