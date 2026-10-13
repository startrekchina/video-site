import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/copy-button";
import { Button } from "@/components/ui/button";

export type Invitation = { id: string; created_at: number; expires_at: number; revoked_at: number | null; used_at: number | null; usedBy: string | null; issuerId?: string | null; issuer?: string | null };
export function invitationStatus(invite: Invitation, now: number) {
  return invite.used_at ? "used" : invite.revoked_at ? "revoked" : invite.expires_at <= now ? "expired" : "unused";
}
const STATUS = { unused: { label: "未使用", className: "text-foreground" }, used: { label: "已使用", className: "text-success" },
  revoked: { label: "已作废", className: "text-muted-foreground line-through decoration-muted-foreground/50" }, expired: { label: "已过期", className: "text-muted-foreground" } };
export function StatusDot({ status }: { status: keyof typeof STATUS }) {
  return <span className="inline-flex items-center gap-1.5 font-mono text-xs"><span className={cn("size-1.5 rounded-full", status === "unused" ? "bg-info" : status === "used" ? "bg-success" : "bg-muted-foreground/40")} />{STATUS[status].label}</span>;
}
export function InviteList({ invitations, now, codes, self, busy, revoke, showIssuer = false }: {
  invitations: Invitation[]; now: number; codes: Record<string, string>; self?: string; busy: boolean; revoke: (id: string) => void; showIssuer?: boolean;
}) {
  return <ul className="divide-y divide-line">{invitations.map(invite => {
    const status = invitationStatus(invite, now);
    const code = codes[invite.id];
    return <li key={invite.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 pr-2 transition-[background-color] ease-out hover:bg-accent-muted">
      <span className={cn("min-w-0 break-all font-mono text-sm tracking-wide", STATUS[status].className)}>{code ?? "邀请 " + invite.id.slice(0, 8)}</span>
      <StatusDot status={status} />
      <span className="text-xs text-muted-foreground">{showIssuer && <>发出人 <span className="font-mono text-foreground">{invite.issuer ?? "初始邀请"}</span> · </>}
        {status === "used" ? <>已邀请 <span className="font-mono text-foreground">{invite.usedBy}</span></> : <>有效至 {new Date(invite.expires_at).toLocaleDateString("zh-CN")}</>}</span>
      <div className="ml-auto flex items-center gap-1">
        {status === "unused" && code && <CopyButton variant="ghost" size="icon-sm" text={() => window.location.origin + "/register?code=" + encodeURIComponent(code)} aria-label="复制注册链接" />}
        {status === "unused" && (!showIssuer || invite.issuerId === self) && <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => revoke(invite.id)}>作废</Button>}
      </div>
    </li>;
  })}</ul>;
}
