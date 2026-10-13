import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ArrowUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const OFFSET = 400

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true })
  return () => window.removeEventListener("scroll", onChange)
}

/** Floating back-to-top button, dimmed while scrolling down (after chanhdai.com). */
export function ScrollToTop() {
  const visible = useSyncExternalStore(subscribe, () => window.scrollY >= OFFSET, () => false)
  const [dir, setDir] = useState<"up" | "down">("down")
  const last = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setDir(y > last.current ? "down" : "up")
      last.current = y
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <Button
      data-visible={visible}
      data-scroll-direction={dir}
      className={cn(
        "[--bottom:0.5rem] sm:[--bottom:1rem] lg:[--bottom:2rem]",
        "fixed right-4 bottom-[calc(var(--bottom)+env(safe-area-inset-bottom,0px))] z-50 lg:right-8",
        "transition-[background-color,opacity,visibility] duration-300 data-[scroll-direction=down]:opacity-30 data-[scroll-direction=up]:opacity-100 data-[visible=false]:invisible data-[visible=false]:opacity-0",
        "data-[scroll-direction=down]:hover:opacity-100",
        "border-none shadow-[inset_0_0_1px] shadow-foreground/20",
      )}
      variant="secondary"
      size="icon-sm"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}
    >
      <ArrowUpIcon />
    </Button>
  )
}
