import type React from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/** Centered card used by all guest pages, after the reference login-01 block. */
export function AuthFrame({ title, description, children, aside }: { title: string; description?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  // Phones drop the card frame so fields span the column and reach Turnstile's 300px flexible minimum.
  return (
    <div data-slot="auth-frame" data-width="narrow" className="mx-auto flex w-full flex-1 items-center justify-center border-x px-4 py-6 sm:p-6 md:max-w-(--content-width) md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card className="max-sm:rounded-none max-sm:bg-transparent max-sm:py-0 max-sm:shadow-none max-sm:ring-0">
          <CardHeader className="max-sm:px-0">
            <CardTitle><h1>{title}</h1></CardTitle>
            {description && <CardDescription className="text-pretty">{description}</CardDescription>}
          </CardHeader>
          <CardContent className="max-sm:px-0">{children}</CardContent>
        </Card>
        {aside && <div className="px-6 text-center text-sm text-balance text-muted-foreground">{aside}</div>}
      </div>
    </div>
  )
}
