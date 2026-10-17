import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { login, member, request } from "./fixtures/auth";

const runtime = { ...env, APP_ENV: "test", OWNER_EMAIL: "nova@example.test", BACKUP_ACCOUNT_ID: "a".repeat(32),
  BACKUP_DATABASE_ID: "00000000-0000-4000-8000-000000000000", CLOUDFLARE_API_TOKEN: "fictional-export-token" };
let owner: string, ordinary: string, admin: string, ownerId: string;
async function send(path: string, cookie = "") {
  const ctx = createExecutionContext(), response = await worker.fetch(request(path, undefined, cookie), runtime, ctx);
  await waitOnExecutionContext(ctx); return response;
}
// Match the existing HTTP suite: Vite's first UI graph compilation is setup, not a request latency assertion.
beforeAll(async () => { await (await send("/robots.txt")).text(); }, 60000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  ownerId = (await member("Nova")).id; const other = (await member("Vega")).id; await member("Kepler");
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id IN (?, ?)").bind(ownerId, other).run();
  owner = await login("Nova"); ordinary = await login("Kepler"); admin = await login("Vega");
});
afterEach(() => vi.unstubAllGlobals());
it("renders the backup page only for the owner and hides the entry from other administrators", async () => {
  const page = await send("/admin/backups", owner); expect(page.status).toBe(200);
  const html = await page.text(); expect(html).toContain("数据备份"); expect(html).toContain("创建备份");
  for (const value of [runtime.CLOUDFLARE_API_TOKEN, runtime.BACKUP_ENCRYPTION_KEY, runtime.BACKUP_ACCOUNT_ID, "backup-control/"]) expect(html).not.toContain(value);
  expect(page.headers.get("Cache-Control")).toBe("private, no-store"); expect(page.headers.get("X-Robots-Tag")).toBe("noindex");
  expect((await send("/admin/backups")).status).toBe(302);
  for (const cookie of [ordinary, admin]) expect((await send("/admin/backups", cookie)).status).toBe(403);
  expect(await (await send("/admin", owner)).text()).toContain('href="/admin/backups"');
  expect(await (await send("/admin", admin)).text()).not.toContain('href="/admin/backups"');
  await env.DB.prepare("UPDATE member_profiles SET role = 'member' WHERE user_id = ?").bind(ownerId).run();
  expect((await send("/admin/backups", owner)).status).toBe(403);
});
