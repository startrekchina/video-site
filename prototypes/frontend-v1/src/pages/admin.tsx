import { useMemo, useState } from "react"
import { BanIcon, LinkIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, ShieldIcon, ShieldOffIcon, UndoIcon } from "lucide-react"

import { actions, useStore, type Member } from "@/data/store"
import { cn, fakeLatency } from "@/lib/utils"
import { CopyButton } from "@/components/ui/copy-button"
import { MiddleTruncation } from "@/components/ui/middle-truncation"
import { StatusButton } from "@/components/ui/status-button"
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel"
import { StatusDot } from "@/pages/invites"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tag } from "@/components/ui/tag"
import { toast } from "@/components/ui/toast"

function descendants(members: Member[], id: string) {
  const out: Member[] = []
  const walk = (pid: string) => {
    for (const m of members) if (m.invitedBy === pid) out.push(m), walk(m.id)
  }
  walk(id)
  return out
}

function BanDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const members = useStore((s) => s.members)
  const chain = useMemo(() => descendants(members, member.id), [members, member.id])
  const [cascade, setCascade] = useState(false)
  const activeChain = chain.filter((m) => m.status === "active")
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            封禁 <span className="font-mono">{member.username}</span>
          </DialogTitle>
          <DialogDescription>封禁后立即无法登录，所有会话失效；正在播放的视频最多 30 分钟后停止。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", !cascade && "border-foreground/40 bg-accent-muted")}>
            <input type="radio" name="scope" className="mt-1 accent-foreground" checked={!cascade} onChange={() => setCascade(false)} />
            <span>
              <span className="font-medium">只封禁本人</span>
              <span className="block text-muted-foreground">他邀请的人不受影响</span>
            </span>
          </label>
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", cascade && "border-destructive/50 bg-destructive/5", chain.length === 0 && "opacity-50")}>
            <input type="radio" name="scope" className="mt-1 accent-destructive" checked={cascade} disabled={chain.length === 0} onChange={() => setCascade(true)} />
            <span className="min-w-0">
              <span className="font-medium">沿邀请链连带封禁</span>
              <span className="block text-muted-foreground">{chain.length === 0 ? "他没有邀请过任何人" : `另外 ${activeChain.length} 人会被封禁：`}</span>
              {chain.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {chain.map((m) => (
                    <Tag key={m.id} className={cn(m.status === "banned" && "line-through")}>
                      {m.username}
                    </Tag>
                  ))}
                </span>
              )}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            className="bg-destructive text-white hover:bg-destructive/85"
            onClick={() => {
              actions.ban(member.id, cascade)
              toast.add({ title: cascade ? `已封禁 ${1 + activeChain.length} 人` : `已封禁 ${member.username}`, type: "success" })
              onClose()
            }}
          >
            确认封禁{cascade ? `（${1 + activeChain.length} 人）` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetLinkDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const url = useMemo(() => `https://video.startrekchina.org/reset/${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`, [])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            为 <span className="font-mono">{member.username}</span> 生成的重置链接
          </DialogTitle>
          <DialogDescription>一次性有效，24 小时后过期。请通过站外渠道（私信）发给本人，不要公开发布。</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center gap-1 rounded-lg border bg-zinc-50 p-1 pl-3 dark:bg-zinc-900">
          <MiddleTruncation className="min-w-0 flex-1 font-mono text-xs" end={8}>{url}</MiddleTruncation>
          <CopyButton variant="ghost" size="icon-sm" text={url} aria-label="复制链接" />
        </div>
        <Alert>
          <AlertTitle>对方使用后</AlertTitle>
          <AlertDescription>所有会话失效，通行密钥和二步验证被清除，需要重新绑定。</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QuotaDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const [q, setQ] = useState(String(member.inviteQuota))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>调整邀请额度</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{member.username}</span> 当前额度 {member.inviteQuota}，默认值为 2。
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="quota">邀请额度</FieldLabel>
          <Input id="quota" type="number" min={0} max={50} value={q} onChange={(e) => setQ(e.target.value)} className="w-32 font-mono" />
          <FieldDescription>已发出的邀请码不受影响</FieldDescription>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              actions.setQuota(member.id, Math.max(0, Number(q) || 0))
              onClose()
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type DialogState = { kind: "ban" | "reset" | "quota"; member: Member } | null

function MembersTab() {
  const me = useStore((s) => s.me)!
  const members = useStore((s) => s.members)
  const [q, setQ] = useState("")
  const [dialog, setDialog] = useState<DialogState>(null)
  const byId = (id: string | null) => members.find((m) => m.id === id)
  const list = members.filter((m) => m.username.includes(q.trim().toLowerCase()))

  return (
    <>
      <div className="screen-line-bottom flex items-center gap-3 px-4 py-3">
        <InputGroup className="max-w-xs min-w-0 flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索用户名" aria-label="搜索成员" />
        </InputGroup>
        <span className="ml-auto shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
          {members.filter((m) => m.status === "active").length} 活跃 · {members.filter((m) => m.status === "banned").length} 封禁
        </span>
      </div>
      <div className="no-scrollbar scroll-fade-x overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">成员</th>
              <th className="px-2 py-2 font-medium">邀请人</th>
              <th className="px-2 py-2 font-medium">邀请了</th>
              <th className="px-2 py-2 font-medium">额度</th>
              <th className="px-2 py-2 font-medium">最近活动</th>
              <th className="w-12 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((m) => {
              const invited = members.filter((x) => x.invitedBy === m.id)
              const self = m.id === me.id
              return (
                <tr key={m.id} className={cn("hover:bg-accent-muted", m.status === "banned" && "text-muted-foreground")}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-mono", m.status === "banned" && "line-through")}>{m.username}</span>
                      {m.role === "admin" && <Tag className="shrink-0 gap-1 whitespace-nowrap"><ShieldIcon />管理员</Tag>}
                      {m.status === "banned" && <Tag className="shrink-0 whitespace-nowrap text-destructive">已封禁</Tag>}
                      {self && <Tag className="shrink-0">你</Tag>}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">加入于 {m.joinedAt}</div>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs">{byId(m.invitedBy)?.username ?? "—"}</td>
                  <td className="px-2 py-2.5 font-mono text-xs">{invited.length ? invited.map((x) => x.username).join(", ") : "—"}</td>
                  <td className="px-2 py-2.5 font-mono text-xs">{m.inviteQuota === Infinity ? "∞" : m.inviteQuota}</td>
                  <td className="px-2 py-2.5 text-xs">{m.lastSeen}</td>
                  <td className="px-2 py-2.5">
                    {!self && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`管理 ${m.username}`} />}>
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setDialog({ kind: "reset", member: m })}>
                            <LinkIcon />
                            生成重置链接
                          </DropdownMenuItem>
                          {m.role === "member" && (
                            <DropdownMenuItem onClick={() => setDialog({ kind: "quota", member: m })}>
                              <PlusIcon />
                              调整邀请额度
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => actions.setRole(m.id, m.role === "admin" ? "member" : "admin")}>
                            {m.role === "admin" ? <ShieldOffIcon /> : <ShieldIcon />}
                            {m.role === "admin" ? "取消管理员" : "设为管理员"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {m.status === "active" ? (
                            <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "ban", member: m })}>
                              <BanIcon />
                              封禁…
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => actions.unban(m.id)}>
                              <UndoIcon />
                              解除封禁
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {dialog?.kind === "ban" && <BanDialog member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === "reset" && <ResetLinkDialog member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === "quota" && <QuotaDialog member={dialog.member} onClose={() => setDialog(null)} />}
    </>
  )
}

