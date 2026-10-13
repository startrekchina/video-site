import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

type Turnstile = { render: (node: HTMLElement, options: { sitekey: string; action: string; theme: string; size: "normal" | "compact"; language: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }
let scriptPromise: Promise<void> | undefined;
function load() {
  return scriptPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true; script.onload = () => resolve();
    script.onerror = () => { script.remove(); scriptPromise = undefined; reject(new Error()); };
    document.head.appendChild(script);
  });
}
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const node = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const theme = useTheme();
  useEffect(() => {
    let disposed = false;
    let id: string | undefined;
    let observer: ResizeObserver | undefined;
    let size: "normal" | "compact" | undefined;
    onToken(""); setFailed(false);
    load().then(() => {
      if (disposed || !node.current) return;
      observer = new ResizeObserver(([entry]) => {
        const next = entry.contentRect.width < 300 ? "compact" : "normal";
        if (disposed || size === next) return;
        size = next;
        if (id) window.turnstile!.remove(id);
        onToken(""); setFailed(false);
        try {
          id = window.turnstile!.render(node.current!, { sitekey: siteKey, action: "auth", theme, size, language: "zh-cn",
            callback: onToken, "expired-callback": () => onToken(""), "error-callback": () => { onToken(""); setFailed(true); } });
        } catch { setFailed(true); }
      });
      observer.observe(node.current);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; observer?.disconnect(); if (id) window.turnstile?.remove(id); };
  }, [siteKey, onToken, theme, retry]);
  return <div><div ref={node} className="min-h-[140px] @min-[300px]/field-group:min-h-[65px]" />{failed && <button type="button" className="text-sm underline" onClick={() => setRetry(value => value + 1)}>人机验证无法加载，点击重试</button>}</div>;
}
