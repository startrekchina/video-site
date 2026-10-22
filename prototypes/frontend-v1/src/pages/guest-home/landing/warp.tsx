import { useEffect, useRef } from "react"
import { ArrowDownIcon, ArrowRightIcon, FingerprintIcon, TicketIcon } from "lucide-react"
import { Link } from "react-router"

import { useStageHeader } from "@/lib/header-tone"
import { useTheme } from "@/lib/theme"
import { Page } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { hash, mulberry32 } from "@/pages/watch-comments/data"

import { GuideSections } from "../guide"
import { ChannelKeys } from "./channels"
import { useEntry } from "./entry"

// Candidate 曲速: a cinematic first screen like the member home's theatre, a full-bleed stage with stars
// streaming past at cruising speed behind the name and both ways in. It follows the theme: in dark the
// stage is black under the transparent header with pale streaks; in light it is paper with black
// streaks and the header stays as on any page.

/** Stars streaming out from the centre; a still field when the system asks for reduced motion. */
function Starfield({ color, className }: { color: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext("2d")!
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches
    const rand = mulberry32(hash("warp"))
    const spawn = (z = rand()) => ({ x: rand() * 2 - 1, y: rand() * 2 - 1, z })
    const stars = Array.from({ length: 420 }, () => spawn())
    let w = 0
    let h = 0
    const draw = (dz: number) => {
      ctx.clearRect(0, 0, w, h)
      const f = Math.max(w, h) * 0.25
      for (const s of stars) {
        const z0 = s.z
        s.z -= dz
        if (s.z < 0.03) Object.assign(s, spawn(1))
        const at = (z: number) => [w / 2 + (s.x / z) * f, h / 2 + (s.y / z) * f]
        const [x1, y1] = at(s.z)
        // The trail runs back along the star's path, so near stars streak and far ones stay points.
        const [x0, y0] = at(Math.min(z0 + dz * 8, 1))
        ctx.globalAlpha = Math.min(1, (1 - s.z) * 1.3)
        ctx.lineWidth = 0.4 + (1 - s.z) * 1.6
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
      }
    }
    const resize = () => {
      const dpr = devicePixelRatio
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.strokeStyle = color
      ctx.lineCap = "round"
      draw(0)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    // Stop drawing once the stage scrolls out of view.
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(canvas)
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      if (visible) draw(Math.min(t - last, 50) * 0.00012)
      last = t
      raf = requestAnimationFrame(tick)
    }
    if (!still) raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
    }
  }, [color])
  return <canvas ref={ref} aria-hidden className={className} />
}

export function WarpLanding() {
  const { code, setCode, submit, passkey } = useEntry()
  const dark = useTheme() === "dark"
  const stage = useRef<HTMLElement>(null)
  const noStage = useRef<HTMLElement>(null)
  // The transparent stage header carries dark tokens, so only the dark stage takes it.
  useStageHeader(dark ? stage : noStage)
  return (
    <>
      <section
        ref={stage}
        aria-labelledby="warp-title"
        className="screen-line-bottom relative isolate -mx-2 -mt-(--header-height) flex min-h-[min(100svh,54rem)] flex-col overflow-hidden bg-background text-foreground dark:bg-black"
      >
        <Starfield color={dark ? "#dce6ff" : "#18181b"} className="absolute inset-0 -z-1 size-full" />
        <div
          aria-hidden
          className="absolute inset-0 -z-1 bg-[radial-gradient(55%_45%_at_50%_48%,var(--vignette),transparent)] [--vignette:rgb(255_255_255/0.92)] dark:[--vignette:rgb(0_0_0/0.65)]"
        />
        <div className="mx-auto flex w-[calc(100%-1rem)] flex-1 flex-col items-center justify-center border-x px-4 pt-(--header-height) pb-20 text-center md:max-w-(--content-width) dark:border-white/10">
          <h1 id="warp-title" className="text-5xl font-medium tracking-tight text-balance sm:text-7xl">
            星际舰队档案馆
          </h1>
          <p className="mt-3 font-mono text-xs tracking-[0.5em] text-muted-foreground uppercase">Starfleet Archive</p>

          <form onSubmit={submit} className="mt-10 flex w-full max-w-md gap-2">
            <InputGroup className="h-11 flex-1 bg-background/60 backdrop-blur-sm dark:bg-black/40">
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
            <Button type="submit" size="lg" className="h-11">
              登舰
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            已经是成员？
            <Button variant="ghost" size="sm" onClick={passkey}>
              <FingerprintIcon data-icon="inline-start" />
              通行密钥登录
            </Button>
            <Link to="/login" className="link-underline text-foreground">
              密码登录
            </Link>
          </div>
        </div>
        {/* Kept above the fixed bottom fade, which covers the stage's last stretch on the first screen. */}
        <a href="#join" className="absolute bottom-[calc(var(--fade-bottom-height)+0.5rem)] left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          了解如何加入
          <ArrowDownIcon className="size-3.5" />
        </a>
      </section>
      {/* Outside the stage, whose isolation would hold the keys under the page's bottom fade. */}
      <div className="relative mx-auto md:max-w-(--content-width)">
        <ChannelKeys className="absolute right-4 bottom-3" />
      </div>
      <Page id="join" className="scroll-mt-(--header-height) pt-0">
        <GuideSections />
      </Page>
    </>
  )
}
