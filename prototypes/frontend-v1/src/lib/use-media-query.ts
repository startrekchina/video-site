import { useSyncExternalStore } from "react"

/** Live `matchMedia` result, e.g. `useMediaQuery("(min-width: 64rem)")` for Tailwind's lg. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
  )
}
