import type React from "react"
import { Link } from "react-router"

import { EPISODE_TOTAL, MOVIES, SEASON_TOTAL, SERIES } from "@/data/catalog"
import { cn } from "@/lib/utils"
import { ThemeSwitcher } from "@/components/ui/theme-switcher"

import { SiteMark } from "./site-mark"

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1 bg-background px-4 py-3", className)}>
      <dt className="font-sans text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/** Footer laid out as the title block of a technical drawing, after chanhdai.com. */
export function SiteFooter({ minimal }: { minimal?: boolean }) {
  return (
    <footer className="max-w-screen overflow-x-clip px-2">
      <div className="mx-auto border-x md:max-w-(--content-width)">
        <div className="screen-line-top screen-line-bottom before:z-1">
          <div className="stripe-divider h-12" />
        </div>

        {!minimal && (
          <>
            <div className="screen-line-bottom flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 font-mono text-sm">
              <span className="font-medium">video.startrekchina.org</span>
              <span className="font-sans text-muted-foreground">星际迷航中国粉丝社区 · 邀请制私人档案馆</span>
            </div>

            <dl className="grid grid-cols-2 gap-px bg-line font-mono md:grid-cols-4">
              <Field label="剧集">{SERIES.length} 部 · {SEASON_TOTAL} 季</Field>
              <Field label="单集">约 {EPISODE_TOTAL} 集</Field>
              <Field label="电影">{MOVIES.length} 部</Field>
              <Field label="字幕">中文 / English · VTT</Field>
              <Field label="海报来源">
                <a className="link-underline" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">
                  TMDB
                </a>
              </Field>
              <Field label="运行于">Cloudflare Workers</Field>
              <Field label="播放器">ArtPlayer</Field>
              <Field label="字体">Noto Sans SC · Geist Mono</Field>
              <Field className="col-span-2 md:col-span-4" label="版权说明">
                <span className="font-sans text-muted-foreground">
                  《星际迷航》及相关海报版权归 Paramount 及原权利人所有。本站仅对受邀成员开放，不公开索引。
                </span>
              </Field>
            </dl>
          </>
        )}

        <div className="screen-line-top h-4" />

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
          <span className="font-mono text-xs max-sm:hidden">原型 · proto/frontend-v1</span>
          <ThemeSwitcher />
        </div>
      </div>
      <div className="h-[calc(var(--fade-bottom-height)+env(safe-area-inset-bottom,0px))]" />
    </footer>
  )
}
