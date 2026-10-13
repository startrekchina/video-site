import { useState, type FormEvent, type ReactNode } from "react";
import { data, useRevalidator } from "react-router";
import { FingerprintIcon, KeyRoundIcon, LaptopIcon, MailIcon, ShieldCheckIcon, SmartphoneIcon, Trash2Icon, DownloadIcon } from "lucide-react";
import type { Route } from "./+types/account";
import { pageMember } from "@/lib/member.server";
import { createAuth } from "@/lib/auth.server";
import { settings } from "@/lib/settings.server";
import { csrfData } from "@/lib/security.server";
import { authClient, authError, call } from "@/lib/auth-client";
import { useActiveSection } from "@/lib/use-active-section";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { Page, PageHeading, PageHeadingTitle, PageHeadingDescription, PageHeadingTagline, Panel, PanelHeader, PanelTitle, PanelTitleSup, Separator } from "@/components/site/panel";
import { Field, useAction } from "@/components/site/account-form";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { CopyButton, CopyStateIcon } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { IconTile } from "@/components/ui/icon-tile";
import { Tag } from "@/components/ui/tag";
import { LineNav } from "@/components/ui/line-nav";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const current = await pageMember(request, env);
  const csrf = await csrfData(request, env);
  for (const cookie of csrf.headers.getSetCookie()) current.headers.append("Set-Cookie", cookie);
  const sessions = await env.DB.prepare("SELECT id, createdAt, updatedAt, userAgent FROM session WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC")
    .bind(current.member.user_id, new Date().toISOString()).all<{ id: string; createdAt: string; updatedAt: string; userAgent: string | null }>();
  const passkeys = await env.DB.prepare("SELECT id, name, createdAt FROM passkey WHERE userId = ? ORDER BY createdAt DESC")
    .bind(current.member.user_id).all<{ id: string; name: string | null; createdAt: string }>();
  const passwordUpdatedAt = await env.DB.prepare("SELECT updatedAt FROM account WHERE userId = ? AND providerId = 'credential'")
    .bind(current.member.user_id).first<string>("updatedAt");
  const backupCodesLeft = current.member.twoFactorEnabled ? (await createAuth(env).api.viewBackupCodes({ body: { userId: current.member.user_id } })).backupCodes.length : 0;
  return data({ username: current.member.displayUsername ?? current.member.username, role: current.member.role, joinedAt: current.member.created_at,
    email: current.member.email, totp: !!current.member.twoFactorEnabled, passwordUpdatedAt, backupCodesLeft, backupCodeTotal: settings.backupCodeCount,
    csrfToken: csrf.csrfToken, sessions: sessions.results.map(row => ({ ...row, userAgent: row.userAgent?.slice(0, 160), current: row.id === current.session.id })), passkeys: passkeys.results }, { headers: current.headers });
}
export const meta = () => [{ title: "账号与安全 · 星际迷航中国" }];
const SECTIONS = [{ title: "登录方式", href: "#methods" }, { title: "通行密钥", href: "#passkeys" }, { title: "登录会话", href: "#sessions" }];
type DialogState = "password" | "email" | "totp-enable" | "totp-disable" | "totp-verify" | "backup" | "codes" | "delete-passkey" | null;
const TITLES = { password: "修改密码", email: "修改注册邮箱", "totp-enable": "开启二步验证", "totp-disable": "关闭二步验证", "totp-verify": "绑定验证器",
  backup: "重新生成备用码", codes: "保存二步验证备用码", "delete-passkey": "删除通行密钥" };
