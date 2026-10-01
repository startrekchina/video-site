import { useEffect } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useSearchParams } from "react-router"

export type Variant = { key: string; name: string }

/** Reads `?variant=`, falling back to the first variant for missing or unknown keys. */
export function useVariant<T extends Variant>(variants: T[]): T {
  const [params] = useSearchParams()
  const key = params.get("variant")?.toLowerCase()
  return variants.find((v) => v.key === key) ?? variants[0]
}

function isTyping(el: Element | null) {
  return !!el && ((el as HTMLElement).isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
}

/**
 * Prototype-only floating bar for flipping between design variants (← / → also cycle).
 * Styled like the prototype console, deliberately unlike the site.
 */
export function VariantSwitcher({ variants, current }: { variants: Variant[]; current: Variant }) {
  const [, setParams] = useSearchParams()
  const index = variants.indexOf(current)
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length]
    setParams(
      (p) => {
        p.set("variant", next.key)
        return p
      },
      { replace: true },
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || isTyping(document.activeElement)) return
      if (e.key === "ArrowLeft") go(-1)
      else if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (import.meta.env.PROD && !import.meta.env.VITE_PROTO_CONSOLE) return null

  return (
    <div className="fixed bottom-[calc(--spacing(3)+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-amber-300 p-1 font-mono text-xs text-zinc-950 shadow-xl ring-2 ring-zinc-950">
      <button className="rounded-full p-1.5 hover:bg-zinc-950/10" onClick={() => go(-1)} aria-label="上一个方案">
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="min-w-36 px-1 text-center font-bold whitespace-nowrap" aria-live="polite">
        方案 {current.key.toUpperCase()} · {current.name}
        <span className="ml-1.5 font-normal opacity-60">
          {index + 1}/{variants.length}
        </span>
      </span>
      <button className="rounded-full p-1.5 hover:bg-zinc-950/10" onClick={() => go(1)} aria-label="下一个方案">
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  )
}
