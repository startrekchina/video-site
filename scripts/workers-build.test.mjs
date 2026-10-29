import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The `bash` on Windows PATH is WSL's; use Git for Windows when present.
const bash = process.platform === "win32" ? ["C:/Program Files/Git/bin/bash.exe"].find(existsSync) : "bash";
const script = resolve("scripts/workers-build.sh").replaceAll("\\", "/");

function run(step, env, t) {
  // An empty working directory makes every step past the branch gate fail, so a zero exit proves the gate stopped it.
  const cwd = mkdtempSync(join(tmpdir(), "video-site-workers-build-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const { CLOUDFLARE_PREVIEW_BUILD, PREVIEW_BRANCH, WORKERS_CI_BRANCH, ...base } = process.env;
  return spawnSync(bash, [script, step], { cwd, encoding: "utf8", env: { ...base, ...env } });
}

for (const step of ["build", "deploy"]) test(`Preview ${step} from another branch stops before installing, migrating or publishing`, { skip: !bash && "needs bash" }, t => {
  const result = run(step, { CLOUDFLARE_PREVIEW_BUILD: "true", PREVIEW_BRANCH: "dev", WORKERS_CI_BRANCH: "feat/fictional" }, t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skip: Previews are built only from dev\./u);
});

test("Preview builds require PREVIEW_BRANCH", { skip: !bash && "needs bash" }, t => {
  const result = run("deploy", { CLOUDFLARE_PREVIEW_BUILD: "true", WORKERS_CI_BRANCH: "dev" }, t);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PREVIEW_BRANCH is required for Preview builds/u);
});
