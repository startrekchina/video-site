# video-site

星际迷航中国（StarTrekChina）粉丝社区的邀请制私人观看站，计划部署在 `video.startrekchina.org`。

## 当前状态

v1 产品范围及需求第 6.13、6.16 节列出的业务、运维策略已确认，对应接口行为和第 7 节测试期望已同步。邮箱验证、成员修改邮箱、管理员删评和单个成员解封均纳入 v1；发信沿用站长已购买的 Postal 服务，原生回调与业务配额已接入，验证/找回邮件及重新登录已在 staging 实际通过。历史备份恢复后保留讨论，由管理员手动重新删除不应恢复的内容。

数据库备份将提供站内操作：直接下载加密文件，或保存到 WebDAV / S3；仅 Worker 变量 `OWNER_EMAIL` 匹配的正常管理员可访问，其他管理员无此权限。只有 WebDAV / S3 目标配置完整后，才能在网页设置定时备份频率与执行时间；仅下载不启用定时备份，不再固定每日 04:00。这项需求和验收已同步，功能按 PLAN T6.1 待实现。

第二阶段工程基础和第三阶段邀请、账号与管理验收完成。邀请注册、认证 HTTP、邮箱验证/找回/本人改邮箱、账号与设备管理、邀请额度及管理员操作已实现，Better Auth/passkey 仍锁定 1.7.7。页面尽可能沿用原型结构，新增邮箱流程沿用同套控件；成功重置后进入无密码表单、无 URL token 的独立完成页，提供登录按钮。[第三阶段验收记录](docs/screenshots/phase3/README.md)列明已验证范围和差异。邮件套餐、管理页面、原生 scrypt 平台小样本已验收；站长确认真实 TOTP、备用码、手机会话撤销及通行密钥登录均有效。第四阶段已在 802b 实现资料占位、固定命名/服务器定时扫描、片库/全站搜索和真实授权播放；真实 TMDB 预检为 27 部作品、52 季、974 个单元。本地扫描、页面/键盘/拖动和暂停/播放续期换 URL 已通过，见[第四阶段记录](docs/screenshots/phase4/README.md)。获站长本次 API 例外授权后，staging 已部署并完成 0012、完整资料占位与 Cron 配置；云端定时关联、失败重试与重复占位已通过；staging 121 分钟自然播放、四次播放中续期及平台用量/日志的功能验证通过；原型一致性复核发现的 12 项偏离已修复并完成本地/更新后 staging 复验，真实手机反馈待完成，详情见 PLAN。

staging 已按站长授权部署第四阶段代码及 12 个迁移，复用既有 Worker、域名、私有媒体桶和 Secrets。公开页面、访客权限、跨站拒绝、通行密钥 UV 选项、静态 noindex 与凭证日志脱敏探针通过，邮件重定向运行时问题已修复；站长确认验证/找回邮件、新密码和登录实际通过。原生 scrypt 的 8 次 HTTP 检查全部符合预期，最多 2 路并发，对应 6 条平台样本 CPU P99 约 83.6 ms、V8 isolate memory P99 约 19.0 MiB、执行错误 0；临时探针已移除并复核正常入口，此样本不代表完整容量。production 资源映射和独立密钥已有准备记录；正式迁移、Secrets 上传、部署和上线验收安排在所有主要功能开发完成后的第六阶段，不作为工程基础或第三至第五阶段完成条件。真实配置只在本机/平台保存，剩余验收与阶段状态以 [`PLAN.md`](PLAN.md) 为准，前端参考原型保留在 `prototypes/frontend-v1/`。

## 文档

2026-10-07 已修复 staging 的页面导航延迟：同组剧集/电影点击样本由约 1.30/0.93 秒降到 0.41/0.37 秒，列表传输数据减少约 95%，视图与排序即时切换；首页查询也已精简。178 项应用测试与线上复测通过，实际方法和样本边界见[性能记录](docs/performance-navigation-20261007.md)。已有测试站标签页需刷新一次。

