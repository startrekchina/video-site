import { useEffect, useState, type FormEvent } from "react";
import { data, Link, useRevalidator, useSearchParams } from "react-router";
import { ArchiveIcon, DownloadIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import type { Route } from "./+types/backups";
import { backupStatus, isBackupOwner, type BackupFrequency } from "@/lib/backups.server";
import { pageMember } from "@/lib/member.server";
import type { BackupTarget, ExternalBackupTarget } from "@/lib/backup-targets.server";
import { call } from "@/lib/auth-client";
import { pageTitle } from "@/lib/site";
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusButton } from "@/components/ui/status-button";
import { Tag } from "@/components/ui/tag";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const labels: Record<BackupTarget, string> = { download: "加密下载", webdav: "WebDAV", s3: "S3" };
const environments: Record<string, string> = { development: "本地开发", test: "测试", staging: "测试站", production: "正式站" };
type Status = Awaited<ReturnType<typeof backupStatus>>;
type Job = Status["items"][number];
const frequencyLabels: Record<BackupFrequency, string> = { daily: "每天", weekly: "每周", interval: "每隔几天" };
const weekdayItems = ([[1, "周一"], [2, "周二"], [3, "周三"], [4, "周四"], [5, "周五"], [6, "周六"], [0, "周日"]] as const).map(([value, label]) => ({ value: value as number, label }));
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env, current = await pageMember(request, env, context.identity);
  if (!isBackupOwner(current.member, env)) throw data({ message: "仅本站站长可访问备份。" }, { status: 403, headers: current.headers });
  return data(await backupStatus(env, new URL(request.url).searchParams.get("after")), { headers: current.headers });
}
export const meta = () => pageTitle("数据备份");
// sv-SE yields "2026-10-17 14:30".
const time = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format;
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function JobStatus({ job }: { job: Job }) {
  if (job.deleted) return <Tag>已过期清理</Tag>;
  if (job.status === "complete") return <Tag className="text-success">成功</Tag>;
  if (job.status === "running") return <Tag>进行中</Tag>;
  return <Tag className="text-destructive">失败</Tag>;
}

