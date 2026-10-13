import type { ComponentProps, ReactNode } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function StatusButton({ status = "idle", successLabel = "已完成", children, className, disabled, ...props }: ComponentProps<typeof Button> & {
  status?: "idle" | "loading" | "success"; successLabel?: ReactNode;
}) {
  return <Button {...props} disabled={disabled || status === "loading"} aria-busy={status === "loading"} data-status={status}
    className={cn("inline-grid justify-items-center *:col-start-1 *:row-start-1 *:flex *:items-center *:gap-[inherit]", className)}>
    <span aria-hidden className="invisible">{children}</span>
    <span aria-hidden className="invisible"><CheckIcon />{successLabel}</span>
    <span>{status === "loading" ? <><LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /><span className="sr-only">正在处理</span></> : status === "success" ? <><CheckIcon />{successLabel}</> : children}</span>
  </Button>;
}
