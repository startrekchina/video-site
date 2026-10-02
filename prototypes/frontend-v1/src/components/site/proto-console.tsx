import { useState } from "react"
import { FlaskConicalIcon, XIcon } from "lucide-react"
import { useLocation, useNavigate } from "react-router"

import { actions, useStore, type Scenario } from "@/data/store"
import { cn } from "@/lib/utils"

const SCENARIOS: { key: Scenario; label: string; home: string }[] = [
  { key: "guest", label: "访客（未登录）", home: "/" },
  { key: "new-member", label: "新成员（空数据）", home: "/" },
  { key: "member", label: "成员 picard_fan", home: "/" },
  { key: "admin", label: "管理员 station_keeper", home: "/admin" },
]

const PAGES: { to: string; label: string }[] = [
  { to: "/about", label: "关于" },
  { to: "/login", label: "登录" },
  { to: "/register?code=Q-CONT-INUM-01", label: "注册（有效码）" },
  { to: "/register?code=BORG-X0X0-7777", label: "注册（过期码）" },
  { to: "/recover", label: "恢复码找回" },
  { to: "/reset/demo-token", label: "重置链接" },
  { to: "/", label: "首页" },
  { to: "/title/star-trek-the-next-generation?season=3", label: "剧集页 TNG" },
  { to: "/title/star-trek-section-31", label: "电影页（缺中文简介）" },
  { to: "/watch/tng-s03e26", label: "播放 TNG S03E26" },
  { to: "/library", label: "收藏与片单" },
  { to: "/playlists/p1", label: "片单详情" },
  { to: "/invites", label: "邀请" },
  { to: "/account", label: "账号与安全" },
  { to: "/admin", label: "管理后台" },
  { to: "/nope", label: "404" },
]

/**
 * Prototype-only control panel. Deliberately styled unlike the site (inverted, high-contrast)
 * so it is never mistaken for part of the design under review.
 */
export function ProtoConsole() {
  const [open, setOpen] = useState(false)
  const scenario = useStore((s) => s.scenario)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  if (import.meta.env.PROD && !import.meta.env.VITE_PROTO_CONSOLE) return null

  return (
    <div className="fixed top-[calc(var(--header-height)+--spacing(2))] left-3 z-[60] font-mono text-xs">
      {open ? (
        <div className="w-72 rounded-lg bg-amber-300 p-3 text-zinc-950 shadow-xl ring-2 ring-zinc-950">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold tracking-wider uppercase">Prototype console</span>
            <button className="rounded p-0.5 hover:bg-zinc-950/10" onClick={() => setOpen(false)} aria-label="关闭原型控制台">
              <XIcon className="size-4" />
            </button>
          </div>
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">身份场景（重置内存数据）</div>
          <div className="mb-3 grid gap-1">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                className={cn("rounded px-2 py-1 text-left hover:bg-zinc-950/10", scenario === s.key && "bg-zinc-950 text-amber-300 hover:bg-zinc-950")}
                onClick={() => {
                  actions.setScenario(s.key)
                  navigate(s.home)
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">跳转页面</div>
          <div className="grid max-h-56 gap-0.5 overflow-y-auto">
            {PAGES.map((p) => (
              <button
                key={p.to}
                className={cn("truncate rounded px-2 py-0.5 text-left hover:bg-zinc-950/10", pathname === p.to.split("?")[0] && "underline")}
                onClick={() => navigate(p.to)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 border-t border-zinc-950/20 pt-2 text-[11px] opacity-70">数据只在内存中，刷新即重置。人物均为虚构。</div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-amber-300 px-3 py-1.5 font-bold text-zinc-950 shadow-lg ring-2 ring-zinc-950"
          aria-label="打开原型控制台"
        >
          <FlaskConicalIcon className="size-3.5" />
          PROTO
        </button>
      )}
    </div>
  )
}
