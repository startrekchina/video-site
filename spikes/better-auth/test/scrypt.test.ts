import { expect, it } from "vitest";
import { SCRYPT, hashPassword, verifyPassword } from "../src/password.ts";

it("hashes with scrypt N=2^14 r=8 p=5 in workerd and records timing", async () => {
  const pw = "Fictional_Pass-01";
  const runs: number[] = [];
  let hash = "";
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    hash = await hashPassword(pw);
    runs.push(performance.now() - t0);
  }
  const t1 = performance.now();
  const ok = await verifyPassword({ hash, password: pw });
  const verifyMs = performance.now() - t1;
  console.log(`[scrypt] hash ms=${runs.map((n) => n.toFixed(0)).join(",")} verify ms=${verifyMs.toFixed(0)}`);

  expect(hash).toMatch(/^scrypt-v1\$N=16384,r=8,p=5\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/);
  expect(ok).toBe(true);
  expect(await verifyPassword({ hash, password: `${pw} ` })).toBe(false);
  expect(SCRYPT.maxmem).toBeGreaterThan(128 * SCRYPT.N * SCRYPT.r);
});
