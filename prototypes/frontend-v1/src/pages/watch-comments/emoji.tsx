import { useState } from "react"
import { SmileIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// A curated palette rather than the full Unicode set: offline, small, and laid out on the site's
// hairline grid. Production can swap in emojibase data behind the same picker.
const GROUPS: { key: string; label: string; icon: string; items: string[] }[] = [
  {
    key: "faces",
    label: "表情",
    icon: "😀",
    items: "😀 😄 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 😋 😛 🤪 😎 🤓 🧐 😏 😒 😔 😟 🙁 😣 😩 🥺 😢 😭 😤 😠 🤯 😳 😱 😨 😰 🤗 🤭 🫢 🤫 😶 😐 😑 😬 🙄 😮 😲 🥱 😴 😵 🤐 🥴 🤢 🤧 😷 🤔 🫠".split(" "),
  },
  {
    key: "hands",
    label: "手势",
    icon: "🖖",
    items: "🖖 👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 👋 👏 🙌 🤲 🤝 🙏 ✍️ 💪 🫡 🫶 👀".split(" "),
  },
  {
    key: "space",
    label: "星际",
    icon: "🚀",
    items: "🚀 🛸 🛰️ 🌌 🌠 ⭐ 🌟 🪐 🌍 🌑 ☄️ 💫 👽 👾 🤖 🧑‍🚀 🔭 🧪 🧬 ⚛️ 🛡️ ⚔️ 🖖 ☕ 🍵 🐈 🎻 🎺 🍸 🎲".split(" "),
  },
  {
    key: "symbols",
    label: "符号",
    icon: "❤️",
    items: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 🔥 ✨ 🎉 💡 📌 ✅ ❌ ❓ ❗ ‼️ ⚠️ ⏩ ⏪ ⏸️ 🔁 🔇 🔊 🎬 📺 🍿".split(" "),
  },
]

let recent: string[] = ["👍", "😂", "🖖", "😭", "🔥", "🙏", "☕", "🤔"]

export function EmojiPicker({ onPick, finalFocus, disabled }: { onPick: (e: string) => void; finalFocus?: React.RefObject<HTMLElement | null>; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState("recent")
  const groups = [{ key: "recent", label: "最近使用", icon: "🕘", items: recent }, ...GROUPS]
  const current = groups.find((g) => g.key === group)!
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="插入表情" disabled={disabled} className="text-muted-foreground" />}>
        <SmileIcon />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[17.5rem] gap-0 overflow-hidden p-0" finalFocus={finalFocus}>
        <div className="flex items-stretch divide-x divide-border border-b" role="group" aria-label="表情分类">
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={g.key === group}
              aria-label={g.label}
              title={g.label}
              onClick={() => setGroup(g.key)}
              className={cn("flex h-9 flex-1 items-center justify-center text-base grayscale-[0.6] transition-[filter,background-color] hover:bg-accent-muted hover:grayscale-0", g.key === group && "bg-accent grayscale-0")}
            >
              {g.icon}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
          <span className="text-xs font-medium">{current.label}</span>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{current.items.length}</span>
        </div>
        {/* Hairline grid: 1px gaps over a rule-coloured backing, as in the footer title block. */}
        <div className="max-h-52 overflow-y-auto border-t">
          <div className="grid grid-cols-8 gap-px bg-line">
            {current.items.map((e, i) => (
              <button
                key={`${e}-${i}`}
                type="button"
                aria-label={e}
                onClick={() => {
                  recent = [e, ...recent.filter((x) => x !== e)].slice(0, 16)
                  onPick(e)
                  setOpen(false)
                }}
                className="flex aspect-square items-center justify-center bg-popover text-xl transition-transform outline-none hover:bg-accent focus-visible:bg-accent active:scale-90"
              >
                {e}
              </button>
            ))}
            {Array.from({ length: (8 - (current.items.length % 8)) % 8 }, (_, i) => (
              <span key={`fill-${i}`} className="bg-popover" />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
