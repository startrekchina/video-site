import { afterEach, expect, it, vi } from "vitest";
import { authError, call } from "@/lib/auth-client";

afterEach(() => { vi.unstubAllGlobals(); });

it("explains how to recover from an invitation replay that cannot return the original code", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "INVITATION_REPLAY_UNAVAILABLE" } }, { status: 409 })));
  await expect(call("/invites/create", { operationId: crypto.randomUUID() })).rejects.toThrow("本次发码无法重试，请刷新页面后重新生成。");
});

it("keeps rate-limit waits readable and never surfaces raw network or gateway errors", async () => {
  expect(authError({}, "30")).toBe("操作过于频繁，请在 30 秒后重试。");
  expect(authError({}, "3412")).toBe("操作过于频繁，请约 57 分钟后再试。");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  await expect(call("/api/auth/sign-out", {})).rejects.toThrow("网络连接失败，请检查网络后重试。");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
  await expect(call("/api/auth/sign-out", {})).rejects.toThrow("操作未完成，请检查输入或稍后重试。");
});

it("sends schedule updates as same-origin JSON PUT without changing existing GET and POST defaults", async () => {
  const network = vi.fn(async () => Response.json({ data: { enabled: true } })); vi.stubGlobal("fetch", network);
  const body = { enabled: true };
  expect(await call("/admin/backups/schedule", body, undefined, "PUT")).toEqual(body);
  expect(network).toHaveBeenLastCalledWith("/admin/backups/schedule", expect.objectContaining({ method: "PUT", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  await call("/example"); expect(network).toHaveBeenLastCalledWith("/example", expect.objectContaining({ method: "GET" }));
  await call("/example", {}); expect(network).toHaveBeenLastCalledWith("/example", expect.objectContaining({ method: "POST" }));
});
