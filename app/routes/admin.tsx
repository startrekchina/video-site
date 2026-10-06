import { useState } from "react";
import { data, Form, Link, useRevalidator, useSearchParams, useNavigate } from "react-router";
import { BanIcon, ChevronDownIcon, ChevronRightIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, ShieldIcon, ShieldOffIcon, UndoIcon } from "lucide-react";
import type { Route } from "./+types/admin";
import { pageMember } from "@/lib/member.server";
import { adminHttp } from "@/lib/admin.server";
import { csrfData } from "@/lib/security.server";
import { call } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Page, PageHeading, PageHeadingTitle, PageHeadingDescription, PageHeadingTagline, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Field, useAction } from "@/components/site/account-form";
import { InviteList, type Invitation } from "@/components/site/invite-list";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { StatusButton } from "@/components/ui/status-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";

type TreeMember = { user_id: string; username: string; role: "member" | "admin"; status: "active" | "banned"; childCount: number };
type AdminMember = TreeMember & { emailVerified: number; total: number; occupied: number; invitedBy: string | null; invitedById: string | null; created_at: number; sessionUpdatedAt: string | null };
type Stats = { total: number; active: number; banned: number; filtered: number; roots: number; validUnused: number; invitationCount: number };
type BanPreview = { total: number; active: number; members: { username: string; status: string }[] };
type DialogState = { kind: "ban" | "quota" | "role" | "unban"; member: AdminMember; preview?: BanPreview } | null;

