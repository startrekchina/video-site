import { useEffect, useState, type ReactNode } from "react";
import { MenuIcon, MoonStarIcon, SunMediumIcon } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router";
import { useHotkey } from "@/lib/hotkeys";
import { toggleTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { BottomRuler } from "./bottom-ruler";
import { ScrollToTop } from "./scroll-to-top";
import { SiteMark } from "./site-mark";

type NavigationItem = { to: string; label: string; end?: boolean };
const guestNavigation = [{ to: "/", label: "首页", end: true }, { to: "/about", label: "关于" }];

function Navigation({ items, onNavigate }: { items: readonly NavigationItem[]; onNavigate?: () => void }) {
  return items.map(({ label, ...item }) => (
    <NavLink key={item.to} {...item} onClick={onNavigate}
      className={({ isActive }) => cn("text-sm font-medium tracking-wide whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground", isActive && "text-foreground")}>
      {label}
    </NavLink>
  ));
}

function BottomNav({ items }: { items: readonly NavigationItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="fixed bottom-[calc(--spacing(2)+env(safe-area-inset-bottom,0px))] left-1/2 z-50 -translate-x-1/2 rounded-xl bg-popover p-1 shadow-md ring ring-foreground/10 sm:hidden dark:ring-foreground/20">
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="菜单"><MenuIcon /></Button>} />
        <PopoverContent className="w-48 rounded-xl p-3" side="top" sideOffset={8}>
          <nav className="flex flex-col gap-3" aria-label="手机导航"><Navigation items={items} onNavigate={() => setOpen(false)} /></nav>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Member navigation is presentation data supplied by an authenticated page loader.
export function SiteShell({ children, memberNavigation }: { children: ReactNode; memberNavigation?: readonly NavigationItem[] }) {
  const theme = useTheme();
  const { pathname } = useLocation();
  useHotkey("d", toggleTheme);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="group/layout relative isolate content-frame has-data-[slot=auth-frame]:flex has-data-[slot=auth-frame]:min-h-svh has-data-[slot=auth-frame]:flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded focus:bg-background focus:p-3">跳到正文</a>
      <header className="sticky top-0 z-50 max-w-screen overflow-x-clip bg-background px-2 text-foreground">
        <div className="screen-line-top screen-line-bottom mx-auto flex h-(--header-height) items-center gap-2 border-x pr-2 pl-4 after:z-1 sm:gap-4 md:max-w-(--content-width)">
          <Link to="/" aria-label="首页"><SiteMark className="max-sm:hidden" /><SiteMark className="sm:hidden" compact /></Link>
          <div className="flex-1" />
          <nav className={cn("flex items-center gap-4", memberNavigation && "max-sm:hidden")} aria-label="主导航">
            <Navigation items={memberNavigation ?? guestNavigation} />
          </nav>
          <div className="flex items-center gap-2">
            {!memberNavigation && pathname !== "/login" && <Button variant="secondary" size="sm" nativeButton={false} render={<Link to="/login" />}>登录</Button>}
            <Button variant="ghost" size="icon-sm" aria-label="切换深浅色" title="切换深浅色（D）" onClick={toggleTheme}>
              {theme === "dark" ? <SunMediumIcon /> : <MoonStarIcon />}
            </Button>
          </div>
        </div>
      </header>
      <main id="main-content" className="max-w-screen overflow-x-clip px-2 group-has-data-[slot=auth-frame]/layout:flex group-has-data-[slot=auth-frame]/layout:flex-1 group-has-data-[slot=auth-frame]/layout:flex-col">{children}</main>
      <footer className="max-w-screen overflow-x-clip px-2">
        <div className="mx-auto border-x md:max-w-(--content-width)">
          <div className="screen-line-top screen-line-bottom before:-top-px before:z-1 group-has-data-[slot=auth-frame]/layout:hidden"><div className="stripe-divider h-12" /></div>
          <div className="h-4 group-has-data-[slot=auth-frame]/layout:hidden" />
          <div className="screen-line-top screen-line-bottom flex items-center gap-3 px-4 py-3 text-muted-foreground">
            <Link to="/" className="mr-auto transition-colors hover:text-foreground" aria-label="首页"><SiteMark compact /></Link>
            <ThemeSwitcher />
          </div>
        </div>
        <div className="h-[calc(var(--fade-bottom-height)+env(safe-area-inset-bottom,0px))]" />
      </footer>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40" aria-hidden>
        <div className="h-(--fade-bottom-height) bg-linear-to-b from-transparent to-background mask-linear-[to_top,var(--background)_25%,transparent] backdrop-blur-[1px]" />
        <div className="bg-background pb-[env(safe-area-inset-bottom,0px)]" /><BottomRuler />
      </div>
      <BottomNav items={memberNavigation ?? []} />
      <ScrollToTop />
    </div>
  );
}
