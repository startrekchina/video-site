import { useState } from "react";
import { useRevalidator } from "react-router";
import { toast } from "@/components/ui/toast";

type Result<T> = { data: T } | { error: { status: number; code?: string; message?: string } };

// One favorites or playlist request; a failure keeps the server's message for the notice.
export async function libraryRequest<T = Record<string, unknown>>(path: string, method: string, body: object = {}): Promise<Result<T>> {
  try {
    const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as { data?: T; error?: { code?: string; message?: string } };
    if (response.ok && result.data) return { data: result.data };
    return { error: { status: response.status, ...result.error } };
  } catch { return { error: { status: 0 } }; }
}

// Page writes run one at a time, show a one-line notice on failure and then reload the page data (409 included).
export function useLibraryWrite() {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  async function run<T>(path: string, method: string, body?: object, reload = true) {
    if (busy) return null;
    setBusy(true);
    try {
      const result = await libraryRequest<T>(path, method, body);
      if ("error" in result) toast.add({ title: result.error.message ?? "未保存，请稍后重试。", type: "error" });
      if (reload) await revalidator.revalidate();
      return result;
    } finally { setBusy(false); }
  }
  return { run, busy };
}
