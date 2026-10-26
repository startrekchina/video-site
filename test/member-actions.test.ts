import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { symmetricEncrypt } from "better-auth/crypto";
import { createAuth } from "@/lib/auth.server";
import { adminHttp } from "@/lib/admin.server";
import { invitationsHttp } from "@/lib/invitations.server";
import { accountHttp } from "@/lib/account.server";
import { login, member, request, uncached } from "./fixtures/auth";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).includes("/siteverify") ? { success: true, hostname: "localhost", action: "auth" } : { status: "error" }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setupAdmin(name = "Admiral") {
  const user = await member(name); const anti = { cookie: await login(name) };
  await env.DB.batch([
    env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(user.id),
    env.DB.prepare('UPDATE "user" SET twoFactorEnabled = 1 WHERE id = ?').bind(user.id),
  ]);
  await (await createAuth(env).$context).adapter.create({ model: "twoFactor", data: {
    userId: user.id, secret: await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: "fictional-seed" }), backupCodes: "[]", verified: true,
  } });
  return { ...anti, user };
}
const adminPost = (id: string, action: string, anti: { cookie: string }, body: object = {}) =>
  adminHttp(request(`/admin/members/${id}/${action}`, body, anti.cookie), env);
const issue = (anti: { cookie: string }, operationId = crypto.randomUUID()) =>
  invitationsHttp(request("/invites/create", { operationId }, anti.cookie), env);

it("removes expired admin counters without weakening the active budget or deleting other operation counters", async () => {
  const admin = await setupAdmin(), target = await member(), now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rate_limit_counters VALUES (?, 'admin', ?, 29, ?)").bind(`admin:${admin.user.id}`, now - 1000, now + 59000),
    env.DB.prepare("INSERT INTO rate_limit_counters VALUES ('admin:expired', 'admin', ?, 30, ?)").bind(now - 60000, now),
    env.DB.prepare("INSERT INTO rate_limit_counters VALUES ('admin:active', 'admin', ?, 7, ?)").bind(now - 1000, now + 59000),
    env.DB.prepare("INSERT INTO rate_limit_counters VALUES ('danmaku:kept', 'danmaku', ?, 1, ?)").bind(now - 3600000, now),
  ]);
  expect((await adminPost(target.id, "quota", admin, { total: 9 })).status).toBe(200);
  await expect(adminPost(target.id, "quota", admin, { total: 10 })).rejects.toMatchObject({ statusCode: 429, body: { code: "ADMIN_RATE_LIMITED" } });
  expect(await env.DB.prepare("SELECT sum(count) AS n FROM rate_limit_counters WHERE key = ? AND operation = 'admin'").bind(`admin:${admin.user.id}`).first<number>("n")).toBe(30);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM rate_limit_counters WHERE key = 'admin:expired'").first<number>("n")).toBe(0);
  expect(await env.DB.prepare("SELECT count FROM rate_limit_counters WHERE key = 'admin:active'").first<number>("count")).toBe(7);
  expect(await env.DB.prepare("SELECT count FROM rate_limit_counters WHERE key = 'danmaku:kept'").first<number>("count")).toBe(1);
});

it("serves real admin totals, filtered pages and invitation trees without credentials", async () => {
  const admin = await setupAdmin(); const root = await member("Root"); await member("Branch", true, root.id);
  const anti = { cookie: await login("Root") }; const issued = await (await issue(anti)).json() as { data: { code: string } };
  const read = async (path: string, cookie = admin.cookie) => (await adminHttp(request("/admin/members/" + path, undefined, cookie), env)).json() as Promise<{ data: unknown }>;
  expect((await read("stats?q=branch")).data).toMatchObject({ total: 3, active: 3, filtered: 1, roots: 2, validUnused: 1, invitationCount: 1 });
  expect((await read("data?q=branch")).data).toEqual([expect.objectContaining({ username: "Branch", invitedBy: "Root", childCount: 0 })]);
  expect(JSON.stringify(await read("data"))).not.toContain("root@example.test");
  expect((await read("roots")).data).toEqual(expect.arrayContaining([expect.objectContaining({ username: "Root", childCount: 1 })]));
  expect((await read("invitations")).data).toEqual([expect.objectContaining({ issuer: "Root", issuerId: root.id })]);
  expect(JSON.stringify(await read("invitations"))).not.toMatch(/code_hash|password|backupCodes|session|secret/);
  expect(JSON.stringify(await read("invitations"))).not.toContain(issued.data.code);
  expect((await read("data?page=2")).data).toEqual([]);
  await expect(read("stats", anti.cookie)).rejects.toMatchObject({ statusCode: 403 });
  await expect(read("data?page=0")).rejects.toMatchObject({ statusCode: 400 });
  await env.DB.prepare("UPDATE member_profiles SET role = 'member' WHERE user_id = ?").bind(admin.user.id).run();
  await expect(read("roots")).rejects.toMatchObject({ statusCode: 403 });
});

