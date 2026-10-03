import { useMemo } from "react"
import { DownloadIcon } from "lucide-react"

import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard"
import { Button } from "@/components/ui/button"
import { CopyStateIcon } from "@/components/ui/copy-button"

export function makeRecoveryCodes(n = 10) {
  const a = "abcdefghjkmnpqrstuvwxyz23456789"
  return Array.from({ length: n }, () => Array.from({ length: 10 }, (_, i) => (i === 5 ? "-" : a[Math.floor(Math.random() * a.length)])).join(""))
}

/** One-time display of freshly generated recovery codes. */
export function RecoveryCodes({ seed }: { seed?: number }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const codes = useMemo(() => makeRecoveryCodes(), [seed])
  const { state, copy } = useCopyToClipboard({ resetDelay: 2000 })
  const text = codes.join("\n")
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-line font-mono text-sm">
        {codes.map((c, i) => (
          <li key={c} className="flex gap-2 bg-background px-3 py-2">
            <span className="text-muted-foreground/70 select-none">{String(i + 1).padStart(2, "0")}</span>
            {c}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy(text)}>
          <CopyStateIcon state={state} />
          {state === "done" ? "已复制" : state === "error" ? "复制失败" : "复制全部"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          render={<a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="starfleet-archive-recovery-codes.txt" />}
          nativeButton={false}
        >
          <DownloadIcon data-icon="inline-start" />
          下载 .txt
        </Button>
      </div>
    </div>
  )
}
