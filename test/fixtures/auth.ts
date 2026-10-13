import { env } from "cloudflare:workers";
import { APIError } from "better-auth/api";
import { createAuth } from "@/lib/auth.server";
import { authHttp } from "@/lib/auth-http.server";
import { csrfData } from "@/lib/security.server";

export const password = "Fictional 1701 password";
let ip = 0;
export function cookies(response: Response, original = "") {
  const entries = new Map(original.split("; ").filter(Boolean).map(part => part.split("=") as [string, string]));
  for (const cookie of response.headers.getSetCookie()) {
    const part = cookie.split(";")[0]; const at = part.indexOf("=");
    entries.set(part.slice(0, at), part.slice(at + 1));
  }
  return [...entries].map(([key, value]) => `${key}=${value}`).join("; ");
}
export function request(path: string, body?: object, cookie = "", headers: Record<string, string> = {}) {
  return new Request(`${env.APP_ORIGIN}${path}`, { method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Origin: new URL(env.APP_ORIGIN).origin,
      "cf-connecting-ip": `192.0.2.${++ip % 250 + 1}`, "x-captcha-response": "fictional-token", Cookie: cookie, ...headers },
    body: body ? JSON.stringify(body) : undefined });
}
export async function http(path: string, body?: object, cookie = "", headers: Record<string, string> = {}) {
  try { return await authHttp(request(`/api/auth${path}`, body, cookie, headers), env); }
  catch (error) { if (error instanceof APIError) return Response.json(error.body, { status: error.statusCode, headers: error.headers }); throw error; }
}
export async function csrf(cookie = "") {
  const result = await csrfData(request("/register", undefined, cookie), env);
  return { token: result.csrfToken, cookie: cookies(new Response(null, { headers: result.headers }), cookie) };
}
export async function member(username = "Nova", verified = true, parent: string | null = null) {
  const user = (await createAuth(env).api.signUpEmail({ body: { name: username, username, email: `${username.toLowerCase()}@example.test`, password } })).user;
  await env.DB.batch([
    env.DB.prepare('UPDATE "user" SET emailVerified = ? WHERE id = ?').bind(Number(verified), user.id),
    env.DB.prepare("INSERT INTO member_profiles (user_id, role, status, registration_state, invited_by_user_id, invite_quota, created_at) VALUES (?, 'member', 'active', 'completed', ?, 2, ?)").bind(user.id, parent, Date.now()),
  ]);
  return user;
}
export async function login(username = "Nova") {
  const response = await http("/sign-in/username", { username, password });
  if (response.status !== 200) throw new Error(`Fixture login failed (${response.status})`);
  return cookies(response);
}
