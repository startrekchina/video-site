import { useEffect } from "react"
import { Navigate, Outlet, useLocation } from "react-router"

import { useStore } from "@/data/store"
import { BottomNav } from "@/components/site/bottom-nav"
import { CommandMenu } from "@/components/site/command-menu"
import { ProtoConsole } from "@/components/site/proto-console"
import { ScrollToTop as ScrollToTopButton } from "@/components/site/scroll-to-top"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function FadeBottom() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40" aria-hidden>
      <div className="h-(--fade-bottom-height) bg-linear-to-b from-transparent to-background mask-linear-[to_top,var(--background)_25%,transparent] backdrop-blur-[1px]" />
      <div className="bg-background pb-[env(safe-area-inset-bottom,0px)]" />
    </div>
  )
}

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Toaster>{children}</Toaster>
    </TooltipProvider>
  )
}

export function AppLayout() {
  return (
    <Providers>
      <div className="group/layout relative isolate">
        <ScrollToTop />
        <SiteHeader />
        <main className="max-w-screen overflow-x-clip px-2">
          <Outlet />
        </main>
        <SiteFooter />
        <FadeBottom />
        <BottomNav />
        <ScrollToTopButton />
        <CommandMenu />
        <ProtoConsole />
      </div>
    </Providers>
  )
}

/** Guest pages: only login/register/recovery are reachable before sign-in (requirement 5.1/1). */
export function AuthLayout() {
  return (
    <Providers>
      <div className="group/layout relative isolate flex min-h-svh flex-col">
        <ScrollToTop />
        <SiteHeader />
        <main className="flex max-w-screen flex-1 flex-col overflow-x-clip px-2">
          <div className="mx-auto flex w-full flex-1 flex-col border-x md:max-w-3xl">
            <Outlet />
          </div>
        </main>
        <SiteFooter minimal />
        <ProtoConsole />
      </div>
    </Providers>
  )
}

export function RequireMember() {
  const me = useStore((s) => s.me)
  const { pathname } = useLocation()
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />
  return <Outlet />
}

export function RequireGuest() {
  const me = useStore((s) => s.me)
  if (me) return <Navigate to="/" replace />
  return <Outlet />
}

export function RequireAdmin() {
  const me = useStore((s) => s.me)
  if (me?.role !== "admin") return <Navigate to="/" replace />
  return <Outlet />
}
