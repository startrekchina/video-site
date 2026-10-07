import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Tests use the committed placeholder secrets so they never depend on a developer's .dev.vars.
const testSecrets = parseEnv(readFileSync(".dev.vars.example", "utf8")) as Record<string, string>;
const testMigrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    cloudflareTest({
      main: "./workers/app.ts",
      experimental: { newConfig: true },
      miniflare: { bindings: { ...testSecrets, TEST_MIGRATIONS: testMigrations }, assets: { directory: "public" } },
    }),
  ],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["test/**/*.test.ts", "app/**/*.test.ts", "workers/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
