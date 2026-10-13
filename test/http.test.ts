import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { member, login } from "./fixtures/auth";

const fetchPath = (path: string) => exports.default.fetch(`http://example.com${path}`);

// The first request compiles the UI module graph in Vite; keep that outside the 5s request checks.
beforeAll(async () => { await fetchPath("/robots.txt"); }, 60000);

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

describe("worker responses", () => {
  it("renders reset completion without a password form or captcha and keeps the reset form separate", async () => {
    const response = await fetchPath("/reset-password/complete");
    expect(response.status).toBe(200); expectSecurityHeaders(response);
    const html = await response.text();
    expect(html).toContain("密码已重置"); expect(html).toContain("旧会话已撤销");
    expect(html).toMatch(/href="\/login"[^>]*>前往登录/);
    expect(html).not.toMatch(/<form\b|type="password"|保存新密码|challenges\.cloudflare\.com/);
    const reset = await (await fetchPath("/reset-password?token=fictional-link")).text();
    expect(reset).toContain('name="newPassword"'); expect(reset).toContain("保存新密码");
  });
  it("does not emit reset-link logs that Cloudflare would enrich with the path credential", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await exports.default.fetch("http://localhost:6120/api/auth/reset-password/fictional-private-token?callbackURL=http%3A%2F%2Flocalhost%3A6120%2Freset-password", { redirect: "manual" });
      expect(response.status).toBe(302); expectSecurityHeaders(response); expect(log).not.toHaveBeenCalled();
      await fetchPath("/api/auth/get-session"); expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
  it("renders a real member account without credentials and returns HTML 403 for a non-admin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
    try {
      await member(); const cookie = await login();
      const account = await exports.default.fetch("http://localhost:6120/account", { headers: { Cookie: cookie } });
      expect(account.status).toBe(200); expectSecurityHeaders(account);
      const html = await account.text(); expect(html).toContain("管理登录方式、二步验证和登录会话。"); expect(html).toContain("Nova");
      expect(html).not.toMatch(/"password"|"token"|"secret"|backupCodes\":/);
      const forbidden = await exports.default.fetch("http://localhost:6120/admin", { headers: { Cookie: cookie } });
      expect(forbidden.status).toBe(403); expectSecurityHeaders(forbidden); expect(await forbidden.text()).toContain("访问受限");
    } finally { vi.unstubAllGlobals(); }
  });
  it("exposes the guarded native session endpoint", async () => {
    const res = await fetchPath("/api/auth/get-session");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expectSecurityHeaders(res);
  });

  it("keeps guest forms public while independently protecting member pages and JSON", async () => {
    for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/verify-pending"]) {
      const response = await fetchPath(path); expect(response.status).toBe(200); expectSecurityHeaders(response);
      const html = await response.text(); expect(html).not.toMatch(/PROTO|演示密码|任意 6 位|恢复码重设/);
    }
    for (const path of ["/account", "/invites", "/admin"]) {
      const response = await exports.default.fetch("http://example.com" + path, { redirect: "manual" });
      expect(response.status).toBe(302); expect(response.headers.get("Location")).toBe("/login?next=" + encodeURIComponent(path)); expectSecurityHeaders(response);
    }
    for (const path of ["/account/sessions", "/invites/data", "/admin/members/data", "/admin/members/stats", "/admin/members/invitations", "/admin/members/roots"]) {
      const response = await fetchPath(path); expect(response.status).toBe(401); expectSecurityHeaders(response);
      expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" }, requestId: response.headers.get("X-Request-Id") });
    }
    for (const path of ["/reset-password?token=fictional-link", "/verify-email?error=fictional"]) {
      const html = await (await fetchPath(path)).text(); expect(html).not.toContain("challenges.cloudflare.com");
    }
  }, 20000);

  it("renders the home page with security headers", async () => {
    const res = await fetchPath("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expectSecurityHeaders(res);
  });

  it("disallows all crawlers in robots.txt", async () => {
    const res = await fetchPath("/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
    expectSecurityHeaders(res);
  });

  it("returns a 404 page with the same headers for unknown paths", async () => {
    const res = await fetchPath("/no-such-page");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("这片星域还没有被探索过。");
    expectSecurityHeaders(res);
  });

  it("renders the public about page without member links or prototype identity", async () => {
    const res = await fetchPath("/about");
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
    const html = await res.text();
    expect(html).toContain("mailto:contact@startrekchina.org");
    expect(html).toContain("注册邮箱");
    expect(html).toContain("邮箱找回密码");
    expect(html).toContain("1 小时内有效");
    expect(html).toContain("正确密码加一个未用备用码");
    expect(html).toContain("不承诺网页自助或管理员一键恢复");
    expect(html).not.toMatch(/href="\/recover"|注册时拿到的任意一个恢复码|24 小时内有效|连续认证失败时/);
    expect(html).toContain('name="theme"');
    expect(html).not.toMatch(/href="\/(series|movies|library|playlists|invites|account|admin)(?:["#?\/])/);
    expect(html).not.toMatch(/PROTO|proto\/frontend-v1|站长待填/);
    expect(html.indexOf("localStorage.getItem('site-theme')")).toBeLessThan(html.indexOf('rel="stylesheet"'));
  });
});
