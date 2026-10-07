import { useState } from "react"
import { ArrowRightIcon, ChevronDownIcon, ListVideoIcon, MonitorSmartphoneIcon, ShieldCheckIcon, SubtitlesIcon, TicketIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { cn } from "@/lib/utils"
import { Page, Panel, PanelFooterLink, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { SiteMark } from "@/components/site/site-mark"
import { Button } from "@/components/ui/button"
import { IconTile } from "@/components/ui/icon-tile"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"

// The landing page's narrow-screen layout: a long panel page aimed at someone holding an invite
// code. The primary affordance is the code field; below it, how joining works, what members get,
// rules and FAQ. Features are described, the catalogue is not.

const STEPS = [
  { title: "拿到邀请码", body: "向已加入的朋友索要。每位成员的邀请额度有限，邀请码只能用一次，过期作废。" },
  { title: "设置用户名和密码", body: "填写邮箱并完成验证。注册后可以绑定通行密钥，以后不用输密码。" },
  { title: "设置二步验证", body: "可在账号页开启二步验证并保存备用码。忘记密码时通过已验证邮箱找回。" },
]

const FEATURES = [
  { icon: <SubtitlesIcon />, title: "中英字幕随时切换", body: "中文、英文、关闭，播放时一键切换。" },
  { icon: <MonitorSmartphoneIcon />, title: "进度跨设备同步", body: "手机上看到一半，换到电脑上从同一处接着看。" },
  { icon: <ListVideoIcon />, title: "收藏和片单", body: "整理自己的片单，也可以公开给站内其他成员。" },
  { icon: <ShieldCheckIcon />, title: "账号安全", body: "通行密钥、二步验证和备用码，按需开启。" },
]

const RULES = [
  "账号只给自己用，不要借给别人。",
  "邀请只发给信得过的朋友。违规成员及其邀请的普通后代可能被连带封禁。",
  "不要转发播放地址。地址很快失效，而且只对你自己的账号有效。",
]

const FAQ = [
  { q: "怎么拿到邀请码？", a: "只能向已加入的成员索要。本站没有申请入口。" },
  { q: "需要提供邮箱或手机号吗？", a: "需要邮箱并完成验证，不需要手机号。" },
  { q: "忘记密码怎么办？", a: "通过已验证邮箱重设密码。二步验证仍须动态码或备用码；管理员不能代发重置链接。" },
  { q: "用什么设备看？", a: "电脑、手机、平板上的现代浏览器都可以，不需要安装 App。" },
]

/** Deterministic bar widths for the decorative barcode. */
function bars(seed: string) {
  const src = seed || "STARFLEET-ARCHIVE"
  return Array.from({ length: 42 }, (_, i) => ((src.charCodeAt(i % src.length) * (i + 7)) % 3) + 1)
}

function BoardingPass({ code }: { code: string }) {
  return (
    <div className="w-full max-w-xs rounded-xl border bg-card shadow-sm ring-1 ring-border/50 ring-offset-2 ring-offset-background dark:ring-line">
      <div className="flex items-center justify-between px-4 py-3">
        <SiteMark />
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Boarding pass</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-dashed px-4 py-4 font-mono text-sm">
        <div className="col-span-2 flex flex-col gap-0.5">
          <dt className="font-sans text-xs text-muted-foreground">邀请码</dt>
          <dd className={cn("truncate text-base tracking-wider", !code && "text-muted-foreground/50")}>{code || "———— ———— ——"}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-sans text-xs text-muted-foreground">身份</dt>
          <dd>成员</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-sans text-xs text-muted-foreground">邮箱</dt>
          <dd>需验证</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-sans text-xs text-muted-foreground">二步验证</dt>
          <dd>可开启</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-sans text-xs text-muted-foreground">邀请人</dt>
          <dd className="text-muted-foreground">核验后显示</dd>
        </div>
      </dl>
      <div className="relative border-t border-dashed">
        <span className="absolute top-0 -left-px size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-r bg-background" />
        <span className="absolute top-0 -right-px size-3 translate-x-1/2 -translate-y-1/2 rounded-full border-l bg-background" />
      </div>
      <div aria-hidden className={cn("flex h-12 items-stretch gap-0.5 px-4 py-3 transition-opacity", !code && "opacity-30")}>
        {bars(code).map((w, i) => (
          <span key={i} className="bg-foreground" style={{ flexGrow: w }} />
        ))}
      </div>
    </div>
  )
}

export function GuestGuide() {
  const navigate = useNavigate()
  const [code, setCode] = useState("")
  const normalized = code.trim()

  return (
    <Page className="pt-0">
      <section aria-labelledby="guide-title" className="screen-line-bottom grid md:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col justify-center px-4 py-12 sm:py-20">
          <div className="font-mono text-xs tracking-wider text-muted-foreground">邀请制 · 私人观看站</div>
          <h1 id="guide-title" className="mt-3 text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            欢迎登舰。
          </h1>
          <p className="mt-4 max-w-lg text-base/relaxed text-balance text-muted-foreground">
            星际舰队档案馆是《星际迷航》中文粉丝的私人观看站，只对受邀成员开放。手里有邀请码的话，两分钟就能完成注册。
          </p>
          <form
            className="mt-8 flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              navigate(normalized ? `/register?code=${encodeURIComponent(normalized)}` : "/register")
            }}
          >
            <InputGroup className="h-10 flex-1">
              <InputGroupAddon>
                <TicketIcon />
              </InputGroupAddon>
              <InputGroupInput
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="输入邀请码"
                aria-label="邀请码"
                autoComplete="off"
                spellCheck={false}
                className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
              />
            </InputGroup>
            <Button type="submit" size="lg">
              继续
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </form>
          <p className="mt-3 text-sm text-muted-foreground">
            已经是成员？
            <Link to="/login" className="link-underline text-foreground">
              登录
            </Link>
          </p>
        </div>
        <div className="dot-grid flex items-center justify-center border-line p-8 max-md:hidden md:border-l">
          <BoardingPass code={normalized} />
        </div>
      </section>

      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>加入只需三步</PanelTitle>
        </PanelHeader>
        <ol className="grid gap-px bg-line sm:grid-cols-3">
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
        <ul className="grid gap-px bg-line sm:grid-cols-2">
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
    </Page>
  )
}
