import { useState } from "react";
import { useRevalidator } from "react-router";
import { toast } from "@/components/ui/toast";

export type SavedProgress = { positionSeconds: number; completed: boolean; updatedAt: number; revision: number };
type Change = { positionSeconds: number } | { completed: boolean };
type Outcome = { saved: SavedProgress } | { conflict: number } | { failed: true };

// One write. A 409 hands back the server's revision: the caller drops this event and never replays it.
export async function saveProgress(unitId: string, change: Change, expectedRevision: number, keepalive = false): Promise<Outcome> {
  try {
    const response = await fetch(`/me/progress/${encodeURIComponent(unitId)}`, { method: "PUT", credentials: "same-origin", cache: "no-store", keepalive,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...change, expectedRevision }) });
    const result = await response.json().catch(() => ({})) as { data?: SavedProgress; error?: { revision?: unknown } };
    if (response.ok && result.data) return { saved: result.data };
    if (response.status === 409 && typeof result.error?.revision === "number") return { conflict: result.error.revision };
  } catch { /* Network failures fall through like any other failed write. */ }
  return { failed: true };
}

// Manual watched/unwatched marks; the page reloads its data afterwards so every list shows the stored state.
export function useMarkWatched() {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  async function mark(unitId: string, completed: boolean, expectedRevision: number) {
    if (busy) return null;
    setBusy(unitId);
    try {
      const result = await saveProgress(unitId, { completed }, expectedRevision);
      if ("conflict" in result) toast.add({ title: "观看记录已在其他设备更新，已刷新为最新状态。", type: "info" });
      if ("failed" in result) toast.add({ title: "标记未保存，请稍后重试。", type: "error" });
      await revalidator.revalidate();
      return result;
    } finally { setBusy(null); }
  }
  return { mark, busy };
}
