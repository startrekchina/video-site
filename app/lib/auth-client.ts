import { createAuthClient } from "better-auth/react";
import { usernameClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({ plugins: [usernameClient(), twoFactorClient(), passkeyClient()] });

const messages: Record<string, string> = {
  AUTH_REQUIRED: "请先登录。", AUTH_INVALID: "身份验证未通过，请重新登录后再试。", MEMBERSHIP_REQUIRED: "账号尚未完成注册和邮箱验证，或已被封禁。",
  INVALID_USERNAME_OR_PASSWORD: "用户名或密码不正确。", EMAIL_NOT_VERIFIED: "请先点击验证邮件中的链接完成验证；若未收到，可重新发送验证邮件。", INVALID_PASSWORD: "当前密码不正确。",
  USERNAME_IS_ALREADY_TAKEN: "这个用户名已被使用，请换一个用户名。", USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "这个邮箱已被使用，请换一个邮箱。",
  REGISTRATION_RETRY: "注册尚未完成，请稍后使用相同的用户名、邮箱和密码重试。", REGISTRATION_ATTEMPT_INVALID: "上次注册尚未完成，请使用与上次相同的用户名、邮箱和密码重新提交。",
  INVALID_TOKEN: "链接无效或已过期，请重新申请邮件。", TOKEN_EXPIRED: "链接已过期，请重新申请邮件。",
  CSRF_INVALID: "请求来源无法确认，请刷新页面后重试。", FRESH_SESSION_REQUIRED: "此操作需要已开启二步验证，并在 5 分钟内重新登录。请重新登录后再试。",
  SESSION_NOT_FRESH: "此操作需要在 5 分钟内登录过，请重新登录后再试。",
  INVITATION_INVALID: "邀请码无效。", INVITATION_EXPIRED: "邀请码已过期。", INVITATION_USED: "邀请码已被使用。",
  INVITATION_REVOKED: "邀请码已作废。", INVITATION_RESERVED: "邀请码正在注册中，请稍后重试。",
  QUOTA_EXHAUSTED: "邀请额度不足，无法继续生成邀请码。", TRUST_DEVICE_DISABLED: "本站不支持跳过二步验证。",
  USER_VERIFICATION_REQUIRED: "请使用支持指纹、面容或设备 PIN 验证的通行密钥。",
  INVALID_TWO_FACTOR_COOKIE: "二步验证已超时，请重新登录。", INVALID_CODE: "动态验证码或备用码不正确。",
  ADMIN_CHANGE_REJECTED: "操作未生效：该成员状态可能已变化，或此操作涉及你自己或最后一位管理员。请刷新页面后查看。",
  BACKUP_OWNER_REQUIRED: "仅本站站长可操作备份。", BACKUP_BUSY: "本环境已有备份或清理任务在执行，请稍后刷新状态。",
  BACKUP_CONFIG_INVALID: "本环境备份配置未就绪，本地开发不会调用远程 D1。", BACKUP_TARGET_UNAVAILABLE: "所选外部目标配置不完整或无效。",
  BACKUP_STATE_CHANGED: "备份状态已变化，请刷新检查。", BACKUP_ALREADY_COMPLETE: "该备份已完整完成，无需重试。",
  BACKUP_NOT_FOUND: "找不到本环境的备份。", BACKUP_NOT_READY: "该备份尚未完整完成或已清理，不能下载。",
  BACKUP_OBJECT_CHANGED: "备份对象缺失或版本已变化，拒绝下载未经校验的内容。",
};
export function authError(error: { code?: string; message?: string }, retry?: string | null) {
  if (error.code === "QUOTA_EXHAUSTED" && error.message?.startsWith("总额度不得低于当前占用")) return error.message;
  if (retry) return Number(retry) >= 60 ? `操作过于频繁，请约 ${Math.ceil(Number(retry) / 60)} 分钟后再试。` : `操作过于频繁，请在 ${retry} 秒后重试。`;
  if (error.code?.includes("CAPTCHA") || error.code?.includes("TURNSTILE")) return "人机验证失败，请重新验证。";
  return messages[error.code ?? ""] ?? "操作未完成，请检查输入或稍后重试。";
}
export async function call<T = Record<string, unknown>>(path: string, body?: object, captcha?: string, method?: "GET" | "POST" | "PUT"): Promise<T> {
  const response = await fetch(path, { method: method ?? (body ? "POST" : "GET"), credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json", ...(captcha ? { "x-captcha-response": captcha } : {}) } : undefined,
    body: body ? JSON.stringify(body) : undefined }).catch(() => { throw new Error("网络连接失败，请检查网络后重试。"); });
  // A failed response may be a platform error page rather than JSON; it still gets the generic message below.
  const result = await response.json().catch(error => { if (response.ok) throw error; return {}; }) as { data?: T; error?: { code?: string; message?: string }; code?: string; message?: string };
  if (!response.ok) throw new Error(authError(result.error ?? result, response.headers.get("Retry-After") ?? response.headers.get("X-Retry-After")));
  return (result.data ?? result) as T;
}
