import { useState } from "react"
import { Link } from "react-router"

import { actions, useStore, type Maintenance } from "@/data/store"
import { Panel, PanelHeader, PanelTitle } from "@/components/site/panel"
import { Field as TitleField } from "@/components/site/site-footer"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tag } from "@/components/ui/tag"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

// Maintenance mode: while the owner has it on (e.g. to restore a backup), everyone else gets this page in place of
// every route, and sign-in, playback and writes stop. The formal site would answer 503 with Retry-After.

const DEFAULT_NOTE = "站长正在维护数据，期间暂停登录、播放和所有操作。维护结束后刷新本页即可。"

const BEIJING = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

function fmtBeijing(iso: string) {
  const p = Object.fromEntries(BEIJING.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.month} 月 ${p.day} 日 ${p.hour}:${p.minute}`
}

/** Title-block cells; the caller draws the rules above and below, since the cells cover any drawn inside the grid. */
function MaintenanceTimes({ maintenance }: { maintenance: Maintenance }) {
  return (
    <dl className="grid grid-cols-2 gap-px bg-line font-mono">
      <TitleField label="开始于（北京时间）">{fmtBeijing(maintenance.since)}</TitleField>
      <TitleField label="预计恢复（北京时间）">{maintenance.until ? fmtBeijing(maintenance.until) : "未定"}</TitleField>
    </dl>
  )
}

export function MaintenancePage({ maintenance }: { maintenance: Maintenance }) {
  return (
    <div data-width="narrow" className="mx-auto flex w-full flex-1 flex-col border-x md:max-w-(--content-width)">
      <section className="screen-line-bottom flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <p className="font-mono text-sm tracking-wider text-muted-foreground">503 · 维护中</p>
        <h1 className="font-heading text-4xl font-medium tracking-tight text-balance">档案馆正在维护.</h1>
        <p className="max-w-md text-pretty text-muted-foreground">{maintenance.note || DEFAULT_NOTE}</p>
      </section>
      <MaintenanceTimes maintenance={maintenance} />
      <div className="screen-line-top flex justify-center py-4">
        <Button variant="outline" onClick={() => location.reload()}>
          刷新
        </Button>
      </div>
    </div>
  )
}

/** Reminds the owner, the only one still let in, that everyone else is locked out. */
export function MaintenanceBanner() {
  return (
    <div className="mx-auto border-x md:max-w-(--content-width)">
      <p role="status" className="screen-line-bottom flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <Tag className="text-destructive">维护模式</Tag>
        <span className="text-muted-foreground">除你以外，所有人现在看到的都是维护页。</span>
        <Link to="/admin/backups" className="link-underline ml-auto">
          前往结束
        </Link>
      </p>
    </div>
  )
}

/** The owner's switch, on the backups page next to the restore it guards. */
export function MaintenancePanel() {
  const maintenance = useStore((s) => s.maintenance)
  const [until, setUntil] = useState("")
  const [note, setNote] = useState("")
  const [confirming, setConfirming] = useState(false)

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>维护模式</PanelTitle>
        {maintenance ? <Tag className="text-destructive">已开启</Tag> : <Tag>未开启</Tag>}
      </PanelHeader>
      {maintenance ? (
        <>
          <p className="screen-line-bottom p-4 text-sm text-pretty text-muted-foreground">
            除你以外，所有访问都显示维护页。给成员的说明：{maintenance.note || DEFAULT_NOTE}
          </p>
          <MaintenanceTimes maintenance={maintenance} />
          <div className="screen-line-top p-4">
            <Button
              onClick={() => {
                actions.endMaintenance()
                toast.add({ title: "维护模式已结束", type: "success" })
              }}
            >
              结束维护
            </Button>
          </div>
        </>
      ) : (
        <form
          className="p-4"
          onSubmit={(e) => {
            e.preventDefault()
            setConfirming(true)
          }}
        >
          <FieldGroup>
            <p className="text-sm text-pretty text-muted-foreground">
              开启后，除你以外的所有访问都显示维护页，登录、播放和各种写入一并暂停。恢复备份前先开启，确认数据无误后再结束。
            </p>
            <Field>
              <FieldLabel htmlFor="maintenance-until">预计恢复时间</FieldLabel>
              <Input id="maintenance-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
              <FieldDescription>北京时间，可以留空。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="maintenance-note">给成员的说明</FieldLabel>
              <Textarea id="maintenance-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={DEFAULT_NOTE} />
              <FieldDescription>留空时显示上面的默认说明。</FieldDescription>
            </Field>
            <div>
              <Button type="submit" variant="destructive">
                开启维护模式
              </Button>
            </div>
          </FieldGroup>
        </form>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>开启维护模式？</DialogTitle>
            <DialogDescription>在线成员的下一个请求就会看到维护页，正在播放的视频会在已缓冲的部分播完后停止。维护结束后记得回到这里关闭。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                // datetime-local carries no zone; the field is labelled Beijing time.
                actions.startMaintenance({ since: new Date().toISOString(), until: until && new Date(`${until}:00+08:00`).toISOString(), note: note.trim() })
                setConfirming(false)
              }}
            >
              开启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
