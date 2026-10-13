import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { remoteMigrationSql } from "./migrate-remote.mjs";

for (const mode of ["staging", "production"]) test(`remote migration runs from a fresh checkout (${mode})`, t => {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, "video-site-remote-migration-test-"));
  t.after(() => { assert.equal(dirname(directory), temporaryRoot); rmSync(directory, { recursive: true, force: true }); });
  const databases = { STAGING_D1_DATABASE_ID: "00000000-0000-4000-8000-000000000001", PRODUCTION_D1_DATABASE_ID: "00000000-0000-4000-8000-000000000002" };
  writeFileSync(join(directory, ".env"), Object.entries(databases).map(([key, value]) => `${key}=${value}`).join("\n"));
  mkdirSync(join(directory, "migrations")); mkdirSync(join(directory, "node_modules/cf/bin"), { recursive: true });
  writeFileSync(join(directory, "migrations/0001_fixture.sql"), "SELECT 1;");
  writeFileSync(join(directory, "migrations/0010_registration_ownership.sql"), readFileSync("migrations/0010_registration_ownership.sql", "utf8"));
  writeFileSync(join(directory, "node_modules/cf/bin/cf"), `
    const { readdirSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const args = process.argv.slice(2); const directory = args[args.indexOf("--dir") + 1];
    console.log(JSON.stringify({ args, names: readdirSync(directory).sort(), sql: readFileSync(join(directory, "0010_registration_ownership.sql"), "utf8") }));
  `);
  assert.equal(existsSync(join(directory, ".cloudflare")), false);
  const result = JSON.parse(execFileSync(process.execPath, [resolve("scripts/migrate-remote.mjs"), mode],
    { cwd: directory, encoding: "utf8", env: { ...process.env, ...databases } }));
  assert.deepEqual(result.names, ["0001_fixture.sql", "0010_registration_ownership.sql"]);
  assert.ok(result.sql.includes("SELECT (CASE WHEN NOT EXISTS ("));
  assert.equal(result.args[result.args.indexOf("--mode") + 1], mode);
  assert.equal(result.args[3], databases[`${mode.toUpperCase()}_D1_DATABASE_ID`]);
  assert.deepEqual(readdirSync(join(directory, ".cloudflare")), []);
});

for (const expired of [false, true]) test(`remote migration transport preserves atomic registration (expired=${expired})`, () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for (const name of readdirSync("migrations").filter(name => name.endsWith(".sql")).sort()) db.exec(remoteMigrationSql(name, readFileSync(`migrations/${name}`, "utf8")));
    db.exec(`INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,username) VALUES ('nova','Nova','nova@example.test',0,100,100,'nova');
      INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES ('credential','nova','credential','nova','fictional-hash',100,100);
      INSERT INTO invitations (id,code_hash,created_at,expires_at) VALUES ('invite','fictional-digest',1,${expired ? 50 : 1000});
      INSERT INTO registration_attempts (id,invitation_id,user_id,expected_user_id,state,created_at,updated_at,expires_at) VALUES ('attempt','invite','nova','nova','created',2,2,1000);`);
    const insert = () => db.exec("INSERT INTO member_profiles (user_id,role,status,registration_state,invite_quota,created_at) VALUES ('nova','member','active','completed',2,100)");
    if (expired) assert.throws(insert, /Registration completion conditions failed/); else insert();
    assert.equal(db.prepare("SELECT count(*) AS n FROM member_profiles").get().n, expired ? 0 : 1);
    assert.equal(db.prepare("SELECT state FROM registration_attempts").get().state, expired ? "created" : "completed");
    assert.equal(db.prepare("SELECT used_by_user_id FROM invitations").get().used_by_user_id, expired ? null : "nova");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
