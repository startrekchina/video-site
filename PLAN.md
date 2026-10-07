# 正式开发计划

本文件定义 v1 正式开发的执行顺序、约束和待办；需求以 [`docs/requirements.md`](docs/requirements.md)（下称“需求”）为唯一依据，协作与 Git 规则见 [`AGENTS.md`](AGENTS.md)。两者与本文件冲突时，先停下确认并修正文档，再实现。

- 建立时间：2026-10-05。当前阶段：**第三阶段 邀请、账号与管理**；第二阶段本地工程基础完成，production 配置与平台实测仍按既有待办保留。
- 勾选规则：只有实现完成、相关构建与测试通过、并经复核的事项才勾选；部分完成写在“进展”里，不勾选。依赖站长提供材料或决策的事项标“阻塞”，不自行绕过。
- 每完成一个可验证的任务或出现新阻塞，同步更新本文件的待办、进展、验证记录和未决事项；影响阶段状态时同步更新 `README.md`。

## 1. 执行约束

1. **范围**：只做需求已确认的 v1 内容；需求第 8 节的范围外功能（HLS、ASS 渲染、弹幕、同时播放数限制、OAuth 等）不提前实现。“默认”数值可直接采用，改动须在 PR 描述说明。
2. **工具链**：Cloudflare 资源与本地开发统一用 `cf` CLI，不用 Wrangler、不用 `npx wrangler` 兜底；`cf` 缺能力时记录原因并告知站长。
3. **安全**：仓库公开。真实账号 ID、资源 ID、API token、Secrets、WebDAV 信息和 R2 内部路径不入库；本地用被忽略的 `.dev.vars` / `.env`，线上用 Worker Secrets。浏览器构建不得引用 Secrets、绑定或对象键。
4. **原型迁移**：正式工程在 `app/` 等根目录结构中独立维护，不通过 import、软链接、路径别名或共享包依赖 `prototypes/`；按页面或流程把经审查的展示组件、样式和已定稿交互复制过来，不沿用模拟身份、假认证/权限、内存账本和人为等待（需求 6.15）。
5. **认证基线与验证**：已决定采用 Better Auth，认证要求按需求 6.0、6.2.2、6.3–6.5；不再等待采用/替代决定。旧 POC 差距用于识别原生边界，新基线迁移、正式集成、发件服务和平台实测（需求 6.16）通过后才验收。
6. **对外操作**：推送、创建 PR、合并远程 PR、创建/修改云端资源、设置线上 Secrets 和部署都要站长明确要求。本地提交、任务分支合入本地 `dev` 可自动进行。
7. **开发服务器**：监听 `0.0.0.0:6120`；启动前检查端口，被占用时复用现有实例，不另起端口、不直接杀进程。

## 2. 技术基线（2026-10-05 本机探针实测）

在临时目录用以下组合完成了端到端探针：`cf dev` 渲染带 D1 查询的 loader；`react-router build --mode staging` 产出 `.cloudflare/output/v0`，`vite preview` 下页面与全部客户端资源返回 200；`cf deploy --prebuilt --mode staging --dry-run` 正确列出 staging 绑定；Workers Vitest 直接读取 `cloudflare.config.ts`，D1 迁移后唯一键与外键生效，并能经 Worker 入口渲染路由。

| 组件 | 版本 / 用法 | 说明 |
| --- | --- | --- |
| 运行与包管理 | Node 24、pnpm 12 | 构建脚本需批准 `esbuild`、`workerd` |
| 框架 | `react-router` / `@react-router/dev` 7.18.4，`future.v8_viteEnvironmentApi: true` | 需求定为 v7；自定义 `app/entry.server.tsx`（`renderToReadableStream`） |
| Cloudflare 集成 | `cf` 1.0.0-beta.12（项目 devDependency）、`@cloudflare/vite-plugin` 2.0 beta、Vite 8 | 配置文件为 `cloudflare.config.ts`，没有 Wrangler 配置 |
| 测试 | `vitest` 4.1、`@cloudflare/vitest-plugin`（`experimental.newConfig`） | 读取 `cloudflare.config.ts`，`mode` 为 `test`；D1 迁移在 setup 中应用 |
| 类型 | `.cloudflare/types/index.d.ts`（Vite 插件自动生成，`Env` 由配置推断） | `react-router typegen && tsc` 作为类型检查 |

已知限制与处理（均须在 README 运行说明中写明）：

