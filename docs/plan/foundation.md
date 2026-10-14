# 工程基础与环境

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A1/A7/A8、B 6.1/6.2/6.14/6.15。第二阶段 T2.1–T2.7 已完成；认证专属基础见 authentication，云端发布和备份见 operations。第一阶段已确认需求、原型基线及已知缺陷，原始完成记录保留在归档，不再重复维护。

## 任务与验收摘要

- [x] DOC1 文档职责调整为 A/B 与核心/模块计划四层，链接、内容保留、任务状态及敏感信息检查通过；[检查记录](../documentation-restructure-20261011.md)。
- [x] DOC2 按站长要求继续精炼 A，保留八项核心能力及目标/范围；细则承接、链接和差异检查通过，不改变产品或阶段状态，见[精炼记录](../documentation-restructure-20261011.md#核心需求二次精炼)。
- [x] DOC3 分离协作规则与项目结论，删减内容承接、临时授权记录、维护规则入口及文档链接/状态/差异检查通过；A/B 与功能里程碑不变，见[整理记录](../documentation-restructure-20261011.md#协作规则与项目结论分离)。

文档验证（[PR #19](https://github.com/startrekchina/video-site/pull/19)）：缓存、续期、人机验证及文档职责边界的 8 份文档自检通过，涵盖 132 个本地链接/锚点、既有待办状态、续期默认值和 `git diff --check`；E2E1 与 T4.5 保持待实施。

成熟库优先原则与[项目进展简报](../progress.md)已落实到文档；五章结构、协作称呼、状态依据、入口链接及差异检查通过，未调整功能实现或验收状态。

- [x] T2.1 建立执行计划并同步 README；原建立记录见历史归档。
- [x] T2.2 工程骨架、公开响应安全头、robots、类型检查、构建和 Workers 测试入口落地。
- [x] T2.3 本地/staging 配置与 Secrets 可用，staging/production 隔离声明、资源映射及构建/dry-run 通过；production 发布属于 T6.2。
- [x] T2.5 版本化 D1 迁移、约束与虚构数据/生成媒体夹具通过；认证迁移由 authentication 维护。
- [x] T2.6 前端基础从原型单向迁入；关于页/404 的桌面、手机、浅深色、主题及键盘复核通过。其余页面按各模块验收。
- [ ] E2E1 建立少量关键路径的 Playwright Test 回归：先确认首批场景与环境，再接入隔离数据、真实页面操作、可按场景筛选的执行入口及失败证据保护；方案见[浏览器验证方案](#浏览器验证方案)。未接入不宣称自动化浏览器回归已通过。

证据：[基础截图](../screenshots/phase2/README.md)、[新认证文案截图](../screenshots/phase2-better-auth/README.md)、[历史计划](../archive/plan-20261007.md)。命令与日常使用见根 README，不复制完整开发日志。

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
- **`cf build` 不向 React Router 转发 `--mode`**：staging / prod 构建改用 `react-router build --mode <mode>`，部署用 `cf deploy --prebuilt --mode <mode>`（mode 须与构建一致）。本地开发直接 `cf dev`（mode 为 `development`）。
- **D1 迁移命令只接受数据库 ID**：本地用固定的占位 ID（全零 UUID 变体）并 `--local --persist-to .cloudflare/state`，与 `cf dev` 的本地状态目录一致；staging / prod 的真实 ID 由被忽略的 `.env` 注入 `cloudflare.config.ts`，命令行同样从本机读取，不写入仓库。
- **远程 D1 触发器解析**：staging 的 `/query` 将 0010 内裸 `CASE…END` 错认作触发器结束；该迁移完整回滚，0009 已成功。[同类问题](https://github.com/cloudflare/workers-sdk/issues/4727)用等价括号规避。`pnpm db:migrate:staging` / `db:migrate:production` 只规范临时副本，再交给 cf 的增量迁移 runner，原始迁移不改写；SQLite 正反用例及 staging 0010/0011 实测通过。
- **环境隔离**：`cloudflare.config.ts` 按 `mode`（`development` / `test` / `staging` / `production`）返回完整配置；Worker 名、D1、R2、Rate Limiting namespace 和 `APP_ENV` 各自独立，缺失真实资源标识时拒绝构建 staging / prod。
- **Secrets**：以 `bindings.secret()` 声明，本地开发缺失时警告，**实际部署会拒绝缺少声明的 Secret**。当前声明认证、播放、Turnstile、备份加密与邮件五项；备份 API Token 与启用的 WebDAV / S3 目标凭证在对应模块接入时再声明，不上传占位凭证。线上可用部署时 `--secrets-file` 写入，密钥文件必须被 Git 忽略；既有四项密钥交接文件不包含站长另行配置的 EMAIL_API_KEY，不能据此宣称 production 已齐备。
- **云端复用与日志**：按站长授权复用既有 staging Worker 与访问域名，D1 名称/ID 和 R2 桶名分别从本机 `.env` 注入，不能按数据库名推断媒体桶。Custom Domain 通过 `worker.domains` 管理；关闭 workers.dev / preview URLs。启用应用日志、query 脱敏并关闭 invocation logs；原生 traces 含路径，凭证路径脱敏验证前保持关闭。

### 6.1 总体架构

- 全站使用 React Router v7 框架模式，前后端作为一个 Worker 部署在 Cloudflare Workers 上。页面的登录校验在服务端的 loader 中完成。
- D1 存放所有结构化数据，包括 Better Auth 用户、凭证、会话、验证状态与插件表，以及邀请码、剧集资料、观看进度、片单和讨论。Better Auth 是运行在本站 Worker 内的开源认证库，不使用其托管身份服务，用户资料保存在站长自己的 D1；关闭库 telemetry。发件服务仅接收投递所需邮箱和邮件内容。
- R2 存放媒体文件和字幕文件。R2 存储桶不公开，只通过 Worker 访问。
- 海报和非播放页选集列表使用的小尺寸单集剧照留在仓库的 `public/` 目录下，作为 Workers 静态资源公开访问，不需要登录。站长知道这样会让外人看出这是一个星际迷航站，并接受这一点。
- 单集剧照以 `public/assets/stills/star-trek/manifest.json` 为准，按作品 TMDB ID、季号、集号匹配，可为空。默认输出 240×135 的 WebP（质量 55），保留原始画面比例并补边；列表按小尺寸 16:9 展示，懒加载，加载失败时保留同尺寸占位。播放页的选集列表不显示剧照，视频时间轴的预览缩略图仍在范围外。
- 界面以简体中文为主，不做 i18n；保留原型中的英文作品回退资料、字幕语言名称、星图标注、等宽辅助标签和评论时间格式。
- 全站返回 `X-Robots-Tag: noindex`，并配置 `robots.txt` 禁止所有爬虫。公开访客页同样不允许索引。
- 原型既是页面和交互基准，也是前端代码的迁移来源。正式应用使用 React Router 框架模式和真实的服务端权限校验，优先沿用经审查的页面、展示组件、样式和已定稿交互，不要求全面重写前端；原型保留、迁移边界和验收遵循 6.15。

#### 6.1.1 服务端边界与公共约定

- 路由模块负责 loader / action 的输入输出，认证、D1 查询、签名、R2 和备份逻辑放在 `*.server.ts` 或 Worker 服务端模块。浏览器构建不能引用 Secrets、数据库绑定或对象存储键。
- 每个受保护的 loader、action 和资源路由都单独校验会话、成员状态和权限，不能只依赖父布局 loader；框架的数据请求、预取和直接 HTTP 请求也受同一规则约束。`userId` 和角色取自服务端会话，不接受客户端指定当前身份。
- 会话 Cookie 按 Better Auth 的签名不透明 token 设置，生产命名 `__Host-session`，使用 `HttpOnly; Secure; SameSite=Lax; Path=/` 且无 `Domain`。D1 按原生 schema 保存 token 原值，Cookie 签名 Secret 独立保管；不再要求哈希会话表。库 Cookie 名映射和本地 HTTP 开发例外须实测，不能把本地属性当作生产验收。期限与改密行为见 6.3.3。
- 站点业务写入走 action 或非 GET 接口，校验 Origin 与 `APP_ORIGIN`、Fetch Metadata，并保留业务 CSRF token。Better Auth 入口使用库原生 Origin / Fetch Metadata / SameSite 防护，不再强制附加自定义 `csrfToken`；服务端 API 的包装入口同样先完成跨站检查，不能以内部调用跳过防护。验证邮件 GET 是 6.0.1 明确的例外。trustedOrigins 限于本环境，同源凭证，不开放跨域媒体；回跳限定本站。
- 站点业务 JSON action 成功结构为 `{ data, requestId }`，失败为 `{ error: { code, message, fieldErrors?, challenge? }, requestId }`。Better Auth API 保留原生 JSON、状态码、Cookie 与重定向，认证客户端消费 `code/message`、二步挑战及库客户端类型；中文文案由前端映射，不把全部库端点重写成业务 action。页面表单可 `303` 回跳，媒体返回字节流。
- `400` 表示格式或字段不合法；`401` 表示未认证或凭证无效；`403` 表示已认证但权限不足、CSRF 或挑战未满足；`404` 表示资源不存在或不可见；`409` 表示已消费、版本冲突或额度不足；`429` 表示限流；依赖暂不可用返回 `503`，意外错误返回脱敏 `500`。限流提供可重试信息，不能泄露内部 SQL、栈、R2 key 或上游原始错误。
- 稳定错误码至少区分 `AUTH_REQUIRED`、`AUTH_INVALID`、`CSRF_INVALID`、`TURNSTILE_REQUIRED`、`FRESH_SESSION_REQUIRED`、`INVITATION_INVALID`、`INVITATION_EXPIRED`、`INVITATION_USED`、`INVITATION_REVOKED`、`QUOTA_EXHAUSTED` 和 `REVISION_CONFLICT`；前端按 code 处理，不解析中文 message。邀请码无效使用 `400`，其已用/过期/作废及额度不足使用 `409`。
- 受保护 HTML 页面未登录时跳转登录页；6.5 列明的公开页无需登录，受保护 JSON 和媒体接口返回错误。登录、邮箱找回保留库脱敏语义；注册可返回库的用户名/邮箱冲突码，不能承诺注册入口完全隐藏账号存在性。邀请码失败仍明确区分状态，不返回邀请人的私人资料。
- 登录态 HTML、loader 数据、认证 action、邀请凭证和媒体响应使用 `Cache-Control: private, no-store`，禁止共享缓存绕过鉴权。公开静态资源可以按文件版本缓存；静态资源、重定向、错误和媒体响应同样带 `X-Robots-Tag: noindex`。Workers 静态资源头与 Worker 生成响应头分别配置，不能假定其中一处覆盖另一处。
- 动态响应设置 `Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`。浏览器不接收内部 R2 key/URL、Worker Secrets、密码哈希或 TOTP 密文；必要注册/绑定/签发流程只向有权接收者给出凭证材料，站长专用加密备份文件下载按 6.9.4 单独鉴权。Better Auth 自己的登录/会话端点可返回原生会话 token，按敏感凭证处理；本站会话列表仅给设备信息与 ID，撤销时在服务端映射 token。日志只记录请求 ID、路由模板、状态、错误码及必要资源 ID，不记录 Cookie、密码、邀请码、备用码、TOTP、完整 token/URL；平台 URL 日志也须验证脱敏。

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

首批候选从 B 第 7 节选取：受保护页面登录回跳；搜索、空结果、详情切季与正确单集；关键菜单/对话框的开关、取消及焦点；自生成视频播放、拖动、字幕与退出/撤销后的新媒体请求拒绝；在受控测试时间下真实续期，换 URL 后保留当前位置、暂停/播放状态和字幕，并能继续播放与拖动；封禁专用成员后刷新失去访问。续期的加速方法与 121 分钟长播证据分界见[播放验证方案](playback.md#续期验证方案)。实施前以中文确认具体操作和断言，不在本计划复制业务规则；新增注册、邮件及通行密钥场景时明确自动化覆盖段与真实服务/设备待验段。

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
- 原型 README 记录参考提交、启动和构建方法、页面与路由、已定稿交互及加载/空数据/失败/成功状态，并区分演示内容与正式规则。代表性的桌面和手机截图、验证结果及已知问题随参考版本保留；评估通过不等于全部功能或正式后端已经验收。
- 正式前端以沿用为默认路径：经代码审查确认符合本文后，将已有的纯展示组件、页面布局、样式、设计 token、响应式规则和已定稿的客户端交互复制或提取到正式工程。不要求从零重写全部页面；仅对运行环境、数据契约、安全边界或已知缺陷所需的部分进行适配或替换。依赖模拟数据的组件先分离数据来源，以正式 loader 数据、props 和 action 接入真实能力。
- 页面设计尽可能遵循对应原型的结构、分区列表、统计、表格、标签页与操作对话框，保留现有 token 和视觉层级。需求变化只调整必要字段与流程，迁移差异及原因记入逐页验收记录。
- 不迁移 PROTO 控制台、模拟身份切换、固定密码/验证码、假 token、假权限校验、内存业务账本和人为等待时间作为正式能力。认证、授权、会话、业务数据持久化和媒体签发由正式服务端落实；可保留真正的客户端 UI 状态，例如弹层、主题和未发送草稿。自生成测试片段及虚构成员仅用于测试，不能充当正式片库或成员记录。
- 迁移是单向的：代码进入正式工程后在正式目录维护。正式应用的源码、构建和运行不得通过 import、软链接、路径别名或共享包依赖 `prototypes/`；公共静态素材可按本文从 `public/assets/` 使用。原型保持参考版本，不必随正式产品的每次变更同步。
- 每批迁移按页面或流程审查 mock 是否清除、数据与权限契约是否正确、所需依赖是否支持目标运行环境；验证正式工程类型检查、构建、相关测试及桌面/手机视觉与交互。切集串用进度、继续观看漏项、自动播放仅切页、片单队列不一致等已知缺陷必须修正并纳入验收，不因代码来自已评估原型而豁免。


## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
