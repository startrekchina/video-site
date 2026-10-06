# 正式开发计划

本文件定义 v1 正式开发的执行顺序、约束和待办；需求以 [`docs/requirements.md`](docs/requirements.md)（下称“需求”）为唯一依据，协作与 Git 规则见 [`AGENTS.md`](AGENTS.md)。两者与本文件冲突时，先停下确认并修正文档，再实现。

- 建立时间：2026-10-05。当前阶段：**第二阶段 工程基础**。
- 勾选规则：只有实现完成、相关构建与测试通过、并经复核的事项才勾选；部分完成写在“进展”里，不勾选。依赖站长提供材料或决策的事项标“阻塞”，不自行绕过。
- 每完成一个可验证的任务或出现新阻塞，同步更新本文件的待办、进展、验证记录和未决事项；影响阶段状态时同步更新 `README.md`。

## 1. 执行约束

1. **范围**：只做需求已确认的 v1 内容；需求第 8 节的范围外功能（HLS、ASS 渲染、弹幕、同时播放数限制、OAuth 等）不提前实现。“默认”数值可直接采用，改动须在 PR 描述说明。
2. **工具链**：Cloudflare 资源与本地开发统一用 `cf` CLI，不用 Wrangler、不用 `npx wrangler` 兜底；`cf` 缺能力时记录原因并告知站长。
3. **安全**：仓库公开。真实账号 ID、资源 ID、API token、Secrets、WebDAV 信息和 R2 内部路径不入库；本地用被忽略的 `.dev.vars` / `.env`，线上用 Worker Secrets。浏览器构建不得引用 Secrets、绑定或对象键。
4. **原型迁移**：正式工程在 `app/` 等根目录结构中独立维护，不通过 import、软链接、路径别名或共享包依赖 `prototypes/`；按页面或流程把经审查的展示组件、样式和已定稿交互复制过来，不沿用模拟身份、假认证/权限、内存账本和人为等待（需求 6.15）。
5. **验证门槛**：Better Auth POC、已购发件服务接入和平台实测（需求 6.16）未完成前，不宣称对应功能已验收；本地模拟通过不代表线上复制延迟、限流全局精度或导出耗时已验证。
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
- **Secrets**：以 `bindings.secret()` 声明，本地开发与测试从被忽略的 `.dev.vars` 读取并提供 `.dev.vars.example` 占位样例；缺失时 `cf` 仅警告，服务端读取处须自行拒绝空值。线上 Secrets 由站长授权后用 `cf workers secrets update` 或部署时 `--secrets-file` 写入。

## 3. 第二阶段：工程基础

目标：形成可以承载后续所有功能的正式工程——能本地开发、类型检查、构建、按环境 dry-run 部署和运行 Workers 集成测试；数据库结构和约束一次落地并有测试；认证库是否可用有结论；前端基础样式与站点外壳从原型迁入。

### T2.1 建立并确认 `PLAN.md`

- [x] 根据需求、原型 README 与工具链探针编写本文件，同步 README 阶段清单。
- 验收：本文件与需求、AGENTS.md 和 README 无冲突；未决事项列明。

### T2.2 正式工程骨架

- [x] 在仓库根目录建立 React Router v7 + Workers 正式工程（`app/`、`workers/`、`cloudflare.config.ts`、`vite.config.ts`、`react-router.config.ts`、`tsconfig.json`、`vitest.config.ts`），`public/` 作为公开静态资源。
- [ ] `pnpm dev`（`cf dev`，`0.0.0.0:6120`）、`pnpm typecheck`、`pnpm build`（及 `build:staging` / `build:production`）、`pnpm test` 均可运行；`.gitignore` 覆盖 `node_modules`、`build`、`.cloudflare`、`.react-router`、`.dev.vars*`、`.env*`。
  - 进展：`typecheck`、`test`、`build`、`build:staging`、`build:production`（占位 `.env`）均已通过，忽略规则已补齐。`pnpm dev` 的同款配置已在探针中于其他端口验证；6120 目前被 `.worktree/frontend-v1` 的原型 dev server 占用，按规则未关闭，正式工程尚未在 6120 实际启动（见第 5 节）。