it("enforces exact concurrent quota, idempotent issue/revoke, expiry and permanent used occupancy", async () => {
  const user = await member(); const anti = { cookie: await login() }; const operationId = crypto.randomUUID();
  const same = await Promise.all([issue(anti, operationId), issue(anti, operationId)]);
  const values = await Promise.all(same.map(response => response.json())) as { data: { id: string; code: string } }[];
  expect(values[0].data).toEqual(values[1].data);
  const parallel = await Promise.allSettled(Array.from({ length: 5 }, () => issue(anti)));
  expect(parallel.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const listing = await invitationsHttp(request("/invites/data", undefined, anti.cookie), env);
  const result = await listing.json() as { data: { occupied: number; invitations: object[] } };
  expect(result.data.occupied).toBe(2); expect(JSON.stringify(result)).not.toContain(values[0].data.code); expect(JSON.stringify(result)).not.toContain("code_hash");
  for (let i = 0; i < 2; i++) expect((await invitationsHttp(request(`/invites/${values[0].data.id}/revoke`, {}, anti.cookie), env)).status).toBe(200);
  await issue(anti);
  // Workers time only advances on I/O, so the invitation just issued can share this millisecond; backdate creation too.
  await env.DB.prepare("UPDATE invitations SET created_at = ?, expires_at = ? WHERE issuer_user_id = ? AND revoked_at IS NULL").bind(Date.now() - 2, Date.now() - 1, user.id).run();
  await issue(anti);
  const child = await member("Quinn", true, user.id);
  await env.DB.prepare("UPDATE invitations SET used_by_user_id = ?, used_at = ? WHERE id = ?").bind(child.id, Date.now(), values[0].data.id).run();
  expect((await (await invitationsHttp(request("/invites/data", undefined, anti.cookie), env)).json() as { data: { occupied: number } }).data.occupied).toBe(2);
  await expect(issue(anti)).rejects.toMatchObject({ body: { code: "QUOTA_EXHAUSTED" } });
});

it("allows admins unlimited issue without a fresh session, and refuses foreign invitations or sessions", async () => {
  const admin = await setupAdmin(); await env.DB.prepare("UPDATE session SET createdAt = ? WHERE userId = ?").bind(new Date(Date.now() - 600000).toISOString(), admin.user.id).run();
  for (let i = 0; i < 4; i++) expect((await issue(admin)).status).toBe(200);
  const user = await member(); const anti = { cookie: await login() };
  const created = await issue(admin); const data = await created.json() as { data: { id: string } };
  await expect(invitationsHttp(request(`/invites/${data.data.id}/revoke`, {}, anti.cookie), env)).rejects.toMatchObject({ statusCode: 409 });
  const foreign = await env.DB.prepare("SELECT id FROM session WHERE userId = ?").bind(admin.user.id).first<string>("id");
  await expect(accountHttp(request(`/account/sessions/${foreign}/revoke`, {}, anti.cookie), env)).rejects.toMatchObject({ statusCode: 404 });
  const sessions = await accountHttp(request("/account/sessions", undefined, anti.cookie), env);
  const text = await sessions.text(); expect(text).not.toMatch(/"token"|"ipAddress"/); expect(text).not.toContain(admin.user.id);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE userId = ?").bind(user.id).first<number>("n")).toBe(1);
});

it("requires live role, verified TOTP, fresh creation time and a same-origin JSON request for all high-impact actions", async () => {
  const admin = await setupAdmin(); const target = await member();
  await env.DB.prepare("UPDATE session SET createdAt = ? WHERE userId = ?").bind(new Date(Date.now() - 301000).toISOString(), admin.user.id).run();
  // A real createdAt never changes, so aging it in D1 shows only on the authoritative read; the write SQL refuses it even from the cookie cache.
  for (const action of ["ban", "unban", "quota", "role"]) await expect(adminPost(target.id, action, { cookie: uncached(admin.cookie) }, { cascade: false, total: 2, role: "admin" })).rejects.toMatchObject({ body: { code: "FRESH_SESSION_REQUIRED" } });
  await expect(adminPost(target.id, "ban", admin, { cascade: false })).rejects.toMatchObject({ statusCode: 409 });
  await env.DB.prepare("UPDATE session SET createdAt = ? WHERE userId = ?").bind(new Date().toISOString(), admin.user.id).run();
  const url = `/admin/members/${target.id}/ban`;
  for (const [headers, code] of [[{ Origin: "https://evil.invalid" }, "CSRF_INVALID"], [{ "Sec-Fetch-Site": "same-site" }, "CSRF_INVALID"], [{ "Content-Type": "text/plain" }, "INVALID_INPUT"]] as const) {
    await expect(adminHttp(request(url, { cascade: false }, admin.cookie, headers), env)).rejects.toMatchObject({ body: { code } });
  }
  expect(await env.DB.prepare("SELECT status FROM member_profiles WHERE user_id = ?").bind(target.id).first<string>("status")).toBe("active");
  await env.DB.prepare("UPDATE twoFactor SET verified = 0 WHERE userId = ?").bind(admin.user.id).run();
  await expect(adminPost(target.id, "ban", admin, { cascade: false })).rejects.toMatchObject({ body: { code: "FRESH_SESSION_REQUIRED" } });
  await env.DB.prepare("UPDATE member_profiles SET role = 'member' WHERE user_id = ?").bind(admin.user.id).run();
  await expect(adminPost(target.id, "ban", admin, { cascade: false })).rejects.toMatchObject({ statusCode: 403 });
});

it("atomically cascades through ordinary descendants and stops at another admin; failed mail does not undo the ban", async () => {
  const admin = await setupAdmin(); const target = await member("Root"); const child = await member("Child", true, target.id); const leaf = await member("Leaf", true, child.id); const boundary = await member("Boundary", true, target.id); const beyond = await member("Beyond", true, boundary.id);
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(boundary.id).run();
  const preview = await (await adminHttp(request("/admin/members/" + target.id + "/ban-preview", undefined, admin.cookie), env)).json() as { data: { total: number; active: number; members: { username: string }[] } };
  expect(preview.data.total).toBe(2); expect(preview.data.active).toBe(2);
  expect(preview.data.members.map(row => row.username).sort()).toEqual(["Child", "Leaf"]);
  const targetCookie = await login("Root"); const anti = { cookie: targetCookie }; await issue(anti);
  const result = await adminPost(target.id, "ban", admin, { cascade: true });
  const body = await result.json() as { data: { changed: number; failedNotifications: number } }; expect(body.data.failedNotifications).toBe(3); expect(body.data.changed).toBe(3);
  const descendants = await adminHttp(request(`/admin/members/${target.id}/invited`, undefined, admin.cookie), env);
  const listed = await descendants.json() as { data: { user_id: string }[] };
  expect(listed.data.map(row => row.user_id).sort()).toEqual([child.id, boundary.id].sort());
  for (const id of [target.id, child.id, leaf.id]) expect(await env.DB.prepare("SELECT status FROM member_profiles WHERE user_id = ?").bind(id).first<string>("status")).toBe("banned");
  for (const id of [boundary.id, beyond.id]) expect(await env.DB.prepare("SELECT status FROM member_profiles WHERE user_id = ?").bind(id).first<string>("status")).toBe("active");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE userId = ?").bind(target.id).first<number>("n")).toBe(0);
  expect(await env.DB.prepare("SELECT revoked_at FROM invitations WHERE issuer_user_id = ?").bind(target.id).first<number>("revoked_at")).toBeGreaterThan(0);
  const deliveries = await env.DB.prepare("SELECT count(*) AS n FROM email_deliveries").first<number>("n");
  expect((await adminPost(target.id, "unban", admin)).status).toBe(200);
  expect(await env.DB.prepare("SELECT status FROM member_profiles WHERE user_id = ?").bind(child.id).first<string>("status")).toBe("banned");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM email_deliveries").first<number>("n")).toBe(deliveries);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE userId = ?").bind(target.id).first<number>("n")).toBe(0);
  await expect(adminPost(target.id, "unban", admin)).rejects.toMatchObject({ statusCode: 409 });
});

