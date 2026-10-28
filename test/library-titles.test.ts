import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { login, member, request } from "./fixtures/auth";

let cookie: string;
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  await member("Kepler"); cookie = await login("Kepler");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function call(method: string, path: string, body: object) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(request(path, body, cookie), { method }), env, ctx);
  await waitOnExecutionContext(ctx); return response;
}

it("rejects invisible-only and directional control titles for private and shared playlists without changing data", async () => {
  const created = await call("POST", "/me/playlists", { title: "保留的片单", visibility: "private" });
  expect(created.status).toBe(200);
  for (const title of ["\u200b", " \u200c\u200d\ufe0f ", "\u2060\u00ad", "测试\u202e片单", "\u2066test\u2069", "test\u200f", "test\nlist"]) {
    for (const visibility of ["private", "members"]) {
      const response = await call("POST", "/me/playlists", { title, visibility });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    }
  }
  expect((await env.DB.prepare("SELECT title FROM playlists").all()).results).toEqual([{ title: "保留的片单" }]);
});

it("preserves visible Unicode names, joined emoji and ordinary RTL letters", async () => {
  for (const title of ["  星际迷航  ", "👩‍💻的片单", "👨‍👩‍👧‍👦", "قائمة الأفلام", "می\u200cروم", "é / e\u0301"]) {
    const created = await call("POST", "/me/playlists", { title, visibility: "private" });
    expect(created.status).toBe(200);
    const { data: { id } } = await created.json() as { data: { id: string } };
    expect(await env.DB.prepare("SELECT title FROM playlists WHERE id = ?").bind(id).first("title")).toBe(title.trim());
  }
});
