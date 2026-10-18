import { execSync } from "node:child_process"
import path from "node:path"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = import.meta.dirname

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // Shown in the footer.
  define: {
    __BUILD_INFO__: JSON.stringify({
      commit: process.env.WORKERS_CI_COMMIT_SHA ?? execSync("git rev-parse HEAD", { cwd: root }).toString().trim(),
    }),
  },
  // Serve the repo's real public/ (posters, favicon, logo) so the prototype uses the same assets as production.
  publicDir: path.resolve(root, "../../public"),
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  server: { port: 6120, host: true, strictPort: true, fs: { allow: [path.resolve(root, "../..")] } },
  preview: { port: 6120, host: true },
})