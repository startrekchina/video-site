import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const fetchPath = (path: string) => exports.default.fetch(`http://example.com${path}`);

function expectSecurityHeaders(res: Response) {
  expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

describe("worker responses", () => {
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
    expectSecurityHeaders(res);
  });
});
