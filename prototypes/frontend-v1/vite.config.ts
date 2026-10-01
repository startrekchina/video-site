import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = import.meta.dirname

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Serve the repo's real public/ (posters, favicon, logo) so the prototype uses the same assets as production.
  publicDir: path.resolve(root, "../../public"),
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  server: { port: 5178, fs: { allow: [path.resolve(root, "../..")] } },
  preview: { port: 5178 },
})
