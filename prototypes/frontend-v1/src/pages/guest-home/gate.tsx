import { useMemo } from "react"
import { ArrowRightIcon, TicketIcon } from "lucide-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"

// Variant A (舱门): one screen with the brand and two doors (sign in, register with a code).
// Says nothing about the catalogue; /about carries the rest. Follows the site theme: a starfield
// in dark mode, the same marks as faint pencil dots and drafting lines on light paper.

function Starfield() {
  const stars = useMemo(() => {
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    return Array.from({ length: 120 }, () => ({
      x: rnd() * 100,
      y: rnd() * 100,
      size: rnd() < 0.88 ? 1 : 2,
      opacity: 0.2 + rnd() * 0.6,
      twinkle: rnd() < 0.15,
      delay: rnd() * 4,
      duration: 2 + rnd() * 3,
    }))
  }, [])

  return (
    // --star dims the dots on light paper, where full-strength black specks read as dust.
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-1 [--star:0.45] dark:[--star:1]">
      {stars.map((s, i) => (
        <span
          key={i}
          className={s.twinkle ? "absolute rounded-full bg-foreground motion-safe:animate-pulse" : "absolute rounded-full bg-foreground"}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            opacity: `calc(var(--star) * ${s.opacity})`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}
      {/* Drafting reticle behind the wordmark, in the site's line-drawing idiom. */}
      <svg className="absolute top-1/2 left-1/2 size-[44rem] max-w-none -translate-x-1/2 -translate-y-1/2 text-foreground/15 dark:text-foreground/[0.07]" viewBox="0 0 400 400" fill="none" stroke="currentColor" strokeWidth="0.5">
        <circle cx="200" cy="200" r="190" />
        <circle cx="200" cy="200" r="130" strokeDasharray="2 4" />
        <circle cx="200" cy="200" r="70" />
        <path d="M200 0v400M0 200h400" strokeDasharray="1 6" />
        {Array.from({ length: 72 }, (_, i) => {
          const a = (i * 5 * Math.PI) / 180
          const r1 = i % 6 === 0 ? 180 : 185
          return <line key={i} x1={200 + Math.cos(a) * r1} y1={200 + Math.sin(a) * r1} x2={200 + Math.cos(a) * 190} y2={200 + Math.sin(a) * 190} />
        })}
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_45%,transparent_0%,var(--background)_100%)]" />
    </div>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="text-[11px] tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-xs sm:text-sm">{children}</dd>
    </div>
  )
}

export function GuestGate() {
  return (
    <section aria-labelledby="gate-title" className="relative isolate -mx-2 overflow-hidden">
      <Starfield />
      {/* Ends above the layout's bottom fade so the title-block row is never washed out. */}
      <div className="mx-auto flex min-h-[calc(100svh-var(--header-height)-var(--fade-bottom-height))] w-[calc(100%-1rem)] flex-col border-x md:max-w-(--content-width)">
        <div className="flex justify-between px-4 pt-4 font-mono text-[11px] tracking-wider text-muted-foreground/70 uppercase">
          <span>Fig. 01 · 入口</span>
          <span>Access · Invite only</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <img src="/logo.png" alt="" className="size-14 rounded-2xl shadow-lg ring-1 shadow-black/10 ring-foreground/10 select-none dark:shadow-2xl dark:shadow-black/60" draggable={false} />
          <h1 id="gate-title" className="mt-8 text-4xl font-medium tracking-tight sm:text-6xl">
            星际舰队档案馆
          </h1>
          <div className="mt-3 font-mono text-xs tracking-[0.35em] text-muted-foreground uppercase">Starfleet Archive</div>
          <p className="mt-6 max-w-md text-base/relaxed text-balance text-muted-foreground">《星际迷航》中文粉丝的私人观看站，仅对受邀成员开放。</p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" className="h-11 min-w-28 px-5 text-base" nativeButton={false} render={<Link to="/login" />}>
              登录
            </Button>
            <Button size="lg" variant="outline" className="h-11 px-5 text-base" nativeButton={false} render={<Link to="/register" />}>
              <TicketIcon data-icon="inline-start" />
              我有邀请码
            </Button>
          </div>

          <p className="mt-8 flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <span className="text-balance">没有邀请码？本站不开放申请，只能由已加入的朋友邀请。</span>
            <Link to="/about" className="inline-flex items-center gap-0.5 text-foreground/80 transition-colors hover:text-foreground">
              关于本站
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </p>
        </div>

        <dl className="screen-line-top grid grid-cols-3 divide-x divide-line font-mono">
          <Cell label="访问">仅限受邀成员</Cell>
          <Cell label="注册">凭邀请码</Cell>
          <Cell label="搜索引擎">不收录</Cell>
        </dl>
      </div>
    </section>
  )
}
