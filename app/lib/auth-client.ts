import { createAuthClient } from "better-auth/react";
import { usernameClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({ plugins: [usernameClient(), twoFactorClient(), passkeyClient()] });

const messages: Record<string, string> = {
  AUTH_REQUIRED: "请先登录。", AUTH_INVALID: "凭证无效，请重试。", MEMBERSHIP_REQUIRED: "账号尚未完成邮箱验证或已被停用。",
  INVALID_USERNAME_OR_PASSWORD: "用户名或密码不正确。", EMAIL_NOT_VERIFIED: "请先验证注册邮箱。", INVALID_PASSWORD: "当前密码不正确。",
  USERNAME_IS_ALREADY_TAKEN: "这个用户名已被使用，请换一个用户名。", USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "这个邮箱已被使用，请换一个邮箱。",
  REGISTRATION_RETRY: "注册尚未完成，请保持原用户名和邮箱重试。", REGISTRATION_ATTEMPT_INVALID: "本次注册资料与原尝试不一致，请使用原资料重试。",
  INVALID_TOKEN: "链接无效或已过期，请重新申请邮件。", TOKEN_EXPIRED: "链接已过期，请重新申请邮件。",
  CSRF_INVALID: "页面凭证已失效，请刷新重试。", FRESH_SESSION_REQUIRED: "请绑定二步验证，然后重新登录再执行此操作。",
  SESSION_NOT_FRESH: "请重新登录后再执行此敏感操作。",
  INVITATION_INVALID: "邀请码无效。", INVITATION_EXPIRED: "邀请码已过期。", INVITATION_USED: "邀请码已被使用。",
  INVITATION_REVOKED: "邀请码已作废。", INVITATION_RESERVED: "邀请码正在注册中，请稍后重试。",
  QUOTA_EXHAUSTED: "邀请额度不足，请核对当前占用。", TRUST_DEVICE_DISABLED: "本站不支持跳过二步验证。",
  USER_VERIFICATION_REQUIRED: "请使用支持指纹、面容或设备 PIN 验证的通行密钥。",
  INVALID_TWO_FACTOR_COOKIE: "二步挑战已失效，请重新登录。", INVALID_CODE: "验证码或备用码不正确。",
  ADMIN_CHANGE_REJECTED: "目标状态已变化，或操作受到管理员保护。",
};
export function authError(error: { code?: string; message?: string }, retry?: string | null) {
  if (error.code === "QUOTA_EXHAUSTED" && error.message?.startsWith("总额度不得低于当前占用")) return error.message;
  if (retry) return `操作过于频繁，请在 ${retry} 秒后重试。`;
  if (error.code?.includes("CAPTCHA") || error.code?.includes("TURNSTILE")) return "人机验证失败，请重新验证。";
  return messages[error.code ?? ""] ?? "操作未完成，请检查输入或稍后重试。";
}
export async function call<T = Record<string, unknown>>(path: string, body?: object, captcha?: string): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json", ...(captcha ? { "x-captcha-response": captcha } : {}) } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  const result = await response.json() as { data?: T; error?: { code?: string; message?: string }; code?: string; message?: string };
  if (!response.ok) throw new Error(authError(result.error ?? result, response.headers.get("Retry-After") ?? response.headers.get("X-Retry-After")));
  return (result.data ?? result) as T;
}
