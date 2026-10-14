# video-site

星际迷航中国（StarTrekChina）粉丝社区的邀请制私人观看站，计划部署在 `video.startrekchina.org`。

## 当前状态

工程基础及第三阶段邀请、账号与管理已完成阶段验收。第四阶段片库、资料占位/自动关联、播放、121 分钟长时验证及 12 项原型偏离修复复验通过，**真实手机搜索/切季、触屏拖动、字幕和全屏反馈仍待完成**；下一项技术收尾为 [T4.5 请求级身份复用与 D1 往返优化](docs/plan/authentication.md#t45-请求级身份与-d1-往返优化)，尚未实施，不改变实时授权规则。第五阶段进度、片单与讨论及第六阶段备份/恢复待实施，production 尚未发布。

本页状态对应本 PR 已交付的功能；`dev` 的第 6 个主题性能实现尚未纳入。staging 已部署第四阶段及 12 个迁移；production 只有独立资源/密钥准备记录和构建验证，正式上线须待主要功能与 staging 验收通过并取得站长授权。当前阶段、模块状态、依赖及阻塞以[核心计划](PLAN.md)为准，具体任务只在模块计划维护，本页不复制开发清单。

常规发布要求 Cloudflare 从 GitHub 分支云端构建，规则见 [B 6.9.5](docs/detailed-requirements.md#695-github-分支构建与发布)；云端发布链路尚未接通，实施与验收见[运维计划](docs/plan/operations.md)。

## 文档入口

了解产品进度、体验入口和待处理事项，先读[项目进展简报](docs/progress.md)。开发任务按 A → B → 核心计划 → 本次任务所属模块阅读，不必加载全部计划及归档。

| 文档 | 职责 |
| --- | --- |
| [A 核心需求](docs/requirements.md) | 开发者维护的简短目标、能力与范围外项 |
| [B 详细需求](docs/detailed-requirements.md) | Agent 在 A 约束下维护规则、默认值、权限、失败行为与验收 |
| [核心计划](PLAN.md) | 阶段、优先级、里程碑、模块摘要和重大阻塞 |
| [模块计划](PLAN.md#模块总览) | 六个领域的方案、实施任务和验证摘要，按需读取 |
| [协作约定](AGENTS.md) | 阅读/更新规则、Git、语言、安全及 cf 工具约束，不维护产品决策或临时授权日志 |

- [前端参考原型](prototypes/frontend-v1/README.md)：独立启动、定稿交互及已知缺陷；正式工程不依赖原型目录。
- [导入与自动关联](docs/import-media.md)：资料初始化、本机预检、固定媒体命名及定时扫描使用。
- [第三阶段验收](docs/screenshots/phase3/README.md)、[第四阶段验收](docs/screenshots/phase4/README.md)、[设计修复](docs/screenshots/design-fixes-20261007/README.md)、[导航性能](docs/performance-navigation-20261007.md)：实际结果与验证边界。
- [海报素材](public/assets/posters/star-trek/README.md)、[单集剧照](public/assets/stills/star-trek/README.md)：素材与命名说明。
- [文档整理记录](docs/documentation-restructure-20261011.md)：旧章节迁移与检查；[旧计划归档](docs/archive/plan-20261007.md)和[认证 POC](spikes/better-auth/REPORT.md)仅为历史证据，不作为当前待办或选型阻塞。

## 技术栈

- 运行时：Cloudflare Workers
- 框架：React Router v7（框架模式）
- 数据库：Cloudflare D1，认证与业务资料均保存在站长自己的数据库
- 认证：Better Auth 1.7.7 + username/twoFactor/captcha 与同版 passkey 插件（第三阶段真实设备及平台小样本验收通过，不代表完整容量）
- 媒体存储：Cloudflare R2（私有）
- 播放器：ArtPlayer

工具链基线（`cf` CLI、`@cloudflare/vite-plugin` 2.0 beta、Workers Vitest）及已知限制见[工程基础计划](docs/plan/foundation.md#技术基线与限制)。

## 本地开发

需要 Node 22.18+（推荐 24）和 pnpm 12。正式工程在仓库根目录，与 `prototypes/frontend-v1/` 互不依赖。

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars   # 本地占位 Secrets，不提交
pnpm db:migrate:local            # 先应用 D1 迁移，状态与 cf dev 共用
pnpm dev                         # cf dev，监听 0.0.0.0:6120
```

启动前检查 6120 端口，已有实例则复用。开发服务器监听 `0.0.0.0:6120`；`/login`、`/register`、`/forgot-password`、`/reset-password`、`/verify-email`、`/verify-pending` 是公开账号流程。`/` 对访客展示登舰入口，对成员展示片库首页；`/series`、`/movies`、`/title/:id`、`/watch/:id`、`/account`、`/invites` 是成员页，`/admin` 仅正常管理员可用。权限由页面和 JSON 接口分别校验，访客受保护页面跳回登录并保留返回目标。`/about` 保持公开；播放授权、媒体与字幕入口分别为 `/playback/:id/authorize`、`/media/:id`、`/subtitles/:id`，不暴露私有存储地址。

已有 `.dev.vars` 需补入至少 32 字符的 `BETTER_AUTH_SECRET`，与播放/备份密钥独立；旧 `TOTP_ENCRYPTION_KEY` 不再声明。测试只用 `.dev.vars.example` 的虚构占位值，不读取本机真实 Secrets。原生认证表由 `cf` 版本化迁移管理，不在请求中自动迁移；D1 的原生 DATE 列实测存 ISO 8601 文本，与旧业务表 UTC 毫秒列分别处理。

本地迁移包含 `0009_member_profiles_invitation_guard.sql`、0010 和 0011：邀请码消费人与成员邀请来源必须一致，注册归属与业务完成由触发器保护，密码写入撤销旧会话。`0011_member_security_invitation_expiry_guard.sql` 在原 0011 后替换封禁触发器，只作废有效未使用邀请码并原子删除会话；已过期、已用或已作废码保留原记录。该增量迁移尚未应用到运行环境，不改写原 0011，也不批量修改历史 `revoked_at`。邀请码来源护栏不重复安装 `dev` 中等价的 `0013_invitation_source_guard.sql`。正式注册只开放带 Origin、业务 CSRF、人机验证和原生限流的 `/auth/register`；已完成尝试的 Cookie 允许不同身份或邀请码开始新尝试，相同输入保留幂等重放；失败且尚未创建原生用户时，更换身份或邀请码也可开始新尝试，已创建的未完成身份仍绑定原尝试。直接 sign-up、邮箱密码直登、管理员重置及多余库端点关闭。原生多步流程仍可能部分成功，错误不表示密码或凭证状态一定回滚。

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
| `pnpm build:staging` / `pnpm build:production` | 按环境构建；通过环境变量或本机 `.env` 提供配置（见 `.env.example`），缺少资源标识时构建失败 |
| `cf deploy --prebuilt --mode staging --dry-run` | 检查 staging 构建产物与绑定，不上传 |

`cloudflare.config.ts` 按 mode（`development`、`test`、`staging`、`production`）返回各自独立的 Worker、D1、R2 和 Rate Limiting 配置。真实的账号 ID、D1 ID 和站点 Key 在本机使用被忽略的 `.env`，云端构建使用对应环境的平台配置，不提交仓库；运行时 Secrets 由站长授权后写入 Worker Secrets，不与构建 Secrets 混用。在本机运行 `deploy:staging` / `deploy:production` 等直接部署命令，仅限站长明确授权的例外。开发期间使用本地与 staging；production 构建 / dry-run 仅验证准备状态，正式迁移、Secrets 上传和部署须等主要功能完成后按运维计划 T6.2 执行。

合并到 `main` 不构成上线授权。仓库中没有部署工作流；2026-10-13 经 `cf` 只读核查当前账号全部 42 个 Worker 的 Builds 触发器及 14 个 Pages 项目的 Git 来源，未发现关联本仓库的自动部署配置。合并前仍须确认 Cloudflare Dashboard 未为 `main` 启用 Workers Builds / Git 自动部署，避免核验后配置变化。

已授权的云端配置复用既有 Worker，D1 名称/ID 与媒体桶名由 `.env.example` 所列环境变量分别映射；旧 staging 数据库因 schema 不兼容而保留，当前工程使用新库，不对旧库套用迁移。staging 沿用原有自定义域名，production 使用本文确定的正式域名；Custom Domain 由 `worker.domains` 管理，workers.dev 与版本预览入口关闭。

远程迁移使用 `pnpm db:migrate:staging` / `pnpm db:migrate:production`，脚本先创建 `.cloudflare` 父目录，干净 checkout 无需先运行开发或构建命令。staging 实测 D1 `/query` 将 0010 触发器内裸 `CASE…END` 错认作触发器结束，整份 0010 回滚；[Cloudflare 问题记录](https://github.com/cloudflare/workers-sdk/issues/4727)描述同类行为。脚本仅在临时副本给该表达式加等价括号，再交给 `cf d1 migrations apply --dir`，由 CLI 正常记录原文件名并执行增量判断；原始文件和本地已应用迁移不改写，临时文件执行后清除。SQLite 验证合法邀请原子完成、过期邀请完整拒绝。不要直接重复失败的原始远程命令，也不使用 Wrangler 兜底。

`bindings.secret()` 在实际部署时要求值齐全。当前声明认证、播放、Turnstile、备份加密与 EMAIL_API_KEY 五项；备份 API Token 和启用的 WebDAV / S3 目标凭证随对应模块再声明，禁止用样例值满足线上检查。服务端站长变量 OWNER_EMAIL 也随备份模块加入，当前尚未声明或校验。邮件配置使用 .env.example 中的 STAGING_EMAIL_* / PRODUCTION_EMAIL_*；API 基础地址必须为 HTTPS origin，发件人域名须匹配 EMAIL_SENDER_DOMAIN。传输只发送纯文本正文、最多等待 10 秒、不跟随重定向或自动重发；业务配额、失败记录和认证回调已接入；验证用途共享邮箱摘要配额，找回单独计数，失败/未确认也计入。staging 验证/找回投递及上游小时/日额度已验收，production 凭证按运维计划准备；月额度/API 频率仍未提供。

本机 `.dev.vars.staging.secrets.json` / `.dev.vars.production.secrets.json` 是被忽略的独立密钥交接文件，只含原有四项密钥，未包含站长另行配置的 EMAIL_API_KEY；production 不能仅凭该文件通过正式部署检查。仅在获准本机直接部署的例外任务中，可用 `pnpm exec cf deploy --prebuilt --mode staging --secrets-file .dev.vars.staging.secrets.json` 上传文件中的密钥，不作为 Git 集成的常规步骤；既有 EMAIL_API_KEY 由站长在对应 Worker 配置，不复制 staging 的值到 production。密钥还须由站长保存到密码管理器和离线副本，保管规则见 B 6.9.1，技术步骤见[运维计划](docs/plan/operations.md#691-绑定secrets-与集中配置)。

线上启用应用日志和 query 脱敏，关闭含请求 URL 的 invocation logs；原生 traces 的凭证路径脱敏验证前保持关闭。配置核对和页面冒烟检查不替代第六阶段的真实日志内容、安全与性能验收。

staging 另测发现 Cloudflare 会给应用日志附加请求 URL/路径，即使 invocation logs 已关闭。重置链接凭证位于原生路径中，因此 `/api/auth/reset-password/` 不产生应用日志，避免平台再次附加原文；Better Auth 原始日志保持关闭，其他请求仍记录白名单路由族、状态与请求标识。query token 由平台 `redact_query_string` 剔除。

实际 Workers 的邮件 fetch 使用 `redirect: "error"` 会在发出请求前抛错，改为 `manual` 并拒绝所有非 2xx（包含 3xx）。一次请求、不跟随重定向、不自动补发及 10 秒上限保持不变；匿名探针只证明 Postal 可达，实际投递以收信和验证结果为准。

`cf` strict 限制与历次处置见[运维风险](docs/plan/operations.md#当前运维风险)及其验收记录；执行部署前按 [AGENTS 工具规则](AGENTS.md#cloudflare-cli)核对本次授权，历史成功步骤不是可直接复用的部署许可。

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

局域网验收须将本地 .env 中的 `APP_ORIGIN` 配为实际访问 origin；RP ID 随该 origin 的 hostname 生成，来源校验不因调试而放宽。通行密钥还需浏览器认可的安全上下文；第三阶段实际设备及 HTTPS 结果见[认证计划](docs/plan/authentication.md)，第四阶段实机仍待反馈。

测试并发设为两路，避免原生密码哈希与 Worker 模块图同时争用 CPU。HTTP suite 单独预热 SSR 编译，允许最多 60 秒；普通单请求仍保留原来的 5 秒测试阈值。模拟发信不向真实服务发送邮件，浏览器验收仅使用虚构本地账号。注册、改邮箱和重置失败可能留下部分原生状态，相关故障注入与重试行为见测试和 [B 6.4.1](docs/detailed-requirements.md#641-原生流程的失败边界)。

## 许可证

[MIT](LICENSE)。海报等第三方素材的版权归原权利人所有，不适用本许可证。
