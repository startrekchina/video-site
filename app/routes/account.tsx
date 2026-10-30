import { useState, type FormEvent, type ReactNode } from "react";
import { data, useRevalidator } from "react-router";
import { FingerprintIcon, KeyRoundIcon, LaptopIcon, MailIcon, ShieldCheckIcon, SmartphoneIcon, Trash2Icon, DownloadIcon } from "lucide-react";
import type { Route } from "./+types/account";
import { pageRead } from "@/lib/member.server";
import { createAuth } from "@/lib/auth.server";
import { settings } from "@/lib/settings.server";
import { authClient, authError, call } from "@/lib/auth-client";
import { pageTitle } from "@/lib/site";
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
import { toast } from "@/components/ui/toast";
import { LineNav } from "@/components/ui/line-nav";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const current = await pageRead(request, env, context.identity, (db, userId) => db.batch([
    db.prepare("SELECT id, createdAt, updatedAt, userAgent FROM session WHERE userId = ? AND expiresAt > ? ORDER BY createdAt DESC").bind(userId, new Date().toISOString()),
    db.prepare("SELECT id, name, createdAt FROM passkey WHERE userId = ? ORDER BY createdAt DESC").bind(userId),
    db.prepare("SELECT updatedAt FROM account WHERE userId = ? AND providerId = 'credential'").bind(userId),
  ]));
  const [sessions, passkeys, password] = current.value as [D1Result<{ id: string; createdAt: string; updatedAt: string; userAgent: string | null }>,
    D1Result<{ id: string; name: string | null; createdAt: string }>, D1Result<{ updatedAt: string }>];
  const passwordUpdatedAt = password.results[0]?.updatedAt ?? null;
  const backupCodesLeft = current.member.twoFactorEnabled ? (await createAuth(env).api.viewBackupCodes({ body: { userId: current.member.user_id } })).backupCodes.length : 0;
  return data({ username: current.member.displayUsername ?? current.member.username, role: current.member.role, joinedAt: current.member.created_at,
    email: current.member.email, totp: !!current.member.twoFactorEnabled, passwordUpdatedAt, backupCodesLeft, backupCodeTotal: settings.backupCodeCount,
    sessions: sessions.results.map(row => ({ ...row, userAgent: row.userAgent?.slice(0, 160), current: row.id === current.session.id })), passkeys: passkeys.results }, { headers: current.headers });
}
export const meta = () => pageTitle("账号与安全");
const SECTIONS = [{ title: "登录方式", href: "#methods" }, { title: "通行密钥", href: "#passkeys" }, { title: "登录设备", href: "#sessions" }];
type DialogState = "password" | "email" | "totp-enable" | "totp-disable" | "totp-verify" | "backup" | "codes" | "delete-passkey" | null;
const TITLES = { password: "修改密码", email: "修改注册邮箱", "totp-enable": "开启二步验证", "totp-disable": "关闭二步验证", "totp-verify": "设置验证器",
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
  const revalidator = useRevalidator();
  const active = useActiveSection(SECTIONS.map(section => section.href.slice(1)));
  const [dialog, setDialog] = useState<DialogState>(null);
  const action = useAction(dialog !== null);
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
  async function revoke(id: string) { await call("/account/sessions/" + id + "/revoke", {}); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void action.run(async () => {
      if (dialog === "password") {
        if (fields.newPassword !== fields.confirmPassword) throw new Error("两次密码输入不一致。");
        await call("/api/auth/change-password", { currentPassword: fields.currentPassword, newPassword: fields.newPassword, revokeOtherSessions: true });
        setDialog(null); toast.add({ title: "密码已修改，其他设备已退出登录。", type: "success" });
      } else if (dialog === "email") {
        await call("/api/auth/change-email", { newEmail: fields.newEmail, callbackURL: window.location.origin + "/verify-email" });
        setDialog(null); toast.add({ title: "请到新邮箱查收验证邮件，并在 1 小时内点击链接完成修改；打开链接时如需登录，请登录本账号。确认前，当前邮箱保持不变。若未收到，请检查垃圾邮件或稍后重试。", type: "success", timeout: 0 });
      } else if (dialog === "totp-enable") {
        const result = await call<{ totpURI: string; backupCodes: string[] }>("/api/auth/two-factor/enable", { password: fields.password });
        setSetup(result); setDialog("totp-verify");
      } else if (dialog === "totp-disable") {
        await call("/api/auth/two-factor/disable", { password: fields.password });
        setDialog(null); toast.add({ title: "二步验证已关闭。", type: "success" });
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
    <PageHeading><PageHeadingTagline>账号与安全</PageHeadingTagline><PageHeadingTitle>管理登录方式、二步验证和登录设备.</PageHeadingTitle>
      <PageHeadingDescription className="font-mono text-sm"><dl className="flex flex-wrap gap-x-6 gap-y-1">
        {[["用户名", account.username], ["身份", account.role === "admin" ? "管理员" : "成员"], ["加入于", new Date(account.joinedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })]].map(([title, value]) =>
          <div key={title}><dt className="inline">{title} </dt><dd className="inline text-foreground">{value}</dd></div>)}</dl></PageHeadingDescription></PageHeading>
    <div className="h-4" />
    <Panel id="methods" className="scroll-mt-16"><PanelHeader><PanelTitle>登录方式</PanelTitle></PanelHeader><ul className="divide-y divide-line">
      <Row icon={<KeyRoundIcon />} title="密码" meta={account.passwordUpdatedAt ? "上次修改于 " + new Date(account.passwordUpdatedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "使用用户名和密码登录"}
        action={<Button variant="outline" size="sm" onClick={() => open("password")}>修改</Button>} />
      <Row icon={<MailIcon />} title="注册邮箱" meta={account.email} action={<Button variant="outline" size="sm" onClick={() => open("email")}>修改</Button>} />
      <Row icon={<ShieldCheckIcon />} title={<span className="flex flex-wrap items-center gap-2">二步验证{account.totp ? <Tag className="text-success">已开启</Tag> : <Tag>未开启</Tag>}</span>}
        meta={account.totp ? "密码登录时需要验证器中的动态验证码或备用码" : "给密码登录增加一层保护"}
        action={account.totp ? <Button variant="ghost" size="sm" className="text-destructive" onClick={() => open("totp-disable")}>关闭</Button> : <Button size="sm" onClick={() => open("totp-enable")}>开启</Button>} />
      {account.totp && <Row icon={<FingerprintIcon />} title="二步验证备用码" meta={"还剩 " + account.backupCodesLeft + " / " + account.backupCodeTotal + " 个可用；用于在遗失验证器时替代动态验证码"}
        action={<Button variant="outline" size="sm" onClick={() => open("backup")}>重新生成</Button>} />}
    </ul></Panel><Separator />
    <Panel id="passkeys" className="scroll-mt-16"><PanelHeader><PanelTitle>通行密钥<PanelTitleSup>({account.passkeys.length})</PanelTitleSup></PanelTitle>
      <StatusButton size="sm" status={action.busy ? "loading" : "idle"} onClick={() => void action.run(async () => {
        const result = await authClient.passkey.addPasskey({ name: "我的设备" });
        if (result?.error) throw new Error(authError(result.error));
        if (!result?.data) throw new Error("通行密钥添加未完成。");
        revalidator.revalidate(); toast.add({ title: "通行密钥已添加。", type: "success" });
      })}>添加</StatusButton></PanelHeader>
      {!account.passkeys.length ? <p className="px-4 py-6 text-sm text-muted-foreground">添加通行密钥后，可以用指纹、面容或设备 PIN 免密码登录。</p>
        : <ul className="divide-y divide-line">{account.passkeys.map(key => <Row key={key.id} icon={<FingerprintIcon />} title={key.name || "通行密钥"} meta={"添加于 " + new Date(key.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}
          action={<Button variant="ghost" size="icon-sm" aria-label={"删除 " + (key.name || "通行密钥")} onClick={() => { setSelectedKey(key); open("delete-passkey"); }}><Trash2Icon /></Button>} />)}</ul>}
    </Panel><Separator />
    <Panel id="sessions" className="scroll-mt-16"><PanelHeader><PanelTitle>登录设备<PanelTitleSup>({account.sessions.length})</PanelTitleSup></PanelTitle>
      {account.sessions.length > 1 && <Button variant="outline" size="sm" disabled={action.busy} onClick={() => void action.run(async () => {
        for (const session of account.sessions) if (!session.current) await revoke(session.id);
        revalidator.revalidate(); toast.add({ title: "其他设备已退出登录。", type: "success" });
      })}>退出其他设备</Button>}</PanelHeader>
      <ul className="divide-y divide-line">{account.sessions.map(session => <Row key={session.id} icon={/iPhone|iPad|Android/.test(session.userAgent ?? "") ? <SmartphoneIcon /> : <LaptopIcon />}
        title={<span className="flex flex-wrap items-center gap-2">{device(session.userAgent)}{session.current && <Tag>当前</Tag>}</span>}
        meta={"最近活跃于 " + new Date(session.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
        action={!session.current && <Button variant="ghost" size="sm" className="text-destructive" disabled={action.busy} onClick={() => void action.run(async () => { await revoke(session.id); revalidator.revalidate(); })}>退出</Button>} />)}</ul>
      <div className="screen-line-top flex justify-center py-4"><Button variant="ghost" size="sm" disabled={action.busy} onClick={() => void action.run(async () => { await call("/api/auth/sign-out", {}); window.location.assign("/login"); })}>退出当前账号</Button></div>
    </Panel>
    <Dialog open={dialog !== null} onOpenChange={value => { if (!value) close(); }}><DialogContent showCloseButton={dialog !== "codes" || saved}>
      <DialogHeader><DialogTitle>{dialog ? TITLES[dialog] : ""}</DialogTitle><DialogDescription>
        {dialog === "password" ? "修改后，其他设备会退出登录。"
          : dialog === "email" ? "当前邮箱：" + account.email + "。验证邮件会发到新邮箱，链接 1 小时内有效；完成验证前，当前邮箱保持不变。"
          : dialog === "totp-enable" ? "先确认当前密码，再将密钥添加到验证器应用中。"
          : dialog === "totp-disable" ? "确认当前密码后关闭二步验证。"
          : dialog === "totp-verify" ? "在验证器应用中手动添加下方密钥，然后输入 6 位动态验证码。"
          : dialog === "backup" ? "旧的备用码将全部作废。新备用码只显示这一次，请妥善保存。"
          : dialog === "codes" ? "每个备用码仅可使用一次（用于在遗失验证器时替代动态验证码登录），不能重设密码。请存放在密码管理器或安全离线位置。"
          : "删除后，无法再用此通行密钥登录。其他登录方式保持有效。"}
      </DialogDescription></DialogHeader>
      {action.feedback}
      {dialog === "codes" ? <><BackupCodes codes={codes} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-foreground" checked={saved} onChange={event => setSaved(event.target.checked)} />我已妥善保存这些备用码</label><DialogFooter><Button disabled={!saved} onClick={close}>我已保存</Button></DialogFooter></>
        : dialog === "delete-passkey" ? <><p className="font-mono">{selectedKey?.name || "通行密钥"}</p><DialogFooter><Button variant="outline" disabled={action.busy} onClick={close}>取消</Button><StatusButton variant="destructive" status={action.busy ? "loading" : "idle"} onClick={() => void action.run(async () => {
          await call("/api/auth/passkey/delete-passkey", { id: selectedKey!.id }); setDialog(null); revalidator.revalidate(); toast.add({ title: "通行密钥已删除。", type: "success" });
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
            <Field id="totpCode" name="code" label="动态验证码" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} autoComplete="one-time-code" className="font-mono tracking-[0.4em]" /></>}
        </FieldGroup><DialogFooter className="mt-6"><Button type="button" variant="outline" disabled={action.busy} onClick={close}>取消</Button>
          <StatusButton type="submit" status={action.busy ? "loading" : "idle"}>{dialog === "totp-verify" ? "验证并开启" : dialog === "totp-enable" ? "继续" : dialog === "email" ? "发送验证邮件" : "确认"}</StatusButton></DialogFooter></form>}
    </DialogContent></Dialog>
  </Page>;
}
