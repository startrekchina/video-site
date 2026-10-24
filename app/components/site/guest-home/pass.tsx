import { useState } from "react"
import { ArrowRightIcon, FingerprintIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { cn } from "@/lib/utils"
import { SiteMark } from "@/components/site/site-mark"
import { Button } from "@/components/ui/button"

import { bars, usePasskeySignIn } from "./guide"

// The landing's first screen below md (登舰证): a boarding pass laid out like a real one (main part,
// perforation, stub) is the invite form itself; members get one quiet line beneath it.

const FIELDS = [
  ["目的地", "星际舰队档案馆"],
  ["舱位", "成员"],
  ["邮箱", "需验证"],
  ["邀请人", "核验后显示"],
] as const

export function BoardingPass({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [code, setCode] = useState("")
  const normalized = code.trim()
  const passkey = usePasskeySignIn()
  return (
    <section aria-labelledby="pass-title" className={cn("dot-grid screen-line-bottom px-3 py-12 sm:px-6 md:py-16", className)}>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h1 id="pass-title" className="text-4xl font-medium tracking-tight sm:text-5xl">
          欢迎登舰。
        </h1>
        <p className="mt-4 text-base/relaxed text-balance text-muted-foreground">
          把邀请码填进登舰证，两分钟完成注册。
        </p>
      </div>

      {/* The register page checks the code, so it goes on as typed. */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          navigate(normalized ? `/register?code=${encodeURIComponent(normalized)}` : "/register")
        }}
        className="mx-auto mt-10 grid max-w-3xl rounded-xl border bg-card text-left shadow-sm md:grid-cols-[minmax(0,1fr)_13rem]"
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between px-5 py-3">
            <SiteMark />
            <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Boarding pass · 登舰证</span>
          </div>
          <label className="flex flex-col gap-1 border-t border-dashed px-5 py-4">
            <span className="text-xs text-muted-foreground">邀请码</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="输入邀请码"
              aria-label="邀请码"
              autoComplete="off"
              spellCheck={false}
              className="w-full border-b border-dashed border-foreground/30 bg-transparent py-1 font-mono text-2xl tracking-[0.2em] outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-muted-foreground/60 focus:border-solid focus:border-foreground"
            />
          </label>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-dashed px-5 py-4 font-mono text-sm sm:grid-cols-4">
            {FIELDS.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="font-sans text-xs text-muted-foreground">{k}</dt>
                <dd className={cn(v === "核验后显示" && "text-muted-foreground")}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* The stub, torn off along the perforation: a dashed rule with a notch at each end. */}
        <div className="relative flex flex-col gap-4 border-dashed px-5 py-4 max-md:border-t md:border-l">
          {/* Only the half of each notch inside the pass keeps a rim, so it reads as cut out of the edge. */}
          <span className="absolute -top-px -left-px size-4 -translate-1/2 rounded-full border-b bg-background max-md:hidden" />
          <span className="absolute -bottom-px -left-px size-4 -translate-x-1/2 translate-y-1/2 rounded-full border-t bg-background max-md:hidden" />
          <span className="absolute -top-px -left-px size-4 -translate-1/2 rounded-full border-r bg-background md:hidden" />
          <span className="absolute -top-px -right-px size-4 translate-x-1/2 -translate-y-1/2 rounded-full border-l bg-background md:hidden" />
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Stub · 存根</span>
          <div aria-hidden className={cn("flex h-14 items-stretch gap-0.5 transition-opacity md:mt-auto", !normalized && "opacity-30")}>
            {bars(normalized).map((w, i) => (
              <span key={i} className="bg-foreground" style={{ flexGrow: w }} />
            ))}
          </div>
          <Button type="submit" size="lg" className="w-full">
            登舰
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        已经是成员？
        <Button variant="secondary" size="sm" disabled={passkey.busy} onClick={passkey.signIn}>
          <FingerprintIcon data-icon="inline-start" />
          通行密钥登录
        </Button>
        <Link to="/login" className="link-underline text-foreground">
          密码登录
        </Link>      </div>
    </section>
  )
}
