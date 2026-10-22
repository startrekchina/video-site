import { useEffect } from "react"
import { useSearchParams } from "react-router"

/**
 * Prototype-only picker for design candidates: `?<param>=<key>` selects one and is remembered for the tab,
 * so it survives navigation; unknown keys fall back to the first.
 */
export function useVariant<K extends string>(param: string, keys: readonly K[]): K {
  const [params] = useSearchParams()
  const q = params.get(param)
  const storageKey = `proto-${param}`
  useEffect(() => {
    if (q) sessionStorage.setItem(storageKey, q)
  }, [q, storageKey])
  const v = q ?? sessionStorage.getItem(storageKey)
  return keys.find((k) => k === v) ?? keys[0]
}
