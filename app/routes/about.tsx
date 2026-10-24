import type React from "react"
import { ArrowRightIcon } from "lucide-react"
import { Link, useRouteLoaderData } from "react-router"
import type { SimpleIcon } from "simple-icons"
import { siBaseui, siBetterauth, siCloudflare, siGithubactions, siLucide, siPnpm, siReact, siReactrouter, siTailwindcss, siTypescript, siVite, siVitest } from "simple-icons"
import type { loader as rootLoader } from "@/root"

import { useActiveSection } from "@/lib/use-active-section"
import { pageTitle } from "@/lib/site"
import { Page, PageHeading, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { Field } from "@/components/site/site-footer"
import { Button } from "@/components/ui/button"
import { LineNav } from "@/components/ui/line-nav"

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
  { what: "用户名", why: "注册时由你自己设置，之后不能修改。其他成员会在评论、公开片单和邀请记录中看到它。" },
  { what: "注册邮箱", why: "用于验证邮箱、找回密码和接收账号安全提醒，不会向其他成员公开。" },
  { what: "密码", why: "经不可逆处理后保存，包括站长在内，任何人都看不到原文。" },
  { what: "观看进度、收藏和片单", why: "用于续播和跨设备同步。片单默认私有。" },
  { what: "登录设备", why: "包括设备信息、登录 IP 和最近活跃时间。你可以在账号页查看已登录的设备，并退出不认识的设备。" },
  { what: "邀请关系", why: "你可以查看自己发出的邀请，管理员可查看邀请关系。" },
]

const REPO = "https://github.com/startrekchina/video-site"

