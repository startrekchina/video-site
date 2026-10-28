import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { login, member, request } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";
import { probeD1 } from "./fixtures/d1-probe";

let adminId: string, cookie: string;
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  adminId = (await member("Kepler")).id;
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(adminId).run();
  cookie = await login("Kepler");
  await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO comments VALUES ('root', 'episode-unit', 'nova', 'Fictional comment', ?)").bind(Date.now()),
    env.DB.prepare("INSERT INTO comment_replies VALUES ('reply', 'root', 'quinn', NULL, 'Fictional reply', ?)").bind(Date.now()),
    env.DB.prepare("INSERT INTO discussion_votes VALUES ('nova', NULL, 'reply', 1)"),
    env.DB.prepare("INSERT INTO danmaku VALUES ('message', 'episode-unit', 'nova', 1, 'Fictional danmaku', 0, '#FFFFFF', ?)").bind(Date.now()),
  ]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function remove(path: string, db = env.DB) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(request(`/units/episode-unit/${path}`, {}, cookie), { method: "DELETE" }), { ...env, DB: db }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
const snapshot = () => env.DB.batch(["danmaku", "comments", "comment_replies", "discussion_votes", "comment_reply_cursors"]
  .map(table => env.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`))).then(rows => rows.map(row => row.results));

describe.each([
  ["danmaku/message", "danmaku", "message"],
  ["comments/root", "comments", "root"],
  ["replies/reply", "comment_replies", "reply"],
])("administrator deletion of %s", (path, table, id) => {
  it("allows a current administrator to delete and reports a missing target on repetition", async () => {
    expect((await remove(path)).status).toBe(200);
    expect(await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first()).toBeNull();
    expect((await remove(path)).status).toBe(404);
  });

  it.each([
    ["demotion", "UPDATE member_profiles SET role = 'member' WHERE user_id = ?", 403],
    ["session revocation", "DELETE FROM session WHERE userId = ?", 401],
  ] as const)("preserves the target and related data when %s happens after the permission read", async (_, sql, status) => {
    const before = await snapshot();
    let changed = false;
    const probe = probeD1(env.DB, async call => {
      if (!changed && call.statements.includes("member")) {
        changed = true;
        await env.DB.prepare(sql).bind(adminId).run();
      }
    });
    const response = await remove(path, probe.db);
    expect(changed).toBe(true);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code: status === 401 ? "AUTH_REQUIRED" : "FORBIDDEN" } });
    expect(await snapshot()).toEqual(before);
  });
});
