import { useRef, useState } from "react"
import { PlayIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { Poster, ProgressBar } from "@/components/site/media"
import { Button } from "@/components/ui/button"
import { useStageHeader } from "@/lib/header-tone"
import { cn } from "@/lib/utils"

import { useStages, type Stage } from "./theatre"

// Design studies for the logged-in hero. The live hero stays in theatre.tsx; this page only compares
// ways of drawing the same dark theatre with the site's line-drawing language (hairlines, hatch,
// mono captions, square bars). Shared chrome so the four variants differ in structure, not in copy.

export const STUDIES = [
  { id: "a", fig: "Fig. A", name: "图框", blurb: "深色舞台收成一张带图注的图纸。海报进线框，进度是直角平条，继续观看是底部格子。" },
  { id: "b", fig: "Fig. B", name: "幕布", blurb: "海报本身就是幕布，四边刻度尺框住它。文案落在幕布下沿，像放映单贴在银幕上。" },
  { id: "c", fig: "Fig. C", name: "放映单", blurb: "没有大海报。左侧是当前这一部的放映记录，右侧整列是继续观看，选中项用斜纹标出。" },
  { id: "d", fig: "Fig. D", name: "刻度", blurb: "刻度尺还在。模糊海报铺回舞台当背景光，图注和刻度是浮在光上的细线。" },
] as const

export type StudyId = (typeof STUDIES)[number]["id"]

function Plate({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative border border-white/15 bg-white/3", className)}>
      <span aria-hidden className="absolute top-1.5 left-1.5 size-2.5 border-t border-l border-white/80" />
      <span aria-hidden className="absolute top-1.5 right-1.5 size-2.5 border-t border-r border-white/80" />
      <span aria-hidden className="absolute bottom-1.5 left-1.5 size-2.5 border-b border-l border-white/80" />
      <span aria-hidden className="absolute right-1.5 bottom-1.5 size-2.5 border-r border-b border-white/80" />
      {children}
    </div>
  )
}

function Play({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <Button size="lg" className={cn("h-11 px-4 text-base", className)} render={<Link to={stage.primary.to} />} nativeButton={false}>
      <PlayIcon className="fill-current" data-icon="inline-start" />
      {stage.primary.label}
    </Button>
  )
}

function Ghost({ stage }: { stage: Stage }) {
  return (
    <Button size="lg" variant="ghost" className="h-11 px-4 text-base text-white/85 hover:bg-white/10" render={<Link to={stage.secondary.to} />} nativeButton={false}>
      {stage.secondary.label}
    </Button>
  )
}

function Copy({ stage, clamp = true }: { stage: Stage; clamp?: boolean }) {
  return (
    <>
      <div className="font-mono text-xs tracking-wide text-white/70">{stage.eyebrow}</div>
      <h1 id="hero-title" className="mt-1.5 text-[1.75rem]/tight font-medium tracking-tight text-balance text-white sm:mt-2 sm:text-3xl/tight md:text-[2.5rem]/tight">
        {stage.title}
      </h1>
      <p className="mt-1 truncate text-sm text-white/80 sm:text-lg">{stage.sub}</p>
      <p className={cn("mt-3 max-w-prose text-sm/relaxed text-white/65", clamp && "line-clamp-2")}>{stage.overview}</p>
      {stage.frac !== null && <ProgressBar value={stage.frac} className="mt-4 max-w-xs bg-white/15 [&>div]:bg-white" />}
      <div className={cn("font-mono text-xs text-white/65", stage.frac !== null ? "mt-2" : "mt-3")}>{stage.meta}</div>
    </>
  )
}

function Actions({ stage }: { stage: Stage }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Play stage={stage} />
      <Ghost stage={stage} />
    </div>
  )
}

