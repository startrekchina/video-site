import type React from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/** Centered card used by all guest pages, after the reference login-01 block. */
export function AuthFrame({ title, description, children, aside }: { title: string; description?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div data-slot="auth-frame" data-width="narrow" className="mx-auto flex w-full flex-1 items-center justify-center border-x p-6 md:max-w-(--content-width) md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle><h1>{title}</h1></CardTitle>
            {description && <CardDescription className="text-pretty">{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {aside && <div className="px-6 text-center text-sm text-balance text-muted-foreground">{aside}</div>}
      </div>
    </div>
  )
}
