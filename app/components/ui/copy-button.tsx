import type { ComponentProps } from "react";
import { CheckIcon, CircleXIcon, CopyIcon } from "lucide-react";
import { useCopyToClipboard, type CopyState } from "@/lib/use-copy-to-clipboard";
import { Button } from "./button";

export function CopyStateIcon({ state }: { state: CopyState }) {
  return state === "done" ? <CheckIcon /> : state === "error" ? <CircleXIcon /> : <CopyIcon />;
}
export function CopyButton({ text, children, size = "icon", ...props }: ComponentProps<typeof Button> & { text: string | (() => string) }) {
  const { state, copy } = useCopyToClipboard();
  return <Button size={size} aria-label={state === "done" ? "已复制" : state === "error" ? "复制失败，请手动复制" : "复制"} {...props} onClick={() => void copy(text)}>
    <CopyStateIcon state={state} />{children}<span role="status" className="sr-only">{state === "done" ? "已复制" : state === "error" ? "复制失败，请手动复制" : ""}</span>
  </Button>;
}
