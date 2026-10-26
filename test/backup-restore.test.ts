import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { backupKeyId } from "@/lib/backup-keys.server";
import { decryptBackupForRestore, encryptBackup, stageBackup } from "@/lib/backup-storage.server";
import { restoreBackup, restoredBusinessSummary, sanitizeRestoredCredentials, validateRestoredDatabase, verifyRestoredCredentials } from "@/lib/backup-restore.server";
import { syncMedia } from "@/lib/media-sync.server";
import { login, member } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";

const signal = () => new AbortController().signal;
const runtime = { ...env, APP_ENV: "test", BACKUP_ACCOUNT_ID: "a".repeat(32), BACKUP_DATABASE_ID: "00000000-0000-4000-8000-000000000000", D1_IMPORT_TOKEN: "fictional-import-token" };
const target = { db: env.TEST_RESTORE_DB, id: "00000000-0000-4000-8000-000000000001" };
const newSecret = "fictional-new-auth-secret-0123456789abcdef";
const importPreamble = "PRAGMA foreign_keys=OFF;\n";
async function artifact(sql = "CREATE TABLE fictional (value TEXT);") {
  const scope = { environment: "test" as const, id: crypto.randomUUID() };
  const names = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY name").all<{ name: string }>();
  const schemaVersion = createHash("sha256").update(JSON.stringify(names.results.map(row => row.name))).digest("hex");
  await stageBackup(env.MEDIA_BUCKET, { ...scope, createdAt: Date.now(), schemaVersion, bookmark: "fictional-bookmark", authKeyId: backupKeyId(env.BETTER_AUTH_SECRET) },
    new Response(sql).body!, Buffer.byteLength(sql), signal());
  return encryptBackup(env.MEDIA_BUCKET, scope, env.BACKUP_ENCRYPTION_KEY, signal());
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["CREATE VIEW occupied AS SELECT 1 AS value", "CREATE TABLE xcf_data (value TEXT)"])("refuses an occupied restore target before reading backup data: %s", async schema => {
  const file = await artifact(), get = vi.spyOn(env.MEDIA_BUCKET, "get"), network = vi.fn(); vi.stubGlobal("fetch", network);
  await target.db.prepare(schema).run();
  await expect(restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal())).rejects.toThrow();
  expect(get).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
});

it("cancels an unsuccessful import metadata response and removes the plaintext", async () => {
  const file = await artifact(), cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 500 })));
  await expect(restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal())).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
});

it.each(["reject", "http-error"])("settles the upload producer and closes plaintext readers when upload fails: %s", async failure => {
  const file = await artifact(), get = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET), bodies: ReadableStream[] = [];
  vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementation(async (key, options) => {
    const object = await get(key, options);
    if (key.startsWith("backup-restore/") && object && "body" in object) bodies.push(object.body);
    return object;
  });
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).startsWith("https://fixture-upload.example.test/")) {
      if (failure === "reject") throw new Error("fictional-upload-failure");
      return new Response(null, { status: 500 });
    }
    return Response.json({ success: true, result: { filename: "fixture.sql", upload_url: "https://fixture-upload.example.test/sql" } });
  }));
  await expect(restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal())).rejects.toThrow();
  expect(bodies).toHaveLength(3); expect(bodies.map(body => body.locked)).toEqual([false, false, false]);
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
  expect(await env.MEDIA_BUCKET.head(`backups/test/${file.source.id}/${file.file}.bin`)).not.toBeNull();
});

it("stops reading plaintext when cancellation occurs during the MD5 pass", async () => {
  const file = await artifact(), get = env.MEDIA_BUCKET.get.bind(env.MEDIA_BUCKET), controller = new AbortController(), cancel = vi.fn(), network = vi.fn();
  let reads = 0, passes = 0;
  vi.spyOn(env.MEDIA_BUCKET, "get").mockImplementation(async (key, options) => {
    const object = await get(key, options);
    if (!key.startsWith("backup-restore/") || !object || !("body" in object)) return object;
    if (++passes !== 2) return object;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const body = new ReadableStream<Uint8Array>({ pull(stream) {
      stream.enqueue(bytes.slice(reads, ++reads)); if (reads === 2) controller.abort();
    }, cancel }, { highWaterMark: 0 });
    return new Proxy(object, { get: (real, property) => property === "body" ? body : Reflect.get(real, property) });
  });
  vi.stubGlobal("fetch", network);
  await expect(restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, controller.signal)).rejects.toThrow();
  expect(reads).toBe(2); expect(cancel).toHaveBeenCalledOnce(); expect(network).not.toHaveBeenCalled();
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
});

