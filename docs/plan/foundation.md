# 工程基础与环境

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A1/A7/A8、B 6.1/6.2/6.14/6.15。第二阶段 T2.1–T2.7 已完成；认证专属基础见 authentication，云端发布和备份见 operations。第一阶段已确认需求、原型基线及已知缺陷，原始完成记录保留在归档，不再重复维护。

## 任务与验收摘要

- [x] DSK 基础防护与配置清理的实现与本地自检（2026-10-26，基线 `58d408d`）：动态响应与静态资源使用禁止嵌入的 CSP，配置只声明实际使用的绑定。`http`、`settings` 与原生限流定向用例通过；development 构建产物保留静态 CSP，类型检查通过。隔离浏览器直接访问登录页正常、官方 Turnstile 测试控件显示成功，在 iframe 中的登录页不显示。临时夹具与虚构配置均已清理，staging 未复验。

- [x] DOC1 文档职责调整为 A/B 与核心/模块计划四层，链接、内容保留、任务状态及敏感信息检查通过；[检查记录](../documentation-restructure-20261011.md)。
- [x] DOC2 按站长要求继续精炼 A，保留八项核心能力及目标/范围；细则承接、链接和差异检查通过，不改变产品或阶段状态，见[精炼记录](../documentation-restructure-20261011.md#核心需求二次精炼)。
- [x] DOC3 分离协作规则与项目结论，删减内容承接、临时授权记录、维护规则入口及文档链接/状态/差异检查通过；A/B 与功能里程碑不变，见[整理记录](../documentation-restructure-20261011.md#协作规则与项目结论分离)。

文档验证（[PR #19](https://github.com/startrekchina/video-site/pull/19)）：缓存、续期、人机验证及文档职责边界的 8 份文档自检通过，涵盖 132 个本地链接/锚点、既有待办状态、续期默认值和 `git diff --check`；E2E1 待接入，T4.5 当前实现与云端验收状态见[认证计划](authentication.md#t45-请求级身份与-d1-往返优化)。

成熟库优先原则与[项目进展简报](../progress.md)已落实到文档；五章结构、协作称呼、状态依据、入口链接及差异检查通过，未调整功能实现或验收状态。

- [x] T2.1 建立执行计划并同步 README；原建立记录见历史归档。
- [x] T2.2 工程骨架、公开响应安全头、robots、类型检查、构建和 Workers 测试入口落地。
- [x] T2.3 本地/staging 配置与 Secrets 可用，staging/production 隔离声明、资源映射及构建/dry-run 通过；production 发布属于 T6.2。
- [x] T2.5 版本化 D1 迁移、约束与虚构数据/生成媒体夹具通过；认证迁移由 authentication 维护。
- [x] T2.6 前端基础从原型单向迁入；关于页/404 的桌面、手机、浅深色、主题及键盘复核通过。其余页面按各模块验收。
- [ ] UI1 界面文案对齐实际行为（开发者 2026-10-15 批准两步）：统一术语并修正与行为不符的说明；需改逻辑的部分包括播放登录失效改为“重新登录”、全屏出错先退出全屏、重设与邮件链接失效落到页面说明、同步字幕按语言显示（迁移 `0014`）、剧集简称补全、首页通行密钥直接登录、非 Apple 平台显示 Ctrl、认证请求的网络/网关错误兜底与限流分钟换算；站名统一为“星际舰队档案馆”并为各页补标题（B 6.14）；B 故事 23/26 按会话鉴权改写；原型共有界面同步，并删除恢复码、管理员重置与免邮箱注册等旧流程。实现与本地自检通过：类型检查、257 项应用测试、21 项工具测试及正式/原型构建；原型关于、播放、注册页与找回锚点已浏览器查看，正式工程登录态页面、手机与深色主题未复核。
- [ ] UI2 正式站同步原型 10-20 至 10-22 的纯前端改动：访客首页（桌面固定 9:5 象限星图、UFP 徽记与标题栏，手机登舰证，下接三步、成员能力、守则和常见问题，B 6.11/6.14）、页脚透视线稿、深浅色单键切换（跟随系统不存储，系统变化时清除，B 6.11）、关于页文案与技术说明图标墙、登录/注册说明，以及观看页（字幕只在播放器内选择、原名/年份/时长信息行、续播位置改由播放器提示、按集切换保留片单）。需后端或尚未确认的部分不在本项：页脚构建/边缘节点/技术栈（由 UI3 承接）、片单队列条（由[社区计划](community.md#任务与验收) T5.2 队列条承接）、首播日期（由[片库计划 AIR1](catalog.md#air1-单集首播日期) 承接）、字幕标签与文案（由[片库计划 SUB1](catalog.md#sub1-字幕四类标记) 承接）、状态/维护/欢迎/片库报告页、首页候选。实现与本地自检通过：类型检查、505 项应用测试、构建；本地浏览器查看访客首页桌面/手机、邀请码跳转注册、关于页桌面/320px、页脚线稿、主题按钮与 D 键、成员页脚和观看页结构。字幕切换与续播提示因本地缺媒体文件只由单测覆盖；待开发者复核。
- [x] UI3 成员页脚图签按原型以工程信息替换片库统计（B 6.14）：Vite `define` 在构建时写入 `__BUILD_COMMIT__`，Workers Builds 取 `WORKERS_CI_COMMIT_SHA`，本地取 `git rev-parse HEAD`，两者都取不到时构建失败，测试用固定虚构值；提交号只经根 loader 下发，客户端脚本不含提交号，部署不改变带 hash 的资源名（T4.8）。Worker 入口把请求头 `cf-ray` 中的 Ray ID 与 `request.cf.colo` 经 load context 交给根 loader；页脚读根数据，技术栈版本读 `package.json`；`SiteFooter` 与关于页共用 `REPO`、`ExternalLink`、`Field`。`catalogSummary` 只查作品列表，根 loader 与作品页各少一条计数 SQL。实现与本地自检通过：类型检查、http（含成员页脚、无 colo、404 出错页、两次 `.data` 各带本次 Ray ID、访客精简页脚）、player、catalog、request-performance 用例及开发构建，客户端资源中查不到提交号；http、catalog、request-performance 因本机冷启动超过 60 秒预热时限，用只放宽预热时限的临时副本运行；与片库、片单各项合并后的全量运行中 http、request-performance 原文件通过，结果与 catalog 冷启动超时见[片库计划集成自检](catalog.md#air1-单集首播日期)。本地浏览器（2026-10-25，6120）：成员关于页桌面与 320px 的图签字段、顺序与链接和原型一致且无横向溢出，访客页与登录页只有底栏；请求 ID 按原型显示 16 位 Ray ID（开发者 2026-10-25 确认，本站 36 位 `X-Request-Id` 在两种宽度下都会折成 3 行），本地没有 `cf-ray` 时显示“—”。staging（2026-10-25，`c1c33f2`）成员页脚显示构建 `c1c33f2`、边缘节点 HKG 和 16 位 Ray ID。
- [ ] E2E1 建立少量关键路径的 Playwright Test 回归：先确认首批场景与环境，再接入隔离数据、真实页面操作、可按场景筛选的执行入口及失败证据保护；方案见[浏览器验证方案](#浏览器验证方案)。未接入不宣称自动化浏览器回归已通过。

证据：[基础截图](https://github.com/startrekchina/video-site/blob/803be06/docs/screenshots/phase2/README.md)、[新认证文案截图](https://github.com/startrekchina/video-site/blob/803be06/docs/screenshots/phase2-better-auth/README.md)、[历史计划](../archive/plan-20261007.md)。命令与日常使用见根 README，不复制完整开发日志。

### T4.7 业务写入来源与 JSON 校验

开发者 2026-10-15 确认。业务页面凭证（`csrf` cookie 加 HMAC）沿用自建认证方案的通用基线；cookie 固定 24 小时过期且不续期，页面开着跨过过期时刻后提交失败，已复现播放续期因此返回 `403`，第五阶段进度上报同样受影响。现有来源校验已拒绝缺 Origin、跨站及同站子域请求，页面凭证不提供额外防护。改为与 Better Auth 1.7.7 原生模型一致：来源校验、Fetch Metadata、`SameSite=Lax` 会话 Cookie、仅接受 JSON 这类非简单请求，不使用页面凭证。

- [x] 业务写入统一经一个入口：Origin 等于 `APP_ORIGIN`，拒绝 `cross-site` / `same-site` Fetch Metadata，要求 `Content-Type: application/json`；删除页面凭证、`csrf` cookie 及各 loader 与表单的传递。注册入口同样要求 JSON。
- [x] 同步 B 6.1.1、6.9.4、6.12、7.1 与本计划 6.1.1；测试覆盖跨站、缺 Origin、非 JSON 拒绝及同源 JSON 成功。

本地自检（2026-10-15）：类型检查与全量 Workers 测试通过；新增来源/Fetch Metadata/非 JSON 拒绝用例，管理员高影响操作在跨站、同站或非 JSON 请求下被拒且成员状态不变。注册入口由 Better Auth 原生拒绝非 JSON（`415`），站点只叠加来源校验。

验收：账号、邀请、管理和注册写入在同源 JSON 下成功；跨站、缺 Origin 或非 JSON 请求被拒且无副作用；页面打开时长不影响提交。

### T4.8 构建资源长期缓存

Workers 静态资源默认 `Cache-Control: public, max-age=0, must-revalidate`，整页加载和再次访问时每个脚本、样式与字体都要回源校验。构建产物的 `.js`、`.css`、`.woff2` 文件名均含内容 hash，内容变化即换名，HTML 为 `private, no-store`，长期缓存不会让用户停留在旧代码。

- [x] `public/_headers` 仅为 `/assets/*.js`、`/assets/*.css`、`/assets/*.woff2` 设置 `Cache-Control: public, max-age=31536000, immutable`；同在 `/assets/` 下但文件名不含 hash 的海报、剧照保持平台默认。
- [x] staging 核对三类文件的响应头，并确认 `.webp` 与 HTML 未受影响。

staging 核对（2026-10-15，`78914f2`）：入口脚本、根样式与字体返回 `public, max-age=31536000, immutable`，海报 `.webp` 保持 `public, must-revalidate, max-age=0`，首页 HTML 为 `no-store, private`。

### ZH1 简繁切换

开发者 2026-10-22 确认采用消息目录方案，首次生产发布后开发，规则见 [B 6.1.2](../detailed-requirements.md#612-简繁切换)。发布前不加界面 i18n 层，只完成[片库 SUB1](catalog.md#sub1-字幕四类标记)的字幕标记。

- 界面文案：以简体源文作消息 ID 包裹（`t()`、`<Trans>` 一类接口），模块级文案常量改为渲染时取值；构建时由 OpenCC（`cn`→`twp`）生成繁体目录，再叠加人工词表（如「賬號」改「帳號」、作品译名）。成员内容不进目录，天然不转换。
- 库选型：先验证 Lingui 宏能否接入当前 Vite 8 + React Router 工具链；不能接入时改用无宏的薄封装（`t("源文")` 加构建时抽取生成目录）。
- 服务端提示：按请求的偏好输出，或改为返回错误码、由页面取文案。
- 作品资料：导入时用 OpenCC 转换并存库，运行时不加载简转繁词典；搜索把查询词用 `t2cn` 转成简体再匹配。
- 偏好：存 Cookie，root loader 读取并设置 `<html lang>`；无 Cookie 时按 `Accept-Language`。繁体时加载 Noto Sans TC 子集。
- 字幕：导入时为只有一种文字的轨道转出另一种，原生优先；播放器默认取与偏好相同文字的轨道。
- 检查：新增脚本扫描未包裹的中文字面量，防止漏包。
- 选型依据（2026-10-22，`origin/dev`）：界面约 64 个文件、590 行含中文的 JSX，服务端约 165 行提示；OpenCC 简转繁词典 347KB（brotli，Node 初始化约 50ms），现有 870 条文案生成的繁体目录约 15KB（brotli）。渲染层统一转换会默认转换成员内容，并要求前端加载完整词典，因此未采用。

- [ ] 库选型验证与接入，生成繁体目录和人工词表。
- [ ] 包裹全部界面文案与服务端提示，加入漏包检查；用例覆盖默认语言判定、Cookie 保持、首屏输出和不转换的字段。
- [ ] 作品资料导入时转换，搜索不区分简繁；字幕自动转换与默认跟随，同步[导入说明](../import-media.md)。
- [ ] 桌面与手机浏览器验证简繁切换、首屏不闪烁和字幕跟随。

## 技术基线与限制

在临时目录用以下组合完成了端到端探针：`cf dev` 渲染带 D1 查询的 loader；`react-router build --mode staging` 产出 `.cloudflare/output/v0`，`vite preview` 下页面与全部客户端资源返回 200；`cf deploy --prebuilt --mode staging --dry-run` 正确列出 staging 绑定；Workers Vitest 直接读取 `cloudflare.config.ts`，D1 迁移后唯一键与外键生效，并能经 Worker 入口渲染路由。

| 组件 | 版本 / 用法 | 说明 |
| --- | --- | --- |
| 运行与包管理 | Node 24、pnpm 12 | 构建脚本需批准 `esbuild`、`workerd` |
| 框架 | `react-router` / `@react-router/dev` 7.18.4，`future.v8_viteEnvironmentApi: true` | 需求定为 v7；自定义 `app/entry.server.tsx`（`renderToReadableStream`） |
| Cloudflare 集成 | `cf` 1.0.0-beta.12、`@cloudflare/vite-plugin` 2.0 beta、Vite 8；Wrangler 4.150.0 补充 staging 发布 | `cloudflare.config.ts` 为权威配置，Wrangler 配置仅从 Build Output 生成，不提交资源映射 |
| 测试 | `vitest` 4.1、`@cloudflare/vitest-plugin`（`experimental.newConfig`） | 读取 `cloudflare.config.ts`，`mode` 为 `test`；D1 迁移在 setup 中应用 |
| 类型 | `.cloudflare/types/index.d.ts`（Vite 插件自动生成，`Env` 由配置推断） | `react-router typegen && tsc` 作为类型检查 |

已知限制与处理（均须在 README 运行说明中写明）：

- `cf` 与 Vite 插件均为 beta，锁定精确版本；升级单独提交并重跑相关完整验证，不借文档拆分升级工具链。
- **v7 与 Build Output 目录不一致**：Vite 插件 2.0 把客户端产物强制输出到 `.cloudflare/output/v0/workers/default/assets`，React Router v7 仍从 `build/client` 读写 manifest。用一个小 Vite 插件在构建时双向同步，待 [remix-run/react-router#15480](https://github.com/remix-run/react-router/pull/15480) 进入 v7 后删除。官方插件声明正式支持的是 React Router v8；是否升级 v8 属于需求变更，须站长决定并同步本技术基线和 README。
- **`cf build` 不向 React Router 转发 `--mode`**：staging / prod 构建使用 `react-router build --mode <mode>`；production 预备路径为 `cf deploy --prebuilt --mode production`，staging 使用[运维计划的 Wrangler 补充发布](operations.md#695-远程数据库迁移与运维工程细节)。部署目标须与构建一致；本地开发直接 `cf dev`（mode 为 `development`）。
- **D1 迁移命令只接受数据库 ID**：本地用固定的占位 ID（全零 UUID 变体）并 `--local --persist-to .cloudflare/state`，与 `cf dev` 的本地状态目录一致；staging / prod 的真实 ID 由被忽略的 `.env` 注入 `cloudflare.config.ts`，命令行同样从本机读取，不写入仓库。
- **远程 D1 触发器解析**：staging 的 `/query` 将 0010 内裸 `CASE…END` 错认作触发器结束；该迁移完整回滚，0009 已成功。[同类问题](https://github.com/cloudflare/workers-sdk/issues/4727)用等价括号规避。`pnpm db:migrate:staging` / `db:migrate:production` 只规范临时副本，再交给 cf 的增量迁移 runner，原始迁移不改写；SQLite 正反用例及 staging 0010/0011 实测通过。
- **环境隔离**：`cloudflare.config.ts` 按 `mode`（`development` / `test` / `staging` / `production`）返回完整配置；Worker 名、D1、R2、Rate Limiting namespace 和 `APP_ENV` 各自独立，缺失真实资源标识时拒绝构建 staging / prod。
- **Secrets**：`bindings.secret()` 声明的是必需项，本地开发缺失时警告，**实际部署会拒绝缺少声明的 Secret**。认证、Turnstile、备份加密、备份 API Token 与邮件五项线上必需；历史 keyring 和 WebDAV / S3 可选 Secret 只在本地声明以推导类型，线上按需预配并由 CLI 保留，不强制为未启用目标上传占位凭证。备份 Token 是独立运行时 Secret，不能将构建机部署凭证当作已配置的运行时备份权限。线上可用部署时 `--secrets-file` 写入，密钥文件必须被 Git 忽略；既有四项密钥交接文件不包含站长另行配置的 EMAIL_API_KEY 或新增备份 Token，不能据此宣称 production 已齐备。
- **云端复用与日志**：按站长授权复用既有 staging Worker 与访问域名，D1 名称/ID 和 R2 桶名分别从本机 `.env` 注入，不能按数据库名推断媒体桶。Custom Domain 通过 `worker.domains` 管理；关闭 workers.dev / preview URLs。启用应用日志、query 脱敏并关闭 invocation logs；原生 traces 含路径，凭证路径脱敏验证前保持关闭。

### 6.1 总体架构

- 全站使用 React Router v7 框架模式，前后端作为一个 Worker 部署在 Cloudflare Workers 上。页面的登录校验在服务端的 loader 中完成。
- D1 存放所有结构化数据，包括 Better Auth 用户、凭证、会话、验证状态与插件表，以及邀请码、剧集资料、观看进度、片单和讨论。Better Auth 是运行在本站 Worker 内的开源认证库，不使用其托管身份服务，用户资料保存在站长自己的 D1；关闭库 telemetry。发件服务仅接收投递所需邮箱和邮件内容。
- R2 存放媒体文件和字幕文件。R2 存储桶不公开，只通过 Worker 访问。
- 海报和非播放页选集列表使用的小尺寸单集剧照留在仓库的 `public/` 目录下，作为 Workers 静态资源公开访问，不需要登录。站长知道这样会让外人看出这是一个星际迷航站，并接受这一点。
- 单集剧照以 `public/assets/stills/star-trek/manifest.json` 为准，按作品 TMDB ID、季号、集号匹配，可为空。默认输出 240×135 的 WebP（质量 55），保留原始画面比例并补边；列表按小尺寸 16:9 展示，懒加载，加载失败时保留同尺寸占位。播放页的选集列表不显示剧照，视频时间轴的预览缩略图仍在范围外。
- 界面以简体中文为源文字，简繁切换在首次生产发布后按 [ZH1](#zh1-简繁切换) 实施，不做中英双语界面；保留原型中的英文作品回退资料、星图标注、等宽辅助标签和评论时间格式。
- 全站返回 `X-Robots-Tag: noindex`，并配置 `robots.txt` 禁止所有爬虫。公开访客页同样不允许索引。
- 原型既是页面和交互基准，也是前端代码的迁移来源。正式应用使用 React Router 框架模式和真实的服务端权限校验，优先沿用经审查的页面、展示组件、样式和已定稿交互，不要求全面重写前端；原型保留、迁移边界和验收遵循 6.15。

#### 6.1.1 服务端边界与公共约定

- 路由模块负责 loader / action 的输入输出，认证、D1 查询、签名、R2 和备份逻辑放在 `*.server.ts` 或 Worker 服务端模块。浏览器构建不能引用 Secrets、数据库绑定或对象存储键。
- 每个受保护的 loader、action 和资源路由都单独校验会话、成员状态和权限，不能只依赖父布局 loader；框架的数据请求、预取和直接 HTTP 请求也受同一规则约束。`userId` 和角色取自服务端会话，不接受客户端指定当前身份。
- 会话 Cookie 按 Better Auth 的签名不透明 token 设置，生产命名 `__Host-session`，使用 `HttpOnly; Secure; SameSite=Lax; Path=/` 且无 `Domain`。D1 按原生 schema 保存 token 原值，Cookie 签名 Secret 独立保管；不再要求哈希会话表。库 Cookie 名映射和本地 HTTP 开发例外须实测，不能把本地属性当作生产验收。期限与改密行为见 6.3.3。
- 站点业务写入走 action 或非 GET 接口，统一经 `checkWrite` 校验 Origin 等于 `APP_ORIGIN`、拒绝 `cross-site` / `same-site` Fetch Metadata，并只接受 `Content-Type: application/json`，不使用页面凭证（T4.7）。Better Auth 入口使用库原生 Origin / Fetch Metadata / SameSite 防护，不再强制附加自定义 `csrfToken`；服务端 API 的包装入口同样先完成跨站检查，不能以内部调用跳过防护。验证邮件 GET 是 6.0.1 明确的例外。trustedOrigins 限于本环境，同源凭证，不开放跨域媒体；回跳限定本站。
- 站点业务 JSON action 成功结构为 `{ data, requestId }`，失败为 `{ error: { code, message, fieldErrors?, challenge? }, requestId }`。Better Auth API 保留原生 JSON、状态码、Cookie 与重定向，认证客户端消费 `code/message`、二步挑战及库客户端类型；中文文案由前端映射，不把全部库端点重写成业务 action。页面表单可 `303` 回跳，媒体返回字节流。
- `400` 表示格式或字段不合法；`401` 表示未认证或凭证无效；`403` 表示已认证但权限不足、来源校验（`CSRF_INVALID`）或挑战未满足；`404` 表示资源不存在或不可见；`409` 表示已消费、版本冲突或额度不足；`429` 表示限流；依赖暂不可用返回 `503`，意外错误返回脱敏 `500`。限流提供可重试信息，不能泄露内部 SQL、栈、R2 key 或上游原始错误。
- 稳定错误码至少区分 `AUTH_REQUIRED`、`AUTH_INVALID`、`CSRF_INVALID`、`TURNSTILE_REQUIRED`、`FRESH_SESSION_REQUIRED`、`INVITATION_INVALID`、`INVITATION_EXPIRED`、`INVITATION_USED`、`INVITATION_REVOKED`、`QUOTA_EXHAUSTED` 和 `REVISION_CONFLICT`；前端按 code 处理，不解析中文 message。邀请码无效使用 `400`，其已用/过期/作废及额度不足使用 `409`。
- 受保护 HTML 页面未登录时跳转登录页；6.5 列明的公开页无需登录，受保护 JSON 和媒体接口返回错误。登录、邮箱找回保留库脱敏语义；注册可返回库的用户名/邮箱冲突码，不能承诺注册入口完全隐藏账号存在性。邀请码失败仍明确区分状态，不返回邀请人的私人资料。
- 登录态 HTML、loader 数据、认证 action、邀请凭证和媒体响应使用 `Cache-Control: private, no-store`，禁止共享缓存绕过鉴权。公开静态资源可以按文件版本缓存；静态资源、重定向、错误和媒体响应同样带 `X-Robots-Tag: noindex`。Workers 静态资源头与 Worker 生成响应头分别配置，不能假定其中一处覆盖另一处。
- Worker 动态响应及静态资源均设置 `Content-Security-Policy: frame-ancestors 'none'`，禁止页面被嵌入；该策略不限制页面自身加载 Turnstile 脚本及 iframe。
- 动态响应设置 `Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`。浏览器不接收内部 R2 key/URL、Worker Secrets、密码哈希或 TOTP 密文；必要注册/绑定/签发流程只向有权接收者给出凭证材料，站长专用加密备份文件下载按 6.9.4 单独鉴权。Better Auth 自己的登录/会话端点可返回原生会话 token，按敏感凭证处理；本站会话列表仅给设备信息与 ID，撤销时在服务端映射 token。日志只记录请求 ID、路由模板、状态、错误码、处理请求的机房代码（`colo`）及必要资源 ID，不记录 Cookie、密码、邀请码、备用码、TOTP、完整 token/URL；平台 URL 日志也须验证脱敏。

## 基础验证方法

Workers Vitest 读取 cloudflare.config.ts 的 test 模式，每例 reset 并应用版本化迁移；本地 D1/R2 和虚构数据，不断言内部调用。约束验证包括复合外键、唯一性、互斥字段、原生 Date 序列化、迁移拒绝/回滚及孤立注册无权限。测试命令见 [README](../../README.md#常用命令)，并发与 SSR 预热边界见[本地认证验收边界](authentication.md#本地认证验收边界)，业务场景见 B 第 7 节。

### 测试媒体准备

需要媒体夹具时，先安装 ffmpeg 并确保它可从 `PATH` 调用，再从工作树根目录执行：

```bash
node scripts/gen-test-media.mjs
```

脚本自行生成 4 秒、320×180、H.264 + AAC、faststart 的测试视频，输出到被 Git 忽略的 `test/fixtures/media/signal-test.mp4`；可重复运行并覆盖该测试文件，不使用真实剧集。自行编写的中英文 VTT 位于 `test/fixtures/subtitles/`，随代码提交；数据库约束测试不依赖生成的 MP4。

### 浏览器验证方案

当前自动化由 Workers Vitest 与 Node 测试承担；`test/http.test.ts` 直接调用 Worker 并检查响应，不执行客户端点击、弹窗或导航。Playwright Test 尚未接入，E2E1 只补浏览器到 Worker、数据的交互链路，不替换现有测试体系，也不重做未受影响的已验收功能。

| 层次 | 责任与边界 |
| --- | --- |
| Workers Vitest / Node | HTTP 权限、并发、数据一致性、媒体边界和导入幂等等；浏览器层不机械重复全部组合。 |
| Playwright Test（待接入） | 固定操作与行为断言，回归少量稳定关键路径；默认由测试框架启动管理浏览器，以独立上下文隔离角色和会话，不连接个人日常会话作为默认测试环境。 |
| CDP 探索与现场排查 | 复现问题、观察页面及请求；稳定且有回归价值的发现收成自动化用例，临时点击记录不充当长期回归门禁。 |
| staging / 人工实机 | 真实配置、外部服务、设备能力与视觉确认；手机视口模拟、虚拟验证器和短片段不替代相应实机及长时验收。 |

首批候选从 B 第 7 节选取：受保护页面登录回跳；搜索、空结果、详情切季与正确单集；关键菜单/对话框的开关、取消及焦点；自生成视频播放、拖动、字幕与退出/撤销后的新媒体请求拒绝，媒体缺失时的出错提示与原地重新连接；封禁专用成员后刷新失去访问。自动化与长播证据分界见[播放验证方案](playback.md#播放验证方案)。实施前以中文确认具体操作和断言，不在本计划复制业务规则；新增注册、邮件及通行密钥场景时明确自动化覆盖段与真实服务/设备待验段。

- **环境与身份**：优先独立本地测试数据，启动/复用服务遵守 AGENTS；staging 执行须明确目标及数据变更授权，不将测试授权当作部署授权。只使用虚构账号及自生成媒体，走真实应用链路；隔离本地环境如需模拟外部服务须标明覆盖边界。
- **人机验证与登录夹具**：按 [认证计划本地认证验收边界](authentication.md#本地认证验收边界)，仅 development 且官方 always-pass Site Key/Secret 配对时接受对应测试响应；test、staging、production 仍严格校验 hostname/action。staging/prod 不设认证或 CAPTCHA 旁路，也不增加默认可关闭的生产开关。登录后的业务可复用专用登录态；注册/登录本身须走对应流程，真人挑战、邮件与设备待验段明确分开，复用登录态或跳过的步骤不计作注册/登录验收。
- **数据隔离**：浏览器上下文不隔离 D1/R2。测试数据有可识别的本次运行归属；staging 的状态修改只针对本次专用数据，清理不重置共享库、不删除他人内容，并避免并行用例共用可变账号。
- **证据保护**：会话状态文件、截图、视频、trace 和报告可能含 Cookie、邮箱、验证链接或播放凭证，不提交仓库或公开发布；需要共享的证据先脱敏。失败保留可定位的操作与断言，不能靠重试直至变绿掩盖不稳定行为。
- **执行与验收**：按 [AGENTS 验证规则](../../AGENTS.md#验证)定向选测和复用有效证据；工具接入、自检通过和站长验收分别记录。已有真实手机待验项仍由片库/播放计划维护；E2E1 不替代这些门槛，也不自动接通发布流水线。

### 6.2.1 数据结构共用约定

各业务表按领域分别见 authentication、catalog、community；原生认证 schema 以锁定版本为准。内部 ID 与 TMDB ID 分开，HTTP 时间用 ISO 8601，时长/位置用秒；业务 UTC 毫秒与原生 D1 DATE 文本按 adapter 分别处理。关联列使用外键、类型/互斥字段用 CHECK、唯一性由数据库约束保护，不以一次客户端查询代替。已应用迁移不改写。

索引围绕实际查询：目录季集顺序与资源归属、会话用户/期限、邀请关系、进度时间、片单所有者/顺序、发信摘要/用途/时间；任意子串搜索不承诺 B-tree 加速。站点业务参数绑定、条件写入和 D1 batch；影响 0 行不自动回滚，后续写入受相同条件或约束保护，不使用跨网络交互事务。

### 6.15 前端原型保留与代码沿用

- `prototypes/frontend-v1/` 保留为同仓库中独立、可运行的参考项目，具备自己的依赖和启动入口；正式工程另建，与原型并列，不在原型目录中继续发展正式应用。`.worktree/` 只是临时分支检出目录，不作为参考代码的最终位置；合入参考材料时不携带 `node_modules`、构建产物、原始素材或本地凭证。
- 原型 README 记录参考提交、启动和构建方法、页面与路由、已定稿交互及加载/空数据/失败/成功状态，并区分演示内容与正式规则。验证结果及已知问题随参考版本保留，代表性的桌面和手机截图按 [AGENTS 目录约定](../../AGENTS.md#专项读取与目录约定)只存本地；评估通过不等于全部功能或正式后端已经验收。
- 正式前端以沿用为默认路径：经代码审查确认符合本文后，将已有的纯展示组件、页面布局、样式、设计 token、响应式规则和已定稿的客户端交互复制或提取到正式工程。不要求从零重写全部页面；仅对运行环境、数据契约、安全边界或已知缺陷所需的部分进行适配或替换。依赖模拟数据的组件先分离数据来源，以正式 loader 数据、props 和 action 接入真实能力。
- 页面设计尽可能遵循对应原型的结构、分区列表、统计、表格、标签页与操作对话框，保留现有 token 和视觉层级。需求变化只调整必要字段与流程，迁移差异及原因记入逐页验收记录。
- 不迁移 PROTO 控制台、模拟身份切换、固定密码/验证码、假 token、假权限校验、内存业务账本和人为等待时间作为正式能力。认证、授权、会话、业务数据持久化和媒体签发由正式服务端落实；可保留真正的客户端 UI 状态，例如弹层、主题和未发送草稿。自生成测试片段及虚构成员仅用于测试，不能充当正式片库或成员记录。
- 迁移是单向的：代码进入正式工程后在正式目录维护。正式应用的源码、构建和运行不得通过 import、软链接、路径别名或共享包依赖 `prototypes/`；公共静态素材可按本文从 `public/assets/` 使用。原型保持参考版本，不必随正式产品的每次变更同步。
- 每批迁移按页面或流程审查 mock 是否清除、数据与权限契约是否正确、所需依赖是否支持目标运行环境；验证正式工程类型检查、构建、相关测试及桌面/手机视觉与交互。切集串用进度、继续观看漏项、自动播放仅切页、片单队列不一致等已知缺陷必须修正并纳入验收，不因代码来自已评估原型而豁免。

#### PR #45 原型复核

- 原型保留目录统计导出与既有素材断言，bklit 源码附完整 MIT 通知；正式工程没有增加对原型的运行时依赖。
- 字幕具有原生键盘入口，SPA 搜索按路由与查询初始化；图表允许纵向触摸滚动、结束/取消后清理悬停，并按堆叠合计值定轴。reduced-motion 覆盖独立的坐标、背景、高亮与 tooltip 过渡。暂停弹幕筛选共用既有依赖补丁，保留活动节点。
- 模拟备份保留各目标最后完整副本及可下载的 R2 保护点，保存调度重新计算北京时间的下次执行且保留未变间隔的锚点。模拟私有片单不供其他身份的播放队列读取；这些内存规则不构成真实备份或授权验收。
- 本地自检：原型类型检查、30 项 Node 测试与构建通过；默认唯一 S3 副本在点击过期清理后保留。既有 10 个浏览器场景及搜索、暂停弹幕筛选的旧版失败对照沿用此前证据，不计本次重跑；脚本与覆盖边界见[原型复核](../../prototypes/frontend-v1/README.md#原型复核pr-45)。Kimi 脚本不计作 E2E1 的 Playwright Test 接入，不改变模块阶段、staging 或实机验收状态；约 2.4 MB 的单脚本告警仍保留。


## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
