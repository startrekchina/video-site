import { beforeEach, expect, it, vi } from "vitest";
import { toggleTheme } from "@/lib/theme";

const storage = new Map<string, string>(), classes = new Set<string>();
let systemDark = false;
beforeEach(() => {
  storage.clear(); classes.clear(); systemDark = false;
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("matchMedia", () => ({ matches: systemDark }));
  vi.stubGlobal("document", { documentElement: { style: {}, classList: { contains: (name: string) => classes.has(name), toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) } } });
  vi.stubGlobal("window", { dispatchEvent: () => true });
});

it("stores only a theme opposite to the system and forgets it when flipped back", () => {
  toggleTheme();
  expect(classes.has("dark")).toBe(true);
  expect(storage.get("site-theme")).toBe("dark");
  toggleTheme();
  expect(classes.has("dark")).toBe(false);
  expect(storage.has("site-theme")).toBe(false);
});

it("flips a dark system to light and keeps that choice", () => {
  systemDark = true; classes.add("dark");
  toggleTheme();
  expect(classes.has("dark")).toBe(false);
  expect(storage.get("site-theme")).toBe("light");
});
