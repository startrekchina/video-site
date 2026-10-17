import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { login, member, request } from "./fixtures/auth";
import { updateBackupSchedule } from "@/lib/backups.server";

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

it("selects the available S3-only channel initially and explains a saved target becoming unavailable", async () => {
  const bindings = { ...runtime, S3_BACKUP_ENDPOINT: "https://s3.example.test", S3_BACKUP_BUCKET: "fictional", S3_BACKUP_REGION: "auto",
    S3_BACKUP_ACCESS_KEY_ID: "fictional", S3_BACKUP_SECRET_ACCESS_KEY: "fictional" };
  async function html(config: Env) {
    const ctx = createExecutionContext(), response = await worker.fetch(request("/admin/backups", undefined, owner), config, ctx);
    await waitOnExecutionContext(ctx); expect(response.status).toBe(200); return response.text();
  }
  expect(await html(bindings)).toMatch(/<option[^>]*value="s3"[^>]*selected=""/u);
  await updateBackupSchedule(bindings, { enabled: true, target: "s3", frequency: "daily", time: "04:00" });
  const unavailable = await html({ ...bindings, S3_BACKUP_SECRET_ACCESS_KEY: "" });
  expect(unavailable).toContain("已保存的渠道当前不可执行");
  expect(unavailable).toContain("或关闭自动备份"); expect(unavailable).toContain("成员查询可能暂时不可用");
  expect(unavailable).toMatch(/type="checkbox"[^>]*checked=""/u);
});
