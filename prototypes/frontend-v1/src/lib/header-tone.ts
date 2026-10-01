import { useSyncExternalStore } from "react"

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
