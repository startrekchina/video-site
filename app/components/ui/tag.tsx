import React from "react"

import { cn } from "@/lib/utils"

function Tag({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tag"
      className={cn(
        "inline-flex items-center rounded-full border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground",
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

export { Tag }