- **v7 与 Build Output 目录不一致**：Vite 插件 2.0 把客户端产物强制输出到 `.cloudflare/output/v0/workers/default/assets`，React Router v7 仍从 `build/client` 读写 manifest。用一个小 Vite 插件在构建时双向同步，待 [remix-run/react-router#15480](https://github.com/remix-run/react-router/pull/15480) 进入 v7 后删除。官方插件声明正式支持的是 React Router v8；是否升级 v8 属于需求变更，须站长决定（见第 5 节未决事项）。
- **`cf build` 不向 React Router 转发 `--mode`**：staging / prod 构建改用 `react-router build --mode <mode>`，部署用 `cf deploy --prebuilt --mode <mode>`（mode 须与构建一致）。本地开发直接 `cf dev`（mode 为 `development`）。
- **D1 迁移命令只接受数据库 ID**：本地用固定的占位 ID（全零 UUID 变体）并 `--local --persist-to .cloudflare/state`，与 `cf dev` 的本地状态目录一致；staging / prod 的真实 ID 由被忽略的 `.env` 注入 `cloudflare.config.ts`，命令行同样从本机读取，不写入仓库。
- **环境隔离**：`cloudflare.config.ts` 按 `mode`（`development` / `test` / `staging` / `production`）返回完整配置；Worker 名、D1、R2、Rate Limiting namespace 和 `APP_ENV` 各自独立，缺失真实资源标识时拒绝构建 staging / prod。
- **Secrets**：以 `bindings.secret()` 声明，本地开发缺失时警告，**实际部署会拒绝缺少声明的 Secret**。当前声明认证、播放、Turnstile、备份加密与邮件五项；备份 API Token 与启用的 WebDAV / S3 目标凭证在对应模块接入时再声明，不上传占位凭证。线上可用部署时 `--secrets-file` 写入，密钥文件必须被 Git 忽略；既有四项密钥交接文件不包含站长另行配置的 EMAIL_API_KEY，不能据此宣称 production 已齐备。
- **云端复用与日志**：按站长授权复用既有 staging Worker 与访问域名，D1 名称/ID 和 R2 桶名分别从本机 `.env` 注入，不能按数据库名推断媒体桶。Custom Domain 通过 `worker.domains` 管理；关闭 workers.dev / preview URLs。启用应用日志、query 脱敏并关闭 invocation logs；原生 traces 含路径，凭证路径脱敏验证前保持关闭。

## 3. 第二阶段：工程基础

目标：形成可以承载后续所有功能的正式工程——能本地开发、类型检查、构建、按环境 dry-run 部署和运行 Workers 集成测试；数据库结构和约束落地并有测试，既有认证表按采用决定增量迁移；认证库接入边界有结论；前端基础样式与站点外壳从原型迁入。

### T2.1 建立并确认 `PLAN.md`

- [x] 根据需求、原型 README 与工具链探针编写本文件，同步 README 阶段清单。
- 验收：本文件与需求、AGENTS.md 和 README 无冲突；未决事项列明。

### T2.2 正式工程骨架

- [x] 在仓库根目录建立 React Router v7 + Workers 正式工程（`app/`、`workers/`、`cloudflare.config.ts`、`vite.config.ts`、`react-router.config.ts`、`tsconfig.json`、`vitest.config.ts`），`public/` 作为公开静态资源。
- [x] `pnpm dev`（`cf dev`，`0.0.0.0:6120`）、`pnpm typecheck`、`pnpm build`（及 `build:staging` / `build:production`）、`pnpm test` 均可运行；`.gitignore` 覆盖 `node_modules`、`build`、`.cloudflare`、`.react-router`、`.dev.vars*`、`.env*`。
  - 进展：`typecheck`、`test`、`build` 及两环境占位构建 / dry-run 均已通过。正式工程已在集成工作树 `.worktree/dev` 常驻监听 `0.0.0.0:6120`，本机和局域网请求 `/about` 返回 200；复用该实例，不另起服务。
- [x] 公共响应约定先落地并有测试：所有动态响应带 `X-Robots-Tag: noindex`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`；HTML 默认 `Cache-Control: private, no-store`；`GET /robots.txt` 返回 `User-agent: *` 与 `Disallow: /`；静态资源经 `public/_headers` 带 noindex（需求 6.1、6.1.1）。静态资源头在 staging 部署后另行核对。
- 验收：上述命令全部通过；Workers Vitest 中请求 `/`、`/robots.txt`、不存在的路径，断言状态码与安全头；不依赖 `prototypes/`。

### T2.3 环境、绑定与 Secrets

- [x] `cloudflare.config.ts` 声明逻辑绑定：`ASSETS`、`DB`、`MEDIA_BUCKET`、`AUTH_RATE_LIMITER`、`PLAYBACK_RATE_LIMITER`、`ADMIN_RATE_LIMITER`、`EMAIL_RATE_LIMITER`，配置 `APP_ENV`、`APP_ORIGIN`、`WEBAUTHN_RP_ID`、`TURNSTILE_SITE_KEY`，以及 Secrets `PLAYBACK_HMAC_KEY`、`BETTER_AUTH_SECRET`、`TURNSTILE_SECRET_KEY`、`BACKUP_ENCRYPTION_KEY`。T2.7 已移除旧独立 TOTP Secret；认证 IP/路径限流使用库的 D1 表，既有 Rate Limiting bindings 不作为原生认证计数器。T3.1 已加入 EMAIL_API_KEY 及 EMAIL_API_BASE_URL / EMAIL_SENDER_DOMAIN / EMAIL_FROM / EMAIL_REPLY_TO，真实值从本机 .env 注入；`OWNER_EMAIL`、`CLOUDFLARE_API_TOKEN` 及启用的 WebDAV / S3 目标配置在备份模块接入时加入，样例中的预留值不作为部署凭证。
- [x] staging / prod 两套资源名与 namespace 独立；资源 ID、账号 ID 只从本机 `.env` 读取，提供 `.env.example` 与 `.dev.vars.example` 占位文件；缺失或混用时构建失败。
- [x] 集中默认配置已落在 `app/lib/settings.server.ts`；T2.7 已适配 30 天滚动会话/1 天更新/5 分钟新鲜度、1 小时邮件链接、二步备用码及原生限流，移除旧绝对期限和失败后才要求 Turnstile 的常量，新基线单测与运行探针通过。
- [ ] 完成 staging / prod 云端配置与 Secrets；定时入口在备份任务实现时再加入，业务频率/时间由站长在网页设置，只有配置完整的 WebDAV / S3 目标才能启用（需求 6.9.2）。
  - 2026-10-06 已获站长授权，staging 复用既有 Worker、自定义域名和私有媒体桶；旧 D1 schema 与当前迁移不兼容，保留旧库并创建隔离新库，8 个迁移已应用。认证/播放/Turnstile/备份加密四项 Secrets 已写入，当前正式工程已部署并通过 HTTPS 冒烟检查；旧 Worker 版本仍可追溯，旧 Secrets 未删除。
  - production 已核对既有 Worker、空 D1、独立私有媒体桶；独立 Turnstile 已创建，资源映射和四项新 Secrets 保存在本机忽略文件，最新配置构建 / dry-run 通过。尚未给 production 应用迁移、上传 Secrets 或替换代码。两环境的邮件/备份外部凭证仍待提供；此项不勾选，不再记为全部待授权。
- 验收：`cf deploy --prebuilt --mode staging --dry-run` 与 `--mode production` 列出各自独立的绑定；仓库内 `git grep` 不出现真实 ID 或密钥。

### T2.4 Better Auth 评估与采用决定（需求 6.3.4、6.16）

- [x] 在独立分支完成 Better Auth 1.7.7 最小 POC，对调整前需求的 scrypt、注册 / 恢复原子性、Cookie / 会话、通行密钥、TOTP、恢复码与管理员证明逐项核对，明确区分 workerd 实测与发布源码审查。29 项测试和类型检查通过；测试包含复现库缺陷的断言，绿色不代表兼容性通过。
- [x] 输出逐项通过/差距报告：实验提交 `4fc3bc4`，采用决定说明更新于 `e7d5635`，源码和报告归档在独立目录 [`spikes/better-auth/`](spikes/better-auth/REPORT.md)。按任务交付流程合入 `dev`；正式构建、依赖、迁移和测试入口不引用该目录，旧实验规则不作为当前认证实现。
- [x] 2026-10-06 站长决定调整需求并采用 Better Auth。当前规则和旧→新变更写入需求 6.3.4，不实现旧自管认证契约，也不再等待方案决定；POC 29 项是历史差距证据，真实 WebAuthn、新基线集成和 staging 成本仍未验证。
- 验收：旧 POC 的 Workers Vitest 用例/报告及已确认采用决定；报告标注旧规则评估与当前结论。新集成按 T2.7 和第三阶段另验。

### T2.5 D1 迁移、约束与测试夹具

- [x] 按调整前需求编写初始迁移（按领域拆为 `0001_catalog.sql` 至 `0005_discussions.sql`）：作品、季、可播放单元、媒体、字幕、成员与“已占用邮箱”唯一键集合、邮箱验证凭证、发信记录、会话、邀请码、恢复码、重置链接、TOTP、通行密钥、认证挑战、限流计数、观看进度、收藏、片单与条目、评论、回复、赞踩；外键、`CHECK`、部分唯一索引和需求列出的查询索引一并建立。该旧认证 schema 的退役与 Better Auth schema/业务资料/注册预留增量迁移见 T2.7；原已应用迁移不改写。
- [x] Workers Vitest 覆盖旧基线的数据关系：电影唯一 / 季集唯一 / 同作品外键、片单目标互斥与同目标唯一、赞踩目标互斥与唯一、跨列邮箱占用冲突、媒体与字幕对象键唯一、孤立记录被拒。另覆盖单一未消费验证 / 重置凭证、bootstrap 码、邀请码消费人唯一、批次回滚、讨论直接删除级联与封禁保留讨论。
- [x] 测试夹具只用虚构成员和自生成媒体：`test/fixtures/catalog.ts` 工厂函数生成虚构作品、季、集与成员；`scripts/gen-test-media.mjs` 用 ffmpeg 生成数秒的 H.264 + AAC faststart MP4（输出目录被忽略，不入库），自行编写的中英 VTT 随代码提交到 `test/fixtures/subtitles/`。
- 验收：`cf d1 migrations apply <占位ID> --local` 在本地状态应用成功；`pnpm test` 中约束用例全部通过。

### T2.6 前端基础迁移

- [x] 从原型迁入设计 token、全局样式（Tailwind v4）、字体（Noto Sans SC、Geist Mono、Antonio）、`components/ui` 基础组件、主题（跟随系统 / 浅色 / 深色）与站点外壳（顶栏、页脚、内容列宽切换、手机底部胶囊），以及 404 页和关于页（含 `contact@startrekchina.org` 版权下架联系方式）。
- [x] 外壳只依赖 props / loader 数据，不引入原型的模拟身份、PROTO 控制台和内存数据；受保护入口在访客态不出现。
- 进展：样式 / 字体、页面外壳、主题三档与 D 键、SSR 防闪烁、手机菜单胶囊展示组件、回到顶部、关于页 / 404 已迁入；访客不传成员导航、不显示胶囊和受保护链接。关于页按当时规则补齐邮箱验证/三条恢复路径并修正邀请连带方向、展示下架联系邮箱；恢复文案已被新方案替代，待 T2.7 更新。成员胶囊的真实数据与权限接入随认证阶段验收。`pnpm typecheck`、`pnpm test` 83 项、`pnpm build` 通过；SSR 首次 Vite 编译约 14–20 秒，测试先预热再按原 5 秒请求阈值验证。集成后的浏览器验收及截图见 [前端基础验收记录](docs/screenshots/phase2/README.md)。
- 验收：类型检查、构建通过；用浏览器在 1440×1000 与 360×800、浅色与深色下对照原型截图验收关于页和 404，保存截图。

### T2.7 Better Auth 新基线适配（已完成）

- [x] 将正式工程锁定到已评估的 Better Auth/passkey 1.7.7，按需求设置 username/twoFactor/passkey/captcha、会话/邮件期限和原生限流；配置、绑定类型、`.dev.vars.example` 统一采用必需的 `BETTER_AUTH_SECRET`，移除旧独立 TOTP Secret 和过期常量，保留环境隔离与 telemetry 关闭。
- [x] 用锁定库 `getMigrations().compileMigrations()` 生成并审查 `0008_better_auth.sql`：user/account/session/verification/twoFactor/passkey/rateLimit，补 credential ID 唯一键和用户/会话期限索引。类型检查、真实 D1 日期读写、唯一键/外键及本地增量迁移通过；没有改写 0001–0007。
- [x] 0009 建立 member_profiles / registration_attempts，业务外键统一关联稳定原生用户 ID；真实 D1 验证 9 类历史业务资料、角色/封禁/邀请关系与原生凭证保留，以及迁移拒绝与业务批次回滚。只退役满足前置审查条件的旧认证表；未转换身份、待邮箱或非空旧凭证表会拒绝整次迁移，不自动重编码旧密码/设备数据。
- [x] 21 项最小集成探针复核原生默认密码/用户名、滚动会话/改密换新会话、邮箱 JWT/重置链接生命周期、备用码/二步锁定、captcha/IP 限流与原生响应；新旧 schema 共存不影响已有工程检查。旧 29 项测试不替代这些新用例。
- 进展：`app/lib/auth.server.ts` 是正式服务端配置工厂，注册/邮箱直登/资料更新/OTP 等额外 HTTP 路径关闭，trustDevice 被拒；通行密钥已配置 UV 拒绝钩子，真实仪式仍未验证。Worker **尚未挂载** `/api/auth/*`，待第三阶段邀请完成/封禁/设备绑定门禁、改邮箱本人会话确认和脱敏请求日志接入；当前库日志关闭，发信回调仅在测试用本地捕获，真实服务尚未接入。
- [x] 更新正式关于页和 HTTP 测试，移除恢复码重设密码与管理员重置说明，补齐邮箱找回、二步备用码、通行密钥与不可恢复边界；1440×1000 / 360×800、浅/深色和恢复说明共 8 张截图已复核，见 [新基线验收](docs/screenshots/phase2-better-auth/README.md)。
- 验收：本地 cf 0009 增量迁移、类型检查、100 项 Workers 测试、构建和关于页浏览器检查通过；第二阶段本地基础完成，不表示正式 HTTP 认证、真实设备或 production 已验收。

### 第二阶段完成定义

T2.2、T2.3（除云端资源阻塞项）、T2.5、T2.6、T2.7 勾选；T2.4 有书面结论且采用决定已记录；README 写明本地启动、测试、构建、迁移和 dry-run 部署命令。

## 4. 第三阶段及后续（顺序与验收入口）

每个阶段开工前把对应条目细化为本文件中的可验收任务，验收以需求第 7 节和 7.1 为准。

### T3.1 邀请注册与认证入口（当前任务）

- [x] 完成注册流程依赖的 Postal HTTPS 发信传输层与独立环境配置。12 项 workerd 模拟发信测试覆盖字段、HTTP 200 业务错误、HTTP 失败、超时、单次请求、输入/配置拒绝及脱敏；10 秒超时、不自动跟随重定向、不补发。匿名空请求确认实际 API 路径返回 Postal AccessDenied，未带密钥或发送邮件。传输层尚未接入认证回调/业务配额，也未公开发信或认证 HTTP 入口。
- [x] 完成内部邀请注册服务：邀请码条件预留、随机尝试令牌摘要与预先绑定用户 ID、原生用户创建、业务原子完成及失败续作。0010 增量迁移保护归属不被修改/REPLACE、credential 每用户唯一，并以触发器原子激活成员/消费码/完成尝试；16 项 workerd/D1 用例覆盖模拟成功响应、冲突、账号部分创建、过期续订、发出人封禁、作废、并发和后段提交回滚。尚未挂载 HTTP 或发送验证邮件；后续发信只在业务完成后接入。
- [ ] 接入每个认证入口的注册完成/邮箱验证/成员状态门禁、Origin / Fetch Metadata / Turnstile / IP 限流、邮箱配额与失败记录，完成脱敏日志后再挂载必要 `/api/auth/*`。
- [ ] 迁入邀请注册、验证与登录页面展示组件，真实 loader/action 和客户端消费沿用原生响应；浏览器与 HTTP 端到端验收后勾选。

1. **第三阶段 邀请、账号与管理**：按以下顺序细化并验收，不实现旧三路径密码恢复或管理员逐操作证明。
   - 邀请注册预留/库创建/业务完成及失败续作，邮箱必填/未验证门禁，库默认用户名密码；禁止直接 sign-up、客户端改角色/状态及额外登录入口绕过。
   - 原生 username 登录/退出、二步 TOTP/备用码与账号锁、禁用 trustDevice/OTP、Cookie/滚动会话/改密；通行密钥 UV 钩子与真实仪式；每个 loader/action/媒体的即时鉴权。
   - 已购 Postal 发信 API（**文档与实际配置已提供，staging Secret 已核对；production Secret 未配置**）、签名邮箱验证、邮箱密码重置及部分失败处置、本人会话内改邮箱确认；业务邮件配额、原生 IP 限流/Turnstile/跨站防护。
   - 邀请码、成员/邀请链、额度、角色、首管本机提升、封禁/单个解封、管理员绑定 TOTP + 5 分钟新鲜会话；业务原子批次与并发保护。
2. **第四阶段 片库与播放闭环**：离线导入 CLI（manifest / TMDB、MP4 与 faststart 预检、VTT、R2 / D1 幂等挂接）；访客入口、成员首页、片库、作品与选集接入真实数据；ArtPlayer、播放 token、续期、R2 Range 与字幕授权，两小时连续播放验证。
3. **第五阶段 观看进度、片单与讨论**：进度上报与 `expectedRevision`、继续观看与下一集；收藏、片单与队列展开；评论、回复、赞踩与管理员删除。
4. **第六阶段 运维与上线验收**：站长专用网页备份（`OWNER_EMAIL` + 正常管理员、加密下载、WebDAV / S3）、有外部目标才可配置的定时备份与手动恢复演练；staging 端到端验收与平台实测（网页任务生命周期、15 分钟 Cron 窗口、Time Travel 隔离、限流、scrypt、日志脱敏）；预算核对与部署、恢复文档，发布 v1。

### T6.1 数据库备份与恢复（待第三至第五阶段完成）

- [ ] 在本环境声明服务端 `OWNER_EMAIL`，复用真实会话/成员门禁，仅允许当前已验证邮箱匹配且未封禁、注册完成的管理员；其他管理员、普通成员和访客均拒绝，配置缺失/无效不放行。逐请求复核降权、改邮箱、封禁与撤销会话。
- [ ] 实现站内备份页、状态读取、手动创建/重试及加密文件直接下载；入口只对站长显示，服务端权限和 CSRF 独立验证，不返回明文 SQL、上游地址、对象键或凭证。
- [ ] 复用全量 D1 导出 → 私有 R2 校验 → 版本化认证加密流程，接入预配置的 WebDAV / S3 兼容目标；仅对启用目标声明凭证，上传后流式回读校验长度与 SHA-256，分别展示完整/失败状态。
- [ ] 仅在 WebDAV / S3 目标配置完整后允许站长在网页设置并启用频率与北京时间执行时间；支持修改/关闭，不固定每日 04:00，仅下载不能启用。服务端与定时入口重检所选目标，配置失效拒绝执行；与网页入口共用备份流程及失败人工处理，各端保护最后一份完整可恢复副本，绝不清理媒体或站长本地下载。
- [ ] 使用虚构数据和模拟 Cloudflare / WebDAV / S3 验证权限、下载可恢复性、环境隔离、部分失败、重试与保留；在 staging 实测网页任务中断与执行生命周期、定时全流程 15 分钟限制和资源消耗。
- [ ] 演练 6.9.3 的隔离手动恢复、原生凭证清理和重新开放；补齐站内备份使用、目标配置、历史密钥保管与恢复说明。备份功能未实现/未验证，不提前勾选。

## 5. 未决事项与风险

| 事项 | 状态 | 处理 |
| --- | --- | --- |
| React Router v7 与 `@cloudflare/vite-plugin` 2.0 beta 的产物目录不一致 | 已用同步插件绕过，构建 / 预览 / dry-run 已验证 | 需求定 v7，暂不升级。若站长同意升级 v8（官方支持组合），需同步修改需求 6.1 与 README 技术栈 |
| `cf` 与 Vite 插件 2.0 均为 beta | 风险 | 锁定精确版本；升级单独提交并重跑全部验证 |
| staging / prod 云端资源与 Secrets | staging 已部署；production 构建 / dry-run 通过 | 复用站长现有资源，旧 staging D1 保留；production 未上线。邮件/备份外部凭证仍待提供；真实资源标识和密钥只在本机忽略文件与平台保存 |
| Better Auth 接入 | 已决定采用并调整需求；实现/新验收待完成 | 原生会话、加密、二步备用码和邮箱找回已定。T2.7 迁移旧 schema/配置/文案，第三阶段实现邀请/权限/UV/改邮箱门禁与失败续作；不因旧规则差距重新等待选型。真实验证器与 staging 成本待测 |
| 已购发件服务的 API 文档与配置 | Postal API 地址已提供，发件/回复地址获授权选定；staging EMAIL_API_KEY 已核对，材料阻塞解除 | 真实配置仅在本机/平台保存；production 无 Secrets，不复制 staging 密钥。按需求 6.0.3 接入模拟服务与业务配额，实际投递尚未验证 |
| 平台实测（备份时限、Time Travel 隔离、限流、scrypt、日志） | 待 staging 资源 | 第六阶段执行，不以本地结果代替 |

## 6. 进展与验证记录

- 2026-10-06：完成 T3.1 内部注册核心，新增 registration.server.ts 与 0010_registration_ownership.sql；使用库原生 user.create.before 钩子持久绑定本次目标用户，实际读取 D1 用户/credential 后才激活业务资料，部分创建由同一归属续作，不认领现存同名/同邮箱账号。注册令牌原值只交给未来 HttpOnly Cookie 包装层，不持久保存或记录；已完成尝试重放验证原生密码且不重复消费/建号，不产生会话或发送邮件。16 项注册专项与全量 128 项、类型检查和构建通过，本地 cf 0010 增量迁移成功。完整测试首次暴露历史 0009 测试假定“最后一个迁移”，已按名称定位，9 项保留/回滚用例重新通过。9 个改动文件与 15 个客户端文本资源的实际配置/密钥扫描、文档链接和差异检查通过。需求、README 和待办同步；认证/注册 HTTP、发信配额/回调与页面仍未完成，云端仍为 8 个迁移，未部署。0.0.0.0:6120 原服务保持运行，关于页 200，未挂载的注册/会话入口 404。

- 2026-10-06：站长要求数据库备份作为网站内功能，提供直接下载、WebDAV、S3，并用 Worker 环境变量指定某个管理员邮箱；随后确认只有配置完整的 WebDAV / S3 才可设置频率与执行时间。需求 6.5.1 / 6.9.2 / 6.9.4、接口草案、验收、README 与 T6.1 已同步：`OWNER_EMAIL` + 当前正常管理员由服务端逐请求校验，下载/外部副本继续加密，目标凭证留在 Worker；移除固定每日 04:00 规则，仅下载不启用定时备份，隔离手动恢复规则保留。此项仅完成文档同步，未实现页面/接口或新增环境绑定，仍按第三阶段认证 → 第六阶段备份推进。文档差异、文件链接、表格列数及新增行凭证模式检查通过；未修改运行代码，不重跑代码测试、不部署或重启服务。

- 2026-10-06：推进 T3.1 发信依赖，新增 email.server.ts 的原生 fetch 传输与五项邮件配置绑定；API URL 与两环境发件/回复地址仅在忽略 .env 保存。12 项模拟服务测试与全量 112 项 Workers 测试、类型检查、staging / production 构建及 cf dry-run 通过；15 个客户端文本资源和 186 个源文件/文档的实际配置/已知密钥扫描通过。实际 Postal 路径的匿名空 POST 返回 HTTP 200 / error / AccessDenied，证明路径可达，不证明 API key 有效或邮件送达。线上配置未修改，staging 仍是上一版工程基础和 8 个迁移，production 未迁移/上传 Secret/部署；EMAIL_API_KEY 仅核对到 staging 已存在，未读取值。下一步实现注册预留归属、业务原子完成、邮件配额和认证 HTTP 门禁；6120 配置变更后由 cf 自动重载，服务继续保留。
- 2026-10-06：完成 T2.7 的 0009 业务资料/注册预留增量迁移与关于页新文案。72 项 schema/迁移专项、全量 100 项测试、类型检查、构建及本地 cf 增量迁移通过；旧待邮箱/自定义凭证契约用例已退役，保留原生认证 21 项探针。Chrome 复核 8 张桌面/手机浅深色截图，无横向溢出或捕获的客户端错误；首次 Vite 优化的旧模块 504 在预热刷新后消失，未改主题代码。6120 原服务已停止，重新在当前任务工作树启动 0.0.0.0:6120 并保持运行。站长提供实际 Postal API 地址、授权选定发件/回复地址并确认 Secret，cf 核对 staging EMAIL_API_KEY/CLOUDFLARE_API_TOKEN 存在，production Secret 列表为空。第三阶段按 T3.1 推进；认证 HTTP 与实际发信尚未开放。
- 2026-10-06：站长提供 Postal API 文档；已核对 HTTPS JSON 发信路径、`X-Server-API-Key`、收件人与 From / Reply-To / 正文字段，以及 HTTP 200 仍可能返回业务错误的行为，同步需求与 README。成功回包只提取消息标识，不记录收件人与 token；保留既有单次请求、不自动补发与脱敏规则。实际 API 基础地址、API key 和两环境完整发件/回复地址仍待提供；本次只核对文档与差异，未实现发信回调或发送真实邮件。
- 2026-10-06：站长确认全部发件地址使用统一发件子域，退信路径与收信记录已配置；已同步需求，并在本机忽略文件保存实际域名。尚未取得邮件 API 文档、API key 与具体 From / Reply-To，未进行服务接入、DNS 核验或实际投递验证。
- 2026-10-06：按站长授权接管既有 staging Worker，复用自定义域名及私有媒体桶；旧 staging D1 属于另一套 schema，未改动旧库，创建新 D1 并应用 0001–0008。两环境独立 Turnstile 和认证/播放/备份加密密钥已准备，staging 四项 Secrets 随版本上传。首次实际部署因未接入服务的五项必需 Secret 声明失败，未切换旧版本；移除这些提前声明后部署成功，未写入假凭证。远程核对域名、私有桶、关闭 workers.dev/preview URLs、query 脱敏、关闭 invocation logs/traces、DB/媒体绑定和 2001–2004 namespace；8 个迁移记录和 `foreign_key_check`（0 个违规）通过。首页/关于页/robots.txt 返回 200、未知路径和未挂载认证返回 404，安全头及 3 个客户端资源通过。类型检查、105 项测试、两环境最终构建 / dry-run 与客户端隐私扫描通过。production 未应用迁移或部署，旧 staging 库和旧 Secrets 保留。6120 服务仍可访问，不重启。业务资料迁移、关于页文案、完整认证与平台性能/日志内容验收仍待完成。

- 2026-10-06：推进 T2.7 原生认证基础。正式依赖锁定 1.7.7，新增配置工厂和生成的 0008 迁移；Secrets/常量按新需求适配。21 项 workerd/D1 探针通过，实测 DATE 列保存 ISO 8601 文本并还原为 Date，生产配置 Cookie 为 `__Host-session`，原生 token/滚动会话/改密换新会话、1 小时邮箱 JWT 与重置链接、二步备用码/账号锁定、持久化 IP 限流和 captcha 拒绝分支符合探针预期。全部工程 4 个文件 105 项测试、`pnpm typecheck`、`pnpm build`、本地 0008 增量迁移通过。首次与类型生成/测试/迁移并行构建报字体产物 ENOENT，其他进程结束后同样构建命令通过；后续这些产物生成检查逐项执行。旧用户/业务外键/凭证退役、关于页新文案、真实 WebAuthn 和完整 HTTP 门禁仍未完成，不开放认证 HTTP 路径，不创建云端资源或重启 6120。

- 2026-10-06：按站长提醒将已完成的 `spike/auth-poc-report` 实验源码与报告归档到 `dev`。合并只在 PLAN 产生旧选型说明冲突，保留已确认 Better Auth 的当前计划与进展；POC 仍在独立目录使用独立依赖、迁移和 runner。合并后的正式工程 `pnpm typecheck`、`pnpm test`（83 项）、`pnpm build`，以及 POC `pnpm test`（29 项）、`pnpm typecheck` 全部通过；6120 服务保持运行，归档不表示 T2.7 已完成。

- 2026-10-06：站长明确要求全部按 Better Auth 适配并同步文档。需求/用户故事/接口/schema 草案/Secrets/恢复运维/测试期望、AGENTS、README、原型边界和历史截图说明已同步；T2.4 采用决定完成，T2.7 新增未完成迁移与验证任务。当前代码仍按旧基线，83 项工程测试和 29 项 POC 测试只记为历史验证，不代表新认证通过。本次为文档任务，核对 Markdown 链接、表格、规则与差异；不修改运行代码或重启 6120 服务。

- 2026-10-06：T2.4 形成书面差距结论，独立分支 `spike/auth-poc-report` 提交 `4fc3bc4`。workerd 测试 6 个文件 29 项及类型检查通过，实测注册/恢复部分提交、明文会话、滚动续期、并发 TOTP 重放和可逆恢复码，列出 A1–A7/B1–B10 证据。报告随后标注为旧规则评估并写入已确认采用决定；POC 仍独立，未实现正式认证。
- 2026-10-06：T2.5 修复及 T2.6 前端基础合入本地 `dev`。集成工作树重新执行 `pnpm typecheck`、`pnpm test`（83 项）、`pnpm build`、`pnpm db:migrate:local`（7 个迁移）通过。正式 `pnpm dev` 常驻监听 `0.0.0.0:6120`，局域网访问 `/about` 返回 200。浏览器完成关于页 / 404 的 1440×1000、360×800、浅 / 深色八视图验收；验证三档主题、系统切换、刷新持久化、D 键与输入时忽略、1152 / 768 px 列宽、回到顶部及访客导航，无横向溢出或捕获的客户端异常。截图和边界见 `docs/screenshots/phase2/README.md`。
- 2026-10-06：确认 D1 任务分支无独有提交、工作树无未提交 / 未跟踪文件及运行进程后，移除 `.worktree/d1-schema` 和已合入的两条 D1 任务分支。原 `.worktree/frontend-foundation`、`.worktree/auth-poc` 及 `.worktree/development-roadmap` 带有先前未提交内容，保留；原型工作树保留参考用途。`spike/auth-poc-report` 及其工作树保留供认证决策复核，集成工作树继续运行服务。
- 2026-10-07：修复 #13 审查意见：`.env*` 全部忽略并保留 `.env.example`；Worker 无条件设置 `private, no-store`；补齐 `ASSETS` 绑定和运行时断言。新增缓存头用例可复现并阻止路由自设 `public`；绑定用例在缺少声明时失败。6 项 Workers 测试、类型检查、构建及环境文件忽略检查通过。

- 2026-10-06：修复 T2.5 复核发现的 P1：SQLite `INSERT OR REPLACE` 会绕过 UPDATE 触发器，可改写邀请来源并遗留邮箱占用。增量迁移 `0007_users_insert_guard.sql` 在 INSERT 前拒绝与既有成员 ID 或用户名键冲突的插入；成员变更必须使用 UPDATE。新增两种 REPLACE 语法、ID / 用户名冲突、邮箱占用保留与失败批次回滚回归用例。`pnpm test` 82 项、`pnpm typecheck`、`pnpm build` 通过；本地 `cf` 应用全部 7 个迁移成功。未改写旧迁移。

- 2026-10-05：完成工具链探针（见第 2 节），建立本计划。
- 2026-10-06：T2.2 / T2.3 骨架完成。`pnpm typecheck` 通过；`pnpm test` 2 个文件 5 项通过（首页、robots.txt、404 的状态码与安全头；集中配置数值；测试环境绑定）；`pnpm build` 通过；以占位 `.env` 执行 `build:staging` / `build:production` 后 `cf deploy --prebuilt --dry-run` 分别列出独立的 Worker、D1、R2 与 Rate Limiting 绑定，缺少 `.env` 时构建明确失败。T2.4 的两次子代理执行均中途失败、未产出结果，POC 改为重新组织执行。
- 2026-10-06：T2.5 迁移步骤完成。`pnpm install --frozen-lockfile` 成功且未改变依赖或 lockfile；`pnpm db:migrate:local`（`cf d1 migrations apply 00000000-0000-4000-8000-000000000000 --local --persist-to .cloudflare/state`）5 个迁移全部成功，再次运行返回 `[]`。存储时间统一为 UTC 毫秒；邮箱占用集合由触发器同步并以唯一键阻止跨列冲突；季/集使用复合外键。`pnpm typecheck`、`pnpm test`（已有 5 项）、`pnpm build` 均通过；约束用例和媒体夹具尚待后续步骤，不勾选对应项。
- 2026-10-06：T2.5 约束测试步骤完成。初次测试发现新版 Workers Vitest 未自动隔离文件内用例，setup 改为每条用例 `reset()` 后 `applyD1Migrations()`；重新执行通过。直接删除被引用邮箱占用记录在本地 D1 产生 deferred 外键回滚日志，以增量迁移 `0006_email_claim_guard.sql` 提前拒绝删除，未改写已应用迁移；本地应用成功，完整测试无该异常。`pnpm typecheck`、`pnpm test`（3 个文件 79 项，其中 schema 74 项）、`pnpm build` 均通过。媒体夹具尚未完成，不勾选。
- 2026-10-06：T2.5 夹具步骤完成，三项待办全部通过本地验收。schema 用例复用虚构数据工厂；`node scripts/gen-test-media.mjs` 连续两次成功。`ffprobe -v error -show_entries stream=codec_name,codec_type -show_entries format=duration -of json test/fixtures/media/signal-test.mp4` 确认 `h264` / `aac`、4 秒；Node 检查顶层 MP4 box 顺序为 `ftyp, moov, free, mdat`（faststart），大小 152,508 字节；`git check-ignore test/fixtures/media/signal-test.mp4` 命中。两份 VTT 经 `ffprobe` 识别为 `webvtt`。最终 `pnpm typecheck`、`pnpm test`（3 个文件 79 项，其中 schema 74 项）、`pnpm build` 全通过；`pnpm db:migrate:local` 返回 `[]`。未新增依赖、未创建云端资源、未启动或关闭 6120 服务。T2.4 认证库结论与 staging 平台验证仍保留原有门槛，本地测试不代替它们。
