import { KeyRoundIcon, LogOutIcon, MoonStarIcon, ShieldIcon, SunMediumIcon, TicketIcon, UserIcon } from "lucide-react"
import { Link, NavLink, useLocation, useNavigate } from "react-router"

import { actions, useStore } from "@/data/store"
import { useHeaderTone } from "@/lib/header-tone"
import { useHotkey } from "@/lib/hotkeys"
import { toggleTheme, useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { CommandMenuTrigger } from "./command-menu"
import { SiteMark } from "./site-mark"

export const MAIN_NAV = [
  { to: "/", label: "首页", end: true },
  { to: "/series", label: "剧集" },
  { to: "/movies", label: "电影" },
  { to: "/library", label: "我的片库" },
]

const GUEST_NAV = [
  { to: "/", label: "首页", end: true },
  { to: "/about", label: "关于" },
]

export function NavItem({ to, label, end, className }: { to: string; label: string; end?: boolean; className?: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "text-sm font-medium tracking-wide whitespace-nowrap text-muted-foreground transition-[color] hover:text-foreground",
          isActive && "text-foreground",
          className,
        )
      }
    >
      {label}
    </NavLink>
  )
}

export function ThemeToggle() {
  const theme = useTheme()
  useHotkey("d", toggleTheme)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="border-none" aria-label="切换深浅色" onClick={toggleTheme}>
            {theme === "dark" ? <SunMediumIcon /> : <MoonStarIcon />}
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2 pr-2 pl-3">
        切换深浅色
        <Kbd>D</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function UserMenu() {
  const me = useStore((s) => s.me)!
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="border-none" aria-label="账号菜单">
            <span className="flex size-6 items-center justify-center rounded-md bg-muted font-mono text-xs text-muted-foreground uppercase inset-ring-1 inset-ring-foreground/10">
              {me.username.slice(0, 1)}
            </span>
            <span className="sr-only">{me.username}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="font-mono text-sm text-foreground">{me.username}</span>
            <span className="text-xs">{me.role === "admin" ? "管理员" : "成员"}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/account")}>
          <UserIcon />
          账号与安全
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/account#passkeys")}>
          <KeyRoundIcon />
          通行密钥与二步验证
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/invites")}>
          <TicketIcon />
          邀请
        </DropdownMenuItem>
        {me.role === "admin" && (
          <DropdownMenuItem onClick={() => navigate("/admin")}>
            <ShieldIcon />
            管理后台
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            actions.logout()
            navigate("/login")
          }}
        >
          <LogOutIcon />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader() {
  const me = useStore((s) => s.me)
  const tone = useHeaderTone()
  const { pathname } = useLocation()
  return (
    <header
      className={cn(
        "sticky top-0 z-50 max-w-screen overflow-x-clip bg-background px-2 text-foreground",
        // Over a dark stage: scope dark tokens to the header; --line is resolved at :root, so override it here.
        tone !== "default" && "dark [--line:rgb(255_255_255/0.1)]",
        tone === "stage-top" && "bg-transparent",
        tone === "stage" && "bg-background/70 backdrop-blur-md",
      )}
    >
      <div
        className={cn(
          "screen-line-top screen-line-bottom mx-auto flex h-(--header-height) items-center gap-2 border-x pr-2 pl-4 after:z-1 sm:gap-4 md:max-w-(--content-width)",
          // Match the stage's translucent frame; the dark --border is opaque and shows against the backdrop glow.
          tone !== "default" && "border-white/10",
        )}
      >
        <Link to="/" aria-label="首页">
          <SiteMark className="max-sm:hidden" />
          <SiteMark className="sm:hidden" compact />
        </Link>

        <div className="flex-1" />

        {me ? (
          <nav className="flex items-center gap-4 max-sm:hidden">
            {MAIN_NAV.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
            {me.role === "admin" && <NavItem to="/admin" label="管理" />}
          </nav>
        ) : (
          <nav className="flex items-center gap-4">
            {GUEST_NAV.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
        )}

        <div className="flex items-center">
          {me ? (
            <>
              <Separator orientation="vertical" className="bg-line mr-2 max-sm:hidden data-vertical:h-5 data-vertical:self-center" />
              <CommandMenuTrigger className="max-sm:hidden" />
              <Separator orientation="vertical" className="bg-line mx-2 max-sm:hidden data-vertical:h-5 data-vertical:self-center" />
              <UserMenu />
              <Separator orientation="vertical" className="bg-line mx-2 data-vertical:h-5 data-vertical:self-center" />
            </>
          ) : (
            pathname !== "/login" && (
              <>
                <Separator orientation="vertical" className="bg-line mr-2 data-vertical:h-5 data-vertical:self-center" />
                <Button variant="secondary" size="sm" className="shadow-[inset_0_0_1px] shadow-foreground/20" nativeButton={false} render={<Link to="/login" />}>
                  登录
                </Button>
                <Separator orientation="vertical" className="bg-line mx-2 data-vertical:h-5 data-vertical:self-center" />
              </>
            )
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
