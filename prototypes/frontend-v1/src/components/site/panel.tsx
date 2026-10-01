import type React from "react"
import { ArrowRightIcon } from "lucide-react"
import { Link } from "react-router"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// Panel system ported from chanhdai.com: bordered column sections separated by full-bleed hairlines.

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="panel"
      className={cn("screen-line-top screen-line-bottom border-x", className)}
      {...props}
    />
  )
}

export function PanelHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="panel-header"
      className={cn("screen-line-bottom flex items-end justify-between gap-4 px-4", className)}
      {...props}
    />
  )
}

export function PanelTitle({
  as: Comp = "h2",
  className,
  ...props
}: React.ComponentProps<"h2"> & { as?: "h1" | "h2" | "div" }) {
  return (
    <Comp
      data-slot="panel-title"
      className={cn("font-heading text-3xl font-medium tracking-tight text-balance", className)}
      {...props}
    />
  )
}

export function PanelTitleSup({ className, ...props }: React.ComponentProps<"sup">) {
  return (
    <sup
      className={cn("top-[-0.75em] ml-1 text-sm font-medium tracking-normal text-muted-foreground", className)}
      {...props}
    />
  )
}

export function PanelDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("py-4 text-base text-balance text-muted-foreground", className)} {...props} />
}

export function PanelContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />
}

/** Centered secondary button closing a panel ("All posts →" in the reference). */
export function PanelFooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <div className="screen-line-top flex justify-center py-4">
      <Button
        className="gap-2 pr-2.5 pl-3 shadow-[inset_0_0_1px] shadow-foreground/20"
        variant="secondary"
        size="sm"
        nativeButton={false}
        render={<Link to={to} />}
      >
        {children}
        <ArrowRightIcon />
      </Button>
    </div>
  )
}

/** Diagonal-stripe gap between panels. */
export function Separator({ className }: { className?: string }) {
  return <div className={cn("stripe-divider h-8 w-full border-x", className)} aria-hidden />
}

/** Standard page column: 3xl wide, matching header and footer. */
export function Page({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto border-x pt-12 md:max-w-3xl", className)} {...props} />
}

/** Wide page column; header and footer widen with it (the reference's blocks layout). */
export function PageWide({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="layout-wide" className={cn("container mx-auto border-x pt-12", className)} {...props} />
}

export function PageHeading({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="page-heading" className={cn("group/page-heading", className)} {...props}>
      {children}
      <div className="screen-line-bottom hidden h-px group-has-data-[slot=page-heading-description]/page-heading:flex" />
    </div>
  )
}

export function PageHeadingTagline({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-heading-tagline"
      className={cn("px-4 pb-2 font-heading text-sm/none font-medium tracking-wider text-muted-foreground", className)}
      {...props}
    />
  )
}

export function PageHeadingTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-heading-title"
      className={cn("screen-line-top screen-line-bottom -translate-x-px px-4 font-heading text-4xl font-medium tracking-tight text-balance", className)}
      {...props}
    />
  )
}

export function PageHeadingDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="page-heading-description" className={cn("p-4 text-base text-balance text-muted-foreground", className)} {...props} />
}

/** The "h-4 + hairline" spacer the reference places under every page heading. */
export function HeadingGap() {
  return (
    <>
      <div className="h-4" />
      <div className="screen-line-bottom h-px" />
    </>
  )
}

/** Grey caption, e.g. "Fig. 1." in the reference. */
export function FigCaption({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "pointer-events-none text-sm/none tracking-wide text-[color-mix(in_oklab,var(--muted-foreground)_60%,var(--background))] tabular-nums select-none",
        className,
      )}
      {...props}
    />
  )
}