function usePick(count: number) {
  const [selected, setSelected] = useState(0)
  const [announce, setAnnounce] = useState("")
  const navigate = useNavigate()
  const index = Math.min(selected, Math.max(0, count - 1))
  const pick = (i: number, stage: Stage) => {
    if (i === index) {
      navigate(stage.primary.to)
      return
    }
    setSelected(i)
    setAnnounce(`已切换到 ${stage.title}，${stage.sub}`)
  }
  return { index, announce, pick }
}

/** Fig. A — the current theatre redrawn as one plate: framed poster, square bar, ruled thumb row. */
type Pick = { index: number; announce: string; pick: (i: number, stage: Stage) => void }

function StudyA({ stages, label, index, announce, pick }: { stages: Stage[]; label: string } & Pick) {
  const s = stages[index]
  return (
    <div className="px-4 pt-[calc(var(--header-height)+--spacing(6))] pb-6 sm:pt-[calc(var(--header-height)+--spacing(12))] sm:pb-8">
      <div className="mb-3 flex items-baseline justify-between font-mono text-[11px] tracking-wider text-white/55 uppercase">
        <span>Screening room · {label}</span>
        <span>Fig. A</span>
      </div>
      <div className="grid items-end gap-x-8 gap-y-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Link to={s.primary.to} aria-label={`${s.primary.label}：${s.title}`} className="block w-28 outline-none min-[24rem]:w-32 sm:w-52">
          <Plate className="p-1.5">
            <Poster src={s.poster} alt="" loading="eager" fetchPriority="high" className="rounded-none" />
          </Plate>
        </Link>
        <div className="min-w-0">
          <Copy stage={s} />
          <Actions stage={s} />
        </div>
      </div>
      {stages.length > 1 && (
        <div className="mt-6 border-t border-white/15">
          <div className="flex h-8 items-center justify-between font-mono text-[11px] tracking-wider text-white/55 uppercase">
            <span>{label}</span>
            <span>
              {String(index + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}
            </span>
          </div>
          <div className="no-scrollbar flex overflow-x-auto border-y border-white/15">
            {stages.map((x, i) => {
              const active = i === index
              return (
                <button
                  key={x.key}
                  type="button"
                  aria-pressed={active}
                  aria-label={active ? `播放：${x.title}` : `切换到：${x.title}`}
                  onClick={() => pick(i, x)}
                  className={cn("group/thumb w-20 shrink-0 border-r border-white/15 p-2 text-left outline-none last:border-r-0 sm:w-24", active ? "bg-white/8" : "hover:bg-white/5")}
                >
                  <Poster src={x.poster} alt="" className="rounded-none" />
                  {x.frac !== null && <ProgressBar value={x.frac} className="mt-2 bg-white/15 [&>div]:bg-white" />}
                  <span className={cn("mt-1.5 block truncate font-mono text-[10px]/tight", active ? "text-white" : "text-white/50 group-hover/thumb:text-white/80")}>
                    {x.thumb[0]} {x.thumb[1]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}

function ticks(axis: "x" | "y"): React.CSSProperties {
  const across = axis === "x"
  return {
    backgroundImage: `repeating-linear-gradient(to ${across ? "right" : "bottom"}, currentColor 0 1px, transparent 1px 12px)`,
    backgroundSize: across ? "12px 6px" : "6px 12px",
    backgroundRepeat: across ? "repeat-x" : "repeat-y",
    backgroundPosition: across ? "0 100%" : "100% 0",
  }
}

/** Fig. B — the poster is the screen; graduated edges, copy overlaid on its lower margin. */
function StudyB({ stages, label, index, announce, pick }: { stages: Stage[]; label: string } & Pick) {
  const s = stages[index]
  return (
    <div className="px-4 pt-[calc(var(--header-height)+--spacing(5))] pb-6 sm:pt-[calc(var(--header-height)+--spacing(8))]">
      <div>
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 text-white/35">
            <div className="absolute inset-x-0 top-0 h-2" style={ticks("x")} />
            <div className="absolute inset-x-0 bottom-0 h-2" style={ticks("x")} />
            <div className="absolute inset-y-0 left-0 w-2" style={ticks("y")} />
            <div className="absolute inset-y-0 right-0 w-2" style={ticks("y")} />
          </div>
          <Plate className="overflow-hidden">
            <div className="relative aspect-[16/10] sm:aspect-[2/1]">
              <img key={s.key} src={s.poster} alt="" className="absolute inset-0 size-full scale-110 object-cover object-[center_20%] opacity-75 blur-[2px]" />
              <div className="absolute inset-0 bg-linear-to-t from-black via-black/25 to-black/10" />
              <div className="dot-grid absolute inset-0 opacity-60" />
              <div className="absolute inset-x-0 top-0 flex h-8 items-center justify-between px-3 font-mono text-[11px] tracking-wider text-white/75 uppercase">
                <span>Now screening</span>
                <span>{label}</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4 pb-5 sm:p-6 sm:pb-7">
                <Copy stage={s} />
                <Actions stage={s} />
              </div>
            </div>
          </Plate>
        </div>
        {stages.length > 1 && (
          <div className="-mt-px grid auto-cols-fr grid-flow-col border border-white/15 bg-zinc-950 max-sm:grid-cols-2 max-sm:grid-flow-row">
            {stages.map((x, i) => {
              const active = i === index
              return (
                <button
                  key={x.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pick(i, x)}
                  className={cn(
                    "flex items-center gap-2 border-r border-white/15 bg-zinc-950 px-3 py-2 text-left outline-none last:border-r-0 max-sm:border-b max-sm:nth-[2n]:border-r-0",
                    active ? "text-white shadow-[inset_0_-2px_0_0_white]" : "text-white/70 hover:bg-white/8 hover:text-white",
                  )}
                >
                  <span className="font-mono text-[10px]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{x.title}</span>
                    <span className="block truncate font-mono text-[10px] text-white/45">
                      {x.thumb[0]} {x.thumb[1]}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}

/** Fig. C — a screening log. No hero poster; the queue is the plate, the selected row is hatched. */
function StudyC({ stages, label, index, announce, pick }: { stages: Stage[]; label: string } & Pick) {
  const s = stages[index]
  return (
    <div className="pt-[calc(var(--header-height)+--spacing(4))] pb-2 sm:pt-[calc(var(--header-height)+--spacing(8))]">
      <div className="flex h-9 items-center justify-between border-b border-white/15 px-4 font-mono text-[11px] tracking-wider text-white/55 uppercase">
        <span>Screening log · {label}</span>
        <span>Fig. C</span>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="border-b border-white/15 p-4 sm:p-6 lg:border-r lg:border-b-0">
          <Copy stage={s} clamp={false} />
          <Actions stage={s} />
        </div>
        <ol>
          {stages.map((x, i) => {
            const active = i === index
            return (
              <li key={x.key} className="border-b border-white/15 last:border-b-0">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => pick(i, x)}
                  className={cn("flex w-full items-center gap-3 px-4 py-3 text-left outline-none", active ? "bg-white/6 text-white" : "text-white/70 hover:bg-white/5")}
                >
                  <span className={cn("flex h-8 w-6 shrink-0 items-center justify-center font-mono text-[11px]", active ? "diagonal-stripes text-white [--pattern-foreground:rgb(255_255_255/0.7)]" : "text-white/45")}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Poster src={x.poster} alt="" className="w-8 shrink-0 rounded-none" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{x.title}</span>
                    <span className="block truncate font-mono text-[10px] text-white/50">
                      {x.thumb[0]} {x.thumb[1]} · {x.sub}
                    </span>
                    {x.frac !== null && <ProgressBar value={x.frac} className="mt-1.5 bg-white/15 [&>div]:bg-white" />}
                  </span>
                  {active && <PlayIcon className="size-3.5 shrink-0 fill-current text-white" />}
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}

/** Fig. D — the ruled scale, laid over the original poster glow. */
function StudyD({ stages, label, index, announce, pick }: { stages: Stage[]; label: string } & Pick) {
  const s = stages[index]
  return (
    <div className="pt-[calc(var(--header-height)+--spacing(4))] pb-6 sm:pt-[calc(var(--header-height)+--spacing(8))]">
      <div className="screen-line-top screen-line-bottom flex h-8 items-center justify-between bg-black/25 px-4 font-mono text-[11px] tracking-wider text-white/70 uppercase backdrop-blur-sm before:bg-white/20 after:bg-white/20">
        <span>Continue · {label}</span>
        <span>Fig. D</span>
      </div>
      <div className="px-4 pt-6 sm:pt-8">
      <div className="grid items-start gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8">
        <div className="w-28 min-[24rem]:w-36 sm:w-44">
          <Plate className="p-1.5">
            <Poster src={s.poster} alt="" loading="eager" className="rounded-none" />
          </Plate>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] tracking-wider text-white/55 uppercase">
            <span>{s.thumb[0]}</span>
            <span>{s.thumb[1]}</span>
          </div>
        </div>
        <div className="min-w-0">
          <Copy stage={s} />
          <Actions stage={s} />
        </div>
      </div>
      {stages.length > 1 && (
        <div className="screen-line-top relative mt-8 pt-3 before:bg-white/40">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-2 text-white/55" style={ticks("x")} />
          <div className="no-scrollbar flex gap-px overflow-x-auto">
            {stages.map((x, i) => {
              const active = i === index
              return (
                <button
                  key={x.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pick(i, x)}
                  className="group/tick flex w-28 shrink-0 flex-col items-start pt-2 text-left outline-none sm:w-36"
                >
                  <span className={cn("mb-2 h-3 w-px", active ? "bg-white" : "bg-white/30 group-hover/tick:bg-white/70")} />
                  <span className={cn("font-mono text-[10px] tracking-wider uppercase", active ? "text-white" : "text-white/40")}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={cn("mt-0.5 line-clamp-2 text-xs", active ? "text-white" : "text-white/55 group-hover/tick:text-white/80")}>{x.title}</span>
                  <span className="font-mono text-[10px] text-white/40">{x.thumb[1]}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}

const RENDER = { a: StudyA, b: StudyB, c: StudyC, d: StudyD }

/** One study, full bleed, for the comparison page and for dropping into the home later. */
export function HeroStudy({ id }: { id: StudyId }) {
  const { stages, label } = useStages()
  const picked = usePick(stages.length)
  const ref = useRef<HTMLElement>(null)
  useStageHeader(ref)
  const View = RENDER[id]
  const current = stages[picked.index]
  return (
    <section ref={ref} aria-labelledby="hero-title" className="dark relative isolate -mx-2 -mt-(--header-height) overflow-hidden bg-zinc-950 text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-1">
        {id === "d" && current && (
          <img
            key={current.key}
            src={current.poster}
            alt=""
            className="absolute inset-0 size-full scale-125 animate-in object-cover opacity-60 blur-3xl saturate-150 duration-700 fade-in motion-reduce:animate-none"
          />
        )}
        <div className={cn("absolute inset-0", id === "d" ? "bg-linear-to-b from-zinc-950/20 via-zinc-950/55 to-zinc-950" : "bg-[radial-gradient(80%_60%_at_20%_0%,rgb(255_255_255/0.05),transparent_60%)]")} />
        {id === "d" && <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_25%_35%,transparent_0%,rgb(9_9_11)_80%)]" />}
        <div className="dot-grid absolute inset-0" />
      </div>
      <div className="mx-auto w-[calc(100%-1rem)] border-x border-white/10 md:max-w-(--content-width)">
        <View stages={stages} label={label} {...picked} />
      </div>
    </section>
  )
}
