import { useState } from "react";
import { FingerprintIcon, TicketIcon } from "lucide-react";
import { data, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/auth";
import { AuthFrame } from "@/components/site/auth-frame";
import { Field, useAction } from "@/components/site/account-form";
import { Turnstile } from "@/components/site/turnstile";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { FieldGroup, FieldSeparator, Field as FieldContainer, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { authClient, authError, call } from "@/lib/auth-client";
import { csrfData, safeNext } from "@/lib/security.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const csrf = await csrfData(request, context.cloudflare.env);
  const url = new URL(request.url);
  return data({ page: url.pathname, csrfToken: csrf.csrfToken, siteKey: context.cloudflare.env.TURNSTILE_SITE_KEY,
    next: safeNext(url.searchParams.get("next"), context.cloudflare.env.APP_ORIGIN) }, { headers: csrf.headers });
}
export const meta = () => [{ title: "账号 · 星际迷航中国" }];

export default function AuthPage(props: Route.ComponentProps) {
  const [params] = useSearchParams();
  return <AuthFlow key={props.loaderData.page + "?" + params.toString()} {...props} />;
}
function AuthFlow({ loaderData: config }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const [captcha, setCaptcha] = useState("");
  const [generation, setGeneration] = useState(0);
  const [step, setStep] = useState<"password" | "totp" | "backup">("password");
  const [inviteCode, setInviteCode] = useState(params.get("code") ?? "");
  const [inviteStep, setInviteStep] = useState(false);
  const { busy, run, setMessage, feedback } = useAction();
  const login = config.page === "/login";
  const register = config.page === "/register";
  const reset = config.page === "/reset-password";
  const verified = config.page === "/verify-email";
  const resend = config.page === "/verify-pending";
  const second = login && step !== "password";
  const title = second ? "二步验证" : login ? "登录" : register ? inviteStep ? "创建账号" : "使用邀请码注册" : reset ? "重设密码" : verified ? "邮箱验证" : resend ? "等待邮箱验证" : "找回密码";
  const description = verified ? (params.has("error") ? "验证链接无效或已过期，请重新申请邮件。" : "邮箱已验证，请正常登录。")
    : resend ? (params.get("delivery") && params.get("delivery") !== "accepted" ? "注册已完成，但验证邮件发送失败或结果未确认。请按配额重新发送。"
      : "注册结果已保留。请打开邮件链接完成验证；服务接受发送请求不代表邮件已经送达。")
    : second ? "打开验证器应用，输入 6 位动态码，或使用一个未用备用码。"
    : login ? "星际舰队档案馆是邀请制的私人观看站，仅对受邀成员开放。"
    : register ? inviteStep ? "用户名注册后不可修改，其他成员能看到它。注册完成后需要验证邮箱。" : "本站只对受邀成员开放。请输入朋友发给你的邀请码。"
    : "通过注册邮箱获取链接，1 小时内有效。";
  const needsCaptcha = !reset && !verified && !second;
  async function submit(form: HTMLFormElement) {
    const fields = Object.fromEntries(new FormData(form));
    if (needsCaptcha && !captcha) throw new Error("请先完成人机验证。");
    try {
      if (login && !second) {
        let retry: string | null = null;
        const result = await authClient.signIn.username({ username: String(fields.username), password: String(fields.password), fetchOptions: { headers: { "x-captcha-response": captcha }, onError: ({ response }) => { retry = response.headers.get("X-Retry-After"); } } });
        if (result.error) throw new Error(authError(result.error, retry));
        if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) setStep("totp");
        else window.location.assign(config.next);
      } else if (second) {
        await call(`/api/auth/two-factor/${step === "totp" ? "verify-totp" : "verify-backup-code"}`, { code: fields.code, trustDevice: false });
        window.location.assign(config.next);
      } else if (register) {
        if (fields.password !== fields.confirmPassword) throw new Error("两次密码输入不一致。");
        const result = await call<{ delivery: string | null }>("/auth/register", { ...fields, csrfToken: config.csrfToken }, captcha);
        window.location.assign(`/verify-pending?delivery=${encodeURIComponent(result.delivery ?? "unknown")}`);
      } else if (reset) {
        if (fields.newPassword !== fields.confirmPassword) throw new Error("两次密码输入不一致。");
        if (!params.get("token")) throw new Error("链接缺少凭证，请重新申请邮件。");
        await call("/api/auth/reset-password", { token: params.get("token"), newPassword: fields.newPassword });
        setMessage("密码已更新，旧会话已撤销。请重新登录；已启用的二步验证仍然有效。"); form.reset();
      } else {
        await call(`/api/auth/${resend ? "send-verification-email" : "request-password-reset"}`, { email: fields.email,
          ...(resend ? { callbackURL: `${window.location.origin}/verify-email` } : { redirectTo: `${window.location.origin}/reset-password` }) }, captcha);
        setMessage("如果邮箱符合条件，服务已处理本次发信请求。请检查收件箱和垃圾邮件，未收到可稍后重试。");
      }
    } finally { if (needsCaptcha) { setCaptcha(""); setGeneration(value => value + 1); } }
  }
  return <AuthFrame title={title} description={description} aside={login ? <span>还没有账号？请向已加入的朋友索要邀请码，然后<Link to="/register" className="link-underline text-foreground">注册</Link>。</span>
    : <span>已经有账号？<Link to="/login" className="link-underline text-foreground">登录</Link>{!register && <> · <Link to="/register" className="link-underline text-foreground">邀请码注册</Link></>}</span>}>
    {verified ? <div className="grid gap-3"><Link className="underline" to="/login">前往登录</Link><Link className="underline" to="/verify-pending">重新发送验证邮件</Link></div>
      : register && !inviteStep ? <form onSubmit={event => { event.preventDefault(); setInviteStep(true); }}><FieldGroup>
        <Field id="invitationCode" label="邀请码" value={inviteCode} onChange={event => setInviteCode(event.target.value)} required autoComplete="off" maxLength={512} className="h-11 font-mono tracking-wider" autoFocus />
        <Button type="submit" disabled={!inviteCode.trim()}>继续</Button>
      </FieldGroup></form>
      : <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; void run(() => submit(form)); }}><FieldGroup>
        {login && !second && <><Button variant="outline" type="button" disabled={busy} onClick={() => void run(async () => { const result = await authClient.signIn.passkey(); if (result?.error) throw new Error(authError(result.error)); if (!result?.data) throw new Error("通行密钥登录未完成。"); window.location.assign(config.next); })}><FingerprintIcon data-icon="inline-start" />使用通行密钥登录</Button><FieldSeparator>或使用密码</FieldSeparator></>}
        {feedback}
        {register && <><input type="hidden" name="invitationCode" value={inviteCode} /><Alert><TicketIcon /><AlertTitle>使用此邀请码注册</AlertTitle><AlertDescription><span className="break-all font-mono">{inviteCode}</span> · 提交时确认邀请码是否有效。</AlertDescription></Alert></>}
        {(login && !second || register) && <Field id="username" name="username" label="用户名" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" autoComplete="username webauthn" help={register ? "3–30 位字母、数字、下划线或点号" : undefined} />}
        {!login && !reset && <Field id="email" name="email" type="email" label="注册邮箱" required maxLength={320} autoComplete="email" />}
        {login && !second ? <FieldContainer><div className="flex items-center justify-between"><FieldLabel htmlFor="password">密码</FieldLabel><Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">忘记密码？</Link></div><Input id="password" name="password" type="password" required autoComplete="current-password" maxLength={128} /></FieldContainer>
          : (register || reset) && <Field id="password" name={reset ? "newPassword" : "password"} type="password" label={reset ? "新密码" : "密码"} required minLength={8} maxLength={128} autoComplete="new-password" help="8–128 位，支持中文和空格" />}
        {(reset || register) && <Field id="confirmPassword" name="confirmPassword" label={reset ? "确认新密码" : "确认密码"} type="password" required minLength={8} maxLength={128} autoComplete="new-password" />}
        {second && <Field id="code" name="code" label={step === "totp" ? "动态验证码" : "二步验证备用码"} required autoFocus autoComplete="one-time-code" inputMode={step === "totp" ? "numeric" : "text"} pattern={step === "totp" ? "[0-9]{6}" : undefined} maxLength={step === "totp" ? 6 : 64} className={step === "totp" ? "h-12 text-center font-mono text-xl tracking-[0.5em]" : "font-mono"} />}
        {needsCaptcha && <Turnstile key={generation} siteKey={config.siteKey} onToken={setCaptcha} />}
        <StatusButton type="submit" status={busy ? "loading" : "idle"} disabled={needsCaptcha && !captcha}>{second ? "验证并登录" : login ? "登录" : register ? "创建账号" : reset ? "保存新密码" : "发送邮件"}</StatusButton>
        {second && <Button type="button" variant="ghost" onClick={() => setStep(step === "totp" ? "backup" : "totp")}>{step === "totp" ? "改用备用码" : "改用动态码"}</Button>}
        {register && <Button type="button" variant="ghost" disabled={busy} onClick={() => setInviteStep(false)}>换一个邀请码</Button>}
        {reset && <p className="text-xs text-muted-foreground">提交失败不表示密码一定未变；链接已消费时，请重新申请邮件。</p>}
      </FieldGroup></form>}
  </AuthFrame>;
}