- [需求文档](docs/requirements.md)：v1 的范围、用户故事、实现决策、前端代码沿用要求和测试决策。
- [正式开发计划](PLAN.md)：执行约束、技术基线、当前阶段的可验收待办和未决事项。
- [页面导航性能记录](docs/performance-navigation-20261007.md)：重复查询与多余数据的修复、线上点击计时、权限回归及测量边界。
- [协作约定](AGENTS.md)：语言、Git 流程、目录结构和安全规则。
- [前端参考原型](prototypes/frontend-v1/README.md)：独立运行方式、页面与交互基准、验证记录和迁移时须修正的已知问题。
- [前端基础验收记录](docs/screenshots/phase2/README.md)：正式关于页 / 404 的桌面、手机和浅 / 深色截图及交互核对。
- [认证历史 POC](spikes/better-auth/REPORT.md)：旧需求的行为/差距证据，归档在 `dev` 的独立实验目录；运行命令见报告，正式工程不依赖它。
- [海报素材说明](public/assets/posters/star-trek/README.md)：海报来源和命名规则。
- [资料占位与自动关联](docs/import-media.md)：TMDB 初始化命令、固定媒体命名、服务器定时扫描和验证边界。
- [原型一致性审查](docs/design-audit-20261007.md)：修复前逐页结果、12 项具体偏离及修复证据；真实手机仍待反馈。
- [第四阶段验证记录](docs/screenshots/phase4/README.md)：片库/媒体 HTTP、原型迁移、staging 121 分钟自然播放与平台用量；实机待反馈。

## 开发节奏 TODO

以下是 v1 的阶段概览，不承诺日历日期，也不替代[需求文档](docs/requirements.md)。正式开发遵守根目录 `PLAN.md` 的约束、顺序和详细待办；本地工作树先提交并验证，再直接合入 `dev`（不需要 PR），由 `dev` 创建 PR 合入受保护的 `main`；代码、文档和原型的改动进入 `main` 都必须通过 PR。`dev` 用于日常频繁开发和集成，进展、阻塞及规则变更同步更新相关文档，具体 Git 流程见 [AGENTS.md](AGENTS.md)。开发任务经相关构建、测试和复核通过后再勾选。**勾选“已确认策略”只表示需求定稿，不表示功能已实现**。正式工程优先迁移经审查的原型前端代码，不要求全面重写，迁移边界见需求文档第 6.15 节。

### 1. 需求与原型

- [x] 确认 v1 产品范围、用户故事和范围外项。
- [x] 补充后端数据模型、接口、安全、导入、备份和测试方案。
- [x] 完成原型质量与开发准备度评估，确定成熟的视觉方向、页面结构和主要交互基准。
- [x] 确认首页推荐、Better Auth 邮箱找回/二步备用码及会话规则、混合片单播放队列、版权联系及媒体与续期策略，写入需求和对应验收条件。
- [x] 将切集串进度、继续观看漏项、自动播放仅切页和片单队列不一致等原型已知问题转为正式版验收条件；缺陷修复仍由正式迁移任务完成。
- [x] 确认邮件投递与发信限流、成员自助修改注册邮箱、账号信息规则，以及管理员删评的直接删除策略，冻结关联删除、接口读取与并发一致性的验收条件。
- [x] 确认 Better Auth 滚动会话、TOTP/备用码与通行密钥组合、管理员新鲜会话及保护、首管提升、邀请额度与封禁/解封边界，以及进度冲突和片单去重规则。
- [x] 确认限流、备份保留与回读校验、密钥手动轮换、恢复与重开，以及历史讨论人工复核重删；站长专用网页备份的加密下载 / WebDAV / S3、邮箱变量授权及测试期望已补入需求。只有外部目标配置完整后才可设置定时备份频率与时间，不固定每日 04:00。
- [x] 整理可重复运行的原型参考版本和验证记录；原型保留在 `prototypes/frontend-v1/`，已知缺陷不作为正式版预期行为。

### 2. 工程基础

