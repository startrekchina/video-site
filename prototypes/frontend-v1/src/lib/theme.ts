import { useSyncExternalStore } from "react"

type Theme = "light" | "dark"
type ThemePreference = Theme | "system"

const STORAGE_KEY = "proto-theme"
const listeners = new Set<() => void>()
const darkQuery = matchMedia("(prefers-color-scheme: dark)")

function resolved(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function apply(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark")
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#09090b" : "#ffffff")
}

function setTheme(p: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, p)
  apply(p === "system" ? (darkQuery.matches ? "dark" : "light") : p)
  listeners.forEach((l) => l())
}

/** Flips the rendered theme; stores "system" when that already yields the flipped result. */
export function toggleTheme() {
  const next: Theme = resolved() === "dark" ? "light" : "dark"
  setTheme(next === (darkQuery.matches ? "dark" : "light") ? "system" : next)
}

// The system always wins: when its scheme changes, a flipped theme is dropped and the page follows it again.
darkQuery.addEventListener("change", () => setTheme("system"))

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTheme() {
  return useSyncExternalStore(subscribe, resolved)
}
