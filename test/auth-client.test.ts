import { afterEach, expect, it, vi } from "vitest";
import { authError, call } from "@/lib/auth-client";

afterEach(() => { vi.unstubAllGlobals(); });

it("keeps rate-limit waits readable and never surfaces raw network or gateway errors", async () => {
  expect(authError({}, "30")).toBe("操作过于频繁，请在 30 秒后重试。");
  expect(authError({}, "3412")).toBe("操作过于频繁，请约 57 分钟后再试。");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  await expect(call("/api/auth/sign-out", {})).rejects.toThrow("网络连接失败，请检查网络后重试。");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
  await expect(call("/api/auth/sign-out", {})).rejects.toThrow("操作未完成，请检查输入或稍后重试。");
});