- [x] 建立根目录 `PLAN.md`，把功能顺序和验收条件整理为可执行待办；工具链已在本机探针中验证。
- [x] 使用 `cf` CLI 建立 React Router v7 + Workers 正式工程，配置类型检查、构建和 Workers Vitest 测试入口；不使用 Wrangler。
- [x] 完成 staging 开发资源与 Secrets 配置，并验证 staging / production 的隔离配置、资源映射和构建 / dry-run；staging 的 11 个迁移、五项所需 Secrets 及 HTTPS 冒烟通过。production 正式迁移、Secrets 上传、部署和上线验收按第六阶段执行。
- [x] 完成 Better Auth 旧规则 POC 与差距报告；29 项测试是行为/差距证据，不等于新方案验收。
- [x] 站长决定调整需求并采用 Better Auth；需求、接口、验收和计划已同步，变更索引见需求 6.3.4。
- [x] 落地 D1 迁移/约束与虚构成员、生成媒体/字幕夹具；0008 原生认证表与 0009 成员业务资料/外键已验证，未转换旧凭证会让迁移拒绝并回滚。
- [x] 完成 Better Auth 原生配置、依赖/Secrets/常量适配与 21 项 workerd/D1 探针；这不表示完整认证流程已接通。
- [x] 完成 PLAN T2.7：库原生 schema/业务成员与注册预留增量迁移、依赖/Secrets/常量适配、原生行为探针和关于页新文案验收。
- [x] 迁移前端基础并通过桌面/手机、浅/深色验收；关于页 Better Auth 新文案截图见 [新版验收记录](docs/screenshots/phase2-better-auth/README.md)，旧截图仅作历史参考。
其余原型页面的展示组件、布局、样式和已定稿交互随第三至第五阶段的对应功能迁移，适配 loader / action 与真实数据；正式工程不依赖原型目录，不沿用演示认证和权限。逐页迁移的剩余工作按对应阶段验收。

### 3. 邀请、账号与管理（已完成本阶段验收）

- [x] 接入 Better Auth 和邀请注册预留/创建/完成；本地集成测试覆盖默认用户名/密码、邀请码与失败续作、成员门禁、跨站/IP 限流/Turnstile 和精确邮件配额。
- [x] 完成内部邀请注册核心与 0010 归属/原子提交约束；实际读取原生身份，冲突不消费码，部分账号仅由同一尝试续作，并发不重复建号。HTTP 防护、发信回调和原型式页面现已接入，实际邮件与平台小样本结果见下一项。
- [x] 实现 Postal HTTPS 发信传输与五项环境配置绑定；模拟服务验证单次请求、HTTP / 业务错误、超时及脱敏。实际投递和业务回调见下一项，不因传输测试通过标为完成。
- [x] 完成已购 Postal 发件服务的 staging 验收；API 文档/地址和 From / Reply-To 已确认，staging Secret、原生签名邮箱验证、邮箱重置链接、成员发信限流、待验证账号门禁及失败处理已接入。验证/找回邮件实际通过，站长确认上游额度每小时 3,000 封、每日 24,000 封（需求 6.0）。production 邮件凭证在第六阶段上线前配置。
- [x] 完成已登录成员的原生改邮箱与本人会话确认；验证新邮箱前保留旧邮箱，不提供匿名改邮箱、不预占待邮箱、不承诺撤销未过期旧重置链接。
- [x] 接入通行密钥选项/UV 钩子、TOTP/备用码、滚动会话、改密、邮箱找回及故障处置；备用码仅第二因素，旧密码恢复码/管理员重置路径关闭。
- [x] 补齐其他成员管理对话框和多层邀请关系的桌面/手机浅深色浏览器检查；staging 原生 scrypt 哈希/校验及最多 2 路并发小样本、凭证日志脱敏通过。
- [x] 站长确认真实 TOTP 绑定、密码加动态码/备用码登录、备用码余量减少及电脑撤销手机会话有效，D1 已核对 TOTP 验证/启用状态。
- [x] 站长确认 staging HTTPS 上通行密钥登录手工验收成功，D1 已核对绑定存在；UV 选项/钩子另有自动检查，第三阶段验收完成。
- [x] 完成邀请码管理、成员与邀请链查询、额度调整、角色变更、封禁与解除单个成员封禁（不连带、需绑定 TOTP 和新鲜会话），以及首管由本机运维提升；验证管理员权限、自封禁/自降权保护和确认后的连带范围。

