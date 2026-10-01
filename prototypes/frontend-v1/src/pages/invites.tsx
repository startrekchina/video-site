import { PlusIcon, TicketIcon } from "lucide-react"

import { actions, inviteQuotaLeft, useStore, type InviteCode } from "@/data/store"
import { cn, fakeLatency } from "@/lib/utils"
import { CopyButton } from "@/components/ui/copy-button"
import { StatusButton } from "@/components/ui/status-button"
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"

const STATUS: Record<InviteCode["status"], { label: string; className: string }> = {
  unused: { label: "未使用", className: "text-foreground" },
  used: { label: "已使用", className: "text-success" },
  revoked: { label: "已作废", className: "text-muted-foreground line-through decoration-muted-foreground/50" },
  expired: { label: "已过期", className: "text-muted-foreground" },
}

export function StatusDot({ status }: { status: InviteCode["status"] }) {
  const s = STATUS[status]
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <span className={cn("size-1.5 rounded-full", status === "unused" ? "bg-info" : status === "used" ? "bg-success" : "bg-muted-foreground/40")} />
      {s.label}
    </span>
  )
}

export function InvitesPage() {
  const me = useStore((s) => s.me)!
  const invites = useStore((s) => s.invites.filter((i) => i.issuer === me.username))
  const left = useStore(inviteQuotaLeft)
  const unlimited = left === Infinity
  const link = (code: string) => `https://video.startrekchina.org/register?code=${code}`

  return (
    <Page>
      <PageHeading>
        <PageHeadingTagline>邀请</PageHeadingTagline>
        <PageHeadingTitle>把档案馆分享给信得过的朋友。</PageHeadingTitle>
        <PageHeadingDescription>邀请码只能用一次，默认 14 天内有效。你邀请的人出问题时，你也可能被连带处理。</PageHeadingDescription>
      </PageHeading>
      <div className="h-4" />
      <div className="screen-line-top screen-line-bottom grid grid-cols-2">
        <div className="flex flex-col gap-1 px-4 py-3">
          <div className="text-sm text-muted-foreground">剩余额度</div>
          <div className="font-mono text-3xl font-medium tabular-nums">{unlimited ? "∞" : left}</div>
        </div>
        <div className="flex flex-col gap-1 border-l border-line px-4 py-3">
          <div className="text-sm text-muted-foreground">已邀请</div>
          <div className="font-mono text-3xl font-medium tabular-nums">{invites.filter((i) => i.status === "used").length}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 py-4">
        <StatusButton
          className="gap-2 pr-2.5 pl-3 shadow-[inset_0_0_1px] shadow-foreground/20"
          variant="secondary"
          size="sm"
          disabled={left <= 0}
          successLabel="已生成"
          onClick={async () => {
            await fakeLatency()
            const code = actions.createInvite()
            void navigator.clipboard?.writeText(link(code))
            toast.add({ title: "邀请码已生成", description: `${code} · 注册链接已复制`, type: "success" })
          }}
        >
          <PlusIcon />
          生成邀请码
        </StatusButton>
        {left <= 0 && <span className="text-sm text-muted-foreground">额度已用完，可以联系管理员调整。</span>}
      </div>
      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>
            我发出的邀请码<PanelTitleSup>({invites.length})</PanelTitleSup>
          </PanelTitle>
        </PanelHeader>
        {invites.length === 0 ? (
          <Empty className="rounded-none py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TicketIcon />
              </EmptyMedia>
              <EmptyTitle>还没有发出邀请码</EmptyTitle>
              <EmptyDescription>生成后把注册链接通过私信发给朋友即可。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {invites.map((i) => (
              <li key={i.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 pr-2 transition-[background-color] ease-out hover:bg-accent-muted">
                <span className={cn("font-mono text-sm tracking-wide", STATUS[i.status].className)}>{i.code}</span>
                <StatusDot status={i.status} />
                <span className="text-xs text-muted-foreground max-sm:basis-full">
                  {i.status === "used" ? (
                    <>
                      被 <span className="font-mono text-foreground">{i.usedBy}</span> 使用
                    </>
                  ) : i.status === "unused" ? (
                    `${i.expiresAt} 过期`
                  ) : (
                    `创建于 ${i.createdAt}`
                  )}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {i.status === "unused" && (
                    <>
                      <CopyButton variant="ghost" size="icon-sm" text={link(i.code)} aria-label="复制注册链接" />
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => actions.revokeInvite(i.code)}>
                        作废
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Page>
  )
}
