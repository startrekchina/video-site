import type { JSX } from "react"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { setTheme, useThemePreference, type ThemePreference } from "@/lib/theme"

function ThemeOption({
  icon,
  value,
  label,
  isActive,
  onClick,
}: {
  icon: JSX.Element
  value: ThemePreference
  label: string
  isActive?: boolean
  onClick: (value: ThemePreference) => void
}) {
  return (
    <button
      type="button"
      data-active={isActive}
      className="relative flex size-8 items-center justify-center rounded-full text-muted-foreground transition-[color] outline-none hover:text-foreground focus-visible:inset-ring-2 focus-visible:inset-ring-ring/50 data-[active=true]:text-foreground [&_svg]:size-4"
      role="radio"
      aria-checked={isActive}
      aria-label={label}
      title={label}
      onClick={() => onClick(value)}
    >
      {icon}

      {isActive && (
        <motion.span
          layoutId="theme-option"
          transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
          className="absolute inset-0 rounded-full border"
        />
      )}
    </button>
  )
}

const THEME_OPTIONS: { icon: JSX.Element; value: ThemePreference; label: string }[] = [
  { icon: <MonitorIcon />, value: "system", label: "跟随系统" },
  { icon: <SunIcon />, value: "light", label: "浅色" },
  { icon: <MoonIcon />, value: "dark", label: "深色" },
]

function ThemeSwitcher({ className }: { className?: string }) {
  const theme = useThemePreference()

  return (
    <div
      className={cn("inline-flex items-center overflow-clip rounded-full bg-background inset-ring-1 inset-ring-border", className)}
      role="radiogroup"
      aria-label="主题"
    >
      {THEME_OPTIONS.map((option) => (
        <ThemeOption
          key={option.value}
          icon={option.icon}
          value={option.value}
          label={option.label}
          isActive={theme === option.value}
          onClick={setTheme}
        />
      ))}
    </div>
  )
}

export { ThemeSwitcher }
