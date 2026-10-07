import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Requirements 6.3 / 6.3.1: scrypt N=2^14, r=8, p=5; store version, params, salt, derived key.
export const SCRYPT = { N: 16384, r: 8, p: 5, keyLen: 32, saltLen: 16, maxmem: 64 * 1024 * 1024 } as const;
const VERSION = "scrypt-v1";

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLen: number) {
  return new Promise<Buffer>((resolve, reject) => {
    // No trim / NFKC: the password is hashed byte-for-byte as submitted.
    scrypt(Buffer.from(password, "utf8"), salt, keyLen, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLen);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
  const params = `N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}`;
  return [VERSION, params, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [version, params, saltB64, keyB64] = hash.split("$");
  if (version !== VERSION || !params || !saltB64 || !keyB64) return false;
  const p = Object.fromEntries(params.split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
  const expected = Buffer.from(keyB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), p.N!, p.r!, p.p!, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
