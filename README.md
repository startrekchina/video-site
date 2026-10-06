# video-site

星际迷航中国（StarTrekChina）粉丝社区的邀请制私人观看站，计划部署在 `video.startrekchina.org`。

## 当前状态

v1 产品范围及需求第 6.13、6.16 节列出的业务、运维策略已确认，对应接口行为和第 7 节测试期望已同步。邮箱验证、成员修改邮箱、管理员删评和单个成员解封均纳入 v1；发信沿用站长已购买服务的 HTTPS API。历史备份恢复后保留讨论，由管理员手动重新删除不应恢复的内容。

规则确认**不代表功能已实现或已验收**：正式开发处于第二阶段“工程基础”，工程骨架、环境声明、D1 迁移 / 约束 / 夹具和前端基础已落地。Better Auth/passkey 已锁定 1.7.7，原生服务端配置、认证表 0008 迁移、Secrets/常量适配及 21 项新基线探针完成，全部 105 项 Workers 测试、类型检查、构建和本地迁移通过。staging 已复用站长既有 Worker、域名和私有媒体桶，隔离新 D1 应用 8 个迁移，四项 Secrets 与正式工程部署及 HTTPS 冒烟检查通过；production 资源映射和独立密钥已准备，尚未上线。T2.7 的旧成员/业务外键/凭证迁移与关于页新文案尚未完成；认证 HTTP 路径尚未挂载，完整邀请/权限/发信流程按第三阶段接入。旧 POC 的 29 项测试保留作历史差距证据；已购发件服务、备份外部凭证和平台实测仍待完成。详细进展见 [`PLAN.md`](PLAN.md)。前端参考原型保留在 `prototypes/frontend-v1/`。

## 文档

- [需求文档](docs/requirements.md)：v1 的范围、用户故事、实现决策、前端代码沿用要求和测试决策。
- [正式开发计划](PLAN.md)：执行约束、技术基线、当前阶段的可验收待办和未决事项。
- [协作约定](AGENTS.md)：语言、Git 流程、目录结构和安全规则。
- [前端参考原型](prototypes/frontend-v1/README.md)：独立运行方式、页面与交互基准、验证记录和迁移时须修正的已知问题。
- [前端基础验收记录](docs/screenshots/phase2/README.md)：正式关于页 / 404 的桌面、手机和浅 / 深色截图及交互核对。
- [认证历史 POC](spikes/better-auth/REPORT.md)：旧需求的行为/差距证据，归档在 `dev` 的独立实验目录；运行命令见报告，正式工程不依赖它。
- [海报素材说明](public/assets/posters/star-trek/README.md)：海报来源和命名规则。

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
- [x] 确认限流数值、备份调度与保留、WebDAV 回读校验、密钥手动轮换、恢复与重开策略，以及历史讨论在恢复点中由管理员人工复核重删；接口契约与第 7 节测试期望同步冻结。
- [x] 整理可重复运行的原型参考版本和验证记录；原型保留在 `prototypes/frontend-v1/`，已知缺陷不作为正式版预期行为。

### 2. 工程基础

- [x] 建立根目录 `PLAN.md`，把功能顺序和验收条件整理为可执行待办；工具链已在本机探针中验证。
- [x] 使用 `cf` CLI 建立 React Router v7 + Workers 正式工程，配置类型检查、构建和 Workers Vitest 测试入口；不使用 Wrangler。
- [ ] 配置隔离的 staging / prod Worker、D1、私有 R2 和 Secrets；staging 当前工程、8 个迁移、四项 Secrets 及 HTTPS 冒烟检查通过。production 资源与独立密钥已准备，尚未迁移或部署；邮件/备份外部凭证仍待提供。
- [x] 完成 Better Auth 旧规则 POC 与差距报告；29 项测试是行为/差距证据，不等于新方案验收。
- [x] 站长决定调整需求并采用 Better Auth；需求、接口、验收和计划已同步，变更索引见需求 6.3.4。
- [x] 落地旧基线 D1 迁移/约束与虚构成员、生成媒体/字幕夹具；已新增锁定库的原生认证表，旧成员与业务外键仍待迁移。
- [x] 完成 Better Auth 原生配置、依赖/Secrets/常量适配与 21 项 workerd/D1 探针；这不表示完整认证流程已接通。
- [ ] 完成 PLAN T2.7：库原生 schema/业务成员与注册预留增量迁移、依赖/Secrets/常量适配、原生行为探针和关于页新文案验收。
- [x] 迁移前端基础并通过当时的桌面/手机、浅/深色验收；关于页旧恢复文案与链接待 T2.7 更新，截图已标作历史。
- [ ] 按页面或流程迁移原型的展示组件、布局、样式和已定稿交互，适配 loader / action 与真实数据；正式工程不依赖原型目录，不沿用演示认证和权限。

