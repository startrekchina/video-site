import { HeadingGap, Page, PageHeading, PageHeadingTagline, PageHeadingTitle } from "@/components/site/panel"

import { Dashboard } from "./dashboard"

// Public status board, reachable signed in or out, over fictional telemetry.

export function StatusPage() {
  return (
    <Page>
      <PageHeading>
        <PageHeadingTagline>运行状态</PageHeadingTagline>
        <PageHeadingTitle>查看档案馆的近期运行数据.</PageHeadingTitle>
      </PageHeading>
      <HeadingGap />
      <Dashboard />
    </Page>
  )
}
