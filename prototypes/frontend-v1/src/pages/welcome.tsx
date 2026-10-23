import { useState } from "react"
import { ArrowRightIcon, FingerprintIcon, ShieldCheckIcon } from "lucide-react"
import { Link } from "react-router"

import { actions, useStore } from "@/data/store"
import { fakeLatency } from "@/lib/utils"
import { Poster } from "@/components/site/media"
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { StatusButton } from "@/components/ui/status-button"
import { Tag } from "@/components/ui/tag"
import { toast } from "@/components/ui/toast"
import { MemberRules } from "@/pages/about"
import { Row, TotpDialog } from "@/pages/account"
import { startWorks } from "@/pages/home-hero/data"

// One-time page right after registration. Every step can be skipped; account settings stay on /account.

const DONE = <Tag className="text-success">已完成</Tag>

export function WelcomePage() {
  const me = useStore((s) => s.me)!
  const passkeys = useStore((s) => s.passkeys)
  const totp = useStore((s) => s.totpEnabled)
  const [totpOpen, setTotpOpen] = useState(false)

  return (
    <Page narrow>
      <PageHeading>
        <PageHeadingTagline>欢迎登舰</PageHeadingTagline>
        <PageHeadingTitle>{me.username}，欢迎加入档案馆.</PageHeadingTitle>
        <PageHeadingDescription>先花两分钟保护好账号，再挑一部开始看。下面的设置都可以跳过，之后在「账号与安全」里随时调整。</PageHeadingDescription>
      </PageHeading>
      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>保护账号</PanelTitle>
        </PanelHeader>
        <ul className="divide-y divide-line">
          <Row
            icon={<FingerprintIcon />}
            title="添加通行密钥"
            meta="用指纹、面容或设备 PIN 免密码登录"
            action={
              passkeys.length > 0 ? (
                DONE
              ) : (
                <StatusButton
                  size="sm"
                  successLabel="已添加"
                  onClick={async () => {
                    await fakeLatency(900)
                    actions.addPasskey(navigator.platform.includes("Win") ? "Windows Hello" : "此设备")
                    toast.add({ title: "通行密钥已添加", type: "success" })
                  }}
                >
                  添加
                </StatusButton>
              )
            }
          />
          <Row
            icon={<ShieldCheckIcon />}
            title="开启二步验证"
            meta="密码登录时还需输入验证器里的动态验证码"
            action={
              totp ? (
                DONE
              ) : (
                <Button size="sm" onClick={() => setTotpOpen(true)}>
                  开启
                </Button>
              )
            }
          />
        </ul>
      </Panel>
      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>成员守则</PanelTitle>
        </PanelHeader>
        <MemberRules />
      </Panel>
      <Separator />

      <Panel>
        <PanelHeader>
          <PanelTitle>从这里开始</PanelTitle>
        </PanelHeader>
        <ul className="grid gap-px bg-line sm:grid-cols-3">
          {startWorks().map(({ work, why }) => (
            <li key={work.slug} className="bg-background">
              <Link to={`/title/${work.slug}`} className="flex h-full gap-3 p-4 transition-[background-color] ease-out hover:bg-accent-muted sm:flex-col">
                <Poster src={work.poster} alt="" className="w-14 shrink-0 sm:w-20" />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">
                    {work.code} · {work.year}
                  </span>
                  <span className="leading-snug font-medium">{work.titleZh}</span>
                  <span className="text-sm text-pretty text-muted-foreground">{why}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="screen-line-top flex justify-center py-4">
          <Button className="gap-2" nativeButton={false} render={<Link to="/" />}>
            进入档案馆
            <ArrowRightIcon />
          </Button>
        </div>
      </Panel>

      <TotpDialog open={totpOpen} onOpenChange={setTotpOpen} />
    </Page>
  )
}
