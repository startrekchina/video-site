import { ChevronDownIcon, ListVideoIcon, MonitorSmartphoneIcon, ShieldCheckIcon, SubtitlesIcon } from "lucide-react"

import { Panel, PanelFooterLink, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { IconTile } from "@/components/ui/icon-tile"

// The landing page's shared sections, aimed at someone holding an invite code: how joining works, what
// members get, rules and FAQ. Features are described, the catalogue is not.

const STEPS = [
  { title: "拿到邀请码", body: "向已加入的朋友索要。每位成员的邀请额度有限，邀请码只能用一次，过期作废。" },
  { title: "注册账号", body: "设置用户名和密码，填写常用邮箱。" },
  { title: "验证邮箱", body: "点击验证邮件里的链接后登录。之后可以在账号页添加通行密钥、开启二步验证。" },
]

const FEATURES = [
  { icon: <SubtitlesIcon />, title: "简繁字幕随时切换", body: "简中、简英、繁中、繁英，以各集已有的为准，播放时一键切换。" },
  { icon: <MonitorSmartphoneIcon />, title: "进度跨设备同步", body: "手机上看到一半，换到电脑上从同一处接着看。" },
  { icon: <ListVideoIcon />, title: "收藏和片单", body: "整理自己的片单，也可以公开给站内其他成员。" },
  { icon: <ShieldCheckIcon />, title: "账号安全", body: "通行密钥、二步验证和备用码，按需开启。" },
]

const RULES = [
  "账号只给自己用，不要借给别人。",
  "邀请只发给信得过的朋友。若成员严重违规，其账号以及经他直接或间接邀请加入的成员账号可能一同被封禁。",
  "不要把站内视频转发或分享到站外。",
]

const FAQ = [
  { q: "怎么拿到邀请码？", a: "只能向已加入的成员索要。本站没有申请入口。" },
  { q: "需要提供邮箱或手机号吗？", a: "需要邮箱并完成验证，不需要手机号。" },
  { q: "忘记密码怎么办？", a: "在登录页点「忘记密码？」，通过注册邮箱重设。开启了二步验证的，登录时仍需输入动态验证码或备用码。管理员无法代为重设密码。" },
  { q: "用什么设备看？", a: "电脑、手机、平板上的现代浏览器都可以，不需要安装 App。" },
]

/** Deterministic bar widths for the decorative barcode. */
export function bars(seed: string) {
  const src = seed || "STARFLEET-ARCHIVE"
  return Array.from({ length: 42 }, (_, i) => ((src.charCodeAt(i % src.length) * (i + 7)) % 3) + 1)
}

/** How joining works, what members get, rules and FAQ; shared by the landing page candidates. */
export function GuideSections() {
  return (
    <>
      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>加入只需三步</PanelTitle>
        </PanelHeader>
        {/* pb-px: the cells would cover the panel's bottom rule, so the grid's own line colour draws it. */}
        <ol className="grid gap-px bg-line pb-px sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-2 bg-background p-4">
              <span className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-medium">{s.title}</span>
              <span className="text-sm/relaxed text-muted-foreground">{s.body}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>成员可以</PanelTitle>
        </PanelHeader>
        <ul className="grid gap-px bg-line pb-px sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-4 bg-background p-4">
              <IconTile className="mt-0.5">{f.icon}</IconTile>
              <div className="flex flex-col gap-1">
                <span className="font-medium">{f.title}</span>
                <span className="text-sm/relaxed text-muted-foreground">{f.body}</span>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>守则</PanelTitle>
        </PanelHeader>
        <ol className="divide-y divide-line">
          {RULES.map((r, i) => (
            <li key={r} className="flex gap-4 p-4">
              <span className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-pretty">{r}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>常见问题</PanelTitle>
        </PanelHeader>
        <div className="divide-y divide-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 font-medium transition-[background-color] hover:bg-accent-muted [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 pb-4 text-sm/relaxed text-pretty text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
        <PanelFooterLink to="/about">关于本站</PanelFooterLink>
      </Panel>
    </>
  )
}
