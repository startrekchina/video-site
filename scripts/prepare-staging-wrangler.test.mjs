import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { stagingWranglerConfig } from "./prepare-staging-wrangler.mjs";

const root = resolve("fictional-build");
const directory = join(root, ".cloudflare/wrangler-staging");
function build() {
  return {
    rootConfig: { buildContext: { mode: "staging" } }, containers: [],
    workers: { default: {
      bundleDir: join(root, ".cloudflare/output/v0/workers/default/bundle"),
      assetsDir: join(root, ".cloudflare/output/v0/workers/default/assets"),
      config: {
        name: "stcn-video-site-staging", compatibilityDate: "2026-09-25", compatibilityFlags: ["nodejs_compat"],
        workersDev: false, previewUrls: false, domains: ["staging.example.invalid"],
        triggers: [{ type: "scheduled", schedule: "*/5 * * * *" }],
        observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: false }, traces: { enabled: false } },
        env: {
          APP_ENV: { type: "text", value: "staging" },
          DB: { type: "d1", name: "fictional-staging", id: "00000000-0000-4000-8000-000000000001" },
          MEDIA_BUCKET: { type: "r2", name: "fictional-staging-media" },
          BETTER_AUTH_SECRET: { type: "secret" },
          AUTH_RATE_LIMITER: { type: "rate-limit", namespace: "2001", simple: { limit: 10, period: 60 } },
        },
        manifest: { type: "complete", mainModule: "index.js", modules: { "index.js": { type: "esm" }, "assets/server.js": { type: "esm" } } },
      },
    } },
  };
}

test("uses official conversion while preserving staging bindings, security settings and split build output", () => {
  const config = stagingWranglerConfig(build(), directory);
  assert.equal(config.name, "stcn-video-site-staging");
  assert.equal(config.main, "../output/v0/workers/default/bundle/index.js");
  assert.equal(config.assets.directory, "../output/v0/workers/default/assets");
  assert.equal(config.vars.APP_ENV, "staging");
  assert.equal(config.d1_databases[0].database_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(config.r2_buckets[0].bucket_name, "fictional-staging-media");
  assert.deepEqual(config.routes, [{ pattern: "staging.example.invalid", custom_domain: true }]);
  assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
  assert.equal(config.observability.redact_query_string, true);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.observability.traces.enabled, false);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.ratelimits[0].namespace_id, "2001");
  assert.deepEqual(config.secrets.required, ["BETTER_AUTH_SECRET"]);
  assert.equal(config.vars.BETTER_AUTH_SECRET, undefined);
  assert.equal(config.no_bundle, true);
  assert.equal(config.find_additional_modules, true);
  assert.equal(config.preserve_file_names, true);
  assert.deepEqual(config.rules, [{ type: "ESModule", globs: ["**/*.js"] }]);
});

test("rejects development, production and conflicting staging identity", () => {
  for (const mutate of [
    value => { value.rootConfig.buildContext.mode = "development"; },
    value => { value.rootConfig.buildContext.mode = "production"; },
    value => { value.workers.default.config.name = "stcn-video-site"; },
    value => { value.workers.default.config.env.APP_ENV.value = "production"; },
    value => { value.workers.other = value.workers.default; },
    value => { value.containers.push({}); },
  ]) {
    const value = build(); mutate(value);
    assert.throws(() => stagingWranglerConfig(value, directory), /single staging Worker/);
  }
});

test("rejects missing artifacts and module types that the adapter does not package", () => {
  for (const key of ["bundleDir", "assetsDir"]) {
    const value = build(); delete value.workers.default[key];
    assert.throws(() => stagingWranglerConfig(value, directory), /missing/);
  }
  const value = build(); value.workers.default.config.manifest.modules["payload.wasm"] = { type: "wasm" };
  assert.throws(() => stagingWranglerConfig(value, directory), /unsupported module types/);
});
