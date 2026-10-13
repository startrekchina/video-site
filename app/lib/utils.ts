import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Prototype stand-in for a network round trip, so async UI states are visible. */
export function fakeLatency(ms = 700) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