### 4. 片库与播放闭环（功能/长时与设计修复复验通过，真实手机待验收）

- [x] 修复 staging 导航延迟：批量查询卡片/统计、限定作品及首页必要单集，视图/排序在客户端切换；测试和线上复测通过，保持原生会话及逐请求权限检查。

- [x] 资料占位、固定命名与服务器每 5 分钟扫描通过本地及 staging 验收；真实 TMDB 27 部作品、52 季、974 个单元已初始化。0012、生成媒体定时关联、非法字幕修复后自动重试及重复初始化保留 ID/引用/实际时长通过。
- [x] 成员首页、片库、作品/选集和受保护全站搜索已接入正式数据；推荐起点、双语过滤、资料/图片回退、切季和空态功能已验证。设计一致性复验另列待办，不以功能通过替代。
- [x] ArtPlayer、短时 token、续期、R2 Range 和中英文 VTT 通过本地及 staging HTTP/浏览器验证；121 分钟生成视频以 1 倍速自然播完，四次播放中自然续期均 200、字幕/位置保持。平台 CPU/内存/错误和凭证日志已核对，见[验收记录](docs/screenshots/phase4/README.md)。
- [x] 修复[原型一致性审查](docs/design-audit-20261007.md)的 12 项偏离，当前实现范围的布局/控件/键盘/短屏复验通过，见[修复证据](docs/screenshots/design-fixes-20261007/README.md)；staging 已更新并核对绑定、定时扫描与实际播放。
- [ ] 真实手机搜索输入/切季、触屏拖动、中英文字幕及原生全屏待站长反馈；320/375 px 和短屏/横屏设计复验已通过，仍不能代替实机。收到并完成真实手机验收后才结束第四阶段。

### 5. 观看进度、片单与讨论

- [ ] 完成进度上报、跨设备继续观看、自动 / 手动已看状态和下一集提示，按确认规则处理并发与迟到上报，修正切集起点和继续观看漏项。
- [ ] 将作品收藏、有序片单和站内公开读取接入正式数据，验证所有者写权限、私有片单隔离、重排一致性，以及队列展开、首次去重、跳过已看、逐单元续播和结束提示。
- [ ] 将评论、回复、赞踩、排序、分页、发送反馈及管理员删除接入正式后端，验证讨论归属、持久化、正文安全、整段删除和并发一致性；被删内容不留占位或可访问入口，数量与分页按剩余记录更新。

### 6. 运维与上线验收

- [ ] 完成仅 `OWNER_EMAIL` 匹配管理员可用的站内备份页、手动创建/重试、加密下载与 WebDAV / S3 保存，以及外部目标配置完整后才可启用的频率/时间设置；共用 D1 → R2 流程，验证回读校验、失败处理、各端保留与隔离手动恢复，确认媒体冷备与历史密钥可用（PLAN T6.1）。
- [ ] 在 staging 完成端到端验收：未登录 / 越权访问、封禁与续期、并发幂等、日志脱敏、noindex、备份恢复及真实平台限制；实测网页备份执行生命周期与中断重试、定时全流程 15 分钟窗口、Time Travel 隔离能力、限流与 scrypt 行为。
- [ ] 所有主要功能（认证与管理、片库与播放、进度/片单/讨论、备份与恢复）开发完成并通过相关测试和 staging 验收后，补齐 production 独立配置与 Secrets；获站长明确授权后执行正式迁移、部署及 HTTPS、权限和安全头验收（PLAN T6.2）。
- [ ] 验证目标规模下的播放体验和预算，补齐本地启动、部署及恢复说明，再发布 v1。

HLS、ASS 渲染、弹幕、同时播放数限制、OAuth 登录等范围外功能不纳入本清单；邮箱验证、邮件发信和成员自助修改注册邮箱已纳入 v1，完整范围以需求文档为准。

## 技术栈（计划）

- 运行时：Cloudflare Workers
- 框架：React Router v7（框架模式）
- 数据库：Cloudflare D1，认证与业务资料均保存在站长自己的数据库
- 认证：Better Auth 1.7.7 + username/twoFactor/captcha 与同版 passkey 插件（原生认证与本站必要 HTTP 门禁已接通，真实设备/平台验收待完成）
- 媒体存储：Cloudflare R2（私有）
- 播放器：ArtPlayer

