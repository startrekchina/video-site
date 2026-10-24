import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "site-theme";
const CHANGE_EVENT = "site-theme-change";
let fallback: Theme | null = null;

// Run before styles so the first paint uses the saved or system theme.
export const themeInitScript = `(function(){var p='system';try{p=localStorage.getItem('site-theme')||p}catch(e){}var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'})()`;

const systemTheme = (): Theme => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return fallback;
  }
}

function apply() {
  const dark = (stored() ?? systemTheme()) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

// Following the system stores nothing (B 6.11), so only a theme opposite to the system is ever kept.
function store(value: Theme | null) {
  fallback = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* Keep the choice for this page when storage is unavailable. */ }
  apply();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleTheme() {
  const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
  store(next === systemTheme() ? null : next);
}

function subscribe(onChange: () => void) {
  const query = matchMedia("(prefers-color-scheme: dark)");
  // The system always wins: when its scheme changes, a flipped theme is dropped and the page follows it again.
  const follow = () => store(null);
  const update = () => { apply(); onChange(); };
  query.addEventListener("change", follow);
  window.addEventListener("storage", update);
  window.addEventListener(CHANGE_EVENT, update);
  return () => {
    query.removeEventListener("change", follow);
    window.removeEventListener("storage", update);
    window.removeEventListener(CHANGE_EVENT, update);
  };
}

export function useTheme() {
  return useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark") ? "dark" : "light", () => "light");
}
