import { useState } from "react"
import { ImageIcon } from "lucide-react"

export function EpisodeStill({ src }: { src?: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  return (
    <div aria-hidden className="relative h-[45px] w-20 shrink-0 overflow-hidden rounded-sm border border-line bg-muted sm:h-[63px] sm:w-28">
      <span className="absolute inset-0 grid place-items-center text-muted-foreground/50">
        <ImageIcon className="size-4" />
      </span>
      {src && src !== failedSrc && (
        <img
          src={src}
          alt=""
          width={240}
          height={135}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="relative size-full bg-muted object-contain select-none"
        />
      )}
    </div>
  )
}
