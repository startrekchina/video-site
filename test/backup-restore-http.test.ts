import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import recoveryWorker from "../tools/backup-restore/worker";
import { backupKeyId } from "@/lib/backup-keys.server";
import { encryptBackup, stageBackup } from "@/lib/backup-storage.server";

const bindings = { ...env, APP_ENV: "test", BACKUP_DATABASE_ID: "00000000-0000-4000-8000-000000000000", RESTORE_TARGET_DATABASE_ID: "00000000-0000-4000-8000-000000000001",
  RESTORE_DB: env.TEST_RESTORE_DB, RESTORE_NEW_AUTH_SECRET: "fictional-new-auth-secret-0123456789abcdef", RESTORE_OPERATOR_TOKEN: "fictional-operator-token-0123456789abcdef", D1_IMPORT_TOKEN: "fictional-import-token" };
const key = `backup-restore-control/test/${bindings.RESTORE_TARGET_DATABASE_ID}.json`;
async function send(body: object, headers: Record<string, string> = {}, config = bindings) {
  const ctx = createExecutionContext(), response = await recoveryWorker.fetch(new Request("https://recovery.example.test/operate", { method: "POST",
    headers: { Authorization: "Bearer " + config.RESTORE_OPERATOR_TOKEN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), config, ctx);
  await waitOnExecutionContext(ctx); return response;
}
afterEach(() => vi.restoreAllMocks());

it.each([false, true])("cleans a previous restore's plaintext before replacing its control record (delete fails=%s)", async fails => {
  await applyD1Migrations(env.TEST_RESTORE_DB, env.TEST_MIGRATIONS);
  const config = { ...bindings, APP_ENV: "staging" }, control = key.replace("/test/", "/staging/");
  const plaintextKey = `backup-restore/staging/${crypto.randomUUID()}/source.sql`, previous = { updatedAt: Date.now() - 2000, deadline: 0, plaintextKey };
  await env.MEDIA_BUCKET.put(plaintextKey, "fictional abandoned plaintext"); await env.MEDIA_BUCKET.put(control, JSON.stringify(previous));
  const remove = env.MEDIA_BUCKET.delete.bind(env.MEDIA_BUCKET);
  vi.spyOn(env.MEDIA_BUCKET, "delete").mockImplementation(async name => {
    if (fails && name === plaintextKey) throw new Error("fictional-delete-failure");
    return remove(name);
  });
  const response = await send({ action: "review" }, {}, config);
  expect(response.status).toBe(fails ? 503 : 200);
  if (fails) {
    expect(await response.json()).toMatchObject({ error: "RESTORE_PLAINTEXT_CLEANUP_FAILED" });
    expect(await (await env.MEDIA_BUCKET.get(control))!.json()).toEqual(previous);
    expect(await env.MEDIA_BUCKET.head(plaintextKey)).not.toBeNull();
  } else {
    expect(await env.MEDIA_BUCKET.head(plaintextKey)).toBeNull();
    expect(await (await env.MEDIA_BUCKET.get(control))!.json()).toMatchObject({ deadline: 0 });
    expect(await (await env.MEDIA_BUCKET.get(control))!.json()).not.toHaveProperty("plaintextKey");
  }
});

it("refuses a prior cleanup pointer outside the recovery environment", async () => {
  const config = { ...bindings, APP_ENV: "staging" }, control = key.replace("/test/", "/staging/");
  const plaintextKey = `backup-restore/production/${crypto.randomUUID()}/source.sql`, previous = { updatedAt: Date.now() - 2000, deadline: 0, plaintextKey };
  await env.MEDIA_BUCKET.put(plaintextKey, "fictional protected data"); await env.MEDIA_BUCKET.put(control, JSON.stringify(previous));
  const remove = vi.spyOn(env.MEDIA_BUCKET, "delete");
  expect((await send({ action: "review" }, {}, config)).status).toBe(500);
  expect(remove).not.toHaveBeenCalled(); expect(await (await env.MEDIA_BUCKET.get(control))!.json()).toEqual(previous);
});
it("requires a separate operator token, rejects browser origins and non-JSON, and never exposes a public restoration path", async () => {
  const rejected: Record<string, string>[] = [{ Authorization: "" }, { Authorization: "Bearer wrong" }, { Origin: "https://recovery.example.test" }];
  for (const headers of rejected) {
    const response = await send({ action: "review" }, headers); expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  }
  expect((await send({ action: "review" }, { "Content-Type": "text/plain" })).status).toBe(400);
  expect((await env.MEDIA_BUCKET.list()).objects).toHaveLength(0);
});
it("serializes operations, releases completed leases, and always leaves review in the isolated state", async () => {
  await applyD1Migrations(env.TEST_RESTORE_DB, env.TEST_MIGRATIONS);
  await env.MEDIA_BUCKET.put(key, JSON.stringify({ updatedAt: Date.now() - 2000, deadline: Date.now() + 60000 }));
  expect((await send({ action: "review" })).status).toBe(409);
  await env.MEDIA_BUCKET.put(key, JSON.stringify({ updatedAt: Date.now() - 2000, deadline: 0 }));
  const response = await send({ action: "review" }); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ members: [], devices: [], after: null, readyToOpen: false });
  expect(await (await env.MEDIA_BUCKET.get(key))!.json()).toMatchObject({ deadline: 0 });
});
it("keeps internal failures private and cannot report credential cleanup without explicit maintenance confirmation", async () => {
  const response = await send({ action: "sanitize" }); expect(response.status).toBe(400);
  vi.spyOn(env.TEST_RESTORE_DB, "prepare").mockImplementation(() => { throw new Error("private-api-token-and-storage-path"); });
  const failed = await send({ action: "validate", schemaVersion: "fictional" }); expect(failed.status).toBe(500);
  const text = await failed.text(); expect(text).toContain("RESTORE_FAILED"); expect(text).not.toContain("private-api-token-and-storage-path");
}, 10000);
it.each([
  ['{"D1_RESET_DO":true}', "D1_RESET_DO"], ["UNIQUE constraint failed: user.email fictional-private@example.test", undefined],
])("reports only a bare D1 code when the import rejects %s", async (error, importError) => {
  const scope = { environment: "staging" as const, id: crypto.randomUUID() }, sql = "CREATE TABLE fictional (value TEXT);", signal = new AbortController().signal;
  await stageBackup(env.MEDIA_BUCKET, { ...scope, createdAt: Date.now(), schemaVersion: "fictional", bookmark: "fictional-bookmark", authKeyId: backupKeyId(env.BETTER_AUTH_SECRET) },
    new Response(sql).body!, sql.length, signal);
  const file = await encryptBackup(env.MEDIA_BUCKET, scope, env.BACKUP_ENCRYPTION_KEY, signal);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, result: { success: false, error } })));
  try {
    const response = await send({ action: "restore", id: scope.id, file: file.file, keyId: file.keyId, authKeyId: file.source.authKeyId }, {}, { ...bindings, APP_ENV: "staging" });
    const body = await response.json<Record<string, unknown>>();
    expect(response.status).toBe(500); expect(body.error).toBe("RESTORE_FAILED"); expect(body.importError).toBe(importError);
    expect(JSON.stringify(body)).not.toContain("fictional-private");
    expect((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
}, 10000);
const history = [
  { backupKey: "fictional-old-backup-key-0123456789abcdef", authSecret: "fictional-old-auth-secret-0123456789abcdef" },
  { backupKey: "fictional-other-backup-key-0123456789abcdef", authSecret: "fictional-other-auth-secret-0123456789abcdef" },
];
it.each([false, true])("clears restore plaintext without resuming the request and preserves a replacement lease (%s)", async replaced => {
  const scope = { environment: "staging" as const, id: crypto.randomUUID() }, sql = "CREATE TABLE fictional (value TEXT);", signal = new AbortController().signal;
  await stageBackup(env.MEDIA_BUCKET, { ...scope, createdAt: Date.now(), schemaVersion: "fictional", bookmark: "fictional-bookmark", authKeyId: backupKeyId(env.BETTER_AUTH_SECRET) },
    new Response(sql).body!, sql.length, signal);
  const file = await encryptBackup(env.MEDIA_BUCKET, scope, env.BACKUP_ENCRYPTION_KEY, signal);
  let entered!: () => void, resume!: () => void;
  const importing = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { resume = resolve; });
  vi.stubGlobal("fetch", vi.fn(async () => { entered(); await blocked; return Response.json({ success: false }); }));
  const controller = new AbortController(), ctx = createExecutionContext(), config = { ...bindings, APP_ENV: "staging" };
  const pending = recoveryWorker.fetch(new Request("https://recovery.example.test/operate", { method: "POST", signal: controller.signal,
    headers: { Authorization: "Bearer " + config.RESTORE_OPERATOR_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", id: scope.id, file: file.file, keyId: file.keyId, authKeyId: file.source.authKeyId }) }), config, ctx);
  try {
    await importing;
    const plaintext = (await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects;
    expect(plaintext).toHaveLength(1);
    const leaseKey = key.replace("/test/", "/staging/");
    expect(await (await env.MEDIA_BUCKET.get(leaseKey))!.json()).toMatchObject({ plaintextKey: plaintext[0].key });
    const replacement = { updatedAt: Date.now(), deadline: Date.now() + 60000 };
    if (replaced) await env.MEDIA_BUCKET.put(leaseKey, JSON.stringify(replacement));
    controller.abort(); await waitOnExecutionContext(ctx);
    expect.soft((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
    expect.soft(await (await env.MEDIA_BUCKET.get(leaseKey))!.json()).toMatchObject(replaced ? replacement : { deadline: 0 });
    expect(await env.MEDIA_BUCKET.head(`backups/staging/${scope.id}/${file.file}.bin`)).not.toBeNull();
  } finally { resume(); await pending; await waitOnExecutionContext(ctx); vi.unstubAllGlobals(); }
}, 10000);
it.each(["head", "delete"] as const)("retains plaintext cleanup when disconnected during its %s call", async phase => {
  const scope = { environment: "staging" as const, id: crypto.randomUUID() }, sql = "CREATE TABLE fictional (value TEXT);", signal = new AbortController().signal;
  await stageBackup(env.MEDIA_BUCKET, { ...scope, createdAt: Date.now(), schemaVersion: "fictional", bookmark: "fictional-bookmark", authKeyId: backupKeyId(env.BETTER_AUTH_SECRET) },
    new Response(sql).body!, sql.length, signal);
  const file = await encryptBackup(env.MEDIA_BUCKET, scope, env.BACKUP_ENCRYPTION_KEY, signal);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false })));
  let entered!: () => void, resume!: () => void, deleted = false;
  const cleaning = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { resume = resolve; });
  const head = env.MEDIA_BUCKET.head.bind(env.MEDIA_BUCKET), remove = env.MEDIA_BUCKET.delete.bind(env.MEDIA_BUCKET);
  vi.spyOn(env.MEDIA_BUCKET, "head").mockImplementation(async name => {
    if (phase === "head" && name.startsWith("backup-restore/")) { entered(); await blocked; }
    return head(name);
  });
  vi.spyOn(env.MEDIA_BUCKET, "delete").mockImplementation(async names => {
    if (typeof names === "string" && names.startsWith("backup-restore/")) {
      if (phase === "delete") { entered(); await blocked; }
      await remove(names); deleted = true;
    } else await remove(names);
  });
  const controller = new AbortController(), ctx = createExecutionContext(), retained = vi.spyOn(ctx, "waitUntil"), config = { ...bindings, APP_ENV: "staging" };
  const pending = recoveryWorker.fetch(new Request("https://recovery.example.test/operate", { method: "POST", signal: controller.signal,
    headers: { Authorization: "Bearer " + config.RESTORE_OPERATOR_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", id: scope.id, file: file.file, keyId: file.keyId, authKeyId: file.source.authKeyId }) }), config, ctx);
  try {
    await cleaning; controller.abort();
    let finished = false;
    const background = waitOnExecutionContext(ctx).then(() => { finished = true; });
    // The outer abort handler registers lease release first; let it settle while deletion stays blocked.
    await retained.mock.calls[0][0];
    await new Promise(resolve => setTimeout(resolve, 0));
    expect.soft(finished).toBe(false);
    expect.soft(await (await env.MEDIA_BUCKET.get(key.replace("/test/", "/staging/")))!.json()).toMatchObject({ deadline: 0 });
    resume(); await background;
    expect.soft(deleted).toBe(true);
    expect.soft((await env.MEDIA_BUCKET.list({ prefix: "backup-restore/" })).objects).toHaveLength(0);
    expect(await env.MEDIA_BUCKET.head(`backups/staging/${scope.id}/${file.file}.bin`)).not.toBeNull();
  } finally { resume(); await pending; await waitOnExecutionContext(ctx); vi.unstubAllGlobals(); }
}, 10000);
it.each(["sanitize", "credentials"].flatMap(action => [
  [action, "current authentication", bindings.BETTER_AUTH_SECRET], [action, "selected authentication", history[0].authSecret],
  [action, "other historical authentication", history[1].authSecret], [action, "current backup", bindings.BACKUP_ENCRYPTION_KEY],
  [action, "historical backup", history[1].backupKey],
]))("%s rejects reuse of the %s secret before accessing restored credentials", async (action, _kind, newSecret) => {
  await applyD1Migrations(env.TEST_RESTORE_DB, env.TEST_MIGRATIONS);
  const prepare = vi.spyOn(env.TEST_RESTORE_DB, "prepare"), config = { ...bindings, BACKUP_KEYRING: JSON.stringify(history), RESTORE_NEW_AUTH_SECRET: newSecret };
  const response = await send({ action, maintenanceConfirmed: true, authKeyId: backupKeyId(history[0].authSecret) }, {}, config);
  expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ error: "RESTORE_FAILED" });
  expect(prepare).not.toHaveBeenCalled();
});
it("accepts an independent new authentication secret for both cleanup and verification", async () => {
  await applyD1Migrations(env.TEST_RESTORE_DB, env.TEST_MIGRATIONS);
  const config = { ...bindings, BACKUP_KEYRING: JSON.stringify(history) };
  for (const action of ["sanitize", "credentials"]) {
    const response = await send({ action, maintenanceConfirmed: true, authKeyId: backupKeyId(history[0].authSecret) }, {}, config);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ credentialsCleared: true, authKeyId: backupKeyId(config.RESTORE_NEW_AUTH_SECRET) });
  }
});
it.each([false, true])("keeps the restore lease until an interrupted credential write settles (reject=%s)", async rejected => {
  await applyD1Migrations(env.TEST_RESTORE_DB, env.TEST_MIGRATIONS);
  let entered!: () => void, resume!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { resume = resolve; });
  const batch = env.TEST_RESTORE_DB.batch.bind(env.TEST_RESTORE_DB);
  vi.spyOn(env.TEST_RESTORE_DB, "batch").mockImplementation(async statements => {
    entered(); await blocked;
    if (rejected) throw new Error("fictional-write-failure");
    return batch(statements);
  });
  const controller = new AbortController(), ctx = createExecutionContext();
  const pending = recoveryWorker.fetch(new Request("https://recovery.example.test/operate", { method: "POST", signal: controller.signal,
    headers: { Authorization: "Bearer " + bindings.RESTORE_OPERATOR_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sanitize", maintenanceConfirmed: true, authKeyId: backupKeyId(bindings.BETTER_AUTH_SECRET) }) }), bindings, ctx);
  try {
    await writing; controller.abort();
    let finished = false;
    const background = waitOnExecutionContext(ctx).then(() => { finished = true; });
    // Let the same-key release interval expire while the D1 write remains blocked.
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect.soft(finished).toBe(false);
    expect.soft((await (await env.MEDIA_BUCKET.get(key))!.json<{ deadline: number }>()).deadline).toBeGreaterThan(Date.now());
    expect.soft((await send({ action: "review" })).status).toBe(409);
    resume(); expect((await pending).status).toBe(rejected ? 500 : 200); await background;
    expect(await (await env.MEDIA_BUCKET.get(key))!.json()).toMatchObject({ deadline: 0 });
    expect((await send({ action: "review" })).status).toBe(200);
  } finally { resume(); await pending; await waitOnExecutionContext(ctx); }
}, 10000);
