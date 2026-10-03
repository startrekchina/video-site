import { useSyncExternalStore } from "react"

type Theme = "light" | "dark"
export type ThemePreference = Theme | "system"

const STORAGE_KEY = "proto-theme"
const listeners = new Set<() => void>()
const darkQuery = matchMedia("(prefers-color-scheme: dark)")

function resolved(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function preference(): ThemePreference {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === "light" || v === "dark" ? v : "system"
}

function apply(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark")
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#09090b" : "#ffffff")
}

export function setTheme(p: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, p)
  apply(p === "system" ? (darkQuery.matches ? "dark" : "light") : p)
  listeners.forEach((l) => l())
}

/** Flips the rendered theme; stores "system" when that already yields the flipped result. */
export function toggleTheme() {
  const next: Theme = resolved() === "dark" ? "light" : "dark"
  setTheme(next === (darkQuery.matches ? "dark" : "light") ? "system" : next)
}

darkQuery.addEventListener("change", () => {
  if (preference() === "system") setTheme("system")
})

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTheme() {
  return useSyncExternalStore(subscribe, resolved)
}

export function useThemePreference() {
  return useSyncExternalStore(subscribe, preference)
}