工具链基线（`cf` CLI、`@cloudflare/vite-plugin` 2.0 beta、Workers Vitest）及已知限制见 [`PLAN.md`](PLAN.md) 第 2 节。

## 本地开发

需要 Node 22.18+（推荐 24）和 pnpm 12。正式工程在仓库根目录，与 `prototypes/frontend-v1/` 互不依赖。

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars   # 本地占位 Secrets，不提交
pnpm db:migrate:local            # 先应用 D1 迁移，状态与 cf dev 共用
pnpm dev                         # cf dev，监听 0.0.0.0:6120
```

启动前检查 6120 端口，已有实例则复用。当前服务在 802b 任务工作树监听 `0.0.0.0:6120`；`/login`、`/register`、`/forgot-password`、`/reset-password`、`/verify-email`、`/verify-pending` 是公开账号流程。`/` 对访客展示登舰入口，对成员展示片库首页；`/series`、`/movies`、`/title/:id`、`/watch/:id`、`/account`、`/invites` 是成员页，`/admin` 仅正常管理员可用。权限由页面和 JSON 接口分别校验，访客受保护页面跳回登录并保留返回目标。`/about` 保持公开；播放授权、媒体与字幕入口分别为 `/playback/:id/authorize`、`/media/:id`、`/subtitles/:id`，不暴露私有存储地址。

已有 `.dev.vars` 需补入至少 32 字符的 `BETTER_AUTH_SECRET`，与播放/备份密钥独立；旧 `TOTP_ENCRYPTION_KEY` 不再声明。测试只用 `.dev.vars.example` 的虚构占位值，不读取本机真实 Secrets。原生认证表由 `cf` 版本化迁移管理，不在请求中自动迁移；D1 的原生 DATE 列实测存 ISO 8601 文本，与旧业务表 UTC 毫秒列分别处理。

本地迁移现包含 0011：0010 保护注册归属与业务完成，0011 在密码写入时原子撤销旧会话，并在封禁时原子作废未用码及删除会话，未改写已应用迁移。正式注册只开放带 Origin、业务 CSRF、人机验证和原生限流的 `/auth/register`；直接 sign-up、邮箱密码直登、管理员重置及多余库端点关闭。原生多步流程仍可能部分成功，错误不表示密码或凭证状态一定回滚。

Better Auth 的原生结构检查保留在 test 模式；development/staging/production 使用版本化迁移和测试验证结构，避免每次新建认证实例重复读取数据库元数据。原生会话滚动更新与主库成员状态仍逐请求校验。

| 命令 | 作用 |
| --- | --- |
| `pnpm db:migrate:local` | `cf d1 migrations apply`：将 `migrations/` 应用到本地占位 D1，持久化到被忽略的 `.cloudflare/state`，可重复运行 |
| `pnpm db:migrate:staging` / `pnpm db:migrate:production` | 授权后应用远程增量迁移；通过 cf 的临时 SQL 副本规避 D1 触发器解析问题，不改写已应用迁移 |
| `pnpm typecheck` | 由 `cloudflare.config.ts` 生成绑定类型、生成路由类型，再运行 `tsc` |
| `pnpm test:tools` | 本机 bootstrap、首管提升、导入预检与远程迁移传输兼容测试，不触及云端 |
| `node scripts/import-media.mjs preflight --environment staging --mapping <本机 JSON>` | 只读本机媒体与 TMDB 预检；[输入契约](docs/import-media.md) |
| `node scripts/import-media.mjs catalog --environment staging [--execute]` | 完整资料占位；默认只预检，显式 execute 才经 cf 原子初始化 D1；媒体独立上传后由服务器验证关联 |
| `pnpm admin:bootstrap` | 明确选择环境的初始邀请码/首管提升命令，默认只预检，见下文 |
| `pnpm test` | Workers Vitest：在 workerd 中运行 Worker，D1 / R2 使用本地模拟；每条用例重置绑定并应用 `migrations/`，Secrets 取 `.dev.vars.example` 的占位值 |
| `pnpm build` | development 模式构建到 `.cloudflare/output/v0` |
| `pnpm build:staging` / `pnpm build:production` | 按环境构建；需要本机 `.env`（见 `.env.example`），缺少资源标识时构建失败 |
| `cf deploy --prebuilt --mode staging --dry-run` | 检查 staging 构建产物与绑定，不上传 |

`cloudflare.config.ts` 按 mode（`development`、`test`、`staging`、`production`）返回各自独立的 Worker、D1、R2 和 Rate Limiting 配置。真实的账号 ID、D1 ID 和站点 Key 只放在被忽略的 `.env`，线上 Secrets 由站长授权后写入 Worker Secrets；`deploy:staging` / `deploy:production` 脚本只在站长明确要求时运行。开发期间使用本地与 staging；production 构建 / dry-run 仅验证准备状态，正式迁移、Secrets 上传和部署须等主要功能完成后按 PLAN T6.2 执行。

已授权的云端配置复用既有 Worker，D1 名称/ID 与媒体桶名由 `.env.example` 所列环境变量分别映射；旧 staging 数据库因 schema 不兼容而保留，当前工程使用新库，不对旧库套用迁移。staging 沿用原有自定义域名，production 使用本文确定的正式域名；Custom Domain 由 `worker.domains` 管理，workers.dev 与版本预览入口关闭。

远程迁移使用 `pnpm db:migrate:staging` / `pnpm db:migrate:production`。staging 实测 D1 `/query` 将 0010 触发器内裸 `CASE…END` 错认作触发器结束，整份 0010 回滚；[Cloudflare 问题记录](https://github.com/cloudflare/workers-sdk/issues/4727)描述同类行为。脚本仅在临时副本给该表达式加等价括号，再交给 `cf d1 migrations apply --dir`，由 CLI 正常记录原文件名并执行增量判断；原始文件和本地已应用迁移不改写，临时文件执行后清除。SQLite 验证合法邀请原子完成、过期邀请完整拒绝。不要直接重复失败的原始远程命令，也不使用 Wrangler 兜底。

`bindings.secret()` 在实际部署时要求值齐全。当前声明认证、播放、Turnstile、备份加密与 EMAIL_API_KEY 五项；备份 API Token 和启用的 WebDAV / S3 目标凭证随对应模块再声明，禁止用样例值满足线上检查。服务端站长变量 OWNER_EMAIL 也随备份模块加入，当前尚未声明或校验。邮件配置使用 .env.example 中的 STAGING_EMAIL_* / PRODUCTION_EMAIL_*；API 基础地址必须为 HTTPS origin，发件人域名须匹配 EMAIL_SENDER_DOMAIN。传输只发送纯文本正文、最多等待 10 秒、不跟随重定向或自动重发；业务配额、失败记录和认证回调已接入；验证用途共享邮箱摘要配额，找回单独计数，失败/未确认也计入。真实投递与上游套餐限额仍待核对。

本机 `.dev.vars.staging.secrets.json` / `.dev.vars.production.secrets.json` 是被忽略的独立密钥交接文件，只含原有四项密钥，未包含站长另行配置的 EMAIL_API_KEY；production 不能仅凭该文件通过正式部署检查。授权部署时可用 `pnpm exec cf deploy --prebuilt --mode staging --secrets-file .dev.vars.staging.secrets.json` 上传文件中的密钥；既有 EMAIL_API_KEY 由站长在对应 Worker 配置，不复制 staging 的值到 production。密钥还须由站长保存到密码管理器和离线副本，保管/轮换见需求 6.9.1。

线上启用应用日志和 query 脱敏，关闭含请求 URL 的 invocation logs；原生 traces 的凭证路径脱敏验证前保持关闭。配置核对和页面冒烟检查不替代第六阶段的真实日志内容、安全与性能验收。

staging 另测发现 Cloudflare 会给应用日志附加请求 URL/路径，即使 invocation logs 已关闭。重置链接凭证位于原生路径中，因此 `/api/auth/reset-password/` 不产生应用日志，避免平台再次附加原文；Better Auth 原始日志保持关闭，其他请求仍记录白名单路由族、状态与请求标识。query token 由平台 `redact_query_string` 剔除。

实际 Workers 的邮件 fetch 使用 `redirect: "error"` 会在发出请求前抛错，改为 `manual` 并拒绝所有非 2xx（包含 3xx）。一次请求、不跟随重定向、不自动补发及 10 秒上限保持不变；匿名探针只证明 Postal 可达，实际投递以收信和验证结果为准。

2026-10-06 第三阶段 staging 部署遇到 cf beta.12 的固定严格检查：配置差异以及“最近由 API 更新”均会拒绝上传，CLI 没有覆盖参数。站长明确授权本次 staging 使用官方 API；保存旧配置快照后激活已配置的邮件 Secret 版本、同步邮件/RP ID、清除旧 Cron，再按[官方静态资源上传流程](https://developers.cloudflare.com/workers/static-assets/direct-upload/)上传同一份已验证 Build Output。代码与资源最终已在线；静态 `_headers` 元数据及关键绑定复核通过。临时部署脚本和私密快照只在忽略目录，不改变后续使用 cf 的规则。实际邮件测试使用站长指定地址，真实地址和注册链接不写入公开文档。

测试数据工厂 `test/fixtures/catalog.ts` 只创建虚构成员、作品、季和集。需要媒体夹具时，安装 PATH 上可用的 ffmpeg 后运行 `node scripts/gen-test-media.mjs`：生成 4 秒 H.264 + AAC、faststart 的 MP4 到被忽略的 `test/fixtures/media/`，可重复生成。自行编写的中英文 VTT 在 `test/fixtures/subtitles/` 中随代码提交；约束测试不依赖生成的 MP4。

## 本机初始邀请码与首个管理员

从工作树根目录执行，必须明确选择环境，默认只预检；实际写入需显式增加 `--execute`：

```bash
pnpm admin:bootstrap invite --env=development
pnpm admin:bootstrap invite --env=development --execute
pnpm admin:bootstrap promote <已验证用户名> --env=development --execute
```

初始邀请码没有虚构发出人，默认 30 天有效，原码只在执行成功后显示一次，数据库只存摘要。用它正常注册并验证邮箱，再提升首管；网页注册不能赋予管理员身份。staging / production 将环境名换成对应值，数据库 ID 从忽略的 .env 读取；云端实际执行仍须站长明确授权，不能用 staging 的邮箱或密钥代替 production。

`cf` beta.12 的 D1 query 暂不支持本地执行。本地实际命令使用其 migrations runner 执行同一条条件 SQL，以专用 `local_admin_operations` 元数据表记录，不混入正式迁移目录；条件影响行数不为 1 时整批回滚。线上使用参数化 D1 query，临时 SQL/JSON 文件执行后删除，不回退到 Wrangler。

## 本地认证验收边界

本地官方 Turnstile 测试服务返回 example.com 且没有 action。仅在 development 且 Site Key / Secret 均等于官方 always-pass 配对时接受这一测试响应；test、staging 和 production 仍严格检查本站 hostname 与 auth action。客户端保留原型窄卡片，在容器小于 300px 时切换官方 compact 控件，并预留其高度；[控件尺寸依据](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/#widget-sizes)。

局域网验收须将本地 .env 中的 `APP_ORIGIN` 配为实际访问 origin；RP ID 随该 origin 的 hostname 生成，来源校验不因调试而放宽。通行密钥还需浏览器认可的安全上下文；实际设备和部署 HTTPS 的验收仍在 PLAN 中保留。

测试并发设为两路，避免原生密码哈希与 Worker 模块图同时争用 CPU。HTTP suite 单独预热 SSR 编译，允许最多 60 秒；普通单请求仍保留原来的 5 秒测试阈值。模拟发信不向真实服务发送邮件，浏览器验收仅使用虚构本地账号。注册、改邮箱和重置失败可能留下部分原生状态，相关故障注入与重试行为见测试和需求 6.4.1。

## 许可证

[MIT](LICENSE)。海报等第三方素材的版权归原权利人所有，不适用本许可证。
