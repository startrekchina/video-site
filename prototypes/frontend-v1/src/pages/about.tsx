import type React from "react"
import { ArrowRightIcon } from "lucide-react"
import { Link } from "react-router"

import { useStore } from "@/data/store"
import { useActiveSection } from "@/lib/use-active-section"
import { cn } from "@/lib/utils"
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { LineNav } from "@/components/ui/line-nav"
import { Tag } from "@/components/ui/tag"

// Public page, reachable signed in or out. Describes the site and its rules; never the catalogue.

const SECTIONS = [
  { title: "这是什么", href: "#what" },
  { title: "怎么加入", href: "#join" },
  { title: "成员守则", href: "#rules" },
  { title: "隐私与数据", href: "#privacy" },
  { title: "找回账号", href: "#recovery" },
  { title: "版权说明", href: "#copyright" },
  { title: "技术说明", href: "#colophon" },
]

const KEPT = [
  { what: "用户名", why: "你自己设置。公开片单时，其他成员能看到作者的用户名。" },
  { what: "密码", why: "只保存加盐哈希，任何人都看不到原文。" },
  { what: "观看进度、收藏和片单", why: "用于续播和跨设备同步。片单默认私有。" },
  { what: "登录会话", why: "设备和大致位置。你可以在账号页查看，并退出不认识的会话。" },
  { what: "邀请关系", why: "谁邀请了你、你邀请了谁，管理员可见。" },
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <>
      <Separator />
      <Panel id={id} className="scroll-mt-16">
        <PanelHeader>
          <PanelTitle>{title}</PanelTitle>
        </PanelHeader>
        {children}
      </Panel>
    </>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 p-4 text-pretty text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{children}</div>
}

function Spec({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 bg-background px-4 py-3", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function AboutPage() {
  const me = useStore((s) => s.me)
  const active = useActiveSection(SECTIONS.map((s) => s.href.slice(1)))

  return (
    <Page narrow className="relative">
      <aside className="absolute inset-y-0 left-full hidden pl-8 xl:block" aria-label="本页导航">
        <div className="sticky top-24">
          <LineNav
            items={SECTIONS}
            activeHref={`#${active}`}
            scrollActiveIntoView={false}
            onItemClick={(item, e) => {
              e.preventDefault()
              document.getElementById(item.href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}
          />
        </div>
      </aside>

      <PageHeading>
        <PageHeadingTagline>关于</PageHeadingTagline>
        <PageHeadingTitle>一个邀请制的私人观看站。</PageHeadingTitle>
        <PageHeadingDescription>本站是什么、怎么加入、保存了你的哪些数据，以及账号出了问题怎么办。</PageHeadingDescription>
      </PageHeading>
      <div className="h-4" />

      <Section id="what" title="这是什么">
        <Prose>
          <p>
            星际舰队档案馆是一小群<strong>《星际迷航》中文粉丝</strong>的私人观看站，由站长利用业余时间维护。不营利，没有广告。
          </p>
          <p>
            它只对受邀成员开放：<strong>没有公开注册，也不被搜索引擎收录</strong>。登录之前，你能看到的只有这几页说明。
          </p>
        </Prose>
      </Section>

      <Section id="join" title="怎么加入">
        <Prose>
          <p>
            只能用<strong>已加入成员发出的邀请码</strong>注册。邀请码只能用一次，可能过期，也可能被邀请人作废。每位成员的邀请额度有限。
          </p>
          <p>本站没有申请入口，请不要通过其他渠道向站长索要邀请码。</p>
        </Prose>
        {!me && (
          <div className="screen-line-top flex justify-center py-4">
            <Button className="gap-2 pr-2.5 pl-3 shadow-[inset_0_0_1px] shadow-foreground/20" variant="secondary" size="sm" nativeButton={false} render={<Link to="/register" />}>
              我有邀请码
              <ArrowRightIcon />
            </Button>
          </div>
        )}
      </Section>

      <Section id="rules" title="成员守则">
        <ol className="divide-y divide-line">
          {[
            "账号只给自己用，不要借给别人。",
            "邀请只发给信得过的朋友。你邀请的人违反守则时，你也可能被连带处理。",
            "不要转发播放地址。地址很快失效，而且只对你自己的账号有效。",
            "违反守则的账号会被封禁，封禁后立即无法登录。",
          ].map((r, i) => (
            <li key={r} className="flex gap-4 p-4">
              <span className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-pretty">{r}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="privacy" title="隐私与数据">
        <dl className="divide-y divide-line">
          {KEPT.map((k) => (
            <div key={k.what} className="grid gap-1 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-medium">{k.what}</dt>
              <dd className="text-pretty text-muted-foreground">{k.why}</dd>
            </div>
          ))}
        </dl>
        <p className="screen-line-top p-4 text-pretty text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
          我们<strong>不收集</strong>邮箱、手机号和真实姓名，不使用第三方统计或广告。连续输错密码时会弹出 Cloudflare Turnstile 人机验证。数据库每天加密备份。
        </p>
      </Section>

      <Section id="recovery" title="找回账号">
        <ol className="divide-y divide-line">
          <li className="flex flex-col gap-1 p-4">
            <span className="font-medium">忘记密码</span>
            <span className="text-pretty text-muted-foreground">
              用注册时拿到的任意一个恢复码，自己重设密码。
              <Link to="/recover" className="link-underline ml-1 text-foreground">
                使用恢复码
              </Link>
            </span>
          </li>
          <li className="flex flex-col gap-1 p-4">
            <span className="font-medium">恢复码也丢了</span>
            <span className="text-pretty text-muted-foreground">请邀请你的人转告管理员。管理员会生成一个一次性重置链接，24 小时内有效。重置后，所有旧的登录会话都会失效。</span>
          </li>
        </ol>
      </Section>

      <Section id="copyright" title="版权说明">
        <Prose>
          <p>《星际迷航》（Star Trek）及相关名称、标识和海报的版权归 Paramount 及原权利人所有。本站是粉丝自行维护的非公开站点，与 Paramount 没有任何关联。</p>
          <p className="flex flex-wrap items-center gap-2">
            版权方联系方式：<span className="text-muted-foreground/70">站长待填</span>
            <Tag>待定</Tag>
          </p>
        </Prose>
      </Section>

      <Section id="colophon" title="技术说明">
        <dl className="grid grid-cols-2 gap-px bg-line font-mono">
          <Spec label="运行于">Cloudflare Workers</Spec>
          <Spec label="播放器">ArtPlayer</Spec>
          <Spec label="字幕">中文 / English · VTT</Spec>
          <Spec label="字体">Noto Sans SC · Geist Mono</Spec>
          <Spec label="剧集资料" className="col-span-2">
            <span className="font-sans text-muted-foreground">
              来自{" "}
              <a className="link-underline text-foreground" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">
                TMDB
              </a>
              。本站使用 TMDB API，但未获 TMDB 认可或认证。
            </span>
          </Spec>
        </dl>
      </Section>
    </Page>
  )
}
