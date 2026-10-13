import { APIError } from "better-auth/api";

export function cookieValue(request: Request, name: string) {
  const values = (request.headers.get("Cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
export const cookieName = (env: Env, name: string) => `${new URL(env.APP_ORIGIN).protocol === "https:" ? "__Host-" : ""}${name}`;
export const privateCookie = (env: Env, name: string, value: string, seconds: number) =>
  `${cookieName(env, name)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(env.APP_ORIGIN).protocol === "https:" ? "; Secure" : ""}`;
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");

export function checkOrigin(request: Request, env: Env) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || site === "same-site" || request.headers.get("Origin") !== new URL(env.APP_ORIGIN).origin) {
    throw new APIError("FORBIDDEN", { code: "CSRF_INVALID", message: "请求来源无效。" });
  }
}
const csrfKey = (env: Env) => crypto.subtle.importKey("raw", new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export async function csrfData(request: Request, env: Env) {
  const current = cookieValue(request, cookieName(env, "csrf"));
  const nonce = current && /^[a-f0-9]{64}$/.test(current) ? current : randomToken();
  const signature = await crypto.subtle.sign("HMAC", await csrfKey(env), new TextEncoder().encode(`business-csrf\0${nonce}`));
  return { csrfToken: Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join(""),
    headers: new Headers(current === nonce ? {} : { "Set-Cookie": privateCookie(env, "csrf", nonce, 86400) }) };
}
export async function checkCsrf(request: Request, env: Env, token: unknown) {
  checkOrigin(request, env);
  const nonce = cookieValue(request, cookieName(env, "csrf"));
  if (!nonce || !/^[a-f0-9]{64}$/.test(nonce) || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)
    || !await crypto.subtle.verify("HMAC", await csrfKey(env), Uint8Array.from(token.match(/../g)!, value => parseInt(value, 16)), new TextEncoder().encode(`business-csrf\0${nonce}`))) {
    throw new APIError("FORBIDDEN", { code: "CSRF_INVALID", message: "页面凭证已失效，请刷新后重试。" });
  }
}
export function safeNext(value: string | null, origin: string, fallback = "/account") {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f]/.test(value)) return fallback;
  const url = new URL(value, origin);
  return url.origin === new URL(origin).origin ? `${url.pathname}${url.search}` : fallback;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let length = 0;
  let text = "";
  const decoder = new TextDecoder();
  const reader = request.body?.getReader();
  if (reader) while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16384) { await reader.cancel(); throw new APIError("PAYLOAD_TOO_LARGE", { code: "INPUT_TOO_LARGE", message: "请求过大。" }); }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const value = JSON.parse(text + decoder.decode());
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* Use a stable validation error. */ }
  throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "请求格式无效。" });
}
