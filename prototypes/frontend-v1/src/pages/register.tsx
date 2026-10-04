import { useState } from "react"
import { CircleAlertIcon, TicketCheckIcon } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { actions, getState } from "@/data/store"
import { AuthFrame } from "@/components/site/auth-frame"
import { RecoveryCodes } from "@/components/site/recovery-codes"
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
  const navigate = useNavigate()
  const [code, setCode] = useState(params.get("code") ?? "")
  const [checked, setChecked] = useState<CodeState | null>(() => checkCode(params.get("code") ?? ""))
  const [username, setUsername] = useState("")
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const [done, setDone] = useState(false)
  const [saved, setSaved] = useState(false)

  if (done) {
    return (
      <AuthFrame title="保存你的恢复码" description="本站不收集邮箱。忘记密码时，只能用这些恢复码自己找回账号。每个码只能用一次，只显示这一次。">
        <div className="flex flex-col gap-5">
          <RecoveryCodes />
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>请存放在密码管理器或离线位置</AlertTitle>
            <AlertDescription>恢复码也丢了的话，只能请管理员生成一次性重置链接。</AlertDescription>
          </Alert>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-foreground" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            我已妥善保存这些恢复码
          </label>
          <Button
            disabled={!saved}
            onClick={() => {
              actions.registerAs(username)
              navigate("/")
            }}
          >
            进入档案馆
          </Button>
        </div>
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
  const valid = username && pw && pw2 && !unameErr && !pwErr && !pw2Err

  return (
    <AuthFrame title="创建账号" description="不需要邮箱。用户名注册后不可修改，其他成员能看到它。">
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
