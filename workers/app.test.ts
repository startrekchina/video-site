import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { expect, it, vi } from "vitest";

vi.mock(import("react-router"), async (importOriginal) => ({
  ...await importOriginal(),
  createRequestHandler: () => async () => new Response("private data", {
    headers: { "Cache-Control": "public, max-age=3600" },
  }),
}));

it("overrides a route's public cache policy with private, no-store", async () => {
  vi.resetModules();
  const worker = (await import("./app")).default;
  const request = new Request("http://example.com/") as Parameters<typeof worker.fetch>[0];
  const res = await worker.fetch(request, env, createExecutionContext());
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await res.text()).toBe("private data");
});
