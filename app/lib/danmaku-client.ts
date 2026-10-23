import { useSyncExternalStore } from "react";
import type { Option } from "artplayer-plugin-danmuku";

// Server limits the watch page passes to the player and the block list (B 6.17).
export type DanmakuLimits = { maxLength: number; lockTime: number; colors: readonly string[]; blockWordLimit: number; blockWordMaxLength: number };

// Display settings, block words and danmaku deleted on this page live in this browser only; storage may be unavailable.
const settingsKey = "player-danmaku", blockKey = "danmaku-block-words";
const percent = (value: unknown) => typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?%$/u.test(value));
const mode = (value: unknown) => value === 0 || value === 1 || value === 2;
// The plugin throws on an option of the wrong type, so a saved value it would reject is dropped.
const fields: Record<string, (value: unknown, colors: readonly string[]) => boolean> = {
  visible: value => typeof value === "boolean", antiOverlap: value => typeof value === "boolean", synchronousPlayback: value => typeof value === "boolean",
  opacity: value => typeof value === "number" && value >= 0 && value <= 1, speed: value => typeof value === "number" && value >= 1 && value <= 10,
  fontSize: percent, margin: value => Array.isArray(value) && value.length === 2 && value.every(percent),
  modes: value => Array.isArray(value) && value.every(mode), mode, color: (value, colors) => typeof value === "string" && colors.includes(value),
};
export function savedDanmakuSettings(colors: readonly string[]): Partial<Option> {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(fields).filter(([key, valid]) => key in saved && valid(saved[key], colors)).map(([key]) => [key, saved[key]]));
  } catch { return {}; }
}
export function saveDanmakuSettings(option: Option, hidden: boolean) {
  const picked = Object.fromEntries(Object.keys(fields).map(key => [key, key === "visible" ? !hidden : option[key as keyof Option]]));
  try {
    const serialized = JSON.stringify(picked);
    if (localStorage.getItem(settingsKey) !== serialized) localStorage.setItem(settingsKey, serialized);
  } catch { /* Keep the settings for this page only. */ }
}

// Block words and deletions apply at display time; listeners clear what is already on screen.
let words: string[] | undefined;
const removed = new Set<string>(), listeners = new Set<() => void>(), none: string[] = [];
const notify = () => listeners.forEach(listener => listener());
export function blockedWords() {
  if (words) return words;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(blockKey) ?? "[]");
    words = Array.isArray(saved) ? saved.filter((word): word is string => typeof word === "string" && word.length > 0) : [];
  } catch { words = []; }
  return words;
}
export function setBlockedWords(next: string[]) {
  words = next;
  try { localStorage.setItem(blockKey, JSON.stringify(next)); } catch { /* Keep the list for this page only. */ }
  notify();
}
export function forgetDanmaku(id: string) { removed.add(id); notify(); }
export const subscribeDanmakuFilter = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useBlockedWords = () => useSyncExternalStore(subscribeDanmakuFilter, blockedWords, () => none);
// Case-insensitive containment (B 6.17).
export function danmakuVisible(item: { id?: string; text: string }) {
  const text = item.text.toLowerCase();
  return !(item.id && removed.has(item.id)) && !blockedWords().some(word => text.includes(word.toLowerCase()));
}
