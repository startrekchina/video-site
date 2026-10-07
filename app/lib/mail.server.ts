import { APIError } from "better-auth/api";
import { sendEmail } from "./email.server";
import { sha256 } from "./registration.server";
import { settings } from "./settings.server";

type Purpose = "registration_verification" | "verification_resend" | "email_change_verification" | "password_reset" | "admin_notification";
export type MailAttempt = { id: string; email: string; purpose: Purpose };

export async function reserveMail(env: Env, email: string, purpose: Purpose): Promise<MailAttempt> {
  if (typeof email !== "string" || !email || email.length > 320) throw new APIError("BAD_REQUEST", { code: "INVALID_EMAIL", message: "邮箱格式无效。" });
  const key = await sha256(email.toLowerCase());
  const id = crypto.randomUUID();
  const now = Date.now();
  const group = purpose === "password_reset" ? "purpose = 'password_reset'" : "purpose IN ('registration_verification','verification_resend','email_change_verification')";
  const condition = purpose === "admin_notification" ? "1" : `NOT EXISTS (SELECT 1 FROM email_deliveries WHERE to_email_key = ? AND ${group} AND created_at > ?)
    AND (SELECT count(*) FROM email_deliveries WHERE to_email_key = ? AND ${group} AND created_at > ?) < ?`;
  const statement = env.DB.prepare(`INSERT INTO email_deliveries (id, to_email_key, purpose, status, error_code, created_at)
    SELECT ?, ?, ?, 'unknown', 'EMAIL_PENDING', ? WHERE ${condition}`);
  const result = await (purpose === "admin_notification" ? statement.bind(id, key, purpose, now)
    : statement.bind(id, key, purpose, now, key, now - settings.rateLimits.memberEmail.minInterval * 1000, key, now - 3600000, settings.rateLimits.memberEmail.perHour)).run();
  if (!result.meta.changes) {
    const last = await env.DB.prepare(`SELECT max(created_at) AS latest, min(created_at) AS earliest, count(*) AS n FROM email_deliveries
      WHERE to_email_key = ? AND ${group} AND created_at > ?`).bind(key, now - 3600000).first<{ latest: number; earliest: number; n: number }>();
    const until = Math.max((last?.latest ?? now) + settings.rateLimits.memberEmail.minInterval * 1000,
      (last?.n ?? 0) >= settings.rateLimits.memberEmail.perHour ? (last!.earliest + 3600000) : 0);
    throw new APIError("TOO_MANY_REQUESTS", { code: "EMAIL_RATE_LIMITED", message: "邮件发送过于频繁，请稍后再试。" }, { "Retry-After": String(Math.max(1, Math.ceil((until - now) / 1000))) });
  }
  return { id, email: email.toLowerCase(), purpose };
}

export async function deliverMail(env: Env, attempt: MailAttempt, urlOrText: string, userId?: string) {
  const claim = await env.DB.prepare("UPDATE email_deliveries SET error_code = 'EMAIL_SENDING' WHERE id = ? AND error_code = 'EMAIL_PENDING'").bind(attempt.id).run();
  if (!claim.meta.changes) return;
  const reset = attempt.purpose === "password_reset";
  const notification = attempt.purpose === "admin_notification";
  const result = await sendEmail(env, { to: attempt.email, subject: notification ? "账号状态通知" : reset ? "重设你的密码" : "验证你的注册邮箱",
    text: notification ? urlOrText : `请打开以下链接${reset ? "重设密码" : "验证邮箱"}（1 小时内有效）：\n${urlOrText}\n如非本人操作，请忽略这封邮件。` });
  await env.DB.prepare(`UPDATE email_deliveries SET user_id = (SELECT user_id FROM member_profiles WHERE user_id = ?),
    status = ?, provider_message_id = ?, error_code = ? WHERE id = ?`)
    .bind(userId ?? null, result.status, result.status === "accepted" ? result.messageId : null, result.status === "accepted" ? null : result.errorCode, attempt.id).run();
  console.info(JSON.stringify({ requestId: attempt.id, emailKey: await sha256(attempt.email), purpose: attempt.purpose,
    status: result.status, code: result.status === "accepted" ? undefined : result.errorCode }));
}

export async function finishUnsentMail(env: Env, attempt: MailAttempt) {
  await env.DB.prepare("UPDATE email_deliveries SET status = 'failed', error_code = 'EMAIL_NOT_SENT' WHERE id = ? AND error_code = 'EMAIL_PENDING'").bind(attempt.id).run();
}
