import type React from "react"
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"

import { actions } from "@/data/store"

/** Both ways in, shared by the landing candidates: the invite code goes on to the register page, which checks it. */
export function useEntry() {
  const navigate = useNavigate()
  const [code, setCode] = useState("")
  const normalized = code.trim().toUpperCase()
  return {
    code,
    setCode,
    normalized,
    submit: (e: React.FormEvent) => {
      e.preventDefault()
      navigate(normalized ? `/register?code=${encodeURIComponent(normalized)}` : "/register")
    },
    // shortcut: the prototype signs straight in; the real passkey ceremony lives in the formal app.
    passkey: () => {
      actions.login()
      navigate("/")
    },
  }
}

/**
 * useEntry for candidates that play a scene on the way out: `leaving` turns on and the page changes `ms`
 * later. Reduced motion changes it at once.
 */
export function useDeparture(ms: number) {
  const entry = useEntry()
  const [leaving, setLeaving] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const go = (run: () => void) => {
    if (leaving) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return run()
    setLeaving(true)
    timer.current = window.setTimeout(run, ms)
  }
  return {
    ...entry,
    leaving,
    submit: (e: React.FormEvent) => {
      e.preventDefault()
      go(() => entry.submit(e))
    },
    passkey: () => go(entry.passkey),
  }
}
