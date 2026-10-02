import { useState } from "react"
import { FingerprintIcon, KeyRoundIcon, LaptopIcon, ShieldCheckIcon, SmartphoneIcon, Trash2Icon } from "lucide-react"

import { actions, useStore } from "@/data/store"
import { fakeLatency } from "@/lib/utils"
import { useActiveSection } from "@/lib/use-active-section"
import { LineNav } from "@/components/ui/line-nav"
import { StatusButton, type ButtonStatus } from "@/components/ui/status-button"
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { RecoveryCodes } from "@/components/site/recovery-codes"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { IconTile } from "@/components/ui/icon-tile"
import { Input } from "@/components/ui/input"
import { Tag } from "@/components/ui/tag"
import { toast } from "@/components/ui/toast"

function Row({ icon, title, meta, action }: { icon: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-4 p-4 pr-2 transition-[background-color] ease-out hover:bg-accent-muted">
      <IconTile>{icon}</IconTile>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="leading-snug font-medium">{title}</div>
          {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
        </div>
        {action}
      </div>
    </li>
  )
}

function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [status, setStatus] = useState<ButtonStatus>("idle")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>修改后，其他设备上的会话会退出。</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (status !== "idle") return
            setStatus("loading")
            await fakeLatency()
            setStatus("success")
            await fakeLatency(600)
            onOpenChange(false)
            setStatus("idle")
            toast.add({ title: "密码已修改", type: "success" })
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cur">当前密码</FieldLabel>
              <Input id="cur" type="password" autoComplete="current-password" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="new">新密码</FieldLabel>
              <Input id="new" type="password" autoComplete="new-password" minLength={10} required />
              <FieldDescription>至少 10 位</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <StatusButton type="submit" status={status} successLabel="已保存">
              保存
            </StatusButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TotpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"scan" | "codes">("scan")
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setStep("scan")
          setCode("")
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {step === "scan" ? (
          <>
            <DialogHeader>
              <DialogTitle>开启二步验证</DialogTitle>
              <DialogDescription>用验证器应用（1Password、Google Authenticator 等）扫描二维码，然后输入 6 位动态码。</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-4">
              <div className="dot-grid grid size-32 shrink-0 grid-cols-8 grid-rows-8 gap-px rounded-lg border bg-white p-2" aria-label="二维码占位">
                {Array.from({ length: 64 }, (_, i) => (
                  <span key={i} className={(i * 7919) % 3 === 0 || [0, 1, 8, 9, 6, 7, 14, 15, 48, 49, 56, 57].includes(i) ? "bg-zinc-900" : ""} />
                ))}
              </div>
              <div className="min-w-0 text-sm">
                <div className="text-muted-foreground">无法扫描？手动输入密钥：</div>
                <div className="mt-1 font-mono text-xs break-all">JBSW Y3DP EHPK 3PXP（示例）</div>
              </div>
            </div>
            <Field>
              <FieldLabel htmlFor="totp-new">动态码</FieldLabel>
              <Input id="totp-new" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="font-mono tracking-[0.4em]" />
              <FieldDescription>原型：任意 6 位数字</FieldDescription>
            </Field>
            <DialogFooter>
              <Button
                disabled={code.length !== 6}
                onClick={() => {
                  actions.setTotp(true)
                  actions.regenerateRecoveryCodes()
                  setStep("codes")
                }}
              >
                验证并开启
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>二步验证已开启</DialogTitle>
              <DialogDescription>这是新的恢复码，旧恢复码已作废。验证器丢失时，用它们登录或重设密码。</DialogDescription>
            </DialogHeader>
            <RecoveryCodes />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>我已保存</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const SECTIONS = [
  { title: "登录方式", href: "#methods" },
  { title: "通行密钥", href: "#passkeys" },
  { title: "登录会话", href: "#sessions" },
]

export function AccountPage() {
  const me = useStore((s) => s.me)!
  const sessions = useStore((s) => s.sessions)
  const passkeys = useStore((s) => s.passkeys)
  const totp = useStore((s) => s.totpEnabled)
  const codesLeft = useStore((s) => s.recoveryCodesLeft)
  const [pwOpen, setPwOpen] = useState(false)
  const [totpOpen, setTotpOpen] = useState(false)
  const [codesOpen, setCodesOpen] = useState(false)
  const [seed, setSeed] = useState(0)
  const active = useActiveSection(SECTIONS.map((s) => s.href.slice(1)))

  return (
    <Page narrow className="relative">
      <aside className="absolute inset-y-0 left-full hidden pl-8 xl:block" aria-label="本页导航">
        <div className="sticky top-24">
          <LineNav
            items={SECTIONS}
            activeHref={`#${active}`}
            scrollActiveIntoView={false}
            onItemClick={(item, e) => {
              e.preventDefault()
              document.getElementById(item.href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}
          />
        </div>
      </aside>
      <PageHeading>
        <PageHeadingTagline>账号与安全</PageHeadingTagline>
        <PageHeadingTitle>管理登录方式、二步验证和登录会话。</PageHeadingTitle>
        <PageHeadingDescription className="font-mono text-sm">
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div>
            <dt className="inline">用户名 </dt>
            <dd className="inline text-foreground">{me.username}</dd>
          </div>
          <div>
            <dt className="inline">身份 </dt>
            <dd className="inline text-foreground">{me.role === "admin" ? "管理员" : "成员"}</dd>
          </div>
          <div>
            <dt className="inline">加入于 </dt>
            <dd className="inline text-foreground">{me.joinedAt}</dd>
          </div>
        </dl>
        </PageHeadingDescription>
      </PageHeading>
      <div className="h-4" />

      <Panel id="methods" className="scroll-mt-16">
        <PanelHeader>
          <PanelTitle>登录方式</PanelTitle>
        </PanelHeader>
        <ul className="divide-y divide-line">
          <Row
            icon={<KeyRoundIcon />}
            title="密码"
            meta="上次修改于 2026-06-03"
            action={
              <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
                修改
              </Button>
            }
          />
          <Row
            icon={<ShieldCheckIcon />}
            title={
              <span className="flex items-center gap-2">
                二步验证（TOTP）
                {totp ? <Tag className="text-success">已开启</Tag> : <Tag>未开启</Tag>}
              </span>
            }
            meta={totp ? "登录时需要输入验证器中的动态码" : "即使密码泄露，账号也不会被盗"}
            action={
              totp ? (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => actions.setTotp(false)}>
                  解绑
                </Button>
              ) : (
                <Button size="sm" onClick={() => setTotpOpen(true)}>
                  开启
                </Button>
              )
            }
          />
          <Row
            icon={<FingerprintIcon />}
            title="恢复码"
            meta={`还剩 ${codesLeft} / 10 个可用`}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  actions.regenerateRecoveryCodes()
                  setSeed((s) => s + 1)
                  setCodesOpen(true)
                }}
              >
                重新生成
              </Button>
            }
          />
        </ul>
      </Panel>
      <Separator />

      <Panel id="passkeys" className="scroll-mt-16">
        <PanelHeader>
          <PanelTitle>
            通行密钥<PanelTitleSup>({passkeys.length})</PanelTitleSup>
          </PanelTitle>
          <StatusButton
            size="sm"
            className="mb-1.5"
            successLabel="已添加"
            onClick={async () => {
              await fakeLatency(900)
              actions.addPasskey(navigator.platform.includes("Win") ? "Windows Hello" : "此设备")
              toast.add({ title: "通行密钥已添加", type: "success" })
            }}
          >
            添加
          </StatusButton>
        </PanelHeader>
        {passkeys.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">绑定通行密钥后，可以用指纹、面容或设备 PIN 免密码登录。</p>
        ) : (
          <ul className="divide-y divide-line">
            {passkeys.map((k) => (
              <Row
                key={k.id}
                icon={<FingerprintIcon />}
                title={k.name}
                meta={`添加于 ${k.createdAt}`}
                action={
                  <Button variant="ghost" size="icon-sm" aria-label={`删除 ${k.name}`} onClick={() => actions.removePasskey(k.id)}>
                    <Trash2Icon />
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </Panel>
      <Separator />

      <Panel id="sessions" className="scroll-mt-16">
        <PanelHeader>
          <PanelTitle>
            登录会话<PanelTitleSup>({sessions.length})</PanelTitleSup>
          </PanelTitle>
          {sessions.length > 1 && (
            <Button variant="outline" size="sm" className="mb-1.5" onClick={() => actions.revokeOtherSessions()}>
              退出其他会话
            </Button>
          )}
        </PanelHeader>
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <Row
              key={s.id}
              icon={s.device.includes("iPhone") ? <SmartphoneIcon /> : <LaptopIcon />}
              title={
                <span className="flex items-center gap-2">
                  {s.device}
                  {s.current && <Tag>当前</Tag>}
                </span>
              }
              meta={`${s.location} · ${s.lastActive}`}
              action={
                !s.current && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => actions.revokeSession(s.id)}>
                    退出
                  </Button>
                )
              }
            />
          ))}
        </ul>
      </Panel>

      <PasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      <TotpDialog open={totpOpen} onOpenChange={setTotpOpen} />
      <Dialog open={codesOpen} onOpenChange={setCodesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新的恢复码</DialogTitle>
            <DialogDescription>旧的恢复码已全部作废。这些码只显示这一次。</DialogDescription>
          </DialogHeader>
          <RecoveryCodes seed={seed} />
          <DialogFooter>
            <Button onClick={() => setCodesOpen(false)}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