### 3. 邀请、账号与管理

- [ ] 接入 Better Auth 和邀请注册的预留/创建/完成流程；验默认用户名/密码、一次性邀请码与失败续作、访问门禁、原生跨站/IP 限流/Turnstile 和业务配额。
- [ ] 接入已购发件服务的 API 文档与真实配置，核对套餐限额；完成原生签名邮箱验证、邮箱重置链接、成员发信限流、待验证账号访问限制和投递失败处理（见需求文档第 6.0 节）。
- [ ] 完成已登录成员的原生改邮箱与本人会话确认；验证新邮箱前保留旧邮箱，不提供匿名改邮箱、不预占待邮箱、不承诺撤销未过期旧重置链接。
- [ ] 完成 UV 通行密钥、TOTP/二步备用码、滚动会话、改密、邮箱找回及失败处置；备用码仅第二因素，移除恢复码重设密码/管理员重置流程。
- [ ] 完成邀请码管理、成员与邀请链查询、额度调整、角色变更、封禁与解除单个成员封禁（不连带、需绑定 TOTP 和新鲜会话），以及首管由本机运维提升；验证管理员权限、自封禁/自降权保护和确认后的连带范围。

### 4. 片库与播放闭环

- [ ] 完成离线导入 CLI：manifest / TMDB 双语资料、MP4 格式与 faststart 预检、字幕转 VTT、R2 / D1 挂接及幂等重试。
- [ ] 将访客入口、成员首页、片库网格与时间轴、作品和选集页面接入正式数据，验证站长配置的三个推荐起点、版权联系、搜索、资料回退、海报和单集剧照状态。
- [ ] 适配已有 ArtPlayer 集成，接入短时播放 token、自动续期、R2 Range 和中英文字幕授权；验证拖动、键盘控制及两小时播放不中断。

### 5. 观看进度、片单与讨论

- [ ] 完成进度上报、跨设备继续观看、自动 / 手动已看状态和下一集提示，按确认规则处理并发与迟到上报，修正切集起点和继续观看漏项。
- [ ] 将作品收藏、有序片单和站内公开读取接入正式数据，验证所有者写权限、私有片单隔离、重排一致性，以及队列展开、首次去重、跳过已看、逐单元续播和结束提示。
- [ ] 将评论、回复、赞踩、排序、分页、发送反馈及管理员删除接入正式后端，验证讨论归属、持久化、正文安全、整段删除和并发一致性；被删内容不留占位或可访问入口，数量与分页按剩余记录更新。

### 6. 运维与上线验收

- [ ] 完成每日 D1 → R2 备份及加密 WebDAV 副本，验证失败处理、保留清理和手动恢复；确认媒体冷备与历史解密密钥可用。
- [ ] 在 staging 完成端到端验收：未登录 / 越权访问、封禁与续期、并发幂等、日志脱敏、noindex、备份恢复及真实平台限制；实测备份全流程 15 分钟窗口、Time Travel 隔离能力、限流与 scrypt 行为。
- [ ] 验证目标规模下的播放体验和预算，补齐本地启动、部署及恢复说明，再发布 v1。

HLS、ASS 渲染、弹幕、同时播放数限制、OAuth 登录等范围外功能不纳入本清单；邮箱验证、邮件发信和成员自助修改注册邮箱已纳入 v1，完整范围以需求文档为准。

## 技术栈（计划）

- 运行时：Cloudflare Workers
- 框架：React Router v7（框架模式）
- 数据库：Cloudflare D1，认证与业务资料均保存在站长自己的数据库
- 认证：Better Auth 1.7.7 + username/twoFactor/captcha 与同版 passkey 插件（配置、认证表及探针已落地，HTTP 流程待接通）
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

