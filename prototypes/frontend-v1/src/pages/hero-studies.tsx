import { useState } from "react"

import { cn } from "@/lib/utils"

import { HeroStudy, STUDIES, type StudyId } from "./home-hero/studies"

// Comparison page for the logged-in hero. Not linked from the site nav; reach it from the proto
// console or /hero-studies. The live home keeps the current theatre until a variant is chosen.

export function HeroStudiesPage() {
  const [id, setId] = useState<StudyId>("a")
  const current = STUDIES.find((s) => s.id === id)!
  return (
    <>
      <HeroStudy key={id} id={id} />
      <div className="fixed bottom-[calc(--spacing(16)+env(safe-area-inset-bottom,0px))] left-1/2 z-[55] -translate-x-1/2 sm:bottom-6">
        <div className="border bg-background/95 shadow-sm backdrop-blur-md">
          <div className="flex items-stretch">
            <div className="hidden max-w-64 flex-col justify-center border-r px-3 py-2 sm:flex">
              <div className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">方案比较</div>
              <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{current.blurb}</p>
            </div>
            <div className="flex" role="tablist" aria-label="影院方案">
              {STUDIES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={s.id === id}
                  onClick={() => setId(s.id)}
                  className={cn("border-r px-3 py-2 text-left last:border-r-0", s.id === id ? "bg-foreground text-background" : "hover:bg-accent")}
                >
                  <span className="block font-mono text-[10px] tracking-wider uppercase">{s.fig}</span>
                  <span className="block text-sm font-medium">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
