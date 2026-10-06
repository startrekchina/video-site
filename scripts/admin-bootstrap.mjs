import { randomBytes, randomUUID, createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function bootstrapQuery(action, username, now = Date.now()) {
  if (action === "invite") {
    const code = randomBytes(32).toString("hex");
    return { code, query: { sql: "INSERT INTO invitations (id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?) RETURNING id",
      params: [randomUUID(), createHash("sha256").update(code).digest("hex"), now, now + 30 * 86400000] } };
  }
  if (action !== "promote" || typeof username !== "string" || !/^[A-Za-z0-9_.]{3,30}$/.test(username)) throw new Error("用法：invite 或 promote <用户名>");
  return { query: { sql: `UPDATE member_profiles SET role = 'admin' WHERE role = 'member' AND status = 'active' AND registration_state = 'completed'
    AND user_id IN (SELECT id FROM "user" WHERE username = ? AND emailVerified = 1) RETURNING user_id`, params: [username.toLowerCase()] } };
}

function main() {
  const args = process.argv.slice(2);
  const environment = args.find(value => value.startsWith("--env="))?.slice(6);
  if (!["development", "staging", "production"].includes(environment)) throw new Error("必须明确指定 --env=development、staging 或 production。");
  if (args.some(value => value.startsWith("--") && value !== "--execute" && !value.startsWith("--env="))) throw new Error("未知参数。");
  const positional = args.filter(value => value !== "--" && !value.startsWith("--"));
  if (positional.length > 2) throw new Error("参数过多。");
  if (existsSync(".env")) process.loadEnvFile(".env");
  const local = environment === "development";
  const prefix = environment.toUpperCase();
  const databaseId = local ? "00000000-0000-4000-8000-000000000000" : process.env[`${prefix}_D1_DATABASE_ID`];
  if (!databaseId || !/^[a-f0-9-]{36}$/i.test(databaseId)) throw new Error("目标数据库未配置。");
  if (!local && databaseId === process.env[`${environment === "staging" ? "PRODUCTION" : "STAGING"}_D1_DATABASE_ID`]) throw new Error("两环境数据库不能相同。");
  const { code, query } = bootstrapQuery(positional[0], positional[1]);
  const directory = mkdtempSync(join(tmpdir(), "video-site-bootstrap-"));
  let migrationPath;
  try {
    const bodyPath = join(directory, "query.json"); writeFileSync(bodyPath, JSON.stringify(query), { mode: 0o600 });
    const command = [resolve("node_modules/cf/bin/cf"), "d1", "query", databaseId, "--mode", environment, "--body", `@${bodyPath}`];
    if (local && args.includes("--execute")) {
      // cf beta.12 cannot query local D1; its supported migration runner executes the same atomic SQL.
      let index = 0;
      const sql = query.sql.replace(/\?/g, () => typeof query.params[index] === "number" ? String(query.params[index++]) : `'${query.params[index++].replace(/'/g, "''")}'`).replace(/ RETURNING \w+$/, "");
      const guard = `bootstrap_guard_${randomUUID().replace(/-/g, "")}`;
      migrationPath = join(directory, `${Date.now()}_${randomUUID()}.sql`);
      writeFileSync(migrationPath, `CREATE TABLE ${guard} (n INTEGER CHECK(n = 1));\n${sql};\nINSERT INTO ${guard} SELECT changes();\nDROP TABLE ${guard};\n`, { mode: 0o600 });
      command.splice(1, command.length - 1, "d1", "migrations", "apply", databaseId, "--dir", directory, "--table", "local_admin_operations", "--mode", environment);
    }
    if (local) command.push("--local", "--persist-to", ".cloudflare/state");
    if (!args.includes("--execute")) command.push("--dry-run");
    const output = execFileSync(process.execPath, command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!args.includes("--execute")) { console.log("预检完成，未写入数据库。增加 --execute 执行。"); return; }
    const results = JSON.parse(output);
    const entries = Array.isArray(results) ? results : results.result ?? [results];
    if (!entries.some(result => result.success !== false && ((result.results?.length ?? 0) > 0 || local && result.status === "✅"))) throw new Error("目标不符合条件或数据库未返回完成记录。");
    console.log(code ? `初始邀请码（仅本次显示，默认 30 天）：${code}` : "已将完成邮箱验证的正常成员提升为管理员。");
  } finally { const path = join(directory, "query.json"); if (existsSync(path)) unlinkSync(path); if (migrationPath && existsSync(migrationPath)) unlinkSync(migrationPath); rmdirSync(directory); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error && !('stdout' in error) ? error.message : "cf 执行失败；请核对所选环境、登录和迁移状态。"); process.exitCode = 1; }
}
