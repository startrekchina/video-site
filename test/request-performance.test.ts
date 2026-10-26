import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { seedCatalog } from "./fixtures/catalog";
import { login, member, request, uncached } from "./fixtures/auth";
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
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4', '720p','fictional-object',20,'hash',4,'h264','aac',100,NULL)"),
    env.DB.prepare("INSERT INTO subtitle_tracks VALUES ('zh','episode-unit','zh','vtt','中文','zh','fictional-subtitle',8,'hash',NULL)"),
  ]);
  const video = await env.MEDIA_BUCKET.put("fictional-object", "0123456789abcdefghij");
  const subtitle = await env.MEDIA_BUCKET.put("fictional-subtitle", "WEBVTT\n\n");
  await env.DB.batch([
    env.DB.prepare("UPDATE media_files SET r2_etag = ? WHERE id = 'source'").bind(video!.etag),
    env.DB.prepare("UPDATE subtitle_tracks SET r2_etag = ? WHERE id = 'zh'").bind(subtitle!.etag),
  ]);
  const runtime = { ...env, APP_ENV: "development" };
  // Serial depth counts calls that start only after the previous chain ended; parallel batches share one level.
  async function measure(label: string, input: Request, status: number, budget: number, sessionReads: number, serialBudget = budget) {
    const probe = probeD1(env.DB), ctx = createExecutionContext();
    const start = performance.now();
    const response = await worker.fetch(input, { ...runtime, DB: probe.db }, ctx), headersMs = performance.now() - start;
    expect(response.status, label).toBe(status); const bytes = (await response.arrayBuffer()).byteLength; await waitOnExecutionContext(ctx);
    const sessions = probe.calls.flatMap(call => call.statements).filter(kind => kind === "session").length;
    let serial = 0, end = -1;
    for (const call of [...probe.calls].sort((a, b) => a.start - b.start)) { if (call.start >= end) serial++; end = Math.max(end, call.end ?? Infinity); }
    console.info(JSON.stringify({ label, requestId: response.headers.get("X-Request-Id"), calls: probe.calls, roundTrips: probe.calls.length, serial,
      sql: probe.calls.flatMap(call => call.statements).length, sessions, headersMs, bytes }));
    expect.soft(sessions, label + " native session reads").toBe(sessionReads);
    expect.soft(probe.calls.length, label + " D1 round trips").toBeLessThanOrEqual(budget);
    expect.soft(serial, label + " serial D1 round trips").toBeLessThanOrEqual(serialBudget);
  }
  // With the signed cookie cache, each loader sends one batch that also checks the live member: one serial D1 round trip.
  for (const path of ["/", "/series", "/movies", "/series/ld", "/series/ld/s1/e1", "/movies/the-motion-picture"]) {
    // Detail and watch pages sit below a catalog path.
    for (const suffix of ["", ".data"]) await measure(path + suffix, request(path + suffix, undefined, cookie), 200, path.split("/").length > 2 ? 3 : 2, 0, 1);
  }
  await measure("watch-only-data", request("/series/ld/s1/e1.data?_routes=series-watch", undefined, cookie), 200, 2, 0, 1);
  // Media requests: one primary query that authorizes the live session and member and finds the resource.
  for (const method of ["GET", "HEAD"]) await measure("media-" + method, new Request(request("/media/source", undefined, cookie), { method }), 200, 1, 0);
  await measure("range", request("/media/source", undefined, cookie, { Range: "bytes=2-5" }), 206, 1, 0);
  await measure("subtitle", request("/subtitles/zh", undefined, cookie), 200, 1, 0);
  // The public session endpoint stays authoritative.
  
await measure("get-session", request("/api/auth/get-session", undefined, cookie), 200, 5, 1);
  await measure("no-source", request("/movies/the-motion-picture/watch.data", undefined, cookie), 200, 3, 0, 1);
  await measure("invites", request("/invites.data", undefined, cookie), 200, 4, 0, 3);
  await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = (SELECT id FROM user WHERE username = 'kepler')").run();
  await measure("admin", request("/admin.data", undefined, cookie), 200, 4, 0, 3);
  await env.DB.prepare('UPDATE "user" SET emailVerified = 0 WHERE username = ?').bind("kepler").run();
  await measure("unverified", request("/series", undefined, cookie), 302, 2, 0, 1);
  await env.DB.prepare('UPDATE "user" SET emailVerified = 1, twoFactorEnabled = 1 WHERE username = ?').bind("kepler").run();
  await env.DB.prepare('INSERT INTO twoFactor (id, secret, backupCodes, userId, verified) SELECT ?, ?, ?, id, 1 FROM "user" WHERE username = ?')
    .bind("fictional-factor", "fictional-encrypted", "fictional-codes", "kepler").run();
  await measure("admin-write", request("/admin/members/nova/quota", { total: 3 }, cookie), 200, 4, 0);
  await measure("guest", request("/"), 200, 0, 0);
  await measure("invalid-cookie", request("/series", undefined, "session=invalid"), 302, 0, 0);
  await env.DB.prepare("UPDATE session SET updatedAt = ?, expiresAt = ?").bind(new Date(Date.now() - 2 * 86400000).toISOString(), new Date(Date.now() + 28 * 86400000).toISOString()).run();
  // An expired cookie cache reads the session from D1 once and renews it before the loaders run.
  await measure("rolling-watch", request("/series/ld/s1/e1.data", undefined, uncached(cookie)), 200, 6, 1, 4);
  const ownSession = await env.DB.prepare('SELECT s.id FROM session s JOIN "user" u ON u.id = s.userId WHERE u.username = ?').bind("kepler").first<string>("id");
  // Native authoritative, target-ownership and delete-hook lookups remain necessary library work.
  await measure("self-revoke", request(`/account/sessions/${ownSession}/revoke`, {}, cookie), 200, 9, 3);
  // A still-cached revoked session is refused by the member check inside each loader batch.
  await measure("revoked", request("/series/ld/s1/e1", undefined, cookie), 302, 3, 0, 1);
}, 60000);