export default function BackupsPage({ loaderData: state }: Route.ComponentProps) {
  const revalidator = useRevalidator(), [params] = useSearchParams();
  const saved = state.schedule, savedTarget = saved.updatedAt || state.targets[saved.target] ? saved.target : state.targets.s3 ? "s3" : "webdav";
  const [target, setTarget] = useState<BackupTarget>("download"), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  // undefined: no dialog; null: a new backup; a job: retrying that job.
  const [confirming, setConfirming] = useState<Job | null | undefined>();
  const [scheduleEnabled, setScheduleEnabled] = useState(state.schedule.enabled), [scheduleTarget, setScheduleTarget] = useState<ExternalBackupTarget>(savedTarget);
  const [frequency, setFrequency] = useState<BackupFrequency>(state.schedule.frequency), [intervalDays, setIntervalDays] = useState(state.schedule.intervalDays ?? 7);
  const [weekday, setWeekday] = useState(state.schedule.weekday ?? 1), [scheduleTime, setScheduleTime] = useState(state.schedule.time);
  const running = state.schedule.lastStatus === "running" || state.items.some(job => job.status === "running");
  const scheduleReady = state.targets.webdav || state.targets.s3;
  const targetItems = (["webdav", "s3"] as ExternalBackupTarget[]).map(value => ({ value, label: labels[value] + (state.targets[value] ? "" : "（未配置）") }));
  useEffect(() => {
    setScheduleEnabled(saved.enabled); setScheduleTarget(savedTarget); setFrequency(saved.frequency);
    setIntervalDays(saved.intervalDays ?? 7); setWeekday(saved.weekday ?? 1); setScheduleTime(saved.time);
  }, [saved.enabled, savedTarget, saved.frequency, saved.intervalDays, saved.weekday, saved.time]);
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(timer);
  }, [running, busy, revalidator]);
  async function start() {
    if (confirming === undefined || busy) return;
    const job = confirming; setBusy(true);
    try {
      const made = await call<Job>(job ? `/admin/backups/${job.id}/retry` : "/admin/backups", { target: job?.target ?? target, maintenanceConfirmed: true });
      if (made.status !== "complete") toast.add({ title: made.failure?.message ?? "备份没有完成。", type: "error" });
      else toast.add({ title: (made.target === "download" ? "备份完成。" : `已备份到 ${labels[made.target]}。`) + (made.cleanup?.status === "failed" ? "过期清理未全部完成。" : ""), type: "success" });
    } catch (error) { toast.add({ title: message(error, "备份没有完成。"), type: "error" }); }
    finally { setBusy(false); setConfirming(undefined); revalidator.revalidate(); }
  }
  async function cleanup() {
    setBusy(true);
    try {
      const result = await call<{ status: string; deleted: number }>("/admin/backups/cleanup", {});
      if (result.status === "complete") toast.add({ title: result.deleted ? `清理完成，删除了 ${result.deleted} 份过期备份。` : "没有需要清理的过期备份。", type: "success" });
      else toast.add({ title: "清理未全部完成，请检查保存位置配置和历史密钥。", type: "error" });
    } catch (error) { toast.add({ title: message(error, "清理没有完成。"), type: "error" }); }
    finally { setBusy(false); revalidator.revalidate(); }
  }
  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await call<Status["schedule"]>("/admin/backups/schedule", { enabled: scheduleEnabled, target: scheduleTarget, frequency,
        intervalDays: frequency === "interval" ? intervalDays : null, weekday: frequency === "weekly" ? weekday : null, time: scheduleTime }, undefined, "PUT");
      toast.add({ title: "自动备份设置已保存。", type: "success" }); revalidator.revalidate();
    } catch (error) { toast.add({ title: message(error, "设置没有保存。"), type: "error" }); }
    finally { setSaving(false); }
  }
  const after = params.get("after");
  return <Page narrow>
    <PageHeading><PageHeadingTagline>站长运维 · {environments[state.environment] ?? state.environment}</PageHeadingTagline><PageHeadingTitle>数据备份.</PageHeadingTitle>
      <PageHeadingDescription>备份不含媒体文件，时间均为北京时间。恢复需要备份当时的认证密钥和备份密钥。</PageHeadingDescription></PageHeading>
    <div className="px-4 py-3 text-sm"><Link to="/admin" className="link-underline">返回管理后台</Link></div>
    <Separator /><Panel><PanelHeader><PanelTitle>手动备份</PanelTitle></PanelHeader>
      <div className="space-y-4 p-4">
        <Field><FieldLabel>保存位置</FieldLabel>
          <ToggleGroup aria-label="保存位置" value={[target]} onValueChange={value => value[0] && setTarget(value[0] as BackupTarget)} variant="outline" className="w-full" disabled={busy || running}>
            {(Object.keys(labels) as BackupTarget[]).map(value => <ToggleGroupItem key={value} value={value} disabled={!state.targets[value]} className="flex-1">{labels[value]}</ToggleGroupItem>)}
          </ToggleGroup>
        </Field>
        {state.unavailableReason && <p role="status" className="text-sm text-destructive">{state.unavailableReason}</p>}
        {running && <p role="status" className="text-sm text-muted-foreground">有备份正在进行。</p>}
        <Button disabled={busy || running || !state.targets[target]} onClick={() => setConfirming(null)}>创建备份</Button>
      </div>
    </Panel>
    <Separator /><Panel><PanelHeader><PanelTitle>自动备份</PanelTitle></PanelHeader>
      <form className="space-y-4 p-4" onSubmit={saveSchedule}>
        <p className="text-sm text-muted-foreground">导出期间成员查询可能暂时不可用，建议选在访问较少的时段。</p>
        {!scheduleReady && !saved.enabled ? <p role="status" className="text-sm">尚未配置 WebDAV 或 S3，不能开启自动备份。</p> : <>
          {saved.enabled && !saved.targetReady && <p role="status" className="text-sm text-destructive">已保存的渠道当前不可执行，请改选可用渠道或关闭自动备份。</p>}
          <Field orientation="horizontal"><Checkbox id="schedule-enabled" checked={scheduleEnabled} disabled={saving || !scheduleReady && !scheduleEnabled} onCheckedChange={setScheduleEnabled} />
            <FieldLabel htmlFor="schedule-enabled">启用自动备份</FieldLabel></Field>
          <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!scheduleReady || saving}>
            <Field><FieldLabel htmlFor="schedule-target">保存渠道</FieldLabel>
              <Select items={targetItems} value={scheduleTarget} onValueChange={value => value && setScheduleTarget(value)} disabled={!scheduleReady || saving}>
                <SelectTrigger id="schedule-target" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{targetItems.map(item => <SelectItem key={item.value} value={item.value} disabled={!state.targets[item.value]}>{item.label}</SelectItem>)}</SelectContent>
              </Select></Field>
            <Field><FieldLabel htmlFor="schedule-time">时间（北京时间）</FieldLabel><Input id="schedule-time" type="time" required step={60} value={scheduleTime} onChange={event => setScheduleTime(event.target.value)} /></Field>
            <Field className="sm:col-span-2"><FieldLabel>频率</FieldLabel>
              <ToggleGroup aria-label="频率" value={[frequency]} onValueChange={value => value[0] && setFrequency(value[0] as BackupFrequency)} variant="outline" className="w-full">
                {(Object.keys(frequencyLabels) as BackupFrequency[]).map(value => <ToggleGroupItem key={value} value={value} className="flex-1">{frequencyLabels[value]}</ToggleGroupItem>)}
              </ToggleGroup></Field>
            {frequency === "weekly" && <Field><FieldLabel htmlFor="schedule-weekday">星期</FieldLabel>
              <Select items={weekdayItems} value={weekday} onValueChange={value => value !== null && setWeekday(value)} disabled={!scheduleReady || saving}>
                <SelectTrigger id="schedule-weekday" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{weekdayItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select></Field>}
            {frequency === "interval" && <Field><FieldLabel htmlFor="schedule-interval">间隔天数（1–30）</FieldLabel><Input id="schedule-interval" type="number" required min={1} max={30} value={intervalDays} onChange={event => setIntervalDays(Number(event.target.value))} /></Field>}
          </fieldset>
          {(saved.enabled && saved.nextRunAt || saved.lastRunAt) && <dl className="grid gap-1 text-sm">
            {saved.enabled && saved.nextRunAt && <div><dt className="inline text-muted-foreground">下次执行 </dt><dd className="inline">{time(saved.nextRunAt)} · {labels[saved.target]}</dd></div>}
            {saved.lastRunAt && <div><dt className="inline text-muted-foreground">上次执行 </dt><dd className="inline">{time(saved.lastRunAt)} · {saved.lastStatus === "failed" ? "失败" : saved.lastStatus === "running" ? "进行中" : "成功"}</dd></div>}
          </dl>}
          {saved.failure && <p role="status" className="text-sm text-destructive">{saved.failure.message}</p>}
          <StatusButton type="submit" status={saving ? "loading" : "idle"} disabled={scheduleEnabled && !state.targets[scheduleTarget]}>保存设置</StatusButton>
        </>}
      </form>
    </Panel>
    <Separator /><Panel><PanelHeader><PanelTitle>备份记录</PanelTitle><Button size="sm" variant="ghost" disabled={busy || revalidator.state !== "idle"} onClick={() => revalidator.revalidate()}><RefreshCwIcon />刷新</Button></PanelHeader>
      {!state.items.length ? <Empty className="rounded-none py-12"><EmptyHeader><EmptyMedia variant="icon"><ArchiveIcon /></EmptyMedia><EmptyTitle>还没有备份记录</EmptyTitle></EmptyHeader></Empty>
        : <div className="divide-y divide-line">{state.items.map(job => <article key={job.id} className="space-y-1.5 p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><h2 className="text-sm font-medium">{time(job.backupTime ?? job.createdAt)}</h2><span className="text-sm text-muted-foreground">{labels[job.target]}</span><JobStatus job={job} /></div>
            {(job.downloadReady || job.status === "failed" && !job.r2Deleted) && <div className="flex gap-2">
              {job.downloadReady && <Button variant="outline" size="sm" render={<a href={`/admin/backups/${job.id}/download`} download />}><DownloadIcon />下载</Button>}
              {job.status === "failed" && !job.r2Deleted && <Button variant="outline" size="sm" disabled={busy || running || !state.targets[job.target]} onClick={() => setConfirming(job)}><RotateCcwIcon />重试</Button>}
            </div>}
          </div>
          {job.failure && <p role="status" className="text-sm text-destructive">{job.failure.message}</p>}
          {job.r2Deleted && !job.deleted && <p className="text-sm text-muted-foreground">站内加密文件已过期清理。</p>}
          {job.cleanup?.status === "failed" && <p className="text-sm text-muted-foreground">过期清理未全部完成。</p>}
          <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer py-0.5">详细信息</summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 font-mono [&_dd]:break-all">
              <dt>任务 ID</dt><dd>{job.id}</dd>
              {job.byteLength != null && <><dt>文件大小</dt><dd>{job.byteLength.toLocaleString()} 字节</dd></>}
              {job.keyId && <><dt>备份密钥</dt><dd>{job.keyId}</dd><dt>认证密钥</dt><dd>{job.authKeyId ?? "未记录，恢复前须人工确认"}</dd></>}
            </dl></details>
        </article>)}</div>}
      {(state.after || after) && <div className="screen-line-top flex flex-wrap gap-4 px-4 py-3 text-sm">
        {after && <Link className="link-underline" to="/admin/backups">回到最新</Link>}{state.after && <Link className="link-underline" to={"/admin/backups?after=" + state.after}>更早的记录</Link>}</div>}
    </Panel>
    <Separator /><Panel><PanelHeader><PanelTitle>过期清理</PanelTitle><Button size="sm" variant="outline" disabled={busy || running} onClick={() => void cleanup()}>立即清理</Button></PanelHeader>
      <p className="p-4 text-sm text-muted-foreground">备份保留 30 天，每次备份后自动清理；每个保存位置至少保留最后一份可恢复的副本。</p>
    </Panel>
    <Dialog open={confirming !== undefined} onOpenChange={open => { if (!open && !busy) setConfirming(undefined); }}><DialogContent showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{confirming ? "重试这次备份？" : "开始备份？"}</DialogTitle>
        <DialogDescription>保存到 {labels[confirming?.target ?? target]}。导出期间成员查询可能暂时不可用，请保持本页打开直到完成。</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirming(undefined)}>取消</Button>
        <StatusButton status={busy ? "loading" : "idle"} onClick={() => void start()}>{confirming ? "重试" : "开始备份"}</StatusButton></DialogFooter>
    </DialogContent></Dialog>
  </Page>;
}
