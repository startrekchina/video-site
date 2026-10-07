import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vitest/config";

// Tests use the committed placeholder secrets so they never depend on a developer's .dev.vars.
const testSecrets = parseEnv(readFileSync(".dev.vars.example", "utf8")) as Record<string, string>;

export default defineConfig({
  plugins: [
    reactRouter(),
    cloudflareTest({
      main: "./workers/app.ts",
      experimental: { newConfig: true },
      miniflare: { bindings: testSecrets, assets: { directory: "public" } },
    }),
  ],
  resolve: { tsconfigPaths: true },
  test: { include: ["test/**/*.test.ts", "app/**/*.test.ts", "workers/**/*.test.ts"] },
});