function TreeNode({ member, depth }: { member: TreeMember; depth: number }) {
  const action = useAction();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeMember[]>([]);
  const [page, setPage] = useState(1);
  async function load(next: number) {
    const rows = await call<TreeMember[]>("/admin/members/" + member.user_id + "/invited?page=" + next);
    setChildren(rows); setPage(next); setExpanded(true);
  }
  return <li><div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 20 }}>
    {depth > 0 && <span className="font-mono text-muted-foreground/60">└─</span>}
    {member.childCount > 0 && <Button variant="ghost" size="icon-sm" disabled={action.busy} aria-label={(expanded ? "收起 " : "展开 ") + member.username} aria-expanded={expanded} onClick={() => expanded ? setExpanded(false) : void action.run(() => load(page))}>
      {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}</Button>}
    <span className={cn("font-mono text-sm", member.status === "banned" && "text-muted-foreground line-through")}>{member.username}</span>
    {member.role === "admin" && <ShieldIcon className="size-3.5 text-muted-foreground" aria-label="管理员" />}
    {member.childCount > 0 && <span className="font-mono text-[11px] text-muted-foreground">+{member.childCount}</span>}
  </div>{action.feedback}
    {expanded && <><ul>{children.map(child => <TreeNode key={child.user_id} member={child} depth={depth + 1} />)}</ul>
      {member.childCount > 20 && <div className="flex gap-2 py-2" style={{ paddingLeft: (depth + 1) * 20 }}>
        <Button size="sm" variant="ghost" disabled={action.busy || page === 1} onClick={() => void action.run(() => load(page - 1))}>上一页</Button>
        <span className="self-center text-xs text-muted-foreground">第 {page} 页</span>
        <Button size="sm" variant="ghost" disabled={action.busy || page * 20 >= member.childCount} onClick={() => void action.run(() => load(page + 1))}>下一页</Button></div>}</>}
  </li>;
}
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const current = await pageMember(request, env);
  if (current.member.role !== "admin") throw data({ message: "需要管理员权限。" }, { status: 403, headers: current.headers });
  const csrf = await csrfData(request, env);
  for (const cookie of csrf.headers.getSetCookie()) current.headers.append("Set-Cookie", cookie);
  const query = new URL(request.url).searchParams;
  const tab = query.get("tab") === "invites" ? "invites" : query.get("tab") === "tree" ? "tree" : "members";
  async function read<T>(path: string) {
    const url = new URL("/admin/members/" + path, request.url); url.search = query.toString();
    const result = await (await adminHttp(new Request(url, { headers: request.headers }), env)).json() as { data: T };
    return result.data;
  }
  const stats = await read<Stats>("stats");
  const members = tab === "members" ? await read<AdminMember[]>("data") : [];
  const invitations = tab === "invites" ? await read<Invitation[]>("invitations") : [];
  const roots = tab === "tree" ? await read<TreeMember[]>("roots") : [];
  return data({ members, invitations, roots, stats, tab, csrfToken: csrf.csrfToken, self: current.member.user_id, totp: !!current.member.twoFactorEnabled, now: Date.now() }, { headers: current.headers });
}
export const meta = () => [{ title: "管理后台 · 星际迷航中国" }];
export default function AdminPage({ loaderData: admin }: Route.ComponentProps) {
  const action = useAction(); const revalidator = useRevalidator(); const navigate = useNavigate(); const [params] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [cascade, setCascade] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  async function change(id: string, operation: string, body: object) {
    const result = await call<{ changed: number; failedNotifications: number }>("/admin/members/" + id + "/" + operation, { ...body, csrfToken: admin.csrfToken });
    setDialog(null); revalidator.revalidate(); action.setMessage("已更新 " + result.changed + " 个成员。" + (result.failedNotifications ? "其中 " + result.failedNotifications + " 封通知发送失败或未确认，封禁仍已生效。" : ""));
  }
  function show(kind: NonNullable<DialogState>["kind"], member: AdminMember) {
    action.clear(); setCascade(false);
    if (kind === "ban") void action.run(async () => { const preview = await call<BanPreview>("/admin/members/" + member.user_id + "/ban-preview"); setDialog({ kind, member, preview }); });
    else setDialog({ kind, member });
  }
  function location(tab: string, nextPage = 1) {
    const query = new URLSearchParams(params);
    query.set("tab", tab); query.set("page", String(nextPage));
    return "/admin?" + query;
  }
  const total = admin.tab === "members" ? admin.stats.filtered : admin.tab === "invites" ? admin.stats.invitationCount : admin.stats.roots;
  return <Page narrow>
    <PageHeading><PageHeadingTagline>管理后台</PageHeadingTagline><PageHeadingTitle>成员、邀请码和邀请链。</PageHeadingTitle><PageHeadingDescription>内容由站长用离线工具导入，这里不提供上传。</PageHeadingDescription></PageHeading><div className="h-4" />
    <div className="screen-line-top screen-line-bottom grid grid-cols-3">
      {[["成员", admin.stats.active], ["已封禁", admin.stats.banned], ["未使用邀请码", admin.stats.validUnused]].map(([title, value], i) =>
        <div key={title} className={cn("flex flex-col gap-1 px-4 py-3", i > 0 && "border-l border-line")}><span className="text-sm text-muted-foreground">{title}</span><span className="font-mono text-2xl font-medium tabular-nums">{value}</span></div>)}
    </div>
    <div className="px-4 py-3 text-xs text-muted-foreground">封禁、解封、调整额度和身份须绑定二步验证，并在五分钟内<Link className="link-underline text-foreground" to="/login?next=/admin">重新登录</Link>。{!admin.totp && <Link className="link-underline text-foreground" to="/account">前往绑定验证器</Link>}</div>
    {!dialog && !created && <div className="empty:hidden px-4 pb-4">{action.feedback}</div>}
    <Separator /><Panel><Tabs value={admin.tab} onValueChange={value => navigate(location(String(value)))} className="gap-0">
      <PanelHeader className="flex-wrap py-3"><PanelTitle><span className="whitespace-nowrap">成员与邀请</span><PanelTitleSup>({admin.stats.total})</PanelTitleSup></PanelTitle>
        <TabsList><TabsTrigger value="members">成员</TabsTrigger><TabsTrigger value="invites">邀请码</TabsTrigger><TabsTrigger value="tree">邀请链</TabsTrigger><TabsIndicator /></TabsList></PanelHeader>
      <TabsContent value="members">
        <Form method="get" className="screen-line-bottom flex flex-wrap items-center gap-3 px-4 py-3"><input type="hidden" name="tab" value="members" />
          <InputGroup className="max-w-xs min-w-0 flex-1"><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput key={params.get("q")} name="q" defaultValue={params.get("q") ?? ""} maxLength={30} placeholder="搜索用户名" aria-label="搜索成员" /></InputGroup>
          <Button type="submit" variant="ghost" size="sm">搜索</Button><span className="ml-auto shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{admin.stats.active} 活跃 · {admin.stats.banned} 封禁</span>
        </Form>
        <div className="no-scrollbar scroll-fade-x overflow-x-auto"><table className="w-full min-w-[42rem] text-sm whitespace-nowrap">
          <thead><tr className="border-b border-line text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">成员</th><th className="px-2 py-2 font-medium">邀请人</th><th className="px-2 py-2 font-medium">邀请了</th><th className="px-2 py-2 font-medium">额度</th><th className="px-2 py-2 font-medium">会话更新</th><th className="w-12 px-2 py-2"><span className="sr-only">操作</span></th></tr></thead>
          <tbody className="divide-y divide-line">{admin.members.map(member => <tr key={member.user_id} className={cn("hover:bg-accent-muted", member.status === "banned" && "text-muted-foreground")}>
            <td className="px-4 py-2.5"><div className="flex items-center gap-2"><span className={cn("font-mono", member.status === "banned" && "line-through")}>{member.username}</span>
              {member.role === "admin" && <Tag className="shrink-0 gap-1 whitespace-nowrap"><ShieldIcon />管理员</Tag>}{member.status === "banned" && <Tag className="shrink-0 whitespace-nowrap text-destructive">已封禁</Tag>}{!member.emailVerified && <Tag className="shrink-0">邮箱待验证</Tag>}{member.user_id === admin.self && <Tag className="shrink-0">你</Tag>}</div>
              <div className="font-mono text-[11px] text-muted-foreground">加入于 {new Date(member.created_at).toLocaleDateString("zh-CN")}</div></td>
            <td className="px-2 py-2.5 font-mono text-xs">{member.invitedBy ?? "—"}</td><td className="px-2 py-2.5 font-mono text-xs">{member.childCount ? <Link className="link-underline" to={location("tree")}>{member.childCount} 人</Link> : "—"}</td>
            <td className="px-2 py-2.5 font-mono text-xs">{member.role === "admin" ? "∞" : member.occupied + " / " + member.total}</td><td className="px-2 py-2.5 text-xs">{member.sessionUpdatedAt ? new Date(member.sessionUpdatedAt).toLocaleDateString("zh-CN") : "—"}</td>
            <td className="px-2 py-2.5"><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={"管理 " + member.username} />}><MoreHorizontalIcon /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">{member.role === "member" && <DropdownMenuItem onClick={() => show("quota", member)}><PlusIcon />调整邀请额度</DropdownMenuItem>}
                {member.user_id !== admin.self && <><DropdownMenuItem onClick={() => show("role", member)}>{member.role === "admin" ? <ShieldOffIcon /> : <ShieldIcon />}{member.role === "admin" ? "取消管理员" : "设为管理员"}</DropdownMenuItem><DropdownMenuSeparator />
                  {member.status === "active" ? <DropdownMenuItem variant="destructive" onClick={() => show("ban", member)}><BanIcon />封禁…</DropdownMenuItem> : <DropdownMenuItem onClick={() => show("unban", member)}><UndoIcon />解除封禁</DropdownMenuItem>}</>}
                {member.user_id === admin.self && <DropdownMenuItem disabled>不能封禁自己或取消自己的管理员身份</DropdownMenuItem>}
              </DropdownMenuContent></DropdownMenu></td>
          </tr>)}</tbody></table></div>
        {!admin.members.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">没有匹配的成员。</p>}
      </TabsContent>
      <TabsContent value="invites"><div className="screen-line-bottom flex flex-wrap items-center gap-3 px-4 py-3">
        <StatusButton size="sm" status={action.busy ? "loading" : "idle"} onClick={() => void action.run(async () => {
          const id = operationId ?? crypto.randomUUID(); setOperationId(id);
          const result = await call<{ id: string; code: string }>("/invites/create", { operationId: id, csrfToken: admin.csrfToken });
          setCodes(values => ({ ...values, [result.id]: result.code })); setCreated(result.code); setOperationId(null); revalidator.revalidate();
        })}><PlusIcon />生成邀请码</StatusButton><span className="text-xs text-muted-foreground">管理员生成不受额度限制</span></div>
        <InviteList invitations={admin.invitations} codes={codes} now={admin.now} self={admin.self} showIssuer busy={action.busy} revoke={id => void action.run(async () => {
          await call("/invites/" + id + "/revoke", { csrfToken: admin.csrfToken }); revalidator.revalidate(); action.setMessage("邀请码已作废。");
        })} />{!admin.invitations.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">还没有邀请码。</p>}
        <p className="px-4 py-3 text-xs text-muted-foreground">原码只在生成后显示。仅可作废自己发出的未使用码。</p>
      </TabsContent>
      <TabsContent value="tree"><div className="no-scrollbar overflow-x-auto"><ul className="dot-grid min-w-fit px-4 py-4">{admin.roots.map(member => <TreeNode key={member.user_id} member={member} depth={0} />)}</ul></div>
        {!admin.roots.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">还没有邀请关系。</p>}</TabsContent>
    </Tabs>
      <div className="screen-line-top flex items-center justify-between gap-2 px-4 py-3"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => navigate(location(admin.tab, page - 1))}>上一页</Button><span className="font-mono text-xs text-muted-foreground">第 {page} / {Math.max(1, Math.ceil(total / 20))} 页</span><Button size="sm" variant="ghost" disabled={page * 20 >= total} onClick={() => navigate(location(admin.tab, page + 1))}>下一页</Button></div>
    </Panel>
    <Dialog open={!!dialog} onOpenChange={value => { if (!value && !action.busy) { setDialog(null); action.clear(); } }}><DialogContent>
      <DialogHeader><DialogTitle>{dialog?.kind === "quota" ? "调整邀请额度" : dialog?.kind === "ban" ? "封禁 " : dialog?.kind === "unban" ? "解除封禁 " : "调整管理员身份 "}{dialog?.kind !== "quota" && <span className="font-mono">{dialog?.member.username}</span>}</DialogTitle>
        <DialogDescription>{dialog?.kind === "quota" ? dialog.member.username + " 当前总额度 " + dialog.member.total + "，默认值为 2。"
          : dialog?.kind === "ban" ? "封禁后立即无法登录，所有会话失效；已签发的播放 token 最多 30 分钟后停止。"
          : dialog?.kind === "unban" ? "仅解除这个成员的封禁，不恢复旧会话或已作废的邀请码，不连带解封。"
          : dialog?.member.role === "admin" ? "取消管理员身份后，该成员将失去后台权限。" : "提升后，该成员可以使用管理后台。高影响操作仍需绑定二步验证和新鲜会话。"}</DialogDescription></DialogHeader>
      {action.feedback}
      {dialog?.kind === "quota" ? <form onSubmit={event => { event.preventDefault(); const total = Number(new FormData(event.currentTarget).get("total")); void action.run(() => change(dialog.member.user_id, "quota", { total })); }}>
        <Field id="quota" name="total" label="邀请总额度" type="number" required min={dialog.member.occupied} step="1" defaultValue={dialog.member.total} className="w-32 font-mono" help={"当前占用 " + dialog.member.occupied + "，总额度不得低于占用数。"} />
        <DialogFooter className="mt-6"><Button type="button" variant="outline" disabled={action.busy} onClick={() => setDialog(null)}>取消</Button><StatusButton type="submit" status={action.busy ? "loading" : "idle"}>保存</StatusButton></DialogFooter></form>
        : <>{dialog?.kind === "ban" && <div className="flex flex-col gap-2 text-sm">
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", !cascade && "border-foreground/40 bg-accent-muted")}><input type="radio" name="scope" className="mt-1 accent-foreground" checked={!cascade} onChange={() => setCascade(false)} /><span><span className="font-medium">只封禁本人</span><span className="block text-muted-foreground">他邀请的人不受影响</span></span></label>
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", cascade && "border-destructive/50 bg-destructive/5", !dialog.preview?.total && "opacity-50")}><input type="radio" name="scope" className="mt-1 accent-destructive" checked={cascade} disabled={!dialog.preview?.total} onChange={() => setCascade(true)} />
            <span className="min-w-0"><span className="font-medium">沿邀请链连带封禁</span><span className="block text-muted-foreground">{dialog.preview?.total ? "另外 " + dialog.preview.active + " 人会被封禁，遇到其他管理员停止。" : "没有可连带处理的普通成员后代。"}</span>
              <span className="mt-1 flex flex-wrap gap-1">{dialog.preview?.members.map(member => <Tag key={member.username} className={cn(member.status === "banned" && "line-through")}>{member.username}</Tag>)}{(dialog.preview?.total ?? 0) > 20 && <Tag>仅显示前 20 人</Tag>}</span></span></label></div>}
          <DialogFooter><Button variant="outline" disabled={action.busy} onClick={() => { setDialog(null); action.clear(); }}>取消</Button>
            <StatusButton variant={dialog?.kind === "ban" ? "destructive" : "default"} status={action.busy ? "loading" : "idle"} onClick={() => void action.run(async () => {
              if (!dialog) return;
              await change(dialog.member.user_id, dialog.kind, dialog.kind === "ban" ? { cascade } : dialog.kind === "role" ? { role: dialog.member.role === "admin" ? "member" : "admin" } : {});
            })}>{dialog?.kind === "ban" ? "确认封禁" + (cascade ? "（" + (1 + (dialog.preview?.active ?? 0)) + " 人）" : "") : "确认"}</StatusButton></DialogFooter>
        </>}
    </DialogContent></Dialog>
    <Dialog open={!!created} onOpenChange={value => { if (!value) setCreated(null); }}><DialogContent><DialogHeader><DialogTitle>邀请码已生成</DialogTitle><DialogDescription>默认 30 天内有效，原码只在本次生成后显示。请通过私信发送给朋友。</DialogDescription></DialogHeader>
      <code className="break-all rounded-lg border bg-muted p-3 font-mono text-sm">{created}</code><div className="flex flex-wrap gap-2"><CopyButton variant="outline" size="sm" text={created ?? ""}>复制邀请码</CopyButton><CopyButton variant="outline" size="sm" text={() => window.location.origin + "/register?code=" + encodeURIComponent(created ?? "")}>复制注册链接</CopyButton></div><DialogFooter><Button onClick={() => setCreated(null)}>完成</Button></DialogFooter>
    </DialogContent></Dialog>
  </Page>;
}
