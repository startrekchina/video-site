import { TicketIcon } from "lucide-react"
import { Link } from "react-router"

import { Page, PageHeading, PageHeadingTagline, PageHeadingTitle, Panel, PanelHeader, PanelTitle, Separator } from "@/components/site/panel"
import { Button } from "@/components/ui/button"
import { Tag } from "@/components/ui/tag"

// Variant C (站长来信): a narrow, text-led page. A short signed letter explains what the place is
// and the few rules, then a dated site log shows it is alive. Copy and log entries are placeholders
// for the site owner to rewrite.

const LOG = [
  { date: "2026-10", text: "v1 开放：通行密钥登录、中英字幕切换、跨设备续播、片单。" },
  { date: "2026-09", text: "内测：第一批成员入驻，修好了一批播放和字幕的问题。" },
  { date: "2026-06", text: "开始搭建。" },
]

export function GuestLetter() {
  return (
    <Page narrow>
      <PageHeading>
        <PageHeadingTagline>致收到邀请的你</PageHeadingTagline>
        <PageHeadingTitle>欢迎来到星际舰队档案馆。</PageHeadingTitle>
      </PageHeading>
      <div className="screen-line-bottom flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 font-mono text-xs text-muted-foreground">
        <span>站长 station_keeper</span>
        <span>写于 2026-10-02</span>
        <span>约 2 分钟读完</span>
      </div>

      <article className="typeset px-4 pt-2 pb-8">
        <p>这里是一个很小的地方。</p>
        <p>
          我们这群《星际迷航》的中文观众，一直苦于观看渠道分散，中文字幕和中文资料也总是不全，看到哪一集全凭记性。档案馆想做的就是这件事：在同一个地方，按自己的节奏看下去，配好中英文字幕，记住每个人看到了哪里。
        </p>
        <p>
          这里不对外开放。没有公开注册，不接受申请，也不会出现在搜索引擎里。每一位成员都是被朋友邀请进来的，所以请像对待朋友家的客厅一样对待这里：账号只给自己用，邀请只发给信得过的人。你邀请的人违反守则时，你也可能被连带处理。
        </p>
        <p>
          我们不收集邮箱和手机号，不放广告，也不装第三方统计。注册时你会拿到一组恢复码，那是自己找回账号的唯一凭证，请务必存好。
        </p>
        <p>站点是业余时间维护的，难免有不周到的地方。遇到问题，告诉邀请你的人，或者直接告诉我。</p>
        <p>祝观影愉快。</p>
        <p className="text-right font-mono text-sm text-muted-foreground">— 站长</p>
      </article>

      <div className="screen-line-top screen-line-bottom flex flex-wrap items-center justify-center gap-3 px-4 py-6">
        <Button size="lg" nativeButton={false} render={<Link to="/register" />}>
          <TicketIcon data-icon="inline-start" />
          我有邀请码
        </Button>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link to="/login" />}>
          已是成员，登录
        </Button>
      </div>

      <Separator />

      <Panel>
        <PanelHeader className="items-center">
          <PanelTitle>航行日志</PanelTitle>
          <Tag>示例</Tag>
        </PanelHeader>
        <ol className="divide-y divide-line">
          {LOG.map((e) => (
            <li key={e.date} className="flex gap-4 p-4">
              <span className="shrink-0 font-mono text-sm text-muted-foreground tabular-nums">{e.date}</span>
              <span className="text-pretty">{e.text}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </Page>
  )
}
