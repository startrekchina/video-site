import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import recoveryWorker from "../tools/backup-restore/worker";
import { backupKeyId } from "@/lib/backup-keys.server";

const bindings = { ...env, APP_ENV: "test", BACKUP_DATABASE_ID: "00000000-0000-4000-8000-000000000000", RESTORE_TARGET_DATABASE_ID: "00000000-0000-4000-8000-000000000001",
  RESTORE_DB: env.TEST_RESTORE_DB, RESTORE_NEW_AUTH_SECRET: "fictional-new-auth-secret-0123456789abcdef", RESTORE_OPERATOR_TOKEN: "fictional-operator-token-0123456789abcdef" };
const key = `backup-restore-control/test/${bindings.RESTORE_TARGET_DATABASE_ID}.json`;
async function send(body: object, headers: Record<string, string> = {}, config = bindings) {
  const ctx = createExecutionContext(), response = await recoveryWorker.fetch(new Request("https://recovery.example.test/operate", { method: "POST",
    headers: { Authorization: "Bearer " + config.RESTORE_OPERATOR_TOKEN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), config, ctx);
  await waitOnExecutionContext(ctx); return response;
}
afterEach(() => vi.restoreAllMocks());
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
const history = [
  { backupKey: "fictional-old-backup-key-0123456789abcdef", authSecret: "fictional-old-auth-secret-0123456789abcdef" },
  { backupKey: "fictional-other-backup-key-0123456789abcdef", authSecret: "fictional-other-auth-secret-0123456789abcdef" },
];
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