- [x] 公共响应约定先落地并有测试：所有动态响应带 `X-Robots-Tag: noindex`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`；HTML 默认 `Cache-Control: private, no-store`；`GET /robots.txt` 返回 `User-agent: *` 与 `Disallow: /`；静态资源经 `public/_headers` 带 noindex（需求 6.1、6.1.1）。静态资源头在 staging 部署后另行核对。
- 验收：上述命令全部通过；Workers Vitest 中请求 `/`、`/robots.txt`、不存在的路径，断言状态码与安全头；不依赖 `prototypes/`。

### T2.3 环境、绑定与 Secrets

- [x] `cloudflare.config.ts` 声明需求 6.9.1 的逻辑绑定：`DB`、`MEDIA_BUCKET`、`AUTH_RATE_LIMITER`、`PLAYBACK_RATE_LIMITER`、`ADMIN_RATE_LIMITER`、`EMAIL_RATE_LIMITER`，配置 `APP_ENV`、`APP_ORIGIN`、`WEBAUTHN_RP_ID`、`TURNSTILE_SITE_KEY`，以及 Secrets `PLAYBACK_HMAC_KEY`、`TOTP_ENCRYPTION_KEY`、`TURNSTILE_SECRET_KEY`、`EMAIL_API_KEY`、`CLOUDFLARE_API_TOKEN`、`BACKUP_ENCRYPTION_KEY`、`WEBDAV_URL`、`WEBDAV_USERNAME`、`WEBDAV_PASSWORD`。发件人地址、发件域名和邮件 API 基础地址等发件配置项待站长提供已购服务的 API 文档后在第三阶段加入，不预先猜写。
- [x] staging / prod 两套资源名与 namespace 独立；资源 ID、账号 ID 只从本机 `.env` 读取，提供 `.env.example` 与 `.dev.vars.example` 占位文件；缺失或混用时构建失败。
- [x] 集中默认配置（需求 6.9.1 “集中默认配置”整行，含全部限流数值、会话期限、TOTP 参数、额度、分页和 token 时长）落在一个服务端模块（`app/lib/settings.server.ts`）并有单测核对数值。
- [ ] **阻塞（待站长授权）**：用 `cf d1 create`、`cf r2 buckets create` 创建 staging / prod 的 D1 与私有 R2，确定 Rate Limiting namespace，写入线上 Secrets，并决定 staging 的访问域名；Cron 表达式 `0 20 * * *` 在备份任务实现时再加入。
- 验收：`cf deploy --prebuilt --mode staging --dry-run` 与 `--mode production` 列出各自独立的绑定；仓库内 `git grep` 不出现真实 ID 或密钥。

### T2.4 Better Auth 最小 POC（需求 6.3.1、6.16）

- [ ] 在独立分支 / 工作树做最小 POC，逐项验证：scrypt（N=2^14、r=8、p=5）替换默认哈希；D1 中注册与邀请码原子消费（`batch()` 条件写入，影响 0 行整批失败）；三条恢复路径的事务及旧会话、旧恢复码、旧重置链接撤销；`__Host-session` Cookie 属性（`HttpOnly; Secure; SameSite=Lax; Path=/`、无 `Domain`）与“仅存哈希”；通行密钥（用户验证、challenge 原子消费）与 TOTP（6 位、30 秒、±1 步、时间步防重放）；会话 180 天绝对 / 30 天不活跃且只在页面 loader 续活。
- [ ] 输出逐项通过 / 差距报告。**全部满足才采用；有差距则报告站长决定，不绕过门槛自研，也不让库默认行为覆盖需求规则。**
- 验收：POC 的 Workers Vitest 用例与报告；结论写入本文件第 5 节。

### T2.5 D1 迁移、约束与测试夹具

- [x] 按需求 6.2.1 与 6.2 的约束编写初始迁移（按领域拆为 `0001_catalog.sql` 至 `0005_discussions.sql`）：作品、季、可播放单元、媒体、字幕、成员与“已占用邮箱”唯一键集合、邮箱验证凭证、发信记录、会话、邀请码、恢复码、重置链接、TOTP、通行密钥、认证挑战、限流计数、观看进度、收藏、片单与条目、评论、回复、赞踩；外键、`CHECK`、部分唯一索引和需求列出的查询索引一并建立。认证库内部表待 T2.4 结论后以增量迁移调整。
- [x] Workers Vitest 覆盖需求 7.1“数据关系”行：电影唯一 / 季集唯一 / 同作品外键、片单目标互斥与同目标唯一、赞踩目标互斥与唯一、跨列邮箱占用冲突、媒体与字幕对象键唯一、孤立记录被拒。另覆盖单一未消费验证 / 重置凭证、bootstrap 码、邀请码消费人唯一、批次回滚、讨论直接删除级联与封禁保留讨论。
- [x] 测试夹具只用虚构成员和自生成媒体：`test/fixtures/catalog.ts` 工厂函数生成虚构作品、季、集与成员；`scripts/gen-test-media.mjs` 用 ffmpeg 生成数秒的 H.264 + AAC faststart MP4（输出目录被忽略，不入库），自行编写的中英 VTT 随代码提交到 `test/fixtures/subtitles/`。
- 验收：`cf d1 migrations apply <占位ID> --local` 在本地状态应用成功；`pnpm test` 中约束用例全部通过。

### T2.6 前端基础迁移

- [ ] 从原型迁入设计 token、全局样式（Tailwind v4）、字体（Noto Sans SC、Geist Mono、Antonio）、`components/ui` 基础组件、主题（跟随系统 / 浅色 / 深色）与站点外壳（顶栏、页脚、内容列宽切换、手机底部胶囊），以及 404 页和关于页（含 `contact@startrekchina.org` 版权下架联系方式）。
- [ ] 外壳只依赖 props / loader 数据，不引入原型的模拟身份、PROTO 控制台和内存数据；受保护入口在访客态不出现。
- 验收：类型检查、构建通过；用浏览器在 1440×1000 与 360×800、浅色与深色下对照原型截图验收关于页和 404，保存截图。

### 第二阶段完成定义

T2.2、T2.3（除云端资源阻塞项）、T2.5、T2.6 勾选；T2.4 有书面结论且站长已决定采用或替代方案；README 写明本地启动、测试、构建、迁移和 dry-run 部署命令。

## 4. 后续阶段（顺序与验收入口）

每个阶段开工前把对应条目细化为本文件中的可验收任务，验收以需求第 7 节和 7.1 为准。

1. **第三阶段 邀请、账号与管理**：注册（邀请码原子消费、邮箱必填、待验证账号）、登录 / 退出与服务端访问控制、CSRF、D1 精确限流与 Turnstile；已购发件服务接入（**阻塞：需站长提供 API 文档与本机配置**）、邮箱验证与找回、改邮箱；通行密钥、TOTP、会话管理、改密、恢复码与三条恢复路径；邀请码管理、成员与邀请链、额度、角色、封禁 / 解封与管理员 TOTP 再验证。
2. **第四阶段 片库与播放闭环**：离线导入 CLI（manifest / TMDB、MP4 与 faststart 预检、VTT、R2 / D1 幂等挂接）；访客入口、成员首页、片库、作品与选集接入真实数据；ArtPlayer、播放 token、续期、R2 Range 与字幕授权，两小时连续播放验证。
3. **第五阶段 观看进度、片单与讨论**：进度上报与 `expectedRevision`、继续观看与下一集；收藏、片单与队列展开；评论、回复、赞踩与管理员删除。
4. **第六阶段 运维与上线验收**：每日备份（导出、R2、加密 WebDAV、回读校验、保留清理）与手动恢复演练；staging 端到端验收与平台实测（15 分钟 Cron 窗口、Time Travel 隔离、限流、scrypt、日志脱敏）；预算核对与部署、恢复文档，发布 v1。

## 5. 未决事项与风险

| 事项 | 状态 | 处理 |
| --- | --- | --- |
| React Router v7 与 `@cloudflare/vite-plugin` 2.0 beta 的产物目录不一致 | 已用同步插件绕过，构建 / 预览 / dry-run 已验证 | 需求定 v7，暂不升级。若站长同意升级 v8（官方支持组合），需同步修改需求 6.1 与 README 技术栈 |
| `cf` 与 Vite 插件 2.0 均为 beta | 风险 | 锁定精确版本；升级单独提交并重跑全部验证 |
| staging / prod 云端资源、Secrets、staging 域名 | 阻塞，待站长授权 | 骨架先以 dry-run 验证；授权后创建并记录（不入库真实 ID） |
| Better Auth 是否满足需求规则 | 待 T2.4 | 有差距时由站长决定 |
| 已购发件服务的 API 文档与配置 | 阻塞，第三阶段前需要 | 站长提供后接入，测试用本地模拟服务 |
| 平台实测（备份时限、Time Travel 隔离、限流、scrypt、日志） | 待 staging 资源 | 第六阶段执行，不以本地结果代替 |
| 6120 端口被原型 dev server（`.worktree/frontend-v1`）占用 | 阻塞正式工程的本机 dev 与浏览器验收 | 按规则不关闭他人实例；需站长决定是否停止原型 dev server，让正式工程使用 6120 |

## 6. 进展与验证记录

- 2026-10-06：修复 T2.5 复核发现的 P1：SQLite `INSERT OR REPLACE` 会绕过 UPDATE 触发器，可改写邀请来源并遗留邮箱占用。增量迁移 `0007_users_insert_guard.sql` 在 INSERT 前拒绝与既有成员 ID 或用户名键冲突的插入；成员变更必须使用 UPDATE。新增两种 REPLACE 语法、ID / 用户名冲突、邮箱占用保留与失败批次回滚回归用例。`pnpm test` 82 项、`pnpm typecheck`、`pnpm build` 通过；本地 `cf` 应用全部 7 个迁移成功。未改写旧迁移。

- 2026-10-05：完成工具链探针（见第 2 节），建立本计划。
- 2026-10-06：T2.2 / T2.3 骨架完成。`pnpm typecheck` 通过；`pnpm test` 2 个文件 5 项通过（首页、robots.txt、404 的状态码与安全头；集中配置数值；测试环境绑定）；`pnpm build` 通过；以占位 `.env` 执行 `build:staging` / `build:production` 后 `cf deploy --prebuilt --dry-run` 分别列出独立的 Worker、D1、R2 与 Rate Limiting 绑定，缺少 `.env` 时构建明确失败。T2.4 的两次子代理执行均中途失败、未产出结果，POC 改为重新组织执行。
- 2026-10-06：T2.5 迁移步骤完成。`pnpm install --frozen-lockfile` 成功且未改变依赖或 lockfile；`pnpm db:migrate:local`（`cf d1 migrations apply 00000000-0000-4000-8000-000000000000 --local --persist-to .cloudflare/state`）5 个迁移全部成功，再次运行返回 `[]`。存储时间统一为 UTC 毫秒；邮箱占用集合由触发器同步并以唯一键阻止跨列冲突；季/集使用复合外键。`pnpm typecheck`、`pnpm test`（已有 5 项）、`pnpm build` 均通过；约束用例和媒体夹具尚待后续步骤，不勾选对应项。
- 2026-10-06：T2.5 约束测试步骤完成。初次测试发现新版 Workers Vitest 未自动隔离文件内用例，setup 改为每条用例 `reset()` 后 `applyD1Migrations()`；重新执行通过。直接删除被引用邮箱占用记录在本地 D1 产生 deferred 外键回滚日志，以增量迁移 `0006_email_claim_guard.sql` 提前拒绝删除，未改写已应用迁移；本地应用成功，完整测试无该异常。`pnpm typecheck`、`pnpm test`（3 个文件 79 项，其中 schema 74 项）、`pnpm build` 均通过。媒体夹具尚未完成，不勾选。
- 2026-10-06：T2.5 夹具步骤完成，三项待办全部通过本地验收。schema 用例复用虚构数据工厂；`node scripts/gen-test-media.mjs` 连续两次成功。`ffprobe -v error -show_entries stream=codec_name,codec_type -show_entries format=duration -of json test/fixtures/media/signal-test.mp4` 确认 `h264` / `aac`、4 秒；Node 检查顶层 MP4 box 顺序为 `ftyp, moov, free, mdat`（faststart），大小 152,508 字节；`git check-ignore test/fixtures/media/signal-test.mp4` 命中。两份 VTT 经 `ffprobe` 识别为 `webvtt`。最终 `pnpm typecheck`、`pnpm test`（3 个文件 79 项，其中 schema 74 项）、`pnpm build` 全通过；`pnpm db:migrate:local` 返回 `[]`。未新增依赖、未创建云端资源、未启动或关闭 6120 服务。T2.4 认证库结论与 staging 平台验证仍保留原有门槛，本地测试不代替它们。
