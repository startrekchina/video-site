import { cn } from "@/lib/utils";

export function LineNav({ items, activeHref }: { items: { title: string; href: string }[]; activeHref: string }) {
  return (
    <nav className="flex flex-col gap-2 py-5.25">
      {items.map((item, index) => (
        <div key={item.href} className="flex flex-col gap-2">
          <a href={item.href} aria-current={item.href === activeHref ? "location" : undefined}
            className="group relative flex h-px items-center gap-3 after:absolute after:top-1/2 after:left-0 after:size-full after:-translate-y-1/2 after:p-3.5">
            <span className={cn("block h-px w-6 shrink-0 bg-foreground/20 transition-[width,background-color] group-hover:w-10 group-hover:bg-foreground", item.href === activeHref && "w-10 bg-foreground")} />
            <span className={cn("text-sm whitespace-nowrap text-muted-foreground group-hover:text-foreground", item.href === activeHref && "text-foreground")}>{item.title}</span>
          </a>
          {index < items.length - 1 && <><span className="h-px w-6 bg-foreground/20" /><span className="h-px w-6 bg-foreground/20" /></>}
        </div>
      ))}
    </nav>
  );
}
