import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "site-theme";
const CHANGE_EVENT = "site-theme-change";
let fallback: ThemePreference = "system";

// Run before styles so the first paint uses the saved or system theme.
export const themeInitScript = `(function(){var p='system';try{p=localStorage.getItem('site-theme')||p}catch(e){}var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'})()`;

function preference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return fallback;
  }
}

function apply() {
  const value = preference();
  const dark = value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(value: ThemePreference) {
  fallback = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* Keep the preference for this page when storage is unavailable. */ }
  apply();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleTheme() {
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  setTheme(next === (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") ? "system" : next);
}

function subscribe(onChange: () => void) {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const update = () => { apply(); onChange(); };
  query.addEventListener("change", update);
  window.addEventListener("storage", update);
  window.addEventListener(CHANGE_EVENT, update);
  return () => {
    query.removeEventListener("change", update);
    window.removeEventListener("storage", update);
    window.removeEventListener(CHANGE_EVENT, update);
  };
}

export function useTheme() {
  return useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark") ? "dark" : "light", () => "light");
}

export function useThemePreference() {
  return useSyncExternalStore(subscribe, preference, () => "system");
}
