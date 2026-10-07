import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const stagingId = "00000000-0000-4000-8000-0000000000ab";
const productionId = "00000000-0000-4000-8000-0000000000cd";

function resolveConfig(mode, overrides = {}) {
  return spawnSync(process.execPath, [
    "--input-type=module", "--eval",
    'import { resolveConfig } from "vite"; await resolveConfig({ mode: process.argv[1] }, "build");',
    mode,
  ], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      STAGING_D1_DATABASE_ID: stagingId,
      PRODUCTION_D1_DATABASE_ID: productionId,
      STAGING_APP_ORIGIN: "https://staging.example.test",
      STAGING_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      PRODUCTION_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      ...overrides,
    },
  });
}

for (const mode of ["staging", "production"]) {
  for (const duplicateId of [stagingId, ` ${stagingId.toUpperCase()} `]) {
    test(`${mode} rejects a shared D1 database ID (${duplicateId === stagingId ? "exact" : "normalized"})`, () => {
      const result = resolveConfig(mode, { PRODUCTION_D1_DATABASE_ID: duplicateId });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /STAGING_D1_DATABASE_ID and PRODUCTION_D1_DATABASE_ID must be different/);
    });
  }

  test(`${mode} accepts separate D1 databases`, () => {
    const result = resolveConfig(mode);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
