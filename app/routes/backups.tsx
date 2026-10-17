import { useEffect, useState, type FormEvent } from "react";
import { data, Link, useRevalidator } from "react-router";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import type { Route } from "./+types/backups";
import { backupStatus, isBackupOwner, type BackupFrequency } from "@/lib/backups.server";
import { pageMember } from "@/lib/member.server";
import type { BackupTarget, ExternalBackupTarget } from "@/lib/backup-targets.server";
import { call } from "@/lib/auth-client";
import { pageTitle } from "@/lib/site";
import { useAction } from "@/components/site/account-form";
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";

const labels: Record<BackupTarget, string> = { download: "加密下载", webdav: "WebDAV", s3: "S3" };
type Status = Awaited<ReturnType<typeof backupStatus>>;
type Job = Status["items"][number];
const frequencyLabels: Record<BackupFrequency, string> = { daily: "每天", weekly: "每周", interval: "每隔 N 天" };
const weekdayLabels = [[1, "周一"], [2, "周二"], [3, "周三"], [4, "周四"], [5, "周五"], [6, "周六"], [0, "周日"]] as const;
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env, current = await pageMember(request, env, context.identity);
  if (!isBackupOwner(current.member, env)) throw data({ message: "仅本站站长可访问备份。" }, { status: 403, headers: current.headers });
  return data(await backupStatus(env, new URL(request.url).searchParams.get("after")), { headers: current.headers });
}
export const meta = () => pageTitle("数据备份");
const time = (value: number) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(value);

