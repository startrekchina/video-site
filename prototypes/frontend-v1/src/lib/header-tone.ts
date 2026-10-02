import { type RefObject, useEffect, useSyncExternalStore } from "react"

/**
 * How the sticky header should look over the page beneath it. A full-bleed dark stage sets
 * "stage-top" (transparent, page at rest) or "stage" (scrolled, needs a scrim to stay legible).
 */
export type HeaderTone = "default" | "stage-top" | "stage"

let tone: HeaderTone = "default"
const listeners = new Set<() => void>()

export function setHeaderTone(next: HeaderTone) {
  if (next === tone) return
  tone = next
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useHeaderTone() {
  return useSyncExternalStore(subscribe, () => tone)
}

/** Keeps the sticky header transparent while it sits over the stage, with a scrim once scrolled. */
export function useStageHeader(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const update = () => {
      const el = ref.current
      if (!el) return
      const headerHeight = document.querySelector("header")?.offsetHeight ?? 56
      if (el.getBoundingClientRect().bottom <= headerHeight) setHeaderTone("default")
      else setHeaderTone(window.scrollY < 8 ? "stage-top" : "stage")
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      setHeaderTone("default")
    }
  }, [ref])
}
