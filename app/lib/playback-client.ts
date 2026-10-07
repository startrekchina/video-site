import type { Authorization } from "./playback.server";

export const renewBefore = 5 * 60_000;
export const retryDelays = [5_000, 15_000, 30_000];
export function renewalDelay(expiresAt: number, now = Date.now()) { return Math.max(0, expiresAt - renewBefore - now); }
export function retryDelay(status: number, attempt: number) { return (status === 0 || status === 503) && attempt < retryDelays.length ? retryDelays[attempt] : null; }
export function startRenewal(initial: Authorization, request: (signal: AbortSignal) => Promise<Authorization>, apply: (next: Authorization) => Promise<void>, paused: () => void, errorMessage: (message: string) => void) {
  const controller = new AbortController();
  let current = initial, attempts = 0, running = false;
  let renewalTimer: ReturnType<typeof setTimeout>, expiryTimer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(renewalTimer); clearTimeout(expiryTimer);
    renewalTimer = setTimeout(() => void renew(), renewalDelay(current.expiresAt));
    expiryTimer = setTimeout(() => { paused(); errorMessage("播放凭证已到期，请手动重试。"); }, Math.max(0, current.expiresAt - Date.now()));
  };
  const renew = async () => {
    if (running || controller.signal.aborted) return;
    running = true;
    try {
      const next = await request(controller.signal);
      if (controller.signal.aborted) return;
      await apply(next);
      if (controller.signal.aborted) return;
      current = next; attempts = 0; schedule();
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
      const wait = retryDelay(status, attempts);
      if (status === 401 || status === 403) { paused(); clearTimeout(expiryTimer); errorMessage("登录已失效或无权播放，请重新登录。"); }
      else if (wait !== null && Date.now() + wait < current.expiresAt) { attempts++; renewalTimer = setTimeout(() => void renew(), wait); }
      else errorMessage("续期失败，播放凭证到期后暂停。可以手动重试。");
    } finally { running = false; }
  };
  schedule();
  return { retry() { attempts = 0; clearTimeout(renewalTimer); void renew(); }, stop() { controller.abort(); clearTimeout(renewalTimer); clearTimeout(expiryTimer); } };
}
export async function fetchAuthorization(unitId: string, csrfToken: string, signal: AbortSignal): Promise<Authorization> {
  const response = await fetch(`/playback/${encodeURIComponent(unitId)}/authorize`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csrfToken }), signal });
  if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? "登录已失效或账号无权播放，请重新登录。" : "播放凭证暂时无法续期。"), { status: response.status });
  const value: Authorization = await response.json();
  if (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || !value.url.startsWith("/media/") || !Array.isArray(value.tracks)) throw Object.assign(new Error("播放凭证响应无效。"), { status: 503 });
  return value;
}