启动前检查 6120 端口，已有实例则复用。工程基础验收时服务运行于集成工作树 `.worktree/dev`；`/about` 是公开关于页，未知路径显示 404，`/` 暂为工程首页。登录、注册、邮箱找回和二步备用码按后续阶段实现。旧认证表和关于页恢复文案待 T2.7 迁移，不以展示链接或原生探针表示完整认证已完成。浏览器截图与核对见 [验收记录](docs/screenshots/phase2/README.md)。

已有 `.dev.vars` 需补入至少 32 字符的 `BETTER_AUTH_SECRET`，与播放/备份密钥独立；旧 `TOTP_ENCRYPTION_KEY` 不再声明。测试只用 `.dev.vars.example` 的虚构占位值，不读取本机真实 Secrets。原生认证表由 `cf` 版本化迁移管理，不在请求中自动迁移；D1 的原生 DATE 列实测存 ISO 8601 文本，与旧业务表 UTC 毫秒列分别处理。

| 命令 | 作用 |
| --- | --- |
| `pnpm db:migrate:local` | `cf d1 migrations apply`：将 `migrations/` 应用到本地占位 D1，持久化到被忽略的 `.cloudflare/state`，可重复运行 |
| `pnpm typecheck` | 由 `cloudflare.config.ts` 生成绑定类型、生成路由类型，再运行 `tsc` |
| `pnpm test` | Workers Vitest：在 workerd 中运行 Worker，D1 / R2 使用本地模拟；每条用例重置绑定并应用 `migrations/`，Secrets 取 `.dev.vars.example` 的占位值 |
| `pnpm build` | development 模式构建到 `.cloudflare/output/v0` |
| `pnpm build:staging` / `pnpm build:production` | 按环境构建；需要本机 `.env`（见 `.env.example`），缺少资源标识时构建失败 |
| `cf deploy --prebuilt --mode staging --dry-run` | 检查 staging 构建产物与绑定，不上传 |

`cloudflare.config.ts` 按 mode（`development`、`test`、`staging`、`production`）返回各自独立的 Worker、D1、R2 和 Rate Limiting 配置。真实的账号 ID、D1 ID 和站点 Key 只放在被忽略的 `.env`，线上 Secrets 由站长授权后写入 Worker Secrets；`deploy:staging` / `deploy:production` 脚本只在站长明确要求时运行。

已授权的云端配置复用既有 Worker，D1 名称/ID 与媒体桶名由 `.env.example` 所列环境变量分别映射；旧 staging 数据库因 schema 不兼容而保留，当前工程使用新库，不对旧库套用迁移。staging 沿用原有自定义域名，production 使用本文确定的正式域名；Custom Domain 由 `worker.domains` 管理，workers.dev 与版本预览入口关闭。

`bindings.secret()` 在实际部署时要求值齐全。当前只声明四项已准备的 Secrets；邮件 API、备份 API Token 和 WebDAV 凭证随对应模块接入再声明，禁止用样例值满足线上检查。本机 `.dev.vars.staging.secrets.json` / `.dev.vars.production.secrets.json` 是被忽略的独立密钥交接文件，授权部署时可用 `pnpm exec cf deploy --prebuilt --mode staging --secrets-file .dev.vars.staging.secrets.json` 上传。密钥还须由站长保存到密码管理器和离线副本，保管/轮换见需求 6.9.1。

线上启用应用日志和 query 脱敏，关闭含请求 URL 的 invocation logs；原生 traces 的凭证路径脱敏验证前保持关闭。配置核对和页面冒烟检查不替代第六阶段的真实日志内容、安全与性能验收。

测试数据工厂 `test/fixtures/catalog.ts` 只创建虚构成员、作品、季和集。需要媒体夹具时，安装 PATH 上可用的 ffmpeg 后运行 `node scripts/gen-test-media.mjs`：生成 4 秒 H.264 + AAC、faststart 的 MP4 到被忽略的 `test/fixtures/media/`，可重复生成。自行编写的中英文 VTT 在 `test/fixtures/subtitles/` 中随代码提交；约束测试不依赖生成的 MP4。

## 许可证

[MIT](LICENSE)。海报等第三方素材的版权归原权利人所有，不适用本许可证。
