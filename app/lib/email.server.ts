import { settings } from "./settings.server";

type EmailEnv = Pick<Env, "EMAIL_API_BASE_URL" | "EMAIL_SENDER_DOMAIN" | "EMAIL_FROM" | "EMAIL_REPLY_TO" | "EMAIL_API_KEY">;
type EmailMessage = { to: string; subject: string; text: string };
type EmailResult = { status: "accepted"; messageId: string } | { status: "failed" | "unknown"; errorCode: string };
const mailbox = /^[^\s<>@\x00-\x1f\x7f]+@[^\s<>@\x00-\x1f\x7f]+\.[^\s<>@\x00-\x1f\x7f]+$/;

/** Internal transport only. Callers must apply membership gates, exact quotas and delivery persistence. */
export async function sendEmail(env: EmailEnv, message: EmailMessage): Promise<EmailResult> {
  let base: URL;
  try {
    base = new URL(env.EMAIL_API_BASE_URL);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/"
      || !env.EMAIL_API_KEY || !mailbox.test(env.EMAIL_FROM) || !mailbox.test(env.EMAIL_REPLY_TO)
      || env.EMAIL_FROM.split("@")[1].toLowerCase() !== env.EMAIL_SENDER_DOMAIN.toLowerCase()) {
      throw new Error("Invalid email configuration");
    }
  } catch { return { status: "failed", errorCode: "EMAIL_CONFIGURATION_INVALID" }; }
  if (!mailbox.test(message.to) || !message.subject || /[\x00-\x1f\x7f]/.test(message.subject) || !message.text) {
    return { status: "failed", errorCode: "EMAIL_INPUT_INVALID" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.emailRequestTimeout * 1000);
  try {
    const response = await fetch(new URL("/api/v1/send/message", base), {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Server-API-Key": env.EMAIL_API_KEY },
      body: JSON.stringify({ to: [message.to], from: env.EMAIL_FROM, reply_to: env.EMAIL_REPLY_TO, subject: message.subject, plain_body: message.text }),
    });
    if (!response.ok) return { status: "failed", errorCode: "EMAIL_HTTP_ERROR" };
    const body: { status?: string; data?: { message_id?: unknown } } = await response.json();
    if (body?.status === "error" || body?.status === "parameter-error") {
      return { status: "failed", errorCode: "EMAIL_PROVIDER_REJECTED" };
    }
    const messageId = body?.data?.message_id;
    if (body?.status !== "success" || typeof messageId !== "string" || !messageId || messageId.length > 255 || /[\x00-\x20\x7f]/.test(messageId)) {
      return { status: "unknown", errorCode: "EMAIL_RESPONSE_INVALID" };
    }
    return { status: "accepted", messageId };
  } catch {
    // A request may have been accepted before the connection failed. Never retry or log raw provider data.
    return { status: "unknown", errorCode: "EMAIL_DELIVERY_UNCONFIRMED" };
  } finally { clearTimeout(timer); }
}
