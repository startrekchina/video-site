import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/worker.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "better-auth-spike",
    entrypoint,
    compatibilityDate: "2026-09-25",
    compatibilityFlags: ["nodejs_compat"],
    env: {
      DB: bindings.d1({ name: "spike", id: "00000000-0000-4000-8000-000000000000" }),
    },
  },
});