// Monochrome marks from Simple Icons (CC0).
const STACK_LOGOS: [name: string, url: string, icon: SimpleIcon][] = [
  ["TypeScript", "https://www.typescriptlang.org", siTypescript],
  ["React", "https://react.dev", siReact],
  ["React Router", "https://reactrouter.com", siReactrouter],
  ["Base UI", "https://base-ui.com", siBaseui],
  ["Tailwind CSS", "https://tailwindcss.com", siTailwindcss],
  ["Lucide", "https://lucide.dev", siLucide],
  ["Vite", "https://vite.dev", siVite],
  ["Vitest", "https://vitest.dev", siVitest],
  ["pnpm", "https://pnpm.io", siPnpm],
  ["GitHub Actions", "https://github.com/features/actions", siGithubactions],
  ["Workers", "https://developers.cloudflare.com/workers/", siCloudflare],
  ["D1", "https://developers.cloudflare.com/d1/", siCloudflare],
  ["R2", "https://developers.cloudflare.com/r2/", siCloudflare],
  ["Turnstile", "https://developers.cloudflare.com/turnstile/", siCloudflare],
  ["Better Auth", "https://better-auth.com", siBetterauth],
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Panel id={id} className="scroll-mt-16">
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
      </PanelHeader>
      {children}
    </Panel>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 p-4 text-pretty text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{children}</div>
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="link-underline" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/** What the project is built with; per-build facts belong to the footer's title block. */
function ProjectColophon() {
  return (
    <>
      <dl className="grid grid-cols-2 gap-px bg-line font-mono md:grid-cols-4">
        <Field label="维护">
          <ExternalLink href="https://github.com/narwhrl">@narwhrl</ExternalLink>
        </Field>
        <Field label="源代码">
          <ExternalLink href={REPO}>GitHub</ExternalLink>
        </Field>
        <Field label="许可证">
          <ExternalLink href={`${REPO}/blob/main/LICENSE`}>MIT License</ExternalLink>
        </Field>
        <Field label="播放器">
          <ExternalLink href="https://artplayer.org">ArtPlayer</ExternalLink>
        </Field>
      </dl>
      {/* The cells cover a rule drawn inside the dl, so the spacer below draws it, as in the footer. */}
      <div className="screen-line-top h-4" />
      {/* Logo wall after chanhdai.com/sponsors: guides behind the grid draw unbroken column rules, each row's first cell draws its full-bleed rules.
          With two columns the 15th cell leaves a blank slot that the guides still frame. */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 -z-1 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="border-r border-line" />
          <div className="border-l border-line sm:border-x" />
          <div className="border-l border-line max-sm:hidden" />
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {STACK_LOGOS.map(([name, url, icon]) => (
            <li
              key={name}
              className="max-sm:nth-[2n+1]:screen-line-top max-sm:nth-[2n+1]:screen-line-bottom sm:nth-[3n+1]:screen-line-top sm:nth-[3n+1]:screen-line-bottom"
            >
              <a
                className="flex min-h-15 items-center justify-center gap-2 px-3 text-[15px] font-semibold tracking-tight whitespace-nowrap transition-[background-color] ease-out hover:bg-accent-muted sm:text-base"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg className="size-5 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden>
                  <path d={icon.path} />
                </svg>
                {!name.startsWith(icon.title) && <span className="sr-only">{icon.title} </span>}
                {name}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

export function meta() {
  return pageTitle("关于")
}

export default function AboutPage() {
  const member = useRouteLoaderData<typeof rootLoader>("root")?.member
  const active = useActiveSection(SECTIONS.map((s) => s.href.slice(1)))

  return (
    <Page narrow className="relative">
      <aside className="absolute inset-y-0 left-full hidden pl-8 xl:block" aria-label="本页导航">
        <div className="sticky top-24">
          <LineNav
            items={SECTIONS}
            activeHref={`#${active}`}
          />
        </div>
      </aside>

      <PageHeading>
        <PageHeadingTagline>关于</PageHeadingTagline>
        <PageHeadingTitle>认识星际舰队档案馆.</PageHeadingTitle>
      </PageHeading>
      <div className="h-4" />

      <Section id="what" title="这是什么">
        <Prose>
          <p>
            本站是旨在为《星际迷航》系列粉丝提供服务的私人观看站，由站长利用业余时间维护。不营利，没有广告。
          </p>
          <p>
            本站只对受邀成员开放：<strong>没有公开注册，也不会被搜索引擎收录</strong>。登录之前，你能看到的只有这几页说明。
          </p>
        </Prose>
      </Section>

      <Separator />

      <Section id="join" title="怎么加入">
        <Prose>
          <p>
            只能凭<strong>已加入成员发出的邀请码</strong>注册。邀请码只能使用一次，可能过期，也可能被邀请人作废；每位成员的邀请额度有限。
          </p>
          <p>注册时需要填写邮箱并完成验证。本站没有申请入口，请不要通过其他渠道向站长索要邀请码。</p>
        </Prose>
          {!member && <div className="screen-line-top flex justify-center py-4">
            <Button className="gap-2 pr-2.5 pl-3 shadow-[inset_0_0_1px] shadow-foreground/20" variant="secondary" size="sm" nativeButton={false} render={<Link to="/register" />}>
              我有邀请码
              <ArrowRightIcon />
            </Button>
          </div>}
      </Section>

      <Separator />

      <Section id="rules" title="成员守则">
        <ol className="divide-y divide-line">
          {[
            "账号仅限本人使用，不要外借。",
            "邀请码只发给信得过的朋友。若成员严重违规，其账号以及经他直接或间接邀请加入的成员账号可能一并被封禁。",
            "不要把站内视频转发或分享到站外。",
            "违反守则的账号会被封禁，封禁后立即无法登录。",
          ].map((r, i) => (
            <li key={r} className="flex gap-4 p-4">
              <span className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-pretty">{r}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Separator />

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
          本站<strong>不收集</strong>手机号和真实姓名，也不接入第三方统计或广告。注册、密码登录、申请验证邮件和邮箱找回均设有人机验证与频率限制。数据库备份在存出站外之前会先加密。
        </p>
      </Section>

      <Separator />

      <Section id="recovery" title="找回账号">
        <ol className="divide-y divide-line">
          <li className="flex flex-col gap-1 p-4">
            <span className="font-medium">忘记密码：通过注册邮箱找回</span>
            <span className="text-pretty text-muted-foreground">
              向注册邮箱申请重设链接，1 小时内有效。重设成功后，所有设备都会退出登录；通行密钥、验证器和未使用的备用码不受影响。已开启二步验证的账号，登录时仍需输入动态验证码或备用码。
              <Link to="/forgot-password" className="link-underline ml-1 text-foreground">邮箱找回密码</Link>
            </span>
          </li>
          <li className="flex flex-col gap-1 p-4">
            <span className="font-medium">遗失验证器</span>
            <span className="text-pretty text-muted-foreground">开启二步验证时请妥善保存备用码。遗失验证器后，可以用正确密码加一个未使用的备用码登录；每个备用码只能使用一次，且不能用于重设密码。已添加的通行密钥也可用于登录。</span>
          </li>
          <li className="flex flex-col gap-1 p-4">
            <span className="font-medium">无法找回的情况</span>
            <span className="text-pretty text-muted-foreground">在没有可用通行密钥的前提下，如果验证器和全部备用码都已遗失，或者忘记密码且无法访问注册邮箱，账号将无法找回，管理员也无法替你重设。请妥善保存备用码，并建议添加一个通行密钥。</span>
          </li>
        </ol>
      </Section>

      <Separator />

      <Section id="copyright" title="版权说明">
        <Prose>
          <p>《星际迷航》（Star Trek）及相关名称、标识和海报的版权归 Paramount 及原权利人所有。本站是粉丝自行维护的非公开站点，与 Paramount 没有任何关联。</p>
          <p>作品资料与海报来自 TMDB。本站使用 TMDB API，但未获得 TMDB 的认可或认证。</p>
          <p className="flex flex-wrap items-center gap-2">
            下架请求请联系站长：<a href="mailto:contact@startrekchina.org" className="link-underline font-mono text-foreground">contact@startrekchina.org</a>
          </p>
        </Prose>
      </Section>

      <Separator />

      <Section id="colophon" title="技术说明">
        <ProjectColophon />
      </Section>
    </Page>
  )
}
