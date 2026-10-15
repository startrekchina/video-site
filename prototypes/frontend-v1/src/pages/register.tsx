import { useState } from "react"
import { TicketCheckIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router"

import { getState } from "@/data/store"
import { AuthFrame } from "@/components/site/auth-frame"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type CodeState = { ok: true; issuer: string } | { ok: false; reason: string }

function checkCode(code: string): CodeState | null {
  const c = code.trim().toUpperCase()
  if (!c) return null
  const inv = getState().invites.find((i) => i.code === c)
  if (!inv) return { ok: false, reason: "邀请码无效，请核对后重新输入。" }
  if (inv.status === "used") return { ok: false, reason: "这个邀请码已经被使用过了，请联系邀请人重新生成一个。" }
  if (inv.status === "revoked") return { ok: false, reason: "这个邀请码已被邀请人作废，请联系邀请人重新生成一个。" }
  if (inv.status === "expired") return { ok: false, reason: `这个邀请码已于 ${inv.expiresAt} 过期，请联系邀请人重新生成一个。` }
  return { ok: true, issuer: inv.issuer }
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export function RegisterPage() {
  const [params] = useSearchParams()
  const [code, setCode] = useState(params.get("code") ?? "")
  const [checked, setChecked] = useState<CodeState | null>(() => checkCode(params.get("code") ?? ""))
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <AuthFrame title="等待邮箱验证" description="账号注册已成功。请查收邮件并点击链接完成验证；若未收到，请检查垃圾邮件或稍后重试。">
        <Button render={<Link to="/login" />} nativeButton={false}>
          前往登录
        </Button>
      </AuthFrame>
    )
  }

  if (!checked?.ok) {
    return (
      <AuthFrame
        title="使用邀请码注册"
        description="本站只对受邀成员开放。请输入朋友发给你的邀请码。"
        aside={
          <span>
            已经有账号？<Link to="/login" className="link-underline text-foreground">登录</Link>
            <span className="mt-1 block font-mono text-xs">原型：有效码 <span className="whitespace-nowrap">Q-CONT-INUM-01</span>，已用 <span className="whitespace-nowrap">MAKEIT-SO9-3HDR</span>，作废 <span className="whitespace-nowrap">WARP-F8TZ-11NB</span>，过期 <span className="whitespace-nowrap">BORG-X0X0-7777</span></span>
          </span>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setChecked(checkCode(code))
          }}
        >
          <FieldGroup>
            <Field data-invalid={checked && !checked.ok ? true : undefined}>
              <FieldLabel htmlFor="code">邀请码</FieldLabel>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                className="h-11 font-mono tracking-wider uppercase"
                autoComplete="off"
                autoFocus
                aria-invalid={checked && !checked.ok ? true : undefined}
              />
              {checked && !checked.ok && <FieldError>{checked.reason}</FieldError>}
            </Field>
            <Button type="submit" disabled={!code.trim()}>
              验证邀请码
            </Button>
          </FieldGroup>
        </form>
      </AuthFrame>
    )
  }

  const unameErr = username && !USERNAME_RE.test(username) ? "3–20 位小写字母、数字或下划线" : username === "picard_fan" ? "这个用户名已被占用" : null
  const pwErr = pw && pw.length < 10 ? "密码至少 10 位" : null
  const pw2Err = pw2 && pw2 !== pw ? "两次输入的密码不一致" : null
  const valid = username && email && pw && pw2 && !unameErr && !pwErr && !pw2Err

  return (
    <AuthFrame title="创建账号" description="用户名注册后不可修改，其他成员能看到它。注册完成后需要验证邮箱。">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) setDone(true)
        }}
      >
        <FieldGroup>
          <Alert>
            <TicketCheckIcon />
            <AlertTitle>邀请码有效</AlertTitle>
            <AlertDescription>
              来自 <span className="font-mono text-foreground">{checked.issuer}</span> 的邀请 · <span className="font-mono">{code}</span>
            </AlertDescription>
          </Alert>
          <Field data-invalid={!!unameErr || undefined}>
            <FieldLabel htmlFor="r-username">用户名</FieldLabel>
            <Input id="r-username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="username" className="font-mono" aria-invalid={!!unameErr || undefined} />
            {unameErr ? <FieldError>{unameErr}</FieldError> : <FieldDescription>3–20 位小写字母、数字或下划线</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="r-email">注册邮箱</FieldLabel>
            <Input id="r-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} autoComplete="email" />
          </Field>
          <Field data-invalid={!!pwErr || undefined}>
            <FieldLabel htmlFor="r-pw">密码</FieldLabel>
            <Input id="r-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-invalid={!!pwErr || undefined} />
            {pwErr ? <FieldError>{pwErr}</FieldError> : <FieldDescription>至少 10 位，建议使用密码管理器生成</FieldDescription>}
          </Field>
          <Field data-invalid={!!pw2Err || undefined}>
            <FieldLabel htmlFor="r-pw2">确认密码</FieldLabel>
            <Input id="r-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" aria-invalid={!!pw2Err || undefined} />
            {pw2Err && <FieldError>{pw2Err}</FieldError>}
          </Field>
          <Button type="submit" disabled={!valid}>
            创建账号
          </Button>
          <Button type="button" variant="ghost" onClick={() => setChecked(null)}>
            换一个邀请码
          </Button>
        </FieldGroup>
      </form>
    </AuthFrame>
  )
}
