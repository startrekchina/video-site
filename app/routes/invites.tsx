import { useState } from "react";
import { data, useRevalidator } from "react-router";
import { PlusIcon, TicketIcon } from "lucide-react";
import type { Route } from "./+types/invites";
import { pageMember } from "@/lib/member.server";
import { invitationsHttp } from "@/lib/invitations.server";
import { csrfData } from "@/lib/security.server";
import { call } from "@/lib/auth-client";
import { Page, PageHeading, PageHeadingTitle, PageHeadingDescription, PageHeadingTagline, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { InviteList, type Invitation } from "@/components/site/invite-list";
import { Field, useAction } from "@/components/site/account-form";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

type InviteData = { invitations: Invitation[]; total: number; occupied: number; unlimited: boolean };
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const current = await pageMember(request, env);
  const csrf = await csrfData(request, env);
  for (const cookie of csrf.headers.getSetCookie()) current.headers.append("Set-Cookie", cookie);
  const response = await invitationsHttp(new Request(new URL("/invites/data", request.url), { headers: request.headers }), env);
  const result = await response.json() as { data: InviteData };
  return data({ ...result.data, csrfToken: csrf.csrfToken, now: Date.now() }, { headers: current.headers });
}
export const meta = () => [{ title: "邀请 · 星际迷航中国" }];
export default function InvitesPage({ loaderData: invites }: Route.ComponentProps) {
  const action = useAction(); const revalidator = useRevalidator();
  const [operation, setOperation] = useState<{ id: string; expiresAt?: number } | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ code: string; expiresAt: number } | null>(null);
  const [expiryOpen, setExpiryOpen] = useState(false);
  const left = invites.unlimited ? Infinity : Math.max(0, invites.total - invites.occupied);
  function create(expiresAt?: number) {
    void action.run(async () => {
      const pending = operation ?? { id: crypto.randomUUID(), expiresAt };
      setOperation(pending);
      const result = await call<{ id: string; code: string; expiresAt: number }>("/invites/create", { csrfToken: invites.csrfToken, operationId: pending.id, ...(pending.expiresAt ? { expiresAt: pending.expiresAt } : {}) });
      setCodes(values => ({ ...values, [result.id]: result.code })); setCreated(result); setOperation(null); setExpiryOpen(false); revalidator.revalidate();
    });
  }
  return <Page narrow>
    <PageHeading><PageHeadingTagline>邀请</PageHeadingTagline><PageHeadingTitle>把档案馆分享给信得过的朋友。</PageHeadingTitle>
      <PageHeadingDescription>邀请码只能用一次，默认 30 天内有效。你邀请的人出问题时，你也可能被连带处理。</PageHeadingDescription></PageHeading><div className="h-4" />
    <div className="screen-line-top screen-line-bottom grid grid-cols-2">
      <div className="flex flex-col gap-1 px-4 py-3"><div className="text-sm text-muted-foreground">剩余额度</div><div className="font-mono text-3xl font-medium tabular-nums">{invites.unlimited ? "∞" : left}</div></div>
      <div className="flex flex-col gap-1 border-l border-line px-4 py-3"><div className="text-sm text-muted-foreground">已邀请</div><div className="font-mono text-3xl font-medium tabular-nums">{invites.invitations.filter(invite => invite.used_at).length}</div></div>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-3 py-4">
      <StatusButton className="gap-2 pr-2.5 pl-3 shadow-[inset_0_0_1px] shadow-foreground/20" variant="secondary" size="sm" disabled={left <= 0} status={action.busy ? "loading" : "idle"} onClick={() => create()}><PlusIcon />生成邀请码</StatusButton>
      <Button variant="ghost" size="sm" disabled={action.busy || left <= 0} onClick={() => { action.clear(); setExpiryOpen(true); }}>设置有效期</Button>
      {left <= 0 && <span className="text-sm text-muted-foreground">额度已用完，可以联系管理员调整。</span>}
    </div>
    {!expiryOpen && !created && <div className="empty:hidden px-4 pb-4">{action.feedback}</div>}
    <Separator /><Panel><PanelHeader><PanelTitle>我发出的邀请码<PanelTitleSup>({invites.invitations.length})</PanelTitleSup></PanelTitle></PanelHeader>
      {!invites.invitations.length ? <Empty className="rounded-none py-12"><EmptyHeader><EmptyMedia variant="icon"><TicketIcon /></EmptyMedia><EmptyTitle>还没有发出邀请码</EmptyTitle><EmptyDescription>生成后把注册链接通过私信发给朋友即可。</EmptyDescription></EmptyHeader></Empty>
        : <><InviteList invitations={invites.invitations} now={invites.now} codes={codes} busy={action.busy} revoke={id => void action.run(async () => {
          await call("/invites/" + id + "/revoke", { csrfToken: invites.csrfToken }); revalidator.revalidate(); action.setMessage("邀请码已作废，未用额度已释放。");
        })} /><p className="screen-line-top px-4 py-3 text-xs text-muted-foreground">原码只在本次生成后显示，请及时复制保存。已使用的邀请码永久占用额度，未使用码作废或过期释放。</p></>}
    </Panel>
    <Dialog open={!!created} onOpenChange={value => { if (!value) { setCreated(null); action.clear(); } }}><DialogContent>
      <DialogHeader><DialogTitle>邀请码已生成</DialogTitle><DialogDescription>有效至 {created && new Date(created.expiresAt).toLocaleString("zh-CN")}。请通过私信把注册链接发给朋友。</DialogDescription></DialogHeader>
      {created && <><code className="break-all rounded-lg border bg-muted p-3 font-mono text-sm">{created.code}</code><div className="flex flex-wrap gap-2">
        <CopyButton variant="outline" size="sm" text={created.code}>复制邀请码</CopyButton><CopyButton variant="outline" size="sm" text={() => window.location.origin + "/register?code=" + encodeURIComponent(created.code)}>复制注册链接</CopyButton>
      </div></>}<DialogFooter><Button onClick={() => { setCreated(null); action.clear(); }}>完成</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={expiryOpen} onOpenChange={value => { if (!action.busy) setExpiryOpen(value); }}><DialogContent>
      <DialogHeader><DialogTitle>设置邀请码有效期</DialogTitle><DialogDescription>默认 30 天，可为本次邀请指定其他期限。</DialogDescription></DialogHeader>{action.feedback}
      <form onSubmit={event => { event.preventDefault(); create(new Date(String(new FormData(event.currentTarget).get("expiresAt"))).getTime()); }}>
        <Field id="expiresAt" name="expiresAt" label="有效至" type="datetime-local" required />
        <DialogFooter className="mt-6"><Button type="button" variant="outline" disabled={action.busy} onClick={() => setExpiryOpen(false)}>取消</Button><StatusButton type="submit" status={action.busy ? "loading" : "idle"}>生成邀请码</StatusButton></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </Page>;
}
