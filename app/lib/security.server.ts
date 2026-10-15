import { APIError } from "better-auth/api";

export function cookieValue(request: Request, name: string) {
  const values = (request.headers.get("Cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
export const cookieName = (env: Env, name: string) => `${new URL(env.APP_ORIGIN).protocol === "https:" ? "__Host-" : ""}${name}`;
export const privateCookie = (env: Env, name: string, value: string, seconds: number) =>
  `${cookieName(env, name)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(env.APP_ORIGIN).protocol === "https:" ? "; Secure" : ""}`;

export function checkOrigin(request: Request, env: Env) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || site === "same-site" || request.headers.get("Origin") !== new URL(env.APP_ORIGIN).origin) {
    throw new APIError("FORBIDDEN", { code: "CSRF_INVALID", message: "请求来源无效。" });
  }
}
// Business writes follow Better Auth's model: same origin, no cross/same-site fetch and JSON only, which a
// cross-site form cannot send. No page token, so a page left open never loses the right to submit.
export function checkWrite(request: Request, env: Env) {
  checkOrigin(request, env);
  if (!/^application\/json\s*(;|$)/iu.test(request.headers.get("Content-Type") ?? "")) {
    throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "请求格式无效。" });
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