it("preserves expired invitations when banning and unbanning their issuer", async () => {
  const admin = await setupAdmin(); const target = await member("Root"); const child = await member("Child", true, target.id);
  await login("Root"); const now = Date.now(); const previousRevocation = now - 60000;
  const invitation = (id: string, expiresAt: number, revokedAt: number | null = null, consumer: string | null = null) =>
    env.DB.prepare(`INSERT INTO invitations
      (id, code_hash, issuer_user_id, operation_id, created_at, expires_at, revoked_at, used_by_user_id, used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, `fictional-${id}`, target.id, id, now - 172800000, expiresAt, revokedAt, consumer, consumer ? now - 100000000 : null);
  await env.DB.batch([
    invitation("valid", now + 86400000), invitation("expired", now - 86400000),
    invitation("used", now - 86400000, null, child.id), invitation("revoked", now + 86400000, previousRevocation),
  ]);
  const revokedAt = (id: string) => env.DB.prepare("SELECT revoked_at FROM invitations WHERE id = ?").bind(id).first<number>("revoked_at");
  expect((await adminPost(target.id, "ban", admin, { cascade: false })).status).toBe(200);
  const validRevocation = await revokedAt("valid"); expect(validRevocation).toBeGreaterThan(0);
  expect(await revokedAt("expired")).toBeNull(); expect(await revokedAt("used")).toBeNull();
  expect(await revokedAt("revoked")).toBe(previousRevocation);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE userId = ?").bind(target.id).first<number>("n")).toBe(0);
  expect((await adminPost(target.id, "unban", admin)).status).toBe(200);
  expect(await revokedAt("expired")).toBeNull(); expect(await revokedAt("valid")).toBe(validRevocation);
  expect(await env.DB.prepare("SELECT used_by_user_id FROM invitations WHERE id = 'used'").first()).toEqual({ used_by_user_id: child.id });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE userId = ?").bind(target.id).first<number>("n")).toBe(0);
});

it("does not count an unverified admin as a usable replacement for the last verified admin", async () => {
  const admin = await setupAdmin(); const pending = await member("Pending", false); const helper = await setupAdmin("Helper");
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(pending.id).run();
  expect((await adminPost(helper.user.id, "role", admin, { role: "member" })).status).toBe(200);
  await expect(adminPost(admin.user.id, "role", helper, { role: "member" })).rejects.toMatchObject({ statusCode: 403 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM member_profiles AS p JOIN "user" AS u ON u.id = p.user_id WHERE p.role = ? AND p.status = ? AND u.emailVerified = 1').bind("admin", "active").first<number>("n")).toBe(1);
});

it("rejects self changes and parallel removal of the last administrator at the SQL write boundary", async () => {
  const a = await setupAdmin("AdmiralA"); const b = await setupAdmin("AdmiralB");
  await expect(adminPost(a.user.id, "role", a, { role: "member" })).rejects.toMatchObject({ statusCode: 409 });
  await expect(adminPost(a.user.id, "ban", a, { cascade: true })).rejects.toMatchObject({ statusCode: 409 });
  const result = await Promise.allSettled([adminPost(b.user.id, "role", a, { role: "member" }), adminPost(a.user.id, "role", b, { role: "member" })]);
  expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM member_profiles WHERE role = 'admin' AND status = 'active'").first<number>("n")).toBe(1);
});

it("does not partially ban a chain if native session cleanup fails, and quota cannot fall below occupied", async () => {
  const admin = await setupAdmin(); const target = await member(); const anti = { cookie: await login() }; await issue(anti);
  await expect(adminPost(target.id, "quota", admin, { total: 0 })).rejects.toMatchObject({ body: { code: "QUOTA_EXHAUSTED" } });
  await env.DB.prepare("CREATE TRIGGER fictional_ban_failure BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'Fictional ban failure'); END").run();
  await expect(adminPost(target.id, "ban", admin, { cascade: false })).rejects.toThrow();
  expect(await env.DB.prepare("SELECT status FROM member_profiles WHERE user_id = ?").bind(target.id).first<string>("status")).toBe("active");
  expect(await env.DB.prepare("SELECT revoked_at FROM invitations WHERE issuer_user_id = ?").bind(target.id).first()).toEqual({ revoked_at: null });
  expect(await env.DB.prepare("SELECT count(*) AS n FROM session WHERE userId = ?").bind(target.id).first<number>("n")).toBe(1);
});

it("admits exactly thirty concurrent admin operations with a Retry-After bound", async () => {
  const admin = await setupAdmin(); const target = await member();
  const results = await Promise.allSettled(Array.from({ length: 34 }, () => adminPost(target.id, "quota", admin, { total: 2 })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(30);
  for (const result of results.filter(result => result.status === "rejected")) expect((result as PromiseRejectedResult).reason).toMatchObject({ statusCode: 429, body: { code: "ADMIN_RATE_LIMITED" } });
});
