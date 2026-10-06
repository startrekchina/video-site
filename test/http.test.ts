import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const fetchPath = (path: string) => exports.default.fetch(`http://example.com${path}`);

// The first request compiles the UI module graph in Vite; keep that outside the 5s request checks.
beforeAll(async () => { await fetchPath("/robots.txt"); }, 30000);

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

describe("worker responses", () => {
  it("keeps native authentication HTTP routes unmounted until business gates are implemented", async () => {
    const res = await fetchPath("/api/auth/get-session");
    expect(res.status).toBe(404);
    expectSecurityHeaders(res);
  });

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
    expect(html).toContain('name="theme"');
    expect(html).not.toMatch(/href="\/(series|movies|library|playlists|invites|account|admin)(?:["#?\/])/);
    expect(html).not.toMatch(/PROTO|proto\/frontend-v1|站长待填/);
    expect(html.indexOf("localStorage.getItem('site-theme')")).toBeLessThan(html.indexOf('rel="stylesheet"'));
  });
});
