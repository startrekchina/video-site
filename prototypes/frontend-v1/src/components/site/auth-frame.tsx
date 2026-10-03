import type React from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/** Centered card used by all guest pages, after the reference login-01 block. */
export function AuthFrame({ title, description, children, aside }: { title: string; description?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex w-full flex-1 items-center justify-center p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription className="text-pretty">{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {aside && <div className="px-6 text-center text-sm text-balance text-muted-foreground">{aside}</div>}
      </div>
    </div>
  )
}

/** Stand-in for the Cloudflare Turnstile widget. */
export function TurnstileStub({ onVerify, verified }: { onVerify: () => void; verified: boolean }) {
  return (
    <button
      type="button"
      onClick={onVerify}
      className="flex h-16 w-full items-center gap-3 rounded-lg border bg-muted px-4 text-left text-sm"
      aria-pressed={verified}
    >
      <span className={`flex size-6 items-center justify-center rounded border-2 ${verified ? "border-success bg-success text-white" : "border-muted-foreground/40 bg-background"}`}>
        {verified && "✓"}
      </span>
      <span className="flex-1">{verified ? "验证成功" : "确认你是真人"}</span>
      <span className="font-mono text-[10px] text-muted-foreground">Turnstile（占位）</span>
    </button>
  )
}
