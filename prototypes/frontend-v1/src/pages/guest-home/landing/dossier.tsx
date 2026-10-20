import type React from "react"
import { ArrowRightIcon, FingerprintIcon } from "lucide-react"
import { Link } from "react-router"

import { cn } from "@/lib/utils"
import { Page } from "@/components/site/panel"
import { Button } from "@/components/ui/button"

import { GuideSections } from "../guide"
import { useEntry } from "./entry"

// Candidate 卷宗: the site is an archive, so the first screen is one of its files: a typed dossier on a
// folder tab, stamped members-only, with its contents redacted and an access slip for both ways in.
// The redactions are bars of fixed widths; they stand for nothing.

/** A redaction bar, sized in em so it sits in a line of type. */
function Redact({ w }: { w: number }) {
  return <span aria-hidden className="inline-block h-[1.05em] translate-y-[0.18em] bg-foreground/85" style={{ width: `${w}em` }} />
}

function Stamp({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none -rotate-[8deg] rounded-md border-[3px] border-[#c8352b] p-0.5 text-[#c8352b] opacity-85 mix-blend-multiply dark:border-[#ef5a4f] dark:text-[#ef5a4f] dark:mix-blend-screen",
        className,
      )}
    >
      <div className="rounded-sm border border-current px-3 py-1.5 text-center">
        <div className="text-lg leading-tight font-semibold tracking-[0.3em]">仅限受邀</div>
        <div className="font-mono text-[10px] tracking-[0.35em]">MEMBERS ONLY</div>
      </div>
    </div>
  )
}

/** A numbered box of the access slip. */
function SlipBox({ n, title, className, children }: { n: string; title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-3 p-6 sm:px-10", className)}>
      <div className="flex items-baseline gap-2 font-mono text-xs text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-full border text-[10px]">{n}</span>
        {title}
      </div>
      {children}
    </div>
  )
}

export function DossierLanding() {
  const { code, setCode, submit, passkey } = useEntry()
  return (
    <Page className="pt-0">
      <section aria-labelledby="dossier-title" className="dot-grid screen-line-bottom px-3 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto max-w-3xl">
          <div className="ml-6 inline-flex rounded-t-lg border border-b-0 bg-card px-4 py-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            档案 · SFA-0001
          </div>
          <article className="relative -mt-px rounded-lg rounded-tl-none border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-dashed px-6 py-3 font-mono text-[11px] tracking-wider text-muted-foreground uppercase sm:px-10">
              <span>星际舰队档案馆 · Starfleet Archive</span>
              <span className="max-sm:hidden">第 1 页 · 共 1 页</span>
            </div>

            <div className="px-6 py-8 sm:px-10">
              <div className="font-mono text-xs text-muted-foreground">密级</div>
              <div className="mt-1 inline-flex border border-foreground px-2 py-0.5 font-mono text-sm">仅限受邀成员</div>
              <h1 id="dossier-title" className="mt-6 text-3xl font-medium tracking-tight sm:text-4xl">
                访问受限。
              </h1>
              <div className="mt-4 flex max-w-xl flex-col gap-2 font-mono text-sm/relaxed text-muted-foreground">
                <p className="text-foreground">本馆是《星际迷航》中文粉丝的私人观看站，只对受邀成员开放，不开放申请。</p>
                <p>
                  馆藏目录：<Redact w={9} /> <Redact w={5} /> <Redact w={11} />
                  <span className="sr-only">仅成员可见</span>
                </p>
                <p>
                  调阅记录：<Redact w={7} /> <Redact w={13} />
                  <span className="sr-only">仅成员可见</span>
                </p>
              </div>
            </div>
            <Stamp className="absolute top-20 right-6 sm:top-24 sm:right-12" />

            <div className="grid border-t border-dashed sm:grid-cols-2">
              <SlipBox n="1" title="调阅登记 · 新成员">
                <form onSubmit={submit} className="flex items-end gap-3">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">邀请码</span>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="XXXX-XXXX-XX"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full border-b border-dashed border-foreground/40 bg-transparent py-1.5 font-mono text-lg tracking-[0.15em] uppercase outline-none placeholder:text-muted-foreground/40 focus:border-solid focus:border-foreground"
                    />
                  </label>
                  <Button type="submit" size="icon" aria-label="提交登记">
                    <ArrowRightIcon />
                  </Button>
                </form>
              </SlipBox>
              <SlipBox n="2" title="持证成员" className="border-dashed max-sm:border-t sm:border-l">
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Button variant="secondary" onClick={passkey}>
                    <FingerprintIcon data-icon="inline-start" />
                    出示通行密钥
                  </Button>
                  <Link to="/login" className="link-underline text-sm">
                    密码登录
                  </Link>
                </div>
              </SlipBox>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-dashed px-6 py-3 font-mono text-[11px] text-muted-foreground sm:px-10">
              <span>本档案不被搜索引擎收录</span>
              <span>签发：站长</span>
            </div>
          </article>
        </div>
      </section>
      <GuideSections />
    </Page>
  )
}
