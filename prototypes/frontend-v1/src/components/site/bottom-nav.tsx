import { useState } from "react"
import { NavLink } from "react-router"

import { useStore } from "@/data/store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"

import { CommandMenuTrigger } from "./command-menu"

const ITEMS = [
  { to: "/", label: "首页", end: true },
  { to: "/series", label: "剧集" },
  { to: "/movies", label: "电影" },
  { to: "/library", label: "我的片库" },
  { to: "/invites", label: "邀请" },
  { to: "/account", label: "账号与安全" },
]

function MenuTrigger(props: Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <Button
      className="group relative flex touch-manipulation flex-col gap-1 border-none before:absolute before:-inset-x-2 before:-top-8 before:-bottom-1 active:scale-none aria-expanded:bg-accent"
      variant="ghost"
      size="icon-sm"
      aria-label="菜单"
      {...props}
    >
      <span className="flex h-0.5 w-4 rounded-[1px] bg-foreground transition-transform group-data-popup-open:translate-y-0.75 group-data-popup-open:rotate-45" />
      <span className="flex h-0.5 w-4 rounded-[1px] bg-foreground transition-transform group-data-popup-open:-translate-y-0.75 group-data-popup-open:-rotate-45" />
    </Button>
  )
}

/** Floating mobile pill (search + menu popover), after chanhdai.com's SiteBottomNav. */
export function BottomNav() {
  const me = useStore((s) => s.me)
  const [open, setOpen] = useState(false)
  if (!me) return null
  const items = me.role === "admin" ? [...ITEMS, { to: "/admin", label: "管理后台" }] : ITEMS
  return (
    <div className="fixed bottom-[calc(--spacing(2)+env(safe-area-inset-bottom,0px))] left-1/2 z-50 flex w-fit -translate-x-1/2 items-center rounded-xl bg-popover py-1 pr-1 pl-2.5 shadow-md ring ring-foreground/10 sm:hidden dark:ring-foreground/20">
      <CommandMenuTrigger className="h-8 min-w-20 gap-2 rounded-none bg-transparent px-0 inset-ring-0 hover:bg-transparent active:scale-none dark:bg-transparent dark:hover:bg-transparent" />
      <Separator orientation="vertical" className="mr-1 ml-2.5 data-vertical:h-6 data-vertical:self-center" />
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger render={<MenuTrigger />} />
        <PopoverContent className="w-48 rounded-xl p-1" side="top" align="center" sideOffset={8} finalFocus={false}>
          <nav className="flex flex-col">
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) => cn("rounded-lg px-3 py-1.5 text-base", isActive && "bg-accent")}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </PopoverContent>
      </Popover>
    </div>
  )
}
