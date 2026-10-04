import { ArrowRightIcon } from "lucide-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div data-width="narrow" className="mx-auto grid min-h-[calc(100svh-var(--header-height))] place-items-center border-x py-6 md:max-w-(--content-width)">
      <section className="flex flex-col items-center gap-6">
        <h1 className="font-mono text-8xl font-medium">404</h1>
        <p className="max-w-xs text-center text-muted-foreground text-balance">这片星域还没有被探索过。</p>
        <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
          返回首页
          <ArrowRightIcon />
        </Button>
      </section>
    </div>
  )
}