export default function BackupsPage({ loaderData: state }: Route.ComponentProps) {
  const action = useAction(), scheduleAction = useAction(), revalidator = useRevalidator();
  const saved = state.schedule, savedTarget = saved.updatedAt || state.targets[saved.target] ? saved.target : state.targets.s3 ? "s3" : "webdav";
  const [target, setTarget] = useState<BackupTarget>("download"), [confirmed, setConfirmed] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(state.schedule.enabled), [scheduleTarget, setScheduleTarget] = useState<ExternalBackupTarget>(savedTarget);
  const [frequency, setFrequency] = useState<BackupFrequency>(state.schedule.frequency), [intervalDays, setIntervalDays] = useState(state.schedule.intervalDays ?? 7);
  const [weekday, setWeekday] = useState(state.schedule.weekday ?? 1), [scheduleTime, setScheduleTime] = useState(state.schedule.time);
  const running = state.schedule.lastStatus === "running" || state.items.some(job => job.status === "running");
  const scheduleReady = state.targets.webdav || state.targets.s3;
  useEffect(() => {
    setScheduleEnabled(saved.enabled); setScheduleTarget(savedTarget); setFrequency(saved.frequency);
    setIntervalDays(saved.intervalDays ?? 7); setWeekday(saved.weekday ?? 1); setScheduleTime(saved.time);
  }, [saved.enabled, savedTarget, saved.frequency, saved.intervalDays, saved.weekday, saved.time]);
  useEffect(() => {
    if (!running || action.busy) return;
    const timer = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(timer);
  }, [running, action.busy, revalidator]);
  async function create(job?: Job) {
    try {
      const made = await call<Job>(job ? `/admin/backups/${job.id}/retry` : "/admin/backups", { target: job?.target ?? target, maintenanceConfirmed: true });
      if (made.status !== "complete") throw new Error(made.failure?.message ?? "备份未确认成功，请刷新状态后人工重试。");
      action.setMessage(labels[made.target] + "备份完整成功。" + (made.cleanup?.status === "failed" ? "过期清理未全部成功，可单独重试清理。" : ""));
    } finally { revalidator.revalidate(); }
  }
  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    await scheduleAction.run(async () => {
      await call<Status["schedule"]>("/admin/backups/schedule", { enabled: scheduleEnabled, target: scheduleTarget, frequency,
        intervalDays: frequency === "interval" ? intervalDays : null, weekday: frequency === "weekly" ? weekday : null, time: scheduleTime }, undefined, "PUT");
      scheduleAction.setMessage("自动备份设置已保存。"); revalidator.revalidate();
    });
  }
  return <Page narrow>
    <PageHeading><PageHeadingTagline>站长运维 · {state.environment}</PageHeadingTagline><PageHeadingTitle>数据备份。</PageHeadingTitle>
      <PageHeadingDescription>数据库包含成员敏感数据。只提供认证加密文件；媒体仍由本地冷备保管，恢复需要对应的历史认证与备份密钥。</PageHeadingDescription></PageHeading>
    <div className="px-4 py-3 text-sm"><Link to="/admin" className="link-underline">返回管理后台</Link><span className="ml-4 text-muted-foreground">时间均为北京时间</span></div>
    <Separator /><Panel><PanelHeader><PanelTitle>手动备份</PanelTitle></PanelHeader>
      <form className="space-y-4 px-4 py-4" onSubmit={event => { event.preventDefault(); if (confirmed) void action.run(() => create()); }}>
        <fieldset disabled={action.busy || running}><legend className="mb-2 text-sm font-medium">保存目标</legend><div className="flex flex-wrap gap-4">
          {(Object.keys(labels) as BackupTarget[]).map(value => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="target" value={value} checked={target === value} disabled={!state.targets[value]} onChange={() => setTarget(value)} />{labels[value]}{!state.targets[value] && <span className="text-xs text-muted-foreground">未就绪</span>}</label>)}
        </div></fieldset>
        {state.unavailableReason && <p role="status" className="text-sm text-muted-foreground">{state.unavailableReason}</p>}
        <p className="text-sm text-muted-foreground">{state.notice}</p>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已了解查询可能受影响，选择合适时机执行，并独立保管所需密钥。</label>
        <StatusButton type="submit" status={action.busy ? "loading" : "idle"} disabled={!confirmed || running || !state.targets[target]}>创建备份</StatusButton>
      </form>
    </Panel><div className="px-4 py-3">{action.feedback}</div>
    <Separator /><Panel><PanelHeader><PanelTitle>自动备份</PanelTitle></PanelHeader>
      <form className="space-y-4 px-4 py-4" onSubmit={saveSchedule}>
        <p className="text-sm text-muted-foreground">只有配置完整的 WebDAV 或 S3 目标后才能设置并启用。执行时间使用北京时间，Worker 每 5 分钟检查一次，正常到点后约 5 分钟内开始；错过多个时点只执行一次，失败不自动重试。</p>
        <p className="text-sm text-muted-foreground">导出期间成员查询可能暂时不可用，请选择合适的维护时段，并独立保管历史认证与备份密钥。</p>
        {!scheduleReady && <p role="status" className="text-sm text-muted-foreground">当前没有可用的外部备份渠道；直接下载和私有暂存不能启用定时备份。</p>}
        {saved.enabled && !saved.targetReady && <p role="status" className="text-sm text-destructive">已保存的渠道当前不可执行。请修复服务端配置、选择可用渠道，或关闭自动备份。</p>}
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={scheduleEnabled} disabled={scheduleAction.busy || !scheduleReady && !scheduleEnabled} onChange={event => setScheduleEnabled(event.target.checked)} />启用自动备份</label>
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!scheduleReady || scheduleAction.busy}>
          <label className="grid gap-1 text-sm"><span className="font-medium">保存渠道</span><select className="min-h-10 rounded-md border border-input bg-background px-3" value={scheduleTarget} onChange={event => setScheduleTarget(event.target.value as ExternalBackupTarget)}>{(["webdav", "s3"] as ExternalBackupTarget[]).map(value => <option key={value} value={value} disabled={!state.targets[value]}>{labels[value]}{!state.targets[value] ? "（未就绪）" : ""}</option>)}</select></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">频率</span><select className="min-h-10 rounded-md border border-input bg-background px-3" value={frequency} onChange={event => setFrequency(event.target.value as BackupFrequency)}>{(Object.keys(frequencyLabels) as BackupFrequency[]).map(value => <option key={value} value={value}>{frequencyLabels[value]}</option>)}</select></label>
          {frequency === "interval" && <label className="grid gap-1 text-sm"><span className="font-medium">间隔天数</span><input className="min-h-10 rounded-md border border-input bg-background px-3" type="number" required min={1} max={30} value={intervalDays} onChange={event => setIntervalDays(Number(event.target.value))} /></label>}
          {frequency === "weekly" && <label className="grid gap-1 text-sm"><span className="font-medium">每周几</span><select className="min-h-10 rounded-md border border-input bg-background px-3" value={weekday} onChange={event => setWeekday(Number(event.target.value))}>{weekdayLabels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <label className="grid gap-1 text-sm"><span className="font-medium">北京时间</span><input className="min-h-10 rounded-md border border-input bg-background px-3" type="time" required step={60} value={scheduleTime} onChange={event => setScheduleTime(event.target.value)} /></label>
        </fieldset>
        {saved.enabled && saved.nextRunAt && <p className="text-sm text-muted-foreground">下次执行：{time(saved.nextRunAt)} · {labels[saved.target]}</p>}
        {saved.lastRunAt && <p className="text-sm text-muted-foreground">上次执行：{time(saved.lastRunAt)} · {saved.lastStatus === "failed" ? "未完成，请检查记录后人工重试。" : saved.lastStatus === "running" ? "正在执行" : "完整成功"}</p>}
        {saved.failure && <p role="status" className="text-sm text-destructive">{saved.failure.message}</p>}
        <StatusButton type="submit" status={scheduleAction.busy ? "loading" : "idle"} disabled={scheduleEnabled && !state.targets[scheduleTarget]}>保存定时设置</StatusButton>
        {scheduleAction.feedback}
      </form>
    </Panel>
    <Separator /><Panel><PanelHeader className="flex-wrap gap-2"><PanelTitle>备份记录</PanelTitle><Button size="sm" variant="ghost" disabled={action.busy || revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}><RefreshCwIcon />刷新状态</Button></PanelHeader>
      <div className="divide-y divide-line">{state.items.map(job => <article key={job.id} className="space-y-2 px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-medium">{time(job.backupTime ?? job.createdAt)} · {labels[job.target]}</h2><span className="text-xs text-muted-foreground">{job.deleted ? "已按保留策略清理" : job.status === "complete" ? "完整成功" : job.status === "running" ? "正在执行" : "未完成"}</span></div>
        <p className="break-all font-mono text-[11px] text-muted-foreground">{job.id}</p>
        {job.failure && <p role="status" className="text-sm text-destructive">{job.failure.message}</p>}
        {job.r2Deleted && !job.deleted && <p className="text-xs text-muted-foreground">R2 暂存已清理，外部副本按该端保留策略保留。</p>}
        {job.keyId && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">文件与密钥指纹</summary><div className="space-y-1 break-all py-2 font-mono"><p>{job.byteLength?.toLocaleString()} bytes</p><p>Backup: {job.keyId}</p><p>Auth: {job.authKeyId ?? "未记录，恢复前须人工确认"}</p></div></details>}
        {job.cleanup?.status === "failed" && <p className="text-xs text-destructive">备份成功，但过期清理未全部成功，可单独重试。</p>}
        <div className="flex flex-wrap gap-2">{job.downloadReady && <Button variant="outline" size="sm" render={<a href={`/admin/backups/${job.id}/download`} download />}><DownloadIcon />下载加密副本</Button>}
          {job.status === "failed" && !job.r2Deleted && <Button variant="outline" size="sm" disabled={action.busy || running || !confirmed || !state.targets[job.target]} onClick={() => void action.run(() => create(job))}>人工重试</Button>}</div>
      </article>)}{!state.items.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">本环境还没有备份记录。</p>}</div>
      <div className="screen-line-top flex flex-wrap items-center gap-3 px-4 py-3">{state.after && <Link className="link-underline text-sm" to={"/admin/backups?after=" + state.after}>更早记录</Link>}<Link className="link-underline text-sm" to="/admin/backups">最新记录</Link>
        <Button className="ml-auto" variant="ghost" size="sm" disabled={action.busy || running} onClick={() => void action.run(async () => {
          const result = await call<{ status: string; deleted: number }>("/admin/backups/cleanup", {});
          revalidator.revalidate(); if (result.status !== "complete") throw new Error("清理未全部完成；请检查目标配置、历史密钥和存储状态，再人工重试。未完成的副本仍保留。");
          action.setMessage(`清理完成，清理 ${result.deleted} 份过期备份；各端最后一份可恢复副本受保护。`);
        })}>重试过期清理</Button></div>
    </Panel>
    <p className="px-4 py-4 text-xs text-muted-foreground">默认保留 30 天，各端最后一份完整可恢复副本超期保护。缺历史密钥的副本不算可恢复；无法确认保护副本或外部目标已变更时，保守停止相关删除。你下载到本机的文件不由站点清理。</p>
  </Page>;
}
