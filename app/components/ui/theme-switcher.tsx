import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { setTheme, useThemePreference } from "@/lib/theme";

const options = [
  { value: "system", label: "跟随系统", Icon: MonitorIcon },
  { value: "light", label: "浅色", Icon: SunIcon },
  { value: "dark", label: "深色", Icon: MoonIcon },
] as const;

export function ThemeSwitcher() {
  const preference = useThemePreference();
  return (
    <fieldset className="inline-flex rounded-full bg-background inset-ring-1 inset-ring-border">
      <legend className="sr-only">主题</legend>
      {options.map(({ value, label, Icon }) => (
        <label key={value} className="relative cursor-pointer" title={label}>
          <input className="peer sr-only" type="radio" name="theme" value={value} aria-label={label}
            checked={preference === value} onChange={() => setTheme(value)} />
          <span className="flex size-8 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:text-foreground peer-checked:border-border peer-checked:text-foreground peer-focus-visible:inset-ring-2 peer-focus-visible:inset-ring-ring/50">
            <Icon className="size-4" />
          </span>
        </label>
      ))}
    </fieldset>
  );
}
