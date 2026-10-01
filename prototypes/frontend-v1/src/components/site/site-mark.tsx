import { cn } from "@/lib/utils"

/** Site mark: the repo's logo plus a mono wordmark. */
export function SiteMark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <img src="/logo.png" alt="" className="size-6 shrink-0 select-none" draggable={false} />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-medium tracking-tight">星际舰队档案馆</span>
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Starfleet Archive</span>
        </span>
      )}
    </span>
  )
}
