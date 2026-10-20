import type React from "react"
import { useState } from "react"
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
