import { lazy, Suspense, useEffect, useState } from "react"

import { Panel, PanelHeader, PanelTitle } from "@/components/site/panel"

const Section = lazy(() => import("./section"))

export function DiscussionLoading({ kind }: { kind: "episode" | "movie" }) {
  return (
    <Panel aria-busy>
      <PanelHeader>
        <PanelTitle>{kind === "episode" ? "本集讨论" : "本片讨论"}</PanelTitle>
      </PanelHeader>
      <p className="px-4 py-12 text-center text-sm text-muted-foreground">正在加载讨论…</p>
    </Panel>
  )
}

/** Mounts in the browser after the page: the discussion reads its own API, and Markdown rendering stays out of the watch page's bundle. */
export function Discussion({ unitId, kind }: { unitId: string; kind: "episode" | "movie" }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const loading = <DiscussionLoading kind={kind} />
  return mounted ? (
    <Suspense fallback={loading}>
      <Section unitId={unitId} kind={kind} />
    </Suspense>
  ) : (
    loading
  )
}
