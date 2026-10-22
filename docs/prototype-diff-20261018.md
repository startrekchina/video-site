# 前端原型与正式工程差异：标题句号、原型浮标、公开看板（2026-10-18）

**结论：这批原型改动分三项。标题句号可以直接改到正式工程。原型浮标只属于原型，不迁移。公开看板的界面可以基本照搬，但需求文档 A/B 还没有这个页面，要先确认需求，并把虚构数据换成服务端读取 Cloudflare 数据，才能迁移。**

## 比对基点

- 原型：分支 `feat/status-board-prototype`，基于 `frontend-prototype` 的 `1f2e024`。三个提交分别是 `6c3adf6`（标题句号）、`3b5d7b4`（原型浮标）、`04e975b`（公开看板）。
- 正式工程：`origin/dev` 的 `bd716d2`。
- 共用部分：正式工程以下几处与原型逐行相同（忽略换行符），原型代码的 import 路径可以直接用。
  - `Panel` 系列组件（`app/components/site/panel.tsx`）
  - `ToggleGroup` 和 `Toggle`
  - `dot-grid`、`screen-line-*` 工具类，`--line`、`--success` 令牌
  - `@/*` 别名，同样指向源码根目录

## 1. 页面大标题句末用英文句号

**原型现状：**
- `PageHeadingTitle` 的句末用英文句号 `.`，句中的中文逗号保留。
- 片单详情页的标题是成员自己起的片单名，原样显示。
- 依据：开发者 2026-10-18 的设计决定。需求文档没有相关条款。

**正式工程（`bd716d2`）仍用 `。`，要改 8 个文件、10 处：**

| 位置 | 标题 |
| --- | --- |
| `app/routes/about.tsx:79` | 一个邀请制的私人观看站 |
| `app/routes/account.tsx:108` | 管理登录方式、二步验证和登录设备 |
| `app/routes/admin.tsx:95` | 成员、邀请码和邀请链 |
| `app/routes/backups.tsx:98` | 数据备份 |
| `app/routes/catalog.tsx:37` | 搜索、剧集、电影三条 |
| `app/routes/invites.tsx:43` | 把档案馆分享给信得过的朋友 |
| `app/routes/library.tsx:45` | 收藏的作品和自己整理的片单 |
| `app/routes/playlists.tsx:16` | 其他成员整理并公开的片单 |

- `app/routes/playlist.tsx:29` 显示的是片单名，不改。
- `test/http.test.ts:60` 断言了账号页标题全文（含 `。`），需要同步更新。这是已确认的文案变化，不是放宽断言。

## 2. 原型浮标（不迁移）

**原型现状：**
- `src/components/site/proto-console.tsx` 在所有构建里都显示琥珀色的"前端原型"浮标，开发模式下点击会打开原型控制台。
- 页脚不再显示"原型 · proto/frontend-v1"。

