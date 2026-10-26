import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { login, member, request } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";

let author: string, admin: string;
const root = "/units/movie-unit/comments/root";
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  await member("Kepler"); const owner = await member("Vega");
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(owner.id).run();
  author = await login("Kepler"); admin = await login("Vega");
  await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO comments VALUES ('root', 'movie-unit', 'nova', 'Fictional root', ?)").bind(Date.now()),
    env.DB.prepare("INSERT INTO comment_replies VALUES ('reply', 'root', 'quinn', NULL, 'Fictional reply', ?)").bind(Date.now()),
    env.DB.prepare("INSERT INTO discussion_votes VALUES ('nova', NULL, 'reply', 1)"),
  ]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function call(method: string, path: string, body = {}, cookie = author) {
  const ctx = createExecutionContext(), response = await worker.fetch(new Request(request(path, body, cookie), { method }), { ...env, APP_ENV: "development" }, ctx);
  await waitOnExecutionContext(ctx); return response;
}

it("returns success or a missing target for writes racing a conversation delete, never a server error", async () => {
  const results = await Promise.all([
    call("DELETE", root, {}, admin), call("POST", `${root}/replies`, { bodyMarkdown: "Racing reply" }),
    call("PUT", `${root}/vote`, { value: 1 }), call("PUT", "/units/movie-unit/replies/reply/vote", { value: 1 }),
  ]);
  expect(results[0].status).toBe(200);
  for (const response of results.slice(1)) {
    expect([200, 404]).toContain(response.status);
    if (response.status === 404) expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  }
  expect(await env.DB.prepare("SELECT count(*) AS n FROM comments").first<number>("n")).toBe(0);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM comment_replies").first<number>("n")).toBe(0);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM discussion_votes").first<number>("n")).toBe(0);
});

it("rolls back the conversation, replies, votes and cursor when a cascaded delete fails", async () => {
  const tables = ["comments", "comment_replies", "discussion_votes", "comment_reply_cursors"];
  const snapshot = () => env.DB.batch(tables.map(table => env.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`))).then(rows => rows.map(row => row.results));
  const before = await snapshot();
  await env.DB.prepare("CREATE TRIGGER reject_fixture_vote_delete BEFORE DELETE ON discussion_votes BEGIN SELECT RAISE(ABORT, 'fictional-delete-failure'); END").run();
  try {
    expect((await call("DELETE", root, {}, admin)).status).toBe(500);
    expect(await snapshot()).toEqual(before);
  } finally { await env.DB.prepare("DROP TRIGGER reject_fixture_vote_delete").run(); }
  expect((await call("DELETE", root, {}, admin)).status).toBe(200);
  expect(await snapshot()).toEqual(tables.map(() => []));
});