function InvitesTab() {
  const invites = useStore((s) => s.invites)
  return (
    <>
      <div className="screen-line-bottom flex items-center gap-3 px-4 py-3">
        <StatusButton
          size="sm"
          successLabel="已生成"
          onClick={async () => {
            await fakeLatency()
            const code = actions.createInvite()
            toast.add({ title: "邀请码已生成", description: code, type: "success" })
          }}
        >
          <PlusIcon data-icon="inline-start" />
          生成邀请码
        </StatusButton>
        <span className="text-xs text-muted-foreground">管理员生成不受额度限制</span>
      </div>
      <ul className="divide-y divide-line">
        {invites.map((i) => (
          <li key={i.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
            <span className="font-mono tracking-wide">{i.code}</span>
            <StatusDot status={i.status} />
            <span className="text-xs text-muted-foreground">
              发出人 <span className="font-mono text-foreground">{i.issuer}</span>
              {i.usedBy && (
                <>
                  {" "}
                  · 使用人 <span className="font-mono text-foreground">{i.usedBy}</span>
                </>
              )}
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{i.createdAt}</span>
            {i.status === "unused" && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => actions.revokeInvite(i.code)}>
                作废
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

function TreeNode({ m, members, depth }: { m: Member; members: Member[]; depth: number }) {
  const kids = members.filter((x) => x.invitedBy === m.id)
  return (
    <li>
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 20 }}>
        {depth > 0 && <span className="font-mono text-muted-foreground/60">└─</span>}
        <span className={cn("font-mono text-sm", m.status === "banned" && "text-muted-foreground line-through")}>{m.username}</span>
        {m.role === "admin" && <ShieldIcon className="size-3.5 text-muted-foreground" aria-label="管理员" />}
        {kids.length > 0 && <span className="font-mono text-[11px] text-muted-foreground">+{kids.length}</span>}
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.id} m={k} members={members} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function TreeTab() {
  const members = useStore((s) => s.members)
  return (
    <ul className="dot-grid px-4 py-4">
      {members
        .filter((m) => !m.invitedBy)
        .map((m) => (
          <TreeNode key={m.id} m={m} members={members} depth={0} />
        ))}
    </ul>
  )
}

export function AdminPage() {
  const members = useStore((s) => s.members)
  const invites = useStore((s) => s.invites)
  return (
    <Page>
      <PageHeading>
        <PageHeadingTagline>管理后台</PageHeadingTagline>
        <PageHeadingTitle>成员、邀请码和邀请链。</PageHeadingTitle>
        <PageHeadingDescription>内容由站长用离线工具导入，这里不提供上传。</PageHeadingDescription>
      </PageHeading>
      <div className="h-4" />
      <div className="screen-line-top screen-line-bottom grid grid-cols-3">
        {[
          ["成员", members.filter((m) => m.status === "active").length],
          ["已封禁", members.filter((m) => m.status === "banned").length],
          ["未使用邀请码", invites.filter((i) => i.status === "unused").length],
        ].map(([k, v], i) => (
          <div key={k} className={cn("flex flex-col gap-1 px-4 py-3", i > 0 && "border-l border-line")}>
            <span className="text-sm text-muted-foreground">{k}</span>
            <span className="font-mono text-2xl font-medium tabular-nums">{v}</span>
          </div>
        ))}
      </div>
      <Separator />
      <Panel>
        <Tabs defaultValue="members" className="gap-0">
          <PanelHeader className="flex-wrap py-3">
            <PanelTitle>
              <span className="whitespace-nowrap">成员与邀请</span><PanelTitleSup>({members.length})</PanelTitleSup>
            </PanelTitle>
            <TabsList>
              <TabsTrigger value="members">成员</TabsTrigger>
              <TabsTrigger value="invites">邀请码</TabsTrigger>
              <TabsTrigger value="tree">邀请链</TabsTrigger>
              <TabsIndicator />
            </TabsList>
          </PanelHeader>
          <TabsContent value="members">
            <MembersTab />
          </TabsContent>
          <TabsContent value="invites">
            <InvitesTab />
          </TabsContent>
          <TabsContent value="tree">
            <TreeTab />
          </TabsContent>
        </Tabs>
      </Panel>
    </Page>
  )
}
