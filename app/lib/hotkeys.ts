import { useEffect } from "react"

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
}

/** Minimal single-key hotkey hook; ignores keys typed into form fields. */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { mod?: boolean; enabled?: boolean } = {}) {
  const { mod = false, enabled = true } = opts
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      if (mod !== (e.metaKey || e.ctrlKey)) return
      if (!mod && (e.altKey || isTyping(e))) return
      e.preventDefault()
      handler(e)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [key, handler, mod, enabled])
}
