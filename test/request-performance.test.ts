import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { seedCatalog } from "./fixtures/catalog";
import { csrf, login, member, request } from "./fixtures/auth";
import { probeD1 } from "./fixtures/d1-probe";

beforeAll(async () => {
  const ctx = createExecutionContext();
  await worker.fetch(request("/robots.txt"), env, ctx); await waitOnExecutionContext(ctx);
}, 60000);

it("bounds repeated identity and media work in real Worker requests", async () => {
  await seedCatalog(env.DB);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  let cookie: string;
  try { await member("Kepler"); cookie = await login("Kepler"); } finally { vi.unstubAllGlobals(); }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-object',20,'hash',4,'h264','aac',100,NULL)"),
    env.DB.prepare("INSERT INTO subtitle_tracks VALUES ('zh','episode-unit','zh','vtt','中文','zh','fictional-subtitle',8,'hash',NULL)"),
  ]);
  const video = await env.MEDIA_BUCKET.put("fictional-object", "0123456789abcdefghij");
  const subtitle = await env.MEDIA_BUCKET.put("fictional-subtitle", "WEBVTT\n\n");
  await env.DB.batch([
    env.DB.prepare("UPDATE media_files SET r2_etag = ? WHERE id = 'source'").bind(video!.etag),
    env.DB.prepare("UPDATE subtitle_tracks SET r2_etag = ? WHERE id = 'zh'").bind(subtitle!.etag),
  ]);
  const runtime = { ...env, APP_ENV: "development" };
  const protection = await csrf(cookie); cookie = protection.cookie;
  async function measure(label: string, input: Request, status: number, budget: number, sessionReads: number) {
    const probe = probeD1(env.DB), ctx = createExecutionContext();
    const start = performance.now();
    const response = await worker.fetch(input, { ...runtime, DB: probe.db }, ctx), headersMs = performance.now() - start;
    expect(response.status, label).toBe(status); const bytes = (await response.arrayBuffer()).byteLength; await waitOnExecutionContext(ctx);
    const sessions = probe.calls.flatMap(call => call.statements).filter(kind => kind === "session").length;
    console.info(JSON.stringify({ label, requestId: response.headers.get("X-Request-Id"), calls: probe.calls, roundTrips: probe.calls.length,
      sql: probe.calls.flatMap(call => call.statements).length, sessions, headersMs, bytes }));
    expect.soft(sessions, label + " native session reads").toBe(sessionReads);
    expect.soft(probe.calls.length, label + " D1 round trips").toBeLessThanOrEqual(budget);
  }
  for (const path of ["/", "/series", "/movies", "/title/series", "/watch/episode-unit"]) {
    for (const suffix of ["", ".data"]) await measure(path + suffix, request(path + suffix, undefined, cookie), 200, path.startsWith("/watch/") || path.startsWith("/title/") ? 6 : 5, 1);
  }
  await measure("watch-only-data", request("/watch/episode-unit.data?_routes=routes%2Fwatch", undefined, cookie), 200, 5, 1);
  // Media requests: the native session lookup plus one primary query that authorizes and finds the resource.
  for (const method of ["GET", "HEAD"]) await measure("media-" + method, new Request(request("/media/source", undefined, cookie), { method }), 200, 3, 1);
  await measure("range", request("/media/source", undefined, cookie, { Range: "bytes=2-5" }), 206, 3, 1);
  await measure("subtitle", request("/subtitles/zh", undefined, cookie), 200, 3, 1);
  await measure("get-session", request("/api/auth/get-session", undefined, cookie), 200, 5, 1);
  await measure("no-source", request("/watch/movie-unit.data", undefined, cookie), 200, 6, 1);
  await measure("invites", request("/invites.data", undefined, cookie), 200, 6, 1);
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = (SELECT id FROM user WHERE username = 'kepler')").run();
  await measure("admin", request("/admin.data", undefined, cookie), 200, 6, 1);
  await env.DB.prepare('UPDATE "user" SET emailVerified = 0 WHERE username = ?').bind("kepler").run();
  await measure("unverified", request("/series", undefined, cookie), 302, 3, 1);
  await env.DB.prepare('UPDATE "user" SET emailVerified = 1, twoFactorEnabled = 1 WHERE username = ?').bind("kepler").run();
  await env.DB.prepare('INSERT INTO twoFactor (id, secret, backupCodes, userId, verified) SELECT ?, ?, ?, id, 1 FROM "user" WHERE username = ?')
    .bind("fictional-factor", "fictional-encrypted", "fictional-codes", "kepler").run();
  await measure("admin-write", request("/admin/members/nova/quota", { total: 3, csrfToken: protection.token }, cookie), 200, 6, 1);
  await measure("guest", request("/"), 200, 0, 0);
  await measure("invalid-cookie", request("/series", undefined, "session=invalid"), 302, 0, 0);
  await env.DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ?").bind(new Date(Date.now() - 2 * 86400000).toISOString(), new Date(Date.now() + 28 * 86400000).toISOString()).run();
  await measure("rolling-watch", request("/watch/episode-unit.data", undefined, cookie), 200, 7, 1);
  const ownSession = await env.DB.prepare('SELECT s.id FROM session s JOIN "user" u ON u.id = s.userId WHERE u.username = ?').bind("kepler").first<string>("id");
  // Native authoritative, target-ownership and delete-hook lookups remain necessary library work.
  await measure("self-revoke", request(`/account/sessions/${ownSession}/revoke`, { csrfToken: protection.token }, cookie), 200, 10, 4);
  await measure("revoked", request("/watch/episode-unit", undefined, cookie), 302, 1, 1);
}, 60000);