function Row({ icon, title, meta, action }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return <li className="flex items-center gap-4 p-4 pr-2 transition-[background-color] ease-out hover:bg-accent-muted"><IconTile>{icon}</IconTile>
    <div className="flex min-w-0 flex-1 items-center gap-3"><div className="min-w-0 flex-1"><div className="leading-snug font-medium">{title}</div>
      {meta && <div className="break-words text-sm text-muted-foreground">{meta}</div>}</div>{action}</div></li>;
}
function device(agent: string | undefined | null) {
  if (!agent) return "未知设备";
  const platform = /iPhone|iPad|Android|Windows|Macintosh|Linux/.exec(agent)?.[0] ?? "浏览器";
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "";
  return [platform === "Macintosh" ? "Mac" : platform, browser].filter(Boolean).join(" · ");
}
function BackupCodes({ codes }: { codes: string[] }) {
  const { state, copy } = useCopyToClipboard({ resetDelay: 2000 });
  const text = codes.join("\n");
  return <div className="flex flex-col gap-3"><ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-line font-mono text-sm">
    {codes.map((code, i) => <li key={code} className="flex min-w-0 gap-2 bg-background px-3 py-2"><span className="text-muted-foreground/70 select-none">{String(i + 1).padStart(2, "0")}</span><span className="break-all">{code}</span></li>)}</ol>
    <div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => void copy(text)}><CopyStateIcon state={state} />{state === "done" ? "已复制" : state === "error" ? "复制失败" : "复制全部"}</Button>
      <Button type="button" variant="outline" size="sm" nativeButton={false} render={<a href={"data:text/plain;charset=utf-8," + encodeURIComponent(text)} download="starfleet-archive-backup-codes.txt" />}><DownloadIcon />下载 .txt</Button></div></div>;
}
export default function AccountPage({ loaderData: account }: Route.ComponentProps) {
  const action = useAction();
  const revalidator = useRevalidator();
  const active = useActiveSection(SECTIONS.map(section => section.href.slice(1)));
  const [dialog, setDialog] = useState<DialogState>(null);
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [selectedKey, setSelectedKey] = useState<{ id: string; name: string | null } | null>(null);
  function open(value: DialogState) { action.clear(); setDialog(value); }
  function close() {
    if (action.busy || dialog === "codes" && !saved) return;
    setDialog(null); setSetup(null); setCodes([]); action.clear();
  }
  function showCodes(value: string[]) { setCodes(value); setSaved(false); setSetup(null); setDialog("codes"); }
  async function revoke(id: string) { await call("/account/sessions/" + id + "/revoke", { csrfToken: account.csrfToken }); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void action.run(async () => {
      if (dialog === "password") {
        if (fields.newPassword !== fields.confirmPassword) throw new Error("两次密码输入不一致。");
        await call("/api/auth/change-password", { currentPassword: fields.currentPassword, newPassword: fields.newPassword, revokeOtherSessions: true });
        setDialog(null); action.setMessage("密码已修改，其他会话已退出。");
      } else if (dialog === "email") {
        await call("/api/auth/change-email", { newEmail: fields.newEmail, callbackURL: window.location.origin + "/verify-email" });
        setDialog(null); action.setMessage("已处理验证邮件请求。确认新邮箱前，当前邮箱保持不变；请在本人登录会话中打开邮件链接。");
      } else if (dialog === "totp-enable") {
        const result = await call<{ totpURI: string; backupCodes: string[] }>("/api/auth/two-factor/enable", { password: fields.password });
        setSetup(result); setDialog("totp-verify");
      } else if (dialog === "totp-disable") {
        await call("/api/auth/two-factor/disable", { password: fields.password });
        setDialog(null); action.setMessage("二步验证已关闭。");
      } else if (dialog === "totp-verify" && setup) {
        await call("/api/auth/two-factor/verify-totp", { code: fields.code, trustDevice: false });
        showCodes(setup.backupCodes);
      } else if (dialog === "backup") {
        const result = await call<{ backupCodes: string[] }>("/api/auth/two-factor/generate-backup-codes", { password: fields.password });
        showCodes(result.backupCodes);
      }
      revalidator.revalidate();
    });
  }
  const needsPassword = dialog === "totp-enable" || dialog === "totp-disable" || dialog === "backup";
  return <Page narrow className="relative">
    <aside className="absolute inset-y-0 left-full hidden pl-8 xl:block" aria-label="本页导航"><div className="sticky top-24"><LineNav items={SECTIONS} activeHref={"#" + active} /></div></aside>
    <PageHeading><PageHeadingTagline>账号与安全</PageHeadingTagline><PageHeadingTitle>管理登录方式、二步验证和登录会话。</PageHeadingTitle>
      <PageHeadingDescription className="font-mono text-sm"><dl className="flex flex-wrap gap-x-6 gap-y-1">
        {[["用户名", account.username], ["身份", account.role === "admin" ? "管理员" : "成员"], ["加入于", new Date(account.joinedAt).toLocaleDateString("zh-CN")]].map(([title, value]) =>
          <div key={title}><dt className="inline">{title} </dt><dd className="inline text-foreground">{value}</dd></div>)}</dl></PageHeadingDescription></PageHeading>
    <div className="h-4" />{!dialog && <div className="empty:hidden p-4">{action.feedback}</div>}
    <Panel id="methods" className="scroll-mt-16"><PanelHeader><PanelTitle>登录方式</PanelTitle></PanelHeader><ul className="divide-y divide-line">
      <Row icon={<KeyRoundIcon />} title="密码" meta={account.passwordUpdatedAt ? "上次修改于 " + new Date(account.passwordUpdatedAt).toLocaleDateString("zh-CN") : "使用用户名和密码登录"}
        action={<Button variant="outline" size="sm" onClick={() => open("password")}>修改</Button>} />
      <Row icon={<MailIcon />} title="注册邮箱" meta={account.email} action={<Button variant="outline" size="sm" onClick={() => open("email")}>修改</Button>} />
      <Row icon={<ShieldCheckIcon />} title={<span className="flex flex-wrap items-center gap-2">二步验证（TOTP）{account.totp ? <Tag className="text-success">已开启</Tag> : <Tag>未开启</Tag>}</span>}
        meta={account.totp ? "密码登录时需要验证器中的动态码或备用码" : "给密码登录增加一层保护"}
        action={account.totp ? <Button variant="ghost" size="sm" className="text-destructive" onClick={() => open("totp-disable")}>解绑</Button> : <Button size="sm" onClick={() => open("totp-enable")}>开启</Button>} />
      {account.totp && <Row icon={<FingerprintIcon />} title="二步验证备用码" meta={"还剩 " + account.backupCodesLeft + " / " + account.backupCodeTotal + " 个可用；只能替代第二因素"}
        action={<Button variant="outline" size="sm" onClick={() => open("backup")}>重新生成</Button>} />}
    </ul></Panel><Separator />
    <Panel id="passkeys" className="scroll-mt-16"><PanelHeader><PanelTitle>通行密钥<PanelTitleSup>({account.passkeys.length})</PanelTitleSup></PanelTitle>
      <StatusButton size="sm" status={action.busy ? "loading" : "idle"} onClick={() => void action.run(async () => {
        const result = await authClient.passkey.addPasskey({ name: "我的设备" });
        if (result?.error) throw new Error(authError(result.error));
        if (!result?.data) throw new Error("通行密钥绑定未完成。");
        revalidator.revalidate(); action.setMessage("通行密钥已添加。");
      })}>添加</StatusButton></PanelHeader>
      {!account.passkeys.length ? <p className="px-4 py-6 text-sm text-muted-foreground">绑定通行密钥后，可以用指纹、面容或设备 PIN 免密码登录。</p>
        : <ul className="divide-y divide-line">{account.passkeys.map(key => <Row key={key.id} icon={<FingerprintIcon />} title={key.name || "通行密钥"} meta={"添加于 " + new Date(key.createdAt).toLocaleDateString("zh-CN")}
          action={<Button variant="ghost" size="icon-sm" aria-label={"删除 " + (key.name || "通行密钥")} onClick={() => { setSelectedKey(key); open("delete-passkey"); }}><Trash2Icon /></Button>} />)}</ul>}
    </Panel><Separator />
    <Panel id="sessions" className="scroll-mt-16"><PanelHeader><PanelTitle>登录会话<PanelTitleSup>({account.sessions.length})</PanelTitleSup></PanelTitle>
      {account.sessions.length > 1 && <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void action.run(async () => {
        for (const session of account.sessions) if (!session.current) await revoke(session.id);
        revalidator.revalidate(); action.setMessage("其他会话已退出。");
      })}>退出其他会话</Button>}</PanelHeader>
      <ul className="divide-y divide-line">{account.sessions.map(session => <Row key={session.id} icon={/iPhone|iPad|Android/.test(session.userAgent ?? "") ? <SmartphoneIcon /> : <LaptopIcon />}
        title={<span className="flex flex-wrap items-center gap-2">{device(session.userAgent)}{session.current && <Tag>当前</Tag>}</span>}
        meta={"会话更新于 " + new Date(session.updatedAt).toLocaleString("zh-CN")}
        action={!session.current && <Button variant="ghost" size="sm" className="text-destructive" disabled={action.busy} onClick={() => void action.run(async () => { await revoke(session.id); revalidator.revalidate(); })}>退出</Button>} />)}</ul>
      <div className="screen-line-top flex justify-center py-4"><Button variant="ghost" size="sm" disabled={action.busy} onClick={() => void action.run(async () => { await call("/api/auth/sign-out", {}); window.location.assign("/login"); })}>退出当前账号</Button></div>
    </Panel>
    <Dialog open={dialog !== null} onOpenChange={value => { if (!value) close(); }}><DialogContent showCloseButton={dialog !== "codes" || saved}>
      <DialogHeader><DialogTitle>{dialog ? TITLES[dialog] : ""}</DialogTitle><DialogDescription>
        {dialog === "password" ? "修改后，其他设备上的会话会退出。"
          : dialog === "email" ? "当前邮箱：" + account.email + "。新邮箱验证前，旧邮箱仍然有效。会话过期时请重新登录。"
          : dialog === "totp-enable" ? "先确认当前密码，再将密钥添加到验证器应用中。"
          : dialog === "totp-disable" ? "确认当前密码后解绑验证器。"
          : dialog === "totp-verify" ? "在验证器应用中手动添加下方密钥，然后输入 6 位动态码。"
          : dialog === "backup" ? "旧的备用码将全部作废。新的码只在本次流程显示，请离线保存。"
          : dialog === "codes" ? "每个码只能替代一次登录第二因素，不能重设密码。请存放在密码管理器或离线位置。"
          : "删除后，无法再用此通行密钥登录。其他登录方式保持有效。"}
      </DialogDescription></DialogHeader>
      {action.feedback}
      {dialog === "codes" ? <><BackupCodes codes={codes} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-foreground" checked={saved} onChange={event => setSaved(event.target.checked)} />我已妥善保存这些备用码</label><DialogFooter><Button disabled={!saved} onClick={close}>我已保存</Button></DialogFooter></>
        : dialog === "delete-passkey" ? <><p className="font-mono">{selectedKey?.name || "通行密钥"}</p><DialogFooter><Button variant="outline" disabled={action.busy} onClick={close}>取消</Button><StatusButton variant="destructive" status={action.busy ? "loading" : "idle"} onClick={() => void action.run(async () => {
          await call("/api/auth/passkey/delete-passkey", { id: selectedKey!.id }); setDialog(null); revalidator.revalidate(); action.setMessage("通行密钥已删除。");
        })}>确认删除</StatusButton></DialogFooter></>
        : <form key={dialog} onSubmit={submit}><FieldGroup>
          {dialog === "password" && <><Field id="currentPassword" name="currentPassword" label="当前密码" type="password" required autoComplete="current-password" />
            <Field id="newPassword" name="newPassword" label="新密码" type="password" required minLength={8} maxLength={128} autoComplete="new-password" help="8–128 位，支持中文和空格" />
            <Field id="confirmPassword" name="confirmPassword" label="确认新密码" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></>}
          {dialog === "email" && <Field id="newEmail" name="newEmail" label="新邮箱" type="email" required maxLength={320} autoComplete="email" />}
          {needsPassword && <Field id="confirmCurrentPassword" name="password" label="当前密码" type="password" required autoComplete="current-password" />}
          {dialog === "totp-verify" && setup && <><div className="flex items-center gap-4">
            <div className="dot-grid flex size-24 shrink-0 items-center justify-center rounded-lg border"><ShieldCheckIcon className="size-10 text-muted-foreground" /></div>
            <div className="min-w-0 text-sm"><div className="text-muted-foreground">手动输入密钥：</div><code className="mt-1 block font-mono text-xs break-all">{new URL(setup.totpURI).searchParams.get("secret")}</code>
              <CopyButton variant="ghost" size="sm" text={new URL(setup.totpURI).searchParams.get("secret") ?? ""}>复制密钥</CopyButton></div></div>
            <Field id="totpCode" name="code" label="动态码" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} autoComplete="one-time-code" className="font-mono tracking-[0.4em]" /></>}
        </FieldGroup><DialogFooter className="mt-6"><Button type="button" variant="outline" disabled={action.busy} onClick={close}>取消</Button>
          <StatusButton type="submit" status={action.busy ? "loading" : "idle"}>{dialog === "totp-verify" ? "验证并开启" : dialog === "totp-enable" ? "继续" : dialog === "email" ? "发送验证邮件" : "确认"}</StatusButton></DialogFooter></form>}
    </DialogContent></Dialog>
  </Page>;
}
