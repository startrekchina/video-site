import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("applies migrations to the D1 binding", async () => {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user','session','account','verification') ORDER BY name",
  ).all<{ name: string }>();
  expect(results.map((r) => r.name)).toEqual(["account", "session", "user", "verification"]);
});
