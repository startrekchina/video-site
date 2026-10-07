import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bootstrapQuery } from "./admin-bootstrap.mjs";

test("bootstrap stores a random code digest with no fictional issuer and a thirty-day expiry", () => {
  const first = bootstrapQuery("invite", undefined, 1700000000000); const second = bootstrapQuery("invite");
  assert.match(first.code, /^[a-f0-9]{64}$/); assert.notEqual(first.code, second.code);
  assert.equal(first.query.params[1], createHash("sha256").update(first.code).digest("hex"));
  assert.equal(first.query.params[3] - first.query.params[2], 30 * 86400000);
  assert.ok(!first.query.sql.includes("issuer_user_id")); assert.ok(!JSON.stringify(first.query).includes(first.code));
});
test("first-admin promotion binds normalized username and requires completed verified active membership", () => {
  const query = bootstrapQuery("promote", "Nova.Test").query;
  assert.deepEqual(query.params, ["nova.test"]);
  assert.match(query.sql, /status = 'active'/); assert.match(query.sql, /emailVerified = 1/); assert.match(query.sql, /registration_state = 'completed'/);
  assert.throws(() => bootstrapQuery("promote", "' OR 1=1 --")); assert.throws(() => bootstrapQuery("delete", "Nova"));
});
