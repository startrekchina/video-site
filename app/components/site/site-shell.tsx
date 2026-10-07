import { useEffect, useState, type ReactNode } from "react";
import { KeyRoundIcon, LogOutIcon, MoonStarIcon, SearchIcon, ShieldIcon, SunMediumIcon, TicketIcon, UserIcon } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { call } from "@/lib/auth-client";
import { useHotkey } from "@/lib/hotkeys";
import { toggleTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { Work } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BottomRuler } from "./bottom-ruler";
import { CommandMenu } from "./command-menu";
import { ScrollToTop } from "./scroll-to-top";
import { SiteFooter } from "./site-footer";
import { SiteMark } from "./site-mark";
import { useHeaderTone } from "@/lib/header-tone";

const mainNavigation = [{ to: "/", label: "首页", end: true }, { to: "/series", label: "剧集" }, { to: "/movies", label: "电影" }];
const guestNavigation = [{ to: "/", label: "首页", end: true }, { to: "/about", label: "关于" }];
type Member = { username: string; role: "member" | "admin" };
export type SearchWork = Pick<Work, "slug" | "kind" | "titleZh" | "titleEn" | "code" | "year">;

function UserMenu({ member }: { member: Member }) {
  const navigate = useNavigate(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="border-none" aria-label="账号菜单"><span className="flex size-6 items-center justify-center rounded-md bg-muted font-mono text-xs text-muted-foreground uppercase inset-ring-1 inset-ring-foreground/10">{member.username.slice(0, 1)}</span><span className="sr-only">{member.username}</span></Button>} />
    <DropdownMenuContent align="end" className="w-52"><DropdownMenuGroup><DropdownMenuLabel className="flex flex-col gap-0.5"><span className="font-mono text-sm text-foreground">{member.username}</span><span className="text-xs">{member.role === "admin" ? "管理员" : "成员"}</span></DropdownMenuLabel></DropdownMenuGroup><DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => navigate("/account")}><UserIcon />账号与安全</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/account#passkeys")}><KeyRoundIcon />通行密钥与二步验证</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/invites")}><TicketIcon />邀请</DropdownMenuItem>{member.role === "admin" && <DropdownMenuItem onClick={() => navigate("/admin")}><ShieldIcon />管理后台</DropdownMenuItem>}<DropdownMenuSeparator />
      <DropdownMenuItem disabled={busy} onClick={() => { setBusy(true); setError(""); void call("/api/auth/sign-out", {}).then(() => location.assign("/login")).catch(error => { setError(error.message); setBusy(false); }); }}><LogOutIcon />{busy ? "正在退出…" : "退出登录"}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>{error && <p role="alert" className="absolute top-full right-2 rounded bg-background p-3 text-sm text-destructive">{error}</p>}</>;
}

function SearchTrigger({ onClick, className }: { onClick: () => void; className?: string }) {
  return <Button data-slot="command-menu-trigger" variant="ghost" size="sm" aria-label="搜索作品" className={cn("gap-1.5 border-none px-1.5 text-muted-foreground select-none", className)} onClick={onClick}><SearchIcon /><span className="font-sans text-sm/4 font-medium sm:hidden">搜索</span><KbdGroup className="max-sm:hidden"><Kbd className="w-5 min-w-5">⌘</Kbd><Kbd className="w-5 min-w-5">K</Kbd></KbdGroup></Button>;
}

function BottomNav({ member, onSearch }: { member: Member; onSearch: () => void }) {
  const [open, setOpen] = useState(false);
  const items = [...mainNavigation, { to: "/invites", label: "邀请" }, { to: "/account", label: "账号与安全" }, ...(member.role === "admin" ? [{ to: "/admin", label: "管理后台" }] : [])];
  return <div className="fixed bottom-[calc(--spacing(2)+env(safe-area-inset-bottom,0px))] left-1/2 z-50 flex w-fit -translate-x-1/2 items-center rounded-xl bg-popover py-1 pr-1 pl-2.5 shadow-md ring ring-foreground/10 sm:hidden dark:ring-foreground/20">
    <SearchTrigger onClick={onSearch} className="h-8 min-w-20 gap-2 rounded-none bg-transparent px-0 inset-ring-0 hover:bg-transparent active:scale-none dark:bg-transparent dark:hover:bg-transparent" /><Separator orientation="vertical" className="mr-1 ml-2.5 data-vertical:h-6 data-vertical:self-center" />
    <Popover open={open} onOpenChange={setOpen} modal><PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="菜单" className="group relative flex touch-manipulation flex-col gap-1 border-none before:absolute before:-inset-x-2 before:-top-8 before:-bottom-1 active:scale-none aria-expanded:bg-accent"><span className="flex h-0.5 w-4 rounded-[1px] bg-foreground transition-transform group-data-popup-open:translate-y-0.75 group-data-popup-open:rotate-45 motion-reduce:transition-none" /><span className="flex h-0.5 w-4 rounded-[1px] bg-foreground transition-transform group-data-popup-open:-translate-y-0.75 group-data-popup-open:-rotate-45 motion-reduce:transition-none" /></Button>} />
      <PopoverContent className="w-48 rounded-xl p-1" side="top" align="center" sideOffset={8} finalFocus={false}><nav className="flex flex-col" aria-label="手机导航">{items.map(({ label, ...item }) => <NavLink key={item.to} {...item} onClick={() => setOpen(false)} className={({ isActive }) => cn("rounded-lg px-3 py-1.5 text-base", isActive && "bg-accent")}>{label}</NavLink>)}</nav></PopoverContent>
    </Popover>
  </div>;
}

