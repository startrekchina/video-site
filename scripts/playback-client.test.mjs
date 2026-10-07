import assert from "node:assert/strict";
import { test } from "node:test";
import { startRenewal } from "../app/lib/playback-client.ts";

test("renewal retries 5/15/30 seconds once each, expires, recovers manually and drops late replies after stop", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let calls = 0, paused = 0, applied = 0, message = "", succeeding = false;
  const initial = { url: "/media/first", expiresAt: 400000, tracks: [] };
  const flow = startRenewal(initial, async () => { calls++; if (!succeeding) throw Object.assign(new Error("offline"), { status: 503 }); return { ...initial, expiresAt: Date.now() + 1800000 }; }, async () => { applied++; }, () => { paused++; }, value => { message = value; });
  const tick = async ms => { context.mock.timers.tick(ms); await Promise.resolve(); await Promise.resolve(); };
  await tick(100000); assert.equal(calls, 1);
  await tick(4999); assert.equal(calls, 1); await tick(1); assert.equal(calls, 2);
  await tick(15000); assert.equal(calls, 3); await tick(30000); assert.equal(calls, 4);
  await tick(250000); assert.equal(calls, 4); assert.equal(paused, 1); assert.match(message, /到期/u);
  succeeding = true; flow.retry(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); assert.equal(applied, 1);
  flow.stop();
  let resolve;
  const late = startRenewal(initial, () => new Promise(accept => { resolve = accept; }), async () => { applied++; }, () => { paused++; }, () => {});
  late.retry(); late.stop(); resolve(initial); await Promise.resolve(); await Promise.resolve(); assert.equal(applied, 1);
});

test("401 and 403 stop renewal immediately and do not retry", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  for (const status of [401, 403]) {
    let calls = 0, paused = 0;
    const flow = startRenewal({ url: "/media/first", expiresAt: 1800000, tracks: [] }, async () => { calls++; throw { status }; }, async () => assert.fail(), () => { paused++; }, () => {});
    flow.retry(); await Promise.resolve(); await Promise.resolve(); context.mock.timers.tick(2000000); await Promise.resolve();
    assert.equal(calls, 1); assert.equal(paused, 1); flow.stop();
  }
});
