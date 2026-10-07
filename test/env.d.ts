import type { D1Migration } from "cloudflare:test";

// Extend generated bindings only for the local Workers Vitest environment.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      TEST_MEDIA_BASE64: string;
    }
  }
}
