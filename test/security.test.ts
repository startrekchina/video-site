import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { checkCsrf, cookieName, cookieValue, csrfData, privateCookie, safeNext } from "@/lib/security.server";

it("binds business CSRF to a private nonce and rejects cross-site, missing and duplicate cookies", async () => {
  const result = await csrfData(new Request(env.APP_ORIGIN), env);
  const cookie = result.headers.getSetCookie()[0].split(";")[0];
  const headers = { Cookie: cookie, Origin: new URL(env.APP_ORIGIN).origin };
  await expect(checkCsrf(new Request(env.APP_ORIGIN, { headers }), env, result.csrfToken)).resolves.toBeUndefined();
  for (const invalid of [{ ...headers, Origin: "https://evil.invalid" }, { ...headers, "Sec-Fetch-Site": "same-site" }, { ...headers, Cookie: `${cookie}; ${cookie}` }, { ...headers, Cookie: "" }]) {
    await expect(checkCsrf(new Request(env.APP_ORIGIN, { headers: invalid }), env, result.csrfToken)).rejects.toMatchObject({ body: { code: "CSRF_INVALID" } });
  }
  expect((await csrfData(new Request(env.APP_ORIGIN, { headers }), env)).csrfToken).toBe(result.csrfToken);
  expect(cookieValue(new Request(env.APP_ORIGIN, { headers: { Cookie: "x=1; xx=2" } }), "x")).toBe("1");
});

it("uses host-only secure cookies on deployed HTTPS and accepts only safe relative return targets", () => {
  const secure = { ...env, APP_ORIGIN: "https://example.test" };
  expect(cookieName(secure, "csrf")).toBe("__Host-csrf");
  expect(privateCookie(secure, "csrf", "fictional", 300)).toBe("__Host-csrf=fictional; Path=/; HttpOnly; SameSite=Lax; Max-Age=300; Secure");
  for (const value of ["//evil.invalid", "/\\evil.invalid", "https://evil.invalid", "/\u0000evil", "x".repeat(2049)]) expect(safeNext(value, env.APP_ORIGIN)).toBe("/account");
  expect(safeNext("/invites?view=mine", env.APP_ORIGIN)).toBe("/invites?view=mine");
});
