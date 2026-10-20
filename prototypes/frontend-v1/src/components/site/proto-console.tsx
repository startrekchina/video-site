import { useState } from "react"
import { FlaskConicalIcon, XIcon } from "lucide-react"
import { useLocation, useNavigate } from "react-router"

import { actions, useStore, type Scenario } from "@/data/store"
import { cn } from "@/lib/utils"
import { ARTS, useArt } from "@/components/site/footer-art"
import { LANDINGS, useLanding } from "@/pages/guest-home/landing"
import { CHARTS, useChart } from "@/pages/guest-home/star-chart"

const SCENARIOS: { key: Scenario; label: string; home: string }[] = [
  { key: "guest", label: "访客（未登录）", home: "/" },
  { key: "new-member", label: "新成员（空数据）", home: "/" },
  { key: "member", label: "成员 picard_fan", home: "/" },
  { key: "admin", label: "管理员 station_keeper", home: "/admin" },
]

const PAGES: { to: string; label: string }[] = [
  { to: "/about", label: "关于" },
  { to: "/status", label: "公开看板" },
  { to: "/login", label: "登录" },
  { to: "/register?code=Q-CONT-INUM-01", label: "注册（有效码）" },
  { to: "/register?code=BORG-X0X0-7777", label: "注册（过期码）" },
  { to: "/verify-pending?delivery=accepted", label: "等待邮箱验证" },
  { to: "/verify-pending?delivery=failed", label: "验证邮件可能未发出" },
  { to: "/verify-email", label: "邮箱已验证" },
  { to: "/verify-email?error=invalid_token", label: "验证链接失效" },
  { to: "/forgot-password", label: "找回密码" },
  { to: "/reset-password?token=demo", label: "重设密码" },
  { to: "/reset-password?error=INVALID_TOKEN", label: "重设链接失效" },
  { to: "/reset-password/complete", label: "密码已重设" },
  { to: "/", label: "首页" },
  { to: "/search?q=voyager", label: "全站搜索" },
  { to: "/title/star-trek-the-next-generation?season=3", label: "剧集页 TNG" },
  { to: "/title/star-trek-section-31", label: "电影页（缺中文简介）" },
  { to: "/watch/tng-s03e26", label: "播放 TNG S03E26" },
  { to: "/watch/tng-s03e26#comments", label: "播放页评论区" },
  { to: "/watch/tng-s03e24#comments", label: "评论区（还没有讨论）" },
  { to: "/watch/movie-star-trek-ii-the-wrath-of-khan#comments", label: "评论区（电影）" },
  { to: "/library", label: "收藏与片单" },
  { to: "/playlists/p1", label: "片单详情" },
  { to: "/invites", label: "邀请" },
  { to: "/account", label: "账号与安全" },
  { to: "/welcome", label: "新成员欢迎页" },
  { to: "/admin", label: "管理后台" },
  { to: "/admin/backups", label: "数据备份" },
  { to: "/admin/library", label: "片库完整性" },
  { to: "/admin/backups?demo=invalid", label: "数据备份（渠道失效）" },
  { to: "/admin/backups?demo=empty", label: "数据备份（未配置、无记录）" },
  { to: "/nope", label: "404" },
]

const CONSOLE = !import.meta.env.PROD || Boolean(import.meta.env.VITE_PROTO_CONSOLE)
const BADGE = "flex items-center gap-1.5 rounded-lg bg-amber-300 px-3 py-1.5 font-bold text-zinc-950 shadow-lg ring-2 ring-zinc-950"

/**
 * Prototype marker and control panel. Deliberately styled unlike the site (inverted, high-contrast)
 * so it is never mistaken for part of the design under review. Builds without the console still
 * float the marker, so the public prototype is never taken for the real site.
 */
export function ProtoConsole() {
  const [open, setOpen] = useState(false)
  const scenario = useStore((s) => s.scenario)
  const maintenance = useStore((s) => s.maintenance)
  const art = useArt()
  const landing = useLanding()
  const chart = useChart()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="fixed top-[calc(var(--header-height)+--spacing(2))] left-3 z-[60] font-mono text-xs">
      {!CONSOLE ? (
        <div className={BADGE}>
          <FlaskConicalIcon className="size-3.5" />
          前端原型
        </div>
      ) : open ? (
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
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">访客首页（待选，切到访客场景）</div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {LANDINGS.map((l) => (
              <button
                key={l.key}
                className={cn("truncate rounded px-2 py-1 hover:bg-zinc-950/10", landing === l.key && "bg-zinc-950 text-amber-300 hover:bg-zinc-950")}
                onClick={() => {
                  actions.setScenario("guest")
                  navigate(`/?landing=${l.key}`)
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">星图（待选，宽屏）</div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {CHARTS.map((c) => (
              <button
                key={c.key}
                className={cn("truncate rounded px-2 py-1 hover:bg-zinc-950/10", chart === c.key && "bg-zinc-950 text-amber-300 hover:bg-zinc-950")}
                onClick={() => {
                  actions.setScenario("guest")
                  navigate(`/?landing=now&chart=${c.key}`)
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">页脚线稿（待选）</div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {ARTS.map((a) => (
              <button
                key={a.key}
                className={cn("rounded px-2 py-1 hover:bg-zinc-950/10", art === a.key && "bg-zinc-950 text-amber-300 hover:bg-zinc-950")}
                onClick={() => navigate({ search: `?art=${a.key}` })}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="mb-1 text-[11px] font-bold uppercase opacity-70">维护模式（站长以外都看到维护页）</div>
          <button
            className={cn("mb-3 w-full rounded px-2 py-1 text-left hover:bg-zinc-950/10", maintenance && "bg-zinc-950 text-amber-300 hover:bg-zinc-950")}
            onClick={() =>
              maintenance ? actions.endMaintenance() : actions.startMaintenance({ since: new Date().toISOString(), until: new Date(Date.now() + 2 * 3_600_000).toISOString(), note: "" })
            }
          >
            {maintenance ? "已开启，点击结束" : "开启（预计 2 小时）"}
          </button>
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
        <button onClick={() => setOpen(true)} className={BADGE} aria-label="前端原型，打开控制台">
          <FlaskConicalIcon className="size-3.5" />
          前端原型
        </button>
      )}
    </div>
  )
}
