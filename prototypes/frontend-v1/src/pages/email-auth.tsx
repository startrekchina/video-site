import type React from "react"
import { useState } from "react"
import { CircleCheckIcon } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { fakeLatency } from "@/lib/utils"
import { AuthFrame, TurnstileStub } from "@/components/site/auth-frame"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { StatusButton } from "@/components/ui/status-button"

// Email flows backfilled from the formal app for design review. No mail is sent; links and tokens are simulated.

type Feedback = { message: string; error?: boolean } | null

function FeedbackAlert({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  return (
    <Alert role={feedback.error ? "alert" : "status"} variant={feedback.error ? "destructive" : "default"}>
      <AlertTitle>{feedback.message}</AlertTitle>
    </Alert>
  )
}

function SignInLinks({ demo }: { demo?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span>
        已经有账号？<Link to="/login" className="link-underline text-foreground">登录</Link> ·{" "}
        <Link to="/register" className="link-underline text-foreground">邀请码注册</Link>
      </span>
      {demo && <span className="font-mono text-xs">{demo}</span>}
    </div>
  )
}

function EmailForm({ sent }: { sent: string }) {
  const [email, setEmail] = useState("")
  const [human, setHuman] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setFeedback(null)
        await fakeLatency()
        setBusy(false)
        // Turnstile tokens are single use, so the widget resets after every submit.
        setHuman(false)
        setFeedback({ message: sent })
      }}
    >
      <FieldGroup>
        <FeedbackAlert feedback={feedback} />
        <Field>
          <FieldLabel htmlFor="email">注册邮箱</FieldLabel>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} autoComplete="email" />
        </Field>
        <TurnstileStub verified={human} onVerify={() => setHuman(true)} />
        <StatusButton type="submit" status={busy ? "loading" : "idle"} disabled={!human}>
          发送邮件
        </StatusButton>
      </FieldGroup>
    </form>
  )
}

export function ForgotPasswordPage() {
  return (
    <AuthFrame
      title="找回密码"
      description="通过注册邮箱获取重设链接，1 小时内有效。"
      aside={<SignInLinks demo={<>原型不发邮件：<Link to="/reset-password?token=demo" className="link-underline">打开重设链接</Link></>} />}
    >
      <EmailForm sent="如果该邮箱已注册，你会收到一封重设密码邮件，链接 1 小时内有效。请检查收件箱和垃圾邮件，若未收到可稍后重试。" />
    </AuthFrame>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  // An expired or used link comes back with ?error= instead of a token.
  const invalid = params.has("error") || !params.get("token")

  return (
    <AuthFrame
      title="重设密码"
      description={invalid ? "重设链接无效或已过期，请重新申请重设邮件。" : "请设置新密码。保存后，所有设备都会退出登录。"}
      aside={<SignInLinks demo={invalid ? undefined : "原型：保存后演示密码仍是 engage"} />}
    >
      {invalid ? (
        <Button render={<Link to="/forgot-password" />} nativeButton={false} className="w-full">
          重新申请重设邮件
        </Button>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (pw !== pw2) return setFeedback({ message: "两次密码输入不一致。", error: true })
            setBusy(true)
            setFeedback(null)
            await fakeLatency()
            navigate("/reset-password/complete", { replace: true })
          }}
        >
          <FieldGroup>
            <FeedbackAlert feedback={feedback} />
            <Field>
              <FieldLabel htmlFor="new-password">新密码</FieldLabel>
              <Input id="new-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
              <FieldDescription>8–128 位，支持中文和空格</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">确认新密码</FieldLabel>
              <Input id="confirm-password" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
            </Field>
            <StatusButton type="submit" status={busy ? "loading" : "idle"}>
              保存新密码
            </StatusButton>
            <p className="text-xs text-muted-foreground">若保存失败或重设链接已失效，请重新申请重设邮件。</p>
          </FieldGroup>
        </form>
      )}
    </AuthFrame>
  )
}

export function ResetCompletePage() {
  return (
    <AuthFrame title="密码已重设" description="请使用新密码重新登录。">
      <div className="grid gap-6">
        <Alert role="status">
          <CircleCheckIcon aria-hidden="true" />
          <AlertTitle>所有设备已退出登录</AlertTitle>
          <AlertDescription>已添加的通行密钥和未使用的备用码仍然保留。开启了二步验证的，登录时仍需输入动态验证码或备用码。</AlertDescription>
        </Alert>
        <Button render={<Link to="/login" replace />} nativeButton={false} className="w-full">
          前往登录
        </Button>
      </div>
    </AuthFrame>
  )
}

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const error = params.get("error")
  const description =
    error === "EMAIL_CHANGE_ACCOUNT"
      ? "该链接已使用，或不属于当前登录的账号。如需修改邮箱，请到「账号与安全」重新提交。"
      : error
        ? "验证链接无效或已过期。注册验证请重新发送验证邮件；修改邮箱请到「账号与安全」重新提交。"
        : "邮箱已验证。"

  return (
    <AuthFrame title="邮箱验证" description={description} aside={<SignInLinks />}>
      <div className="grid gap-3">
        <Link className="underline" to="/login">
          前往登录
        </Link>
        <Link className="underline" to="/verify-pending">
          重新发送验证邮件
        </Link>
      </div>
    </AuthFrame>
  )
}

export function VerifyPendingPage() {
  const [params] = useSearchParams()
  const delivery = params.get("delivery")
  const description =
    delivery === "accepted"
      ? "账号注册已成功。请查收邮件并点击链接完成验证；若未收到，请检查垃圾邮件或稍后重试。"
      : delivery
        ? "账号已注册，但验证邮件可能没有发出。若几分钟后仍未收到，请在下方重新发送。"
        : "输入注册邮箱，重新发送验证邮件。链接 1 小时内有效。"

  return (
    <AuthFrame
      title="等待邮箱验证"
      description={description}
      aside={<SignInLinks demo={<>原型不发邮件：<Link to="/verify-email" className="link-underline">打开验证链接</Link></>} />}
    >
      <EmailForm sent="如果该邮箱已注册且尚未验证，你会收到一封新的验证邮件，链接 1 小时内有效。请检查收件箱和垃圾邮件，若未收到可稍后重试。" />
    </AuthFrame>
  )
}