it("does not begin an upload when cancellation arrives with the init response", async () => {
  const file = await artifact(), controller = new AbortController(), network = vi.fn(async () => {
    controller.abort(); return Response.json({ success: true, result: { filename: "fixture.sql", upload_url: "https://fixture-upload.example.test/sql" } });
  });
  vi.stubGlobal("fetch", network);
  await expect(restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, controller.signal)).rejects.toThrow();
  expect(network).toHaveBeenCalledOnce();
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
});

it("restores an encrypted SQL fixture into the isolated binding with identical business digests, then clears credentials without losing devices or discussions", async () => {
  const user = await member(), now = Date.now();
  const totp = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: "FICTIONALTOTP" });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO works (id, kind, tmdb_id) VALUES ('fixture', 'movie', 1701)"),
    env.DB.prepare("INSERT INTO playable_units (id, kind, work_id, tmdb_id) VALUES ('fixture', 'movie', 'fixture', 1701)"),
    env.DB.prepare("INSERT INTO comments (id, playable_unit_id, author_user_id, body_markdown, created_at) VALUES ('fixture-comment', 'fixture', ?, 'Preserved discussion', ?)").bind(user.id, now),
    env.DB.prepare('INSERT INTO passkey (id, publicKey, credentialID, userId, name, counter, deviceType, backedUp, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?)')
      .bind("fixture-passkey", "fictional-public-key", "fictional-credential-id", user.id, "Fictional device", "multiDevice", new Date(now).toISOString()),
    env.DB.prepare('INSERT INTO "twoFactor" (id, secret, backupCodes, userId) VALUES (?, ?, ?, ?)').bind("fixture-totp", totp, await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: '["fictional-backup-code"]' }), user.id),
  ]);
  const baseline = await restoredBusinessSummary(env.DB), statements = ["PRAGMA defer_foreign_keys = ON"];
  const schema = await env.DB.prepare("SELECT name, type, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name")
    .all<{ name: string; type: string; sql: string }>();
  for (const object of schema.results.filter(row => row.type !== "trigger")) statements.push(object.sql);
  const literal = (value: unknown) => value === null ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
  for (const table of schema.results.filter(row => row.type === "table")) {
    const rows = await env.DB.prepare(`SELECT * FROM "${table.name}"`).all<Record<string, unknown>>();
    const columns = await env.DB.prepare(`PRAGMA table_info("${table.name}")`).all<{ name: string }>();
    for (const row of rows.results) statements.push(`INSERT INTO "${table.name}" (${columns.results.map(column => '"' + column.name + '"').join(",")}) VALUES (${columns.results.map(column => literal(row[column.name])).join(",")})`);
  }
  for (const trigger of schema.results.filter(row => row.type === "trigger")) statements.push(trigger.sql);
  // A valid SQL comment delimits this generated fixture, so the mock import executes the uploaded statements without a home-grown SQL parser.
  const separator = ";\n-- fixture-statement\n", fixtureSql = statements.join(separator) + ";", original = await artifact(fixtureSql);
  const newBackupKey = "fictional-rotated-backup-key-0123456789abcdef";
  const file = await encryptBackup(env.MEDIA_BUCKET, original.source, newBackupKey, signal()); let uploaded = "";
  const rotated = { ...runtime, BACKUP_ENCRYPTION_KEY: newBackupKey, BETTER_AUTH_SECRET: newSecret,
    BACKUP_KEYRING: JSON.stringify([{ backupKey: env.BACKUP_ENCRYPTION_KEY, authSecret: env.BETTER_AUTH_SECRET }]) };
  expect(file.keyId).not.toBe(original.keyId); expect(file.source.authKeyId).toBe(original.source.authKeyId);
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith("https://fixture-upload.example.test/")) { uploaded = await new Response(init?.body).text(); return new Response(null); }
    const action = JSON.parse(String(init?.body)).action;
    if (action === "init") return Response.json({ success: true, result: { filename: "fixture.sql", upload_url: "https://fixture-upload.example.test/sql" } });
    expect(action).toBe("ingest"); expect(uploaded).toBe(importPreamble + fixtureSql);
    await target.db.batch(uploaded.slice(importPreamble.length).split(separator).map(statement => target.db.prepare(statement)));
    return Response.json({ success: true, result: { status: "complete" } });
  }));
  const restored = await restoreBackup(rotated, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal());
  expect(restored.validation.business).toEqual(baseline);
  await sanitizeRestoredCredentials(target.db, env.BETTER_AUTH_SECRET, newSecret);
  for (const table of ["passkey", "comments", "member_profiles"]) {
    expect(await target.db.prepare(`SELECT * FROM ${table}`).all()).toMatchObject({ results: (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results });
  }
  const factor = await target.db.prepare('SELECT secret, backupCodes FROM "twoFactor"').first<{ secret: string; backupCodes: string }>();
  expect(await symmetricDecrypt({ key: newSecret, data: factor!.secret })).toBe("FICTIONALTOTP");
  expect(await symmetricDecrypt({ key: newSecret, data: factor!.backupCodes })).toBe("[]");
  expect(await verifyRestoredCredentials(target.db, newSecret)).toMatchObject({ credentialsCleared: true, totpPreserved: 1 });
  await expect(verifyRestoredCredentials(target.db, env.BETTER_AUTH_SECRET)).rejects.toThrow();
});
it("authenticates ciphertext before private restore staging and verifies SHA-256", async () => {
  const sql = "CREATE TABLE fictional (value TEXT);", file = await artifact(sql);
  const restored = await decryptBackupForRestore(env.MEDIA_BUCKET, file.source, file.file, env.BACKUP_ENCRYPTION_KEY, signal());
  expect(restored.sqlKey).toMatch(/^backup-restore\/test\//u);
  expect(await (await env.MEDIA_BUCKET.get(restored.sqlKey))!.text()).toBe(sql);
  await expect(decryptBackupForRestore(env.MEDIA_BUCKET, file.source, file.file, newSecret, signal())).rejects.toThrow();
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(1);
});
it("runs init/upload/ingest/poll within the recovery service, never forwards tokens to signed uploads, and validates an isolated target", async () => {
  const file = await artifact(), actions: string[] = [], signed = "https://fictional.r2.cloudflarestorage.com/import?signature=private", network = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    if (String(url) === signed) {
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      expect(await new Response(init?.body).text()).toBe(importPreamble + "CREATE TABLE fictional (value TEXT);"); return new Response(null);
    }
    expect(String(url)).toContain(target.id); expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fictional-import-token");
    const body = JSON.parse(String(init?.body)); actions.push(body.action);
    if (body.action === "init") return Response.json({ success: true, result: { filename: "fictional.sql", upload_url: signed } });
    if (body.action === "ingest") return Response.json({ success: true, result: { at_bookmark: "fictional-import-bookmark" } });
    expect(body.current_bookmark).toBe("fictional-import-bookmark");
    // The remote D1 import is mocked. Apply the same current schema to the separate local binding for validation.
    await applyD1Migrations(target.db, env.TEST_MIGRATIONS);
    return Response.json({ success: true, result: { status: "complete" } });
  });
  vi.stubGlobal("fetch", network);
  const result = await restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal());
  expect(actions).toEqual(["init", "ingest", "poll"]); expect(result).toMatchObject({ credentialsCleared: false, validation: { mediaVerified: true } });
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>())!.n).toBe(env.TEST_MIGRATIONS.length);
});
it("identifies the import by the MD5 of the exact uploaded bytes, foreign-key preamble included", async () => {
  const file = await artifact(), etags: string[] = []; let uploaded = "";
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith("https://fixture-upload.example.test/")) { uploaded = await new Response(init?.body).text(); return new Response(null); }
    const body = JSON.parse(String(init?.body)); etags.push(body.etag);
    if (body.action === "init") return Response.json({ success: true, result: { filename: "fictional.sql", upload_url: "https://fixture-upload.example.test/sql" } });
    await applyD1Migrations(target.db, env.TEST_MIGRATIONS);
    return Response.json({ success: true, result: { status: "complete" } });
  }));
  await restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal());
  expect(uploaded.startsWith(importPreamble)).toBe(true);
  expect(etags).toEqual(Array(2).fill(createHash("md5").update(uploaded).digest("hex")));
});
it("continues active ingest and poll responses until the isolated import completes", async () => {
  const file = await artifact(), actions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); actions.push(body.action);
    if (body.action === "init") return Response.json({ success: true, result: { filename: "fictional.sql" } });
    if (body.action === "poll") expect(body.current_bookmark).toBe("fictional-import-bookmark");
    if (actions.length < 4) return Response.json({ success: true, result: { success: true, status: "active", at_bookmark: "fictional-import-bookmark" } }, { status: 202 });
    await applyD1Migrations(target.db, env.TEST_MIGRATIONS);
    return Response.json({ success: true, result: { status: "complete" } });
  }));
  expect(await restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal()))
    .toMatchObject({ credentialsCleared: false, validation: { mediaVerified: true } });
  expect(actions).toEqual(["init", "ingest", "poll", "poll"]);
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
});
it.each([
  ["error status", { status: "error" }], ["failed import", { success: false }],
  ["unknown status", { status: "unexpected" }], ["changed bookmark", { at_bookmark: "different-bookmark" }],
])("rejects %s after an active import and removes only recovery plaintext", async (_name, change) => {
  const file = await artifact(); let calls = 0;
  const network = vi.fn(async () => Response.json({ success: true, result: ++calls === 1 ? { filename: "fictional.sql" } : {
    success: true, status: "active", at_bookmark: "fictional-import-bookmark", ...(calls === 3 ? change : {}),
  } }));
  vi.stubGlobal("fetch", network);
  await expect(restoreBackup(runtime, target, file.source, file.file, { keyId: file.keyId, authKeyId: file.source.authKeyId! }, signal())).rejects.toThrow("RESTORE_VALIDATION_FAILED");
  expect(network).toHaveBeenCalledTimes(3);
  expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
  expect(await env.MEDIA_BUCKET.head(`backups/test/${file.source.id}/${file.file}.bin`)).not.toBeNull();
});
it("rejects live/nonempty targets, wrong environments and unavailable key pairs before import", async () => {
  const file = await artifact(), network = vi.fn(); vi.stubGlobal("fetch", network);
  const keys = { keyId: file.keyId, authKeyId: file.source.authKeyId! };
  await expect(restoreBackup(runtime, { ...target, id: runtime.BACKUP_DATABASE_ID }, file.source, file.file, keys, signal())).rejects.toThrow();
  await expect(restoreBackup(runtime, target, { ...file.source, environment: "production" }, file.file, keys, signal())).rejects.toThrow();
  await expect(restoreBackup(runtime, target, file.source, file.file, { ...keys, keyId: "unknown" }, signal())).rejects.toThrow();
  await target.db.prepare("CREATE TABLE occupied (id INTEGER)").run();
  await expect(restoreBackup(runtime, target, file.source, file.file, keys, signal())).rejects.toThrow(); expect(network).not.toHaveBeenCalled();
});
it("fails validation on missing media or a mismatched schema", async () => {
  const file = await artifact();
  await expect(validateRestoredDatabase(env.DB, env.MEDIA_BUCKET, "wrong-schema", signal())).rejects.toThrow();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO works (id, kind, tmdb_id) VALUES ('fictional', 'movie', 1)"),
    env.DB.prepare("INSERT INTO playable_units (id, kind, work_id, tmdb_id) VALUES ('fictional', 'movie', 'fictional', 1)"),
    env.DB.prepare("INSERT INTO subtitle_tracks (id, playable_unit_id, language, format, display_name, track_key, object_key, byte_length, checksum_sha256) VALUES ('fictional', 'fictional', 'en', 'vtt', 'English', 'en.main', 'library/missing.vtt', 10, ?)").bind("a".repeat(64)),
  ]);
  await expect(validateRestoredDatabase(env.DB, env.MEDIA_BUCKET, file.source.schemaVersion, signal())).rejects.toThrow();
});
it("leaves media whose R2 version differs from the restore point to the media scan without reading it", async () => {
  const file = await artifact(); await seedCatalog(env.DB);
  const video = Uint8Array.from(atob(env.TEST_MEDIA_BASE64), char => char.charCodeAt(0)), vtt = "WEBVTT\n\n00:00.000 --> 00:03.000\nA fictional signal.\n";
  const movie = "library/movie/152/movie.mp4", episode = "library/series/85948/S01/E01.mp4", track = "library/series/85948/S01/E01.zh-CN.main.vtt";
  for (const key of [movie, episode]) await env.MEDIA_BUCKET.put(key, video);
  await env.MEDIA_BUCKET.put(track, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 3 });
  // The restore point recorded an earlier version of the episode's identical bytes; the subtitle was replaced after it.
  await env.DB.prepare("UPDATE media_files SET r2_etag = 'fictional-earlier-version' WHERE object_key = ?").bind(episode).run();
  await env.MEDIA_BUCKET.put(track, vtt.replace("fictional", "different"));
  const get = vi.spyOn(env.MEDIA_BUCKET, "get");
  for (let run = 0; run < 2; run++) {
    expect(await validateRestoredDatabase(env.DB, env.MEDIA_BUCKET, file.source.schemaVersion, signal())).toMatchObject({ mediaVerified: true, mediaPending: 2 });
  }
  expect(get).not.toHaveBeenCalled();
  const versions = async () => (await env.DB.prepare("SELECT object_key, r2_etag FROM media_files UNION ALL SELECT object_key, r2_etag FROM subtitle_tracks ORDER BY object_key")
    .all<{ object_key: string; r2_etag: string | null }>()).results;
  expect(await versions()).toEqual([{ object_key: movie, r2_etag: (await env.MEDIA_BUCKET.head(movie))!.etag }, { object_key: episode, r2_etag: null }, { object_key: track, r2_etag: null }]);
  expect(await syncMedia(env)).toMatchObject({ linked: 0, skipped: 2, replaced: 1, failed: 0 });
  for (const row of await versions()) expect(row.r2_etag).toBe((await env.MEDIA_BUCKET.head(row.object_key))!.etag);
});
it("preserves TOTP/passwords/devices/used quota and discussions while revoking sessions, challenges, unused invites and backup codes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  const user = await member(); await login();
  const totp = "FICTIONALBASE32SECRET", secret = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: totp });
  const backupCodes = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: '["fictional-code"]' });
  const account = await env.DB.prepare("SELECT password FROM account WHERE userId = ?").bind(user.id).first();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO "twoFactor" (id, secret, backupCodes, userId, verified) VALUES (?, ?, ?, ?, 1)').bind("fictional", secret, backupCodes, user.id),
    env.DB.prepare('INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').bind("fictional", "challenge", "private", now + 60000, now, now),
    env.DB.prepare("INSERT INTO invitations (id, code_hash, created_at, expires_at) VALUES ('unused', 'fictional-unused', ?, ?)").bind(now, now + 60000),
    env.DB.prepare("INSERT INTO invitations (id, code_hash, created_at, expires_at, used_by_user_id, used_at) VALUES ('used', 'fictional-used', ?, ?, ?, ?)").bind(now, now + 60000, user.id, now),
  ]);
  expect(await sanitizeRestoredCredentials(env.DB, env.BETTER_AUTH_SECRET, newSecret)).toMatchObject({ totpPreserved: 1, credentialsCleared: true });
  const changed = await env.DB.prepare('SELECT secret, backupCodes FROM "twoFactor"').first<{ secret: string; backupCodes: string }>();
  expect(await symmetricDecrypt({ key: newSecret, data: changed!.secret })).toBe(totp);
  expect(await symmetricDecrypt({ key: newSecret, data: changed!.backupCodes })).toBe("[]");
  expect(await env.DB.prepare("SELECT password FROM account WHERE userId = ?").bind(user.id).first()).toEqual(account);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM session").first()).toEqual({ n: 0 });
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM verification").first()).toEqual({ n: 0 });
  const invites = await env.DB.prepare("SELECT id, revoked_at FROM invitations ORDER BY id").all();
  expect(invites.results).toEqual([{ id: "unused", revoked_at: expect.any(Number) }, { id: "used", revoked_at: null }]);
  expect(Number(invites.results[0].revoked_at)).toBeGreaterThanOrEqual(now);
});
it("does not mutate credentials if any old TOTP cannot authenticate", async () => {
  const user = await member(), secret = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: "FICTIONAL" });
  await env.DB.prepare('INSERT INTO "twoFactor" (id, secret, backupCodes, userId) VALUES (?, ?, ?, ?)').bind("fictional", secret, "unchanged", user.id).run();
  await expect(sanitizeRestoredCredentials(env.DB, newSecret, env.BETTER_AUTH_SECRET)).rejects.toThrow();
  expect(await env.DB.prepare('SELECT secret, backupCodes FROM "twoFactor"').first()).toEqual({ secret, backupCodes: "unchanged" });
});
