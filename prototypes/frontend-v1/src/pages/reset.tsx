import { useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"

import { AuthFrame } from "@/components/site/auth-frame"
import { RecoveryCodes } from "@/components/site/recovery-codes"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { NewPasswordForm } from "./recover"

export function ResetPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [step, setStep] = useState<"password" | "codes">("password")

  if (token === "expired") {
    return (
      <AuthFrame title="重置链接已失效" description="链接已过期或已经使用过。重置链接只能用一次，默认 24 小时内有效。">
        <Button render={<Link to="/login" />} nativeButton={false} variant="outline">
          返回登录
        </Button>
      </AuthFrame>
    )
  }

  if (step === "codes") {
    return (
      <AuthFrame title="新的恢复码" description="旧的恢复码已全部作废。请保存这组新的恢复码。">
        <div className="flex flex-col gap-4">
          <RecoveryCodes />
          <Button onClick={() => navigate("/login")}>
            我已保存，去登录
          </Button>
        </div>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title="重置账号" description={<>管理员为 <span className="font-mono text-foreground">tribble_42</span> 生成了一次性重置链接，24 小时内有效。</>}>
      <div className="flex flex-col gap-5">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>重置后会发生什么</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              <li>所有设备上的登录会话立即失效</li>
              <li>通行密钥和二步验证会被清除，需要重新绑定</li>
              <li>生成一组新的恢复码</li>
            </ul>
          </AlertDescription>
        </Alert>
        <NewPasswordForm cta="重置账号并设置新密码" onDone={() => setStep("codes")} />
      </div>
    </AuthFrame>
  )
}
