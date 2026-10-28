import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import { login, member, request } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";

const runtime = { ...env, APP_ENV: "development" };
let cookie: string, userId: string;
beforeAll(async () => { await send(request("/robots.txt")); }, 60000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try { userId = (await member("Kepler")).id; cookie = await login("Kepler"); } finally { vi.unstubAllGlobals(); }
  await seedCatalog(env.DB);
  // The episode's media is 100 s long while its catalogue runtime says 4 s: reports are bounded by the media.
  await env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4', 'original','fictional-object',20,'hash',100,'vp9','aac',100,'fictional-version')").run();
});

async function send(input: Request) {
  const ctx = createExecutionContext(), response = await worker.fetch(input, runtime, ctx);
  await waitOnExecutionContext(ctx); return response;
}
const put = (unit: string, body: object, as = cookie, headers: Record<string, string> = {}) =>
  send(new Request(request(`/me/progress/${unit}`, body, as, headers), { method: "PUT" }));
async function json(response: Response) { return await response.json() as { data?: Record<string, unknown>; error?: { code: string; revision?: number } }; }
const row = (user = userId, unit = "episode-unit") => env.DB.prepare("SELECT position_seconds AS position, completed, revision FROM watch_progress WHERE user_id = ? AND playable_unit_id = ?")
  .bind(user, unit).first<{ position: number; completed: number; revision: number }>();

it("saves reports by revision, completes at the threshold, keeps the mark when rewatching and saves smaller positions", async () => {
  let response = await put("episode-unit", { positionSeconds: 30, expectedRevision: 0 });
  expect(response.status).toBe(200);
  expect((await json(response)).data).toMatchObject({ positionSeconds: 30, completed: false, revision: 1 });
  expect((await json(await put("episode-unit", { positionSeconds: 90, expectedRevision: 1 }))).data).toMatchObject({ completed: true, revision: 2 });
  expect((await json(await put("episode-unit", { positionSeconds: 10, expectedRevision: 2 }))).data).toMatchObject({ positionSeconds: 10, completed: true, revision: 3 });
  // A stale report is refused with the current revision and changes nothing.
  response = await put("episode-unit", { positionSeconds: 60, expectedRevision: 2 });
  expect(response.status).toBe(409); expect((await json(response)).error).toMatchObject({ code: "REVISION_CONFLICT", revision: 3 });
  expect(await row()).toEqual({ position: 10, completed: 1, revision: 3 });
});

it("resets on a manual unwatched mark, refuses older reports and completes again from real viewing", async () => {
  await put("episode-unit", { positionSeconds: 95, expectedRevision: 0 });
  expect((await json(await put("episode-unit", { completed: false, expectedRevision: 1 }))).data).toMatchObject({ positionSeconds: 0, completed: false, revision: 2 });
  expect((await put("episode-unit", { positionSeconds: 96, expectedRevision: 1 })).status).toBe(409);
  expect(await row()).toEqual({ position: 0, completed: 0, revision: 2 });
  expect((await json(await put("episode-unit", { positionSeconds: 89, expectedRevision: 2 }))).data).toMatchObject({ completed: false });
  expect((await json(await put("episode-unit", { positionSeconds: 90, expectedRevision: 3 }))).data).toMatchObject({ completed: true, revision: 4 });
  expect((await json(await put("episode-unit", { completed: true, expectedRevision: 4 }))).data).toMatchObject({ positionSeconds: 100, completed: true, revision: 5 });
});

it("marks units without media manually but takes automatic reports only for watchable media", async () => {
  expect((await json(await put("movie-unit", { completed: true, expectedRevision: 0 }))).data).toMatchObject({ positionSeconds: 4, completed: true, revision: 1 });
  const response = await put("movie-unit", { positionSeconds: 1, expectedRevision: 1 });
  expect(response.status).toBe(404); expect((await json(response)).error?.code).toBe("MEDIA_MISSING");
  expect((await json(await put("missing-unit", { completed: true, expectedRevision: 0 }))).error?.code).toBe("NOT_FOUND");
  // A first write must expect revision 0.
  const late = await put("episode-unit", { positionSeconds: 5, expectedRevision: 2 });
  expect(late.status).toBe(409); expect((await json(late)).error?.revision).toBe(0); expect(await row()).toBeNull();
});

it("rejects invalid input without writing", async () => {
  for (const body of [{ positionSeconds: 100.5, expectedRevision: 0 }, { positionSeconds: -1, expectedRevision: 0 }, { positionSeconds: null, expectedRevision: 0 },
    { positionSeconds: "5", expectedRevision: 0 }, { positionSeconds: 5, completed: true, expectedRevision: 0 }, { expectedRevision: 0 },
    { completed: "true", expectedRevision: 0 }, { positionSeconds: 5, expectedRevision: 1.5 }, { positionSeconds: 5, expectedRevision: -1 }, { positionSeconds: 5, expectedRevision: "0" }]) {
    const response = await put("episode-unit", body);
    expect(response.status, JSON.stringify(body)).toBe(400); expect((await json(response)).error?.code).toBe("INVALID_INPUT");
  }
  expect(await row()).toBeNull();
});

it("requires a live member, a same-origin JSON PUT and keeps each member's progress separate", async () => {
  expect((await put("episode-unit", { positionSeconds: 5, expectedRevision: 0 }, "")).status).toBe(401);
  expect((await json(await put("episode-unit", { positionSeconds: 5, expectedRevision: 0 }, cookie, { Origin: "https://evil.invalid" }))).error?.code).toBe("CSRF_INVALID");
  expect((await json(await put("episode-unit", { positionSeconds: 5, expectedRevision: 0 }, cookie, { "Content-Type": "text/plain" }))).error?.code).toBe("INVALID_INPUT");
  expect((await send(request("/me/progress/episode-unit", { positionSeconds: 5, expectedRevision: 0 }, cookie))).status).toBe(404);
  expect(await row()).toBeNull();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  let other: string, otherId: string;
  try { otherId = (await member("Tessel")).id; other = await login("Tessel"); } finally { vi.unstubAllGlobals(); }
  await put("episode-unit", { positionSeconds: 40, expectedRevision: 0, userId: otherId });
  expect((await json(await put("episode-unit", { positionSeconds: 70, expectedRevision: 0 }, other))).data).toMatchObject({ positionSeconds: 70, revision: 1 });
  expect(await row()).toEqual({ position: 40, completed: 0, revision: 1 });
  expect(await row(otherId)).toEqual({ position: 70, completed: 0, revision: 1 });
  // A revoked session is refused even while its signed cookie cache is valid.
  await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(userId).run();
  expect((await put("episode-unit", { positionSeconds: 50, expectedRevision: 1 })).status).toBe(401);
  expect(await row()).toEqual({ position: 40, completed: 0, revision: 1 });
}, 60000);
