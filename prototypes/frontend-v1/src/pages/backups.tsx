import { useState, type FormEvent } from "react"
import { ArchiveIcon, DownloadIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react"
import { Link, Navigate, useSearchParams } from "react-router"

import { useStore, type Member } from "@/data/store"
import { expiredJobs, updateSchedule, type External, type Frequency, type Job, type Schedule, type Target } from "@/data/backups"
import { fakeLatency } from "@/lib/utils"
import { Page, PageHeading, PageHeadingDescription, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { StatusButton } from "@/components/ui/status-button"
import { Tag } from "@/components/ui/tag"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MaintenancePanel } from "@/pages/maintenance"

// Owner backup page backfilled from the formal app for design review. Exports, uploads and files are simulated;
// ?demo=empty shows a site without WebDAV/S3 and no records, ?demo=invalid a saved schedule whose channel broke.

const labels: Record<Target, string> = { download: "加密下载", webdav: "WebDAV", s3: "S3" }
const frequencyLabels: Record<Frequency, string> = { daily: "每天", weekly: "每周", interval: "每隔几天" }
const weekdayLabels = [[1, "周一"], [2, "周二"], [3, "周三"], [4, "周四"], [5, "周五"], [6, "周六"], [0, "周日"]] as const
// Native selects keep the Input look so the form reads as one control set.
const select =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
// sv-SE yields "2026-10-17 14:30".
const time = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format
const at = (beijing: string) => Date.parse(`${beijing}+08:00`)

/** Prototype: the root admin stands in for the site owner, the only account that sees backups. */
export const isBackupOwner = (me: Member | null) => me?.username === "station_keeper"

const JOBS: Job[] = [
  { id: "20261017-0300-webdav", target: "webdav", createdAt: at("2026-10-17T03:00"), status: "complete", downloadReady: true, byteLength: 752_640, keyId: "bk-2026-09", authKeyId: "auth-2026-06" },
  { id: "20261016-2112-download", target: "download", createdAt: at("2026-10-16T21:12"), status: "complete", downloadReady: true, cleanupFailed: true, byteLength: 751_872, keyId: "bk-2026-09", authKeyId: "auth-2026-06" },
  { id: "20261015-0300-webdav", target: "webdav", createdAt: at("2026-10-15T03:00"), status: "failed", failure: "上传或回读校验失败，加密文件已保留。", downloadReady: true, byteLength: 750_336, keyId: "bk-2026-09", authKeyId: "auth-2026-06" },
  { id: "20261014-2005-download", target: "download", createdAt: at("2026-10-14T20:05"), status: "failed", failure: "数据库导出失败。", downloadReady: false },
  { id: "20260920-0300-s3", target: "s3", createdAt: at("2026-09-20T03:00"), status: "complete", downloadReady: false, r2Deleted: true, byteLength: 731_008, keyId: "bk-2026-06" },
  { id: "20260908-0300-download", target: "download", createdAt: at("2026-09-08T03:00"), status: "complete", downloadReady: false, r2Deleted: true, deleted: true, byteLength: 728_448, keyId: "bk-2026-06", authKeyId: "auth-2026-06" },
]

function demoState(demo: string | null): { targets: Record<Target, boolean>; schedule: Schedule; jobs: Job[] } {
  const schedule: Schedule = { enabled: true, target: "webdav", frequency: "weekly", intervalDays: 7, weekday: 6, time: "03:00", nextRunAt: at("2026-10-24T03:00"), lastRunAt: at("2026-10-17T03:00"), lastStatus: "complete" }
  if (demo === "empty") return { targets: { download: true, webdav: false, s3: false }, schedule: { ...schedule, enabled: false, nextRunAt: undefined, lastRunAt: undefined, lastStatus: undefined }, jobs: [] }
  if (demo === "invalid") return { targets: { download: true, webdav: false, s3: false }, schedule: { ...schedule, lastStatus: "failed", failure: "保存渠道或导出配置失效，本次没有执行。" }, jobs: JOBS }
  return { targets: { download: true, webdav: true, s3: false }, schedule, jobs: JOBS }
}

function JobStatus({ job }: { job: Job }) {
  if (job.deleted) return <Tag>已过期清理</Tag>
  if (job.status === "complete") return <Tag className="text-success">成功</Tag>
  if (job.status === "running") return <Tag>进行中</Tag>
  return <Tag className="text-destructive">失败</Tag>
}

export function BackupsPage() {
  const [params] = useSearchParams()
  // Remount per demo state so PROTO console jumps between ?demo= values start fresh.
  return <BackupsView key={params.get("demo") ?? ""} demo={params.get("demo")} />
}

function BackupsView({ demo }: { demo: string | null }) {
  const me = useStore((s) => s.me)
  const [{ targets, schedule: initialSchedule, jobs: initialJobs }] = useState(() => demoState(demo))
  const [jobs, setJobs] = useState(initialJobs)
  const [saved, setSaved] = useState(initialSchedule)
  const [target, setTarget] = useState<Target>("download")
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  // undefined: no dialog; null: a new backup; a job: retrying that job.
  const [confirming, setConfirming] = useState<Job | null | undefined>()
  const [scheduleEnabled, setScheduleEnabled] = useState(saved.enabled)
  const [scheduleTarget, setScheduleTarget] = useState<External>(saved.target)
  const [frequency, setFrequency] = useState<Frequency>(saved.frequency)
  const [intervalDays, setIntervalDays] = useState(saved.intervalDays)
  const [weekday, setWeekday] = useState(saved.weekday)
  const [scheduleTime, setScheduleTime] = useState(saved.time)
  const running = jobs.some((job) => job.status === "running")
  const scheduleReady = targets.webdav || targets.s3

  async function start() {
    if (confirming === undefined || busy) return
    const job = confirming
    setBusy(true)
    await fakeLatency(1800)
    const made: Job = { ...(job ?? { id: `demo-${jobs.length + 1}`, target, createdAt: Date.now(), byteLength: 753_083, keyId: "bk-2026-09", authKeyId: "auth-2026-06" }), status: "complete", failure: undefined, downloadReady: true }
    setJobs(job ? jobs.map((item) => (item.id === job.id ? made : item)) : [made, ...jobs])
    toast.add({ title: made.target === "download" ? "备份完成。" : `已备份到 ${labels[made.target]}。`, type: "success" })
    setBusy(false)
    setConfirming(undefined)
  }

  async function cleanup() {
    setBusy(true)
    await fakeLatency()
    const expired = expiredJobs(jobs, Date.now())
    setJobs(jobs.map((job) => (expired.includes(job) ? { ...job, deleted: true, r2Deleted: true, downloadReady: false } : job)))
    toast.add({ title: expired.length ? `清理完成，删除了 ${expired.length} 份过期备份。` : "没有需要清理的过期备份。", type: "success" })
    setBusy(false)
  }

  async function refresh() {
    setBusy(true)
    await fakeLatency(400)
    setBusy(false)
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    await fakeLatency()
    setSaved(updateSchedule(saved, { enabled: scheduleEnabled, target: scheduleTarget, frequency, intervalDays, weekday, time: scheduleTime }, Date.now()))
    toast.add({ title: "自动备份设置已保存。", type: "success" })
    setSaving(false)
  }

  if (!isBackupOwner(me)) return <Navigate to="/admin" replace />

  return (
    <Page narrow>
      <PageHeading>
        <PageHeadingTagline>站长运维 · 正式站</PageHeadingTagline>
        <PageHeadingTitle>数据备份.</PageHeadingTitle>
        <PageHeadingDescription>备份不含媒体文件，时间均为北京时间。恢复需要备份当时的认证密钥和备份密钥。</PageHeadingDescription>
      </PageHeading>
      <div className="px-4 py-3 text-sm">
        <Link to="/admin" className="link-underline">
          返回管理后台
        </Link>
      </div>

      <Separator />
      <MaintenancePanel />

      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>手动备份</PanelTitle>
        </PanelHeader>
        <div className="space-y-4 p-4">
          <Field>
            <FieldLabel>保存位置</FieldLabel>
            <ToggleGroup aria-label="保存位置" value={[target]} onValueChange={(v) => v[0] && setTarget(v[0] as Target)} variant="outline" className="w-full" disabled={busy || running}>
              {(Object.keys(labels) as Target[]).map((value) => (
                <ToggleGroupItem key={value} value={value} disabled={!targets[value]} className="flex-1">
                  {labels[value]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          {running && (
            <p role="status" className="text-sm text-muted-foreground">
              有备份正在进行。
            </p>
          )}
          <Button disabled={busy || running || !targets[target]} onClick={() => setConfirming(null)}>
            创建备份
          </Button>
        </div>
      </Panel>

      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>自动备份</PanelTitle>
        </PanelHeader>
        <form className="space-y-4 p-4" onSubmit={saveSchedule}>
          <p className="text-sm text-muted-foreground">导出期间成员查询可能暂时不可用，建议选在访问较少的时段。</p>
          {!scheduleReady && !saved.enabled ? (
            <p role="status" className="text-sm">
              尚未配置 WebDAV 或 S3，不能开启自动备份。
            </p>
          ) : (
            <>
              {saved.enabled && !targets[saved.target] && (
                <p role="status" className="text-sm text-destructive">
                  已保存的渠道当前不可执行，请改选可用渠道或关闭自动备份。
                </p>
              )}
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  className="size-4 accent-foreground"
                  type="checkbox"
                  checked={scheduleEnabled}
                  disabled={saving || (!scheduleReady && !scheduleEnabled)}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                />
                启用自动备份
              </label>
              <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!scheduleReady || saving}>
                <Field>
                  <FieldLabel htmlFor="schedule-target">保存渠道</FieldLabel>
                  <select id="schedule-target" className={select} value={scheduleTarget} onChange={(e) => setScheduleTarget(e.target.value as External)}>
                    {(["webdav", "s3"] as External[]).map((value) => (
                      <option key={value} value={value} disabled={!targets[value]}>
                        {labels[value]}
                        {!targets[value] ? "（未配置）" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="schedule-time">时间（北京时间）</FieldLabel>
                  <Input id="schedule-time" type="time" required step={60} value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel>频率</FieldLabel>
                  <ToggleGroup aria-label="频率" value={[frequency]} onValueChange={(v) => v[0] && setFrequency(v[0] as Frequency)} variant="outline" className="w-full">
                    {(Object.keys(frequencyLabels) as Frequency[]).map((value) => (
                      <ToggleGroupItem key={value} value={value} className="flex-1">
                        {frequencyLabels[value]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                {frequency === "weekly" && (
                  <Field>
                    <FieldLabel htmlFor="schedule-weekday">星期</FieldLabel>
                    <select id="schedule-weekday" className={select} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                      {weekdayLabels.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {frequency === "interval" && (
                  <Field>
                    <FieldLabel htmlFor="schedule-interval">间隔天数（1–30）</FieldLabel>
                    <Input id="schedule-interval" type="number" required min={1} max={30} value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))} />
                  </Field>
                )}
              </fieldset>
              {((saved.enabled && saved.nextRunAt) || saved.lastRunAt) && (
                <dl className="grid gap-1 text-sm">
                  {saved.enabled && saved.nextRunAt && (
                    <div>
                      <dt className="inline text-muted-foreground">下次执行 </dt>
                      <dd className="inline">
                        {time(saved.nextRunAt)} · {labels[saved.target]}
                      </dd>
                    </div>
                  )}
                  {saved.lastRunAt && (
                    <div>
                      <dt className="inline text-muted-foreground">上次执行 </dt>
                      <dd className="inline">
                        {time(saved.lastRunAt)} · {saved.lastStatus === "failed" ? "失败" : "成功"}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {saved.failure && (
                <p role="status" className="text-sm text-destructive">
                  {saved.failure}
                </p>
              )}
              <StatusButton type="submit" status={saving ? "loading" : "idle"} disabled={scheduleEnabled && !targets[scheduleTarget]}>
                保存设置
              </StatusButton>
            </>
          )}
        </form>
      </Panel>

      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>备份记录</PanelTitle>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
            <RefreshCwIcon />
            刷新
          </Button>
        </PanelHeader>
        {!jobs.length ? (
          <Empty className="rounded-none py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ArchiveIcon />
              </EmptyMedia>
              <EmptyTitle>还没有备份记录</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y divide-line">
            {jobs.map((job) => (
              <article key={job.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium">{time(job.createdAt)}</h2>
                    <span className="text-sm text-muted-foreground">{labels[job.target]}</span>
                    <JobStatus job={job} />
                  </div>
                  {(job.downloadReady || (job.status === "failed" && !job.r2Deleted)) && (
                    <div className="flex gap-2">
                      {job.downloadReady && (
                        <Button variant="outline" size="sm" onClick={() => toast.add({ title: "原型不生成备份文件。" })}>
                          <DownloadIcon />
                          下载
                        </Button>
                      )}
                      {job.status === "failed" && !job.r2Deleted && (
                        <Button variant="outline" size="sm" disabled={busy || running || !targets[job.target]} onClick={() => setConfirming(job)}>
                          <RotateCcwIcon />
                          重试
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {job.failure && (
                  <p role="status" className="text-sm text-destructive">
                    {job.failure}
                  </p>
                )}
                {job.r2Deleted && !job.deleted && <p className="text-sm text-muted-foreground">站内加密文件已过期清理。</p>}
                {job.cleanupFailed && <p className="text-sm text-muted-foreground">过期清理未全部完成。</p>}
                <details className="text-xs text-muted-foreground">
                  <summary className="w-fit cursor-pointer py-0.5">详细信息</summary>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 font-mono [&_dd]:break-all">
                    <dt>任务 ID</dt>
                    <dd>{job.id}</dd>
                    {job.byteLength != null && (
                      <>
                        <dt>文件大小</dt>
                        <dd>{job.byteLength.toLocaleString()} 字节</dd>
                      </>
                    )}
                    {job.keyId && (
                      <>
                        <dt>备份密钥</dt>
                        <dd>{job.keyId}</dd>
                        <dt>认证密钥</dt>
                        <dd>{job.authKeyId ?? "未记录，恢复前须人工确认"}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Separator />
      <Panel>
        <PanelHeader>
          <PanelTitle>过期清理</PanelTitle>
          <Button size="sm" variant="outline" disabled={busy || running} onClick={() => void cleanup()}>
            立即清理
          </Button>
        </PanelHeader>
        <p className="p-4 text-sm text-muted-foreground">备份保留 30 天，每次备份后自动清理；每个保存位置至少保留最后一份可恢复的副本。</p>
      </Panel>

      <Dialog open={confirming !== undefined} onOpenChange={(open) => !open && !busy && setConfirming(undefined)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{confirming ? "重试这次备份？" : "开始备份？"}</DialogTitle>
            <DialogDescription>保存到 {labels[confirming?.target ?? target]}。导出期间成员查询可能暂时不可用，请保持本页打开直到完成。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(undefined)}>
              取消
            </Button>
            <StatusButton status={busy ? "loading" : "idle"} onClick={() => void start()}>
              {confirming ? "重试" : "开始备份"}
            </StatusButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
