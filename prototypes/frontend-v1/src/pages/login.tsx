import { useState } from "react"
import { FingerprintIcon } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { actions, useStore } from "@/data/store"
import { AuthFrame, TurnstileStub } from "@/components/site/auth-frame"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { StatusButton } from "@/components/ui/status-button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Demo credentials: any username with password "engage" succeeds; TOTP code 123456; any backup code shaped xxxxx-xxxx.
const DEMO_PASSWORD = "engage"
const TURNSTILE_AFTER = 3
const BACKUP_RE = /^[a-z0-9]{5}-[a-z0-9]{4}$/i

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const failures = useStore((s) => s.loginFailures)
  const [username, setUsername] = useState("picard_fan")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<"password" | "totp" | "backup">("password")
  const [code, setCode] = useState("")
  const [human, setHuman] = useState(false)
  const [busy, setBusy] = useState(false)
  const needTurnstile = failures >= TURNSTILE_AFTER

  const finish = () => {
    actions.login()
    navigate(params.get("next") || "/")
  }

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (needTurnstile && !human) {
      setError("请先完成人机验证")
      return
    }
    setBusy(true)
    setTimeout(() => {
      setBusy(false)
      if (password !== DEMO_PASSWORD) {
        actions.failLogin()
        setHuman(false)
        setError("用户名或密码不正确")
        return
      }
      setError(null)
      setStep("totp")
    }, 400)
  }

  if (step !== "password") {
    const backup = step === "backup"
    return (
      <AuthFrame title="二步验证" description="打开验证器应用，输入 6 位动态验证码，或使用一个未使用的备用码。">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (backup ? BACKUP_RE.test(code.trim()) : code === "123456") finish()
            else setError(backup ? "备用码无效或已被使用" : "验证码不正确或已过期")
          }}
        >
          <FieldGroup>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="code">{backup ? "二步验证备用码" : "动态验证码"}</FieldLabel>
              <Input
                key={step}
                id="code"
                inputMode={backup ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoFocus
                maxLength={backup ? 64 : 6}
                value={code}
                onChange={(e) => setCode(backup ? e.target.value : e.target.value.replace(/\D/g, ""))}
                className={backup ? "font-mono" : "h-12 text-center font-mono text-xl tracking-[0.5em]"}
                aria-invalid={!!error || undefined}
              />
              {error ? <FieldError>{error}</FieldError> : <FieldDescription>{backup ? "原型：任意 xxxxx-xxxx 格式都可以通过" : "原型演示码：123456"}</FieldDescription>}
            </Field>
            <Button type="submit" disabled={backup ? !code.trim() : code.length !== 6}>
              验证并登录
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep(backup ? "totp" : "backup")
                setCode("")
                setError(null)
              }}
            >
              {backup ? "改用动态验证码" : "改用备用码"}
            </Button>
          </FieldGroup>
        </form>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      title="登录"
      description="星际舰队档案馆是邀请制的私人观看站，仅对受邀成员开放。"
      aside={
        <div className="flex flex-col gap-1">
          <span>
            还没有账号？请向已加入的朋友索要邀请码，然后<Link to="/register" className="link-underline text-foreground">注册</Link>。
          </span>
          <span className="font-mono text-xs">原型演示密码：{DEMO_PASSWORD}（连续输错 {TURNSTILE_AFTER} 次后出现人机验证）</span>
        </div>
      }
    >
      <form onSubmit={submitPassword}>
        <FieldGroup>
          <Button type="button" variant="outline" onClick={finish}>
            <FingerprintIcon data-icon="inline-start" />
            使用通行密钥登录
          </Button>
          <FieldSeparator>或使用密码</FieldSeparator>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error}</AlertTitle>
              {failures > 0 && <AlertDescription>已连续失败 {failures} 次。多次失败后需要完成人机验证，登录接口也会被限流。</AlertDescription>}
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="username">用户名</FieldLabel>
            <Input id="username" autoComplete="username webauthn" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">密码</FieldLabel>
              <Link to="/about#recovery" className="text-sm text-muted-foreground hover:text-foreground">
                忘记密码？
              </Link>
            </div>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {needTurnstile && <TurnstileStub verified={human} onVerify={() => setHuman(true)} />}
          <StatusButton type="submit" status={busy ? "loading" : "idle"}>
            登录
          </StatusButton>
        </FieldGroup>
      </form>
    </AuthFrame>
  )
}
