import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { remoteMigrationSql } from "./migrate-remote.mjs";

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