**正式工程：**没有原型控制台，`app/components/site/site-footer.tsx` 里也没有这个标签。按[迁移方案](plan/foundation.md#615-前端原型保留与代码沿用)，原型控制台不迁移，这一项无需适配。

## 3. 公开看板 `/status`（需求待确认）

### 迁移前置条件

- **写入 A/B**：是否对访客公开、展示哪些数字、哪些刻意不展示（R2 存储量和对象数、对象名、存储桶名）。目前唯一的说明是原型 README 的[公开看板（待确认）](../prototypes/frontend-v1/README.md#公开看板待确认)一节。
- **对应模块计划写明以下几点：**
  - 数据来源：Cloudflare GraphQL Analytics，各数据集的对应关系见原型 README 的表格。其中三项还没核对：墙钟时间分位字段、部署记录、zone 级的边缘节点与状态码。
  - 服务端短时缓存：Workers Cache API。
  - API 令牌：作为 Worker Secret 保存，只给 Analytics 只读权限，不暴露给浏览器。
  - API 失败或限流时页面显示什么。

### 可以照搬的展示层

| 原型 | 正式工程（建议位置） | 说明 |
| --- | --- | --- |
| `src/components/charts/**`（bklit） | `app/components/charts/**` | 整个目录复制。`chart-formatters.ts`（北京时间、`MM-DD` / `HH:mm`）和 `chart-loading-label.tsx` 已按站点约定改过，不要用 `shadcn add` 重新拉取覆盖 |
| `src/components/ui/shimmering-text.tsx` | `app/components/ui/shimmering-text.tsx` | `chart-loading-label.tsx` 引用它，正式工程还没有 |
| `src/components/site/charts.tsx` | `app/components/site/charts.tsx` | 站点封装的 `TimeChart`、`Bars`、`Legend`、`ShareList`；点阵背景、绘图区边距、刻度格式都在这里 |
| `src/pages/status/*.tsx` | `app/routes/status.tsx` 及其组件 | 展示结构照搬，数据改由 loader 提供 |
| `src/styles/globals.css` 的 chart 令牌 | `app/styles/globals.css` | `@theme inline` 里 4 行 `--color-chart-*`，加上 `:root` 里一组 `--chart-*`。它们映射到站点的 foreground / muted / border 等令牌，深色模式自动跟随，不另设 `.dark` 值 |
| `src/data/status.ts` 的 `fmt*`、`RANGES` | 正式工程的格式化与时间范围定义 | 格式化规则沿用；种子随机数据（`samples`、`telemetry`、`useMinutes` 的生成逻辑）不迁移 |

**依赖：**
- 正式工程已有 `motion`。
- 需要新增：`@visx/scale`、`@visx/curve`、`@visx/shape`、`@visx/event`、`@visx/responsive`、`@visx/grid`、`d3-array`、`d3-shape`，以及 `@types/d3-array`、`@types/d3-shape`。版本以原型 `package.json` 为准。
- 原型 `package.json` 里的 `@visx/gradient`、`@visx/group`、`@number-flow/react` 没有代码引用，不用带过去。

### 版式要点

**页面与顶部面板：**
- 页面用宽列 `Page`，标题为"运行状态 / 查看档案馆的近期运行数据."。
- 顶部面板第一行：左边是 24h / 7d / 30d 的 `ToggleGroup`（`variant="outline"`、`size="sm"`），切换范围会更新所有序列；右边是"数据截至 HH:mm UTC+8"和一个闪烁的状态点。
- 下面是 8 个读数，手机 2 列、`md` 起 4 列，用 `gap-px` 加 `bg-line` 分割：R2 下行流量、下行速率 · 1m、下行峰值 · 1h、请求数、错误率、接口延迟 p95、CPU 时间 p99、D1 查询。每格只有标签和数值，不带副文字。

**图表：**

| 图 | 内容 | 高度（手机 / `md` 起） |
| --- | --- | --- |
| Fig. 01 | R2 下行流量，面积图，通栏 | 240px / 320px |
| Fig. 02 | 下行速率，最近 60 分钟，每分钟一点 | 192px / 240px |
| Fig. 03 | 接口延迟 p50 / p95 / p99，与 Fig. 02 并排 | 192px / 240px |

**分区面板：**
- Workers / R2 / D1 / 边缘四个分区，标题不带副标题。
- 每个分区内是两列单元格，顶部是"Fig. nn · 标题"条。
- 占比列表（调用结果、操作类型、边缘节点、状态码）每行只有名称、直角占比条和百分比，行间分割线通到单元格两边。
- R2 的传输量是 2×2 读数格。D1 下方有 4 个读数：读取行、写入行、查询耗时 p90、数据库大小。
- 部署面板列出最近 5 次，每行是时间、提交说明，以及"提交 · 版本 · 来源"。
- 页尾写"数据来源 Cloudflare"。

**图表画法：**
- 单色细线，系列之间靠粗细和虚线区分。
- 绘图区不画网格线，铺一层 16px 间距的点阵（`Background pattern="dots"`，颜色 `--chart-4`），向四边淡出。
- Y 轴 4 个刻度，刻度标签去掉全为零的小数（显示 `400 GB`，不是 `400.0 GB`）；悬停提示保留完整格式。

**样式与动效：**
- 网格单元格会盖住面板底部的 `screen-line`（层级 -1），所以带网格的面板要加 `after:z-1`，做法与页脚相同。
- 系统开启"减少动态效果"时，关闭图表入场动画、曲线过渡和状态点闪烁。

### 需要替换或补上的部分

- **数据：**
  - 由 loader 在服务端查询 GraphQL，结果经 Workers Cache API 短时缓存。
  - 每分钟速率单独缓存约 60 秒，舍掉最近 3 分钟、缺失的分钟补 0。
  - 前端每分钟重新拉取一次，标签页隐藏时暂停，回到前台立即刷新，可以用 React Router 的 revalidator 或 fetcher 实现。浏览器端不再生成数据。
- **路由：**在 `app/routes.ts` 加 `route("status", "routes/status.tsx")`，访客也能打开；和原型一样不加导航入口。
- **响应内容：**只返回聚合数字，不出现账户 ID、令牌、存储桶名或对象名。
- **已知问题：**
  - 图表数值只能用指针悬停查看，没有键盘逐点浏览。
  - 原型打包成一个约 2.4 MB 的脚本；正式工程按路由拆分后，图表代码只在 `/status` 加载。
