import { cpSync, existsSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin } from "vite";

const RR_CLIENT_DIR = "build/client";
const CF_ASSETS_DIR = ".cloudflare/output/v0/workers/default/assets";

// ponytail: React Router v7 reads and writes client artifacts under build/client, while the
// cf Build Output forces them into CF_ASSETS_DIR. Drop once remix-run/react-router#15480 ships in v7.
function syncReactRouterClientDir(): Plugin {
  return {
    name: "sync-react-router-client-dir",
    sharedDuringBuild: true,
    writeBundle() {
      if (this.environment.name === "client") {
        cpSync(`${CF_ASSETS_DIR}/.vite`, `${RR_CLIENT_DIR}/.vite`, { recursive: true });
      }
    },
    buildApp: {
      order: "post",
      async handler() {
        if (existsSync(RR_CLIENT_DIR)) cpSync(RR_CLIENT_DIR, CF_ASSETS_DIR, { recursive: true });
      },
    },
  };
}

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter(), syncReactRouterClientDir()],
  resolve: { tsconfigPaths: true },
  server: { host: "0.0.0.0", port: 6120, strictPort: true },
  preview: { host: "0.0.0.0", port: 6120, strictPort: true },
});
