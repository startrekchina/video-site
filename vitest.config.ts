import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Tests use the committed placeholder secrets so they never depend on a developer's .dev.vars.
const testSecrets = parseEnv(readFileSync(".dev.vars.example", "utf8")) as Record<string, string>;
const testMigrations = await readD1Migrations("./migrations");
const mediaFixture = "test/fixtures/media/signal-test.mp4";
if (!existsSync(mediaFixture)) execFileSync(process.execPath, ["scripts/gen-test-media.mjs"], { stdio: "inherit" });

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    cloudflareTest({
      main: "./workers/app.ts",
      experimental: { newConfig: true },
      miniflare: { bindings: { ...testSecrets, TEST_MIGRATIONS: testMigrations, TEST_MEDIA_BASE64: readFileSync(mediaFixture).toString("base64") } },
    }),
  ],
  resolve: { tsconfigPaths: true },
  test: {
    // Native password hashing and ten Worker module graphs otherwise compete for the same CPU.
    maxWorkers: 2,
    include: ["test/**/*.test.ts", "app/**/*.test.ts", "workers/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