export function SiteShell({ children, member, catalog }: { children: ReactNode; member?: Member | null; catalog?: { works: SearchWork[]; stats: { series: number; seasons: number; episodes: number; movies: number } } | null }) {
  const theme = useTheme(), tone = useHeaderTone(), [searchOpen, setSearchOpen] = useState(false), { pathname } = useLocation();
  useHotkey("d", toggleTheme);
  useHotkey("k", () => setSearchOpen(open => !open), { mod: true, enabled: Boolean(member) });
  useHotkey("/", () => setSearchOpen(true), { enabled: Boolean(member) });
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const navigation = member ? [...mainNavigation, ...(member.role === "admin" ? [{ to: "/admin", label: "管理" }] : [])] : guestNavigation;
  const authPage = ["/login", "/register", "/forgot-password", "/reset-password", "/reset-password/complete", "/verify-email", "/verify-pending"].includes(pathname);
  return <TooltipProvider><div className="group/layout relative isolate content-frame has-data-[slot=auth-frame]:flex has-data-[slot=auth-frame]:min-h-svh has-data-[slot=auth-frame]:flex-col">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded focus:bg-background focus:p-3">跳到正文</a>
    <header className={cn("sticky top-0 z-50 max-w-screen overflow-x-clip bg-background px-2 text-foreground", tone !== "default" && "dark [--line:rgb(255_255_255/0.1)]", tone === "stage-top" && "bg-transparent", tone === "stage" && "bg-background/70 backdrop-blur-md")}>
      <div className={cn("screen-line-top screen-line-bottom mx-auto flex h-(--header-height) items-center gap-2 border-x pr-2 pl-4 after:z-1 sm:gap-4 md:max-w-(--content-width)", tone !== "default" && "border-white/10")}>
        <Link to="/" aria-label="首页"><SiteMark className="max-sm:hidden" /><SiteMark className="sm:hidden" compact /></Link><div className="flex-1" />
        <nav className={cn("flex items-center gap-4", member && "max-sm:hidden")} aria-label="主导航">{navigation.map(({ label, ...item }) => <NavLink key={item.to} {...item} className={({ isActive }) => cn("text-sm font-medium tracking-wide whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground", isActive && "text-foreground")}>{label}</NavLink>)}</nav>
        <div className="flex items-center">{member ? <><Separator orientation="vertical" className="mr-2 bg-line max-sm:hidden data-vertical:h-5 data-vertical:self-center" /><SearchTrigger onClick={() => setSearchOpen(true)} className="max-sm:hidden" /><Separator orientation="vertical" className="mx-2 bg-line max-sm:hidden data-vertical:h-5 data-vertical:self-center" /><UserMenu member={member} /><Separator orientation="vertical" className="mx-2 bg-line data-vertical:h-5 data-vertical:self-center" /></> : pathname !== "/login" && <><Separator orientation="vertical" className="mr-2 bg-line data-vertical:h-5 data-vertical:self-center" /><Button variant="secondary" size="sm" className="shadow-[inset_0_0_1px] shadow-foreground/20" nativeButton={false} render={<Link to="/login" />}>登录</Button><Separator orientation="vertical" className="mx-2 bg-line data-vertical:h-5 data-vertical:self-center" /></>}
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="border-none" aria-label="切换深浅色" onClick={toggleTheme}>{theme === "dark" ? <SunMediumIcon /> : <MoonStarIcon />}</Button>} /><TooltipContent className="flex items-center gap-2 pr-2 pl-3">切换深浅色<Kbd>D</Kbd></TooltipContent></Tooltip>
        </div>
      </div>
    </header>
    <main id="main-content" className="max-w-screen overflow-x-clip px-2 group-has-data-[slot=auth-frame]/layout:flex group-has-data-[slot=auth-frame]/layout:flex-1 group-has-data-[slot=auth-frame]/layout:flex-col">{children}</main>
    <SiteFooter stats={member && !authPage ? catalog?.stats : undefined} />
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40" aria-hidden><div className="h-(--fade-bottom-height) bg-linear-to-b from-transparent to-background mask-linear-[to_top,var(--background)_25%,transparent] backdrop-blur-[1px]" /><div className="bg-background pb-[env(safe-area-inset-bottom,0px)]" /><BottomRuler /></div>
    {member && <><BottomNav member={member} onSearch={() => setSearchOpen(true)} /><CommandMenu open={searchOpen} onOpenChange={setSearchOpen} works={catalog?.works ?? []} /></>}
    <ScrollToTop />
  </div></TooltipProvider>;
}
