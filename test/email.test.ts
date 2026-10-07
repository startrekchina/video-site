import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email.server";
import { settings } from "@/lib/settings.server";

const message = { to: "nova@example.test", subject: "验证你的邮箱", text: "请打开 https://example.test/verify-email?token=fictional-token" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("sends exactly one Postal request with the configured sender and returns only its message ID", async () => {
  const fetch = vi.fn(async () => Response.json({ status: "success", data: { message_id: "fictional-id@example.test", messages: { "nova@example.test": { id: 1, token: "fictional-provider-token" } } } }));
  vi.stubGlobal("fetch", fetch);
  expect(await sendEmail(env, message)).toEqual({ status: "accepted", messageId: "fictional-id@example.test" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("https://postal.example.test/api/v1/send/message");
  expect(options).toMatchObject({ method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", "X-Server-API-Key": env.EMAIL_API_KEY } });
  expect(JSON.parse(String(options.body))).toEqual({ to: [message.to], from: env.EMAIL_FROM, reply_to: env.EMAIL_REPLY_TO, subject: message.subject, plain_body: message.text });
});

it.each(["error", "parameter-error"])("treats HTTP 200 with %s as failure and discards upstream error text", async (status) => {
  const fetch = vi.fn(async () => Response.json({ status, data: { code: "UnauthenticatedFromAddress", message: message.text + env.EMAIL_API_KEY } }));
  vi.stubGlobal("fetch", fetch);
  expect(await sendEmail(env, message)).toEqual({ status: "failed", errorCode: "EMAIL_PROVIDER_REJECTED" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("treats an HTTP dependency failure as failure without retrying", async () => {
  const fetch = vi.fn(async () => new Response(message.text, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  expect(await sendEmail(env, message)).toEqual({ status: "failed", errorCode: "EMAIL_HTTP_ERROR" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects redirects without sending the API key or mail to the redirected host", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 307, headers: { Location: "https://other.example.test/send" } }));
  vi.stubGlobal("fetch", fetch);
  expect(await sendEmail(env, message)).toEqual({ status: "failed", errorCode: "EMAIL_HTTP_ERROR" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(options.redirect).toBe("manual");
});

it("marks an incomplete success response as unconfirmed", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "success", data: {} })));
  expect(await sendEmail(env, message)).toEqual({ status: "unknown", errorCode: "EMAIL_RESPONSE_INVALID" });
});

it("bounds a pending request and leaves the delivery unconfirmed without a second attempt", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const fetch = vi.fn((_url: URL, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(new DOMException("Fictional timeout", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetch);
  const pending = sendEmail(env, message);
  await vi.advanceTimersByTimeAsync(settings.emailRequestTimeout * 1000);
  expect(await pending).toEqual({ status: "unknown", errorCode: "EMAIL_DELIVERY_UNCONFIRMED" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  [{ EMAIL_API_BASE_URL: "http://postal.example.test" }, message],
  [{ EMAIL_API_BASE_URL: "https://postal.example.test/private?token=fictional-token" }, message],
  [{ EMAIL_API_KEY: "" }, message],
  [{ EMAIL_FROM: "noreply@other.example.test" }, message],
  [{}, { ...message, to: "nova@example.test\r\nBcc: quinn@example.test" }],
  [{}, { ...message, subject: "Subject\r\nBcc: quinn@example.test" }],
] as const)("rejects invalid configuration or input before sending (%j)", async (overrides, input) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await sendEmail({ ...env, ...overrides }, input)).status).toBe("failed");
  expect(fetch).not.toHaveBeenCalled();
});
