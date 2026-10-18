import type React from "react"
import { useEffect, useState } from "react"
import { Link } from "react-router"

import { cn } from "@/lib/utils"
import { ThemeSwitcher } from "@/components/ui/theme-switcher"

import { dependencies } from "../../../package.json"
import { SiteMark } from "./site-mark"

const REPO = "https://github.com/startrekchina/video-site"
const STACK = ["react-router", "react", "@base-ui/react"] as const

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1 bg-background px-4 py-3", className)}>
      <dt className="font-sans text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm wrap-anywhere">{children}</dd>
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="link-underline" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

// Cloudflare stamps every response with "<ray id>-<edge colo>", e.g. "a4c64beabe4d8478-HKG"; the dev server sends none.
// shortcut: the static prototype reads it from a HEAD probe, not from the page's own response; a server loader can read the request's own.
let rayProbe: Promise<string | null> | undefined

function EdgeFields() {
  const [ray, setRay] = useState<string | null>(null)
  useEffect(() => {
    rayProbe ??= fetch("/", { method: "HEAD", cache: "no-store" }).then((res) => res.headers.get("cf-ray"), () => null)
    rayProbe.then(setRay)
  }, [])
  const [id, colo] = ray?.split("-") ?? []
  return (
    <>
      <Field label="边缘节点">{colo ?? "—"}</Field>
      <Field label="请求 ID">{id ?? "—"}</Field>
    </>
  )
}

/** Footer laid out as the title block of a technical drawing, after chanhdai.com. */
export function SiteFooter({ minimal }: { minimal?: boolean }) {
  return (
    <footer className="max-w-screen overflow-x-clip px-2">
      <div className="mx-auto border-x md:max-w-(--content-width)">
        <div className="screen-line-top screen-line-bottom before:-top-px before:z-1">
          <div className="stripe-divider h-12" />
        </div>

        {!minimal && (
          <>
            <div className="screen-line-bottom flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 font-mono text-sm">
              <span className="font-medium">video.startrekchina.org</span>
              <span className="font-sans text-muted-foreground">星际舰队档案馆</span>
            </div>

            <dl className="grid grid-cols-2 gap-px bg-line font-mono md:grid-cols-4">
              <Field label="维护">
                <ExternalLink href="https://github.com/narwhrl">@narwhrl</ExternalLink>
              </Field>
              <Field label="构建">
                <ExternalLink href={`${REPO}/commit/${__BUILD_INFO__.commit}`}>{__BUILD_INFO__.commit.slice(0, 7)}</ExternalLink>
              </Field>
              <EdgeFields />
              <Field label="部署于">Cloudflare Workers</Field>
              <Field label="源代码">
                <ExternalLink href={REPO}>GitHub</ExternalLink>
              </Field>
              <Field label="许可证">
                <ExternalLink href={`${REPO}/blob/main/LICENSE`}>MIT License</ExternalLink>
              </Field>
              <Field label="数据库">Cloudflare D1</Field>
              <Field className="col-span-2" label="技术栈">
                <ul className="flex flex-col gap-0.5">
                  {STACK.map((name) => (
                    <li key={name}>
                      {name}@{dependencies[name]}
                    </li>
                  ))}
                </ul>
              </Field>
              <Field label="字体">
                <ul className="flex flex-col gap-0.5">
                  <li>Noto Sans SC</li>
                  <li>Geist Mono</li>
                </ul>
              </Field>
              <Field label="资料来源">
                <ExternalLink href="https://www.themoviedb.org">TMDB</ExternalLink>
              </Field>
              <Field className="col-span-2 md:col-span-4" label="版权说明">
                <span className="font-sans text-muted-foreground">
                  《星际迷航》及相关海报版权归 Paramount 及原权利人所有。作品资料与海报来自 TMDB，本站使用 TMDB API，但未获 TMDB
                  认可或认证。本站仅对受邀成员开放，不被搜索引擎收录。
                </span>
              </Field>
            </dl>
          </>
        )}

        <div className={cn("h-4", !minimal && "screen-line-top")} />

        <div className="screen-line-top screen-line-bottom flex items-center gap-3 px-4 py-3 text-muted-foreground">
          <Link to="/" className="mr-auto transition-[color] hover:text-foreground" aria-label="首页">
            <SiteMark compact />
          </Link>
          {/* Guests already reach /about from the header nav; members have no about nav, so they keep it. */}
          {!minimal && (
            <Link to="/about" className="text-sm transition-[color] hover:text-foreground">
              关于
            </Link>
          )}
          <ThemeSwitcher />
        </div>
      </div>
      <div className="h-[calc(var(--fade-bottom-height)+env(safe-area-inset-bottom,0px))]" />
    </footer>
  )
}
