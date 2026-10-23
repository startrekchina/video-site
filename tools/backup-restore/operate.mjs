import { readFileSync, writeFileSync } from "node:fs";

const [configPath, requestPath, outputPath] = process.argv.slice(2);
if (!configPath || !requestPath || !outputPath) throw new Error("Usage: node operate.mjs <private-client-config.json> <request.json> <private-output.json>");
const config = JSON.parse(readFileSync(configPath, "utf8")), payload = readFileSync(requestPath, "utf8"), url = new URL(config.endpoint);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/operate"
  || typeof config.operatorToken !== "string" || Buffer.byteLength(config.operatorToken) < 32 || Buffer.byteLength(payload) > 16384) throw new Error("Invalid recovery client configuration");
const response = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15 * 60_000),
  headers: { Authorization: "Bearer " + config.operatorToken, "Content-Type": "application/json" }, body: payload });
if (!response.ok) { await response.body?.cancel(); throw new Error(`Recovery request failed (HTTP ${response.status}); keep the target isolated`); }
const reader = response.body.getReader(), chunks = []; let length = 0;
try {
  while (true) {
    const next = await reader.read(); if (next.done) break;
    length += next.value.byteLength; if (length > 256 * 1024) throw new Error("Recovery response exceeds the client limit"); chunks.push(next.value);
  }
} finally { await reader.cancel().catch(() => {}); }
const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log("Recovery result written; the tool never switches the live database or reopens service.");
