import { useState } from "react"
import { Link, useNavigate } from "react-router"

import { AuthFrame } from "@/components/site/auth-frame"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"

export function NewPasswordForm({ onDone, cta = "设置新密码" }: { onDone: () => void; cta?: string }) {
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const pwErr = pw && pw.length < 10 ? "密码至少 10 位" : null
  const pw2Err = pw2 && pw2 !== pw ? "两次输入的密码不一致" : null
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (pw && pw2 && !pwErr && !pw2Err) onDone()
      }}
    >
      <FieldGroup>
        <Field data-invalid={!!pwErr || undefined}>
          <FieldLabel htmlFor="n-pw">新密码</FieldLabel>
          <Input id="n-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!pwErr || undefined} autoFocus />
          {pwErr && <FieldError>{pwErr}</FieldError>}
        </Field>
        <Field data-invalid={!!pw2Err || undefined}>
          <FieldLabel htmlFor="n-pw2">确认新密码</FieldLabel>
          <Input id="n-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={!!pw2Err || undefined} />
          {pw2Err && <FieldError>{pw2Err}</FieldError>}
        </Field>
        <Button type="submit" disabled={!pw || !pw2 || !!pwErr || !!pw2Err}>
          {cta}
        </Button>
      </FieldGroup>
    </form>
  )
}

export function RecoverPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)

  if (verified) {
    return (
      <AuthFrame title="设置新密码" description="恢复码已使用并作废。设置新密码后，其他设备上的登录会话会全部退出。">
        <NewPasswordForm
          onDone={() => {
            toast.add({ title: "密码已重设", description: "请用新密码登录", type: "success" })
            navigate("/login")
          }}
        />
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      title="用恢复码找回账号"
      description="输入用户名和注册时保存的任意一个恢复码。"
      aside={
        <span>
          恢复码也丢了？请通过站外渠道联系管理员，为你生成一次性重置链接。<Link to="/login" className="link-underline ml-1 text-foreground">返回登录</Link>
        </span>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (/^[a-z0-9]{5}-[a-z0-9]{4}$/i.test(code.trim())) setVerified(true)
          else setError("恢复码无效或已被使用")
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="rc-user">用户名</FieldLabel>
            <Input id="rc-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required className="font-mono" />
          </Field>
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="rc-code">恢复码</FieldLabel>
            <Input id="rc-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="xxxxx-xxxx" className="font-mono tracking-wider" autoComplete="off" aria-invalid={!!error || undefined} required />
            {error ? <FieldError>{error}</FieldError> : <FieldDescription>原型：任意 xxxxx-xxxx 格式都可以通过</FieldDescription>}
          </Field>
          <Button type="submit">
            验证恢复码
          </Button>
        </FieldGroup>
      </form>
    </AuthFrame>
  )
}
