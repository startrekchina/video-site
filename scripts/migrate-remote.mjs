import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export function remoteMigrationSql(name, sql) {
  if (name !== "0010_registration_ownership.sql") return sql;
  // D1's remote statement splitter mistakes a bare CASE END for the trigger END (#4727).
  const start = "SELECT CASE WHEN NOT EXISTS (";
  const end = "'Registration completion conditions failed') END;";
  if (!sql.includes(start) || !sql.includes(end)) throw new Error("Registration migration changed; review the remote CASE transport workaround.");
  return sql.replace(start, "SELECT (CASE WHEN NOT EXISTS (").replace(end, "'Registration completion conditions failed') END);");
}

function main() {
  const mode = process.argv[2];
  if (!["staging", "production"].includes(mode) || process.argv.length !== 3) throw new Error("用法：node scripts/migrate-remote.mjs staging|production");
  process.loadEnvFile(".env");
  const database = process.env[`${mode.toUpperCase()}_D1_DATABASE_ID`];
  if (!database || !/^[a-f0-9-]{36}$/i.test(database) || database === process.env[`${mode === "staging" ? "PRODUCTION" : "STAGING"}_D1_DATABASE_ID`]) throw new Error("目标数据库未配置或环境未隔离。");
  const directory = mkdtempSync(resolve(".cloudflare/remote-migrations-"));
  const names = readdirSync("migrations").filter(name => /^\d{4}_[\w-]+\.sql$/.test(name));
  try {
    for (const name of names) writeFileSync(join(directory, name), remoteMigrationSql(name, readFileSync(join("migrations", name), "utf8")));
    const output = execFileSync(process.execPath, [resolve("node_modules/cf/bin/cf"), "d1", "migrations", "apply", database, "--mode", mode, "--dir", directory], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(output);
  } finally { for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error && !("stdout" in error) ? error.message : "cf 远程迁移失败；原始配置与资源标识不输出，请核对迁移状态。"); process.exitCode = 1; }
}
