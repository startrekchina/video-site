import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { checkWrite, cookieName, cookieValue, privateCookie, safeNext } from "@/lib/security.server";

it("accepts only same-origin JSON writes and rejects cross-site, same-site, missing-origin and non-JSON requests", () => {
  const origin = new URL(env.APP_ORIGIN).origin, json = { Origin: origin, "Content-Type": "application/json; charset=utf-8" };
  expect(() => checkWrite(new Request(env.APP_ORIGIN, { method: "POST", headers: json }), env)).not.toThrow();
  expect(() => checkWrite(new Request(env.APP_ORIGIN, { method: "POST", headers: { ...json, "Sec-Fetch-Site": "same-origin" } }), env)).not.toThrow();
  for (const [headers, code] of [
    [{ ...json, Origin: "https://evil.invalid" }, "CSRF_INVALID"], [{ "Content-Type": "application/json" }, "CSRF_INVALID"],
    [{ ...json, "Sec-Fetch-Site": "cross-site" }, "CSRF_INVALID"], [{ ...json, "Sec-Fetch-Site": "same-site" }, "CSRF_INVALID"],
    [{ ...json, "Content-Type": "text/plain" }, "INVALID_INPUT"], [{ ...json, "Content-Type": "application/x-www-form-urlencoded" }, "INVALID_INPUT"],
    [{ ...json, "Content-Type": "multipart/form-data; boundary=x" }, "INVALID_INPUT"], [{ Origin: origin }, "INVALID_INPUT"],
  ] as const) expect(() => checkWrite(new Request(env.APP_ORIGIN, { method: "POST", headers }), env), JSON.stringify(headers)).toThrow(expect.objectContaining({ body: expect.objectContaining({ code }) }));
  expect(cookieValue(new Request(env.APP_ORIGIN, { headers: { Cookie: "x=1; xx=2" } }), "x")).toBe("1");
});

it("uses host-only secure cookies on deployed HTTPS and accepts only safe relative return targets", () => {
  const secure = { ...env, APP_ORIGIN: "https://example.test" };
  expect(cookieName(secure, "registration")).toBe("__Host-registration");
  expect(privateCookie(secure, "registration", "fictional", 300)).toBe("__Host-registration=fictional; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure");
  for (const value of ["//evil.invalid", "/\\evil.invalid", "https://evil.invalid", "/\u0000evil", "x".repeat(2049)]) expect(safeNext(value, env.APP_ORIGIN)).toBe("/");
  expect(safeNext(null, env.APP_ORIGIN)).toBe("/");
  expect(safeNext("/invites?view=mine", env.APP_ORIGIN)).toBe("/invites?view=mine");
});

it("rejects return targets that become protocol-relative after URL normalization", () => {
  for (const value of ["/..//evil.invalid", "/.//evil.invalid", "/%2e%2e//evil.invalid", "/a/../..//evil.invalid?view=mine", "/a/..///evil.invalid"]) {
    const next = safeNext(value, env.APP_ORIGIN);
    expect(next, value).toBe("/");
    expect(new URL(next, env.APP_ORIGIN).origin).toBe(new URL(env.APP_ORIGIN).origin);
  }
  expect(safeNext("/title/../invites?view=mine", env.APP_ORIGIN)).toBe("/invites?view=mine");
  expect(safeNext("/search?q=https%3A%2F%2Fexample.test", env.APP_ORIGIN)).toBe("/search?q=https%3A%2F%2Fexample.test");
});
