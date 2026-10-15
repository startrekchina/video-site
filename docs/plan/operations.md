# 部署、备份与运维

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A7、B 6.9/6.10/6.16/7，依赖第三至第五阶段主要功能。T6.1 备份与恢复、T6.2 production 发布均待实施。staging 已通过 GitHub `dev` 的云端自动发布，D1 已应用当前全部迁移；production 只有资源/密钥准备记录和构建/dry-run，不是已发布。

staging 已连接当前仓库 `startrekchina/video-site` 的 `dev`，启用推送构建且关闭其他分支/PR 预览；cf strict 限制下使用 Wrangler 补充发布。配置转换的 3 项定向用例、23 项工具测试、类型检查、staging 构建和 Wrangler dry-run 通过，15 个服务端模块完整打包。实际云端发布、运行时绑定及入口烟测通过，不替代专项功能、性能和实机验收。production 不启用自动发布。

staging 构建触发器排除 `docs/*`、`*.md` 与 `prototypes/*`（开发者 2026-10-15 授权）：推送只改这些文件时不构建、不部署，GitHub 上也不显示构建状态；同一推送含其他文件时照常构建。`test/` 不排除，测试改动仍经过 staging 构建中的测试门禁。一次推送超过 20 个提交或 3000 个文件，或没有文件改动时，平台忽略路径规则强制构建。规则由 `cf builds triggers update` 维护，见 [Build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)。

## 任务与验收

- [x] 同步 `main` 的 PR 合并规则、协作约定和验收条件；规则一致性、62 个本地链接/锚点及 `git diff --check` 自检通过。仅验证文档，未调整 GitHub 分支保护或云端发布配置，DEP1 保持待实施。
- [ ] DEP1 按 [B 6.9.5](../detailed-requirements.md#695-github-分支构建与发布)接通并验收 Workers Builds 分支发布：先完成 staging，production 接通与验收遵守 T6.2 上线门槛；核对 `main` 的 PR 合并与分支保护、现有 cf 工具链兼容性、构建/运行时配置、迁移顺序与失败中止。
- DEP1 staging 自动发布自检（2026-10-14）：GitHub `push_event` 来源 `dev` 的 `1ce197c`，构建 `f447c6db-bdc2-4ac5-a3e0-72d718f3c343` 在云端通过锁文件安装、类型检查、272 项应用测试、23 项工具测试、staging 构建、cf 增量迁移和 Wrangler 发布。版本 `f77d338b-efaa-412d-b81d-ef1612bf00d0` 于 18:18 北京时间生效，100% 流量，版本消息记录完整来源 SHA；未从本机上传。D1 的 `0008_legacy_invitation_guard_retirement.sql`、`0011_member_security_invitation_expiry_guard.sql`、`0013_invitation_source_guard.sql` 已应用，只读迁移列表无待应用项；11 个既有 Secrets、D1/R2 和四个限流绑定与发布前一致。
- DEP1 staging 入口烟测：无 Cookie 的 `/`、`/about` 返回 `200`，`/series` 和 `/watch/series_103516_s1_e1` 返回 `302` 到登录，匿名 `/media/00000000-0000-4000-8000-000000000000` 返回 `401`；入口带 `noindex`、`no-store, private` 和 `nosniff`，首页引用的客户端 JS 返回 `200`。Chrome 当前剧集→电影只读导航正常，无客户端 error；Node 直连连接重置，系统 HTTP 客户端可访问。专项性能与实机/开发者验收及 production 链路仍待完成。
- staging 媒体桶迁至 APAC（2026-10-16，开发者授权）：新桶对象与原桶逐一一致，Workers Builds 构建 Secret 与本机 `.env` 改指新桶，`38457f4` 起生效；原 ENAM 桶保留待确认删除，过程见[账号与性能计划](authentication.md#t458-数据位置与成员机房测量)。
- staging 诊断恢复核验：首次多提交[复验](../staging-revalidation-20261014.md)确认 D1 优化、核心安全与日志脱敏，并定位签发 R2 串行等待；仅并行 HEAD 的修复已通过 A/B/B/A 实测，三个签发入口中位耗时降低约 24%–26%，历史尾延迟未复现、尚未整体验收。cf 恢复原始 `cbb16db` 版本 `323dc854-6954-48a5-a543-30d40827a7bf` 至 100% 流量，11 个 Secrets、绑定和观测配置一致；首次 6 账号/4 版本与修复复测 2 账号/2 版本分别清理。恢复后实际请求日志确认原版本且无诊断事件；修复随后经 PR #26 进入 `dev` 并随 staging 自动发布，没有 production 操作。
- 诊断版本清理边界：平台拒删最新上传版本（API 10339）；沿已确认的 strict 补充路径，以固定 Wrangler 4.150.0 `versions upload` 上传无探针的干净 `cbb16db` 副本 `512c4b13-b83b-459a-99db-5f6466385a55`，只上传、不部署，再用 cf 删除停用诊断版本。该原版副本保留且未激活，原始版本继续 100% 流量；不能将其称为未清除的诊断或已发布修复。清理时一次 D1 `fetch failed` 重试后通过，未扩大删除范围；完整[恢复与清理证据](../staging-revalidation-20261014.md#修复恢复与清理)及 JSON 独立记录。
- [ ] T6.1 站长专用备份页/状态/手动创建与重试、加密下载、WebDAV/S3，逐请求 OWNER_EMAIL + 正常管理员门禁；来源与 JSON 校验不靠隐藏入口。
- [ ] T6.1 配置完整外部目标后才可启用频率/北京时间设置；共用 D1→私有 R2→加密→所选目标→回读校验，目标失效拒绝，保留各端最后可恢复副本。
- [ ] T6.1 本地模拟权限、环境、下载可恢复性、部分失败、重试和保留；staging 实测网页执行生命周期/中断重试、全定时流程 15 分钟、存储访问与内存成本。
- [ ] T6.1 演练隔离手动恢复、重加密与旧凭证清理、角色/封禁/设备复核、历史讨论人工重删；补齐密钥保管和恢复说明，确认媒体冷备。
- [ ] T6.2 全部主要功能、相关测试与 staging 端到端通过，核对日志、权限/封禁、并发、预算及平台边界。
- [ ] T6.2 补齐 production 独立 Secrets、邮件与启用备份目标，核 Worker/D1/R2/Turnstile/域名和隔离；获明确授权后正式迁移、部署与 HTTPS/权限/安全头验收，记录发布版本。

## 备份接口映射

| 入口与方法（草案） | 权限 | 请求 / 响应 |
| --- | --- | --- |
| 备份页面 / `GET /admin/backups` | 仅站长 | 返回本环境备份时间、状态、可用目标和脱敏失败信息；不返回原始 SQL、对象键、上游下载地址或外部存储凭证。 |
| `POST /admin/backups`、`POST /admin/backups/:id/retry`、`GET /admin/backups/:id/download` | 仅站长 | 创建接收目标 `download / webdav / s3`，创建/重试均经业务写入来源与 JSON 校验；目标配置由服务端读取。下载仅允许本环境已完成并校验的加密文件，由 Worker 鉴权后流式返回，不能重定向到 R2 或 D1 导出地址（6.9.4）。 |
| `PUT /admin/backups/schedule` | 仅站长，启用时须有配置完整的 WebDAV / S3 目标 | 接收启用状态、目标类型、备份频率、北京时间执行时间，经业务写入来源与 JSON 校验；服务端验证目标配置，不接受以直接下载或私有 R2 暂存启用定时备份。返回本环境调度状态。 |

## 当前运维风险

- cf beta.12 固定 strict 检查因 staging 最近由 script API 更新而拒绝上传；官方 beta.16 同样固定 `strict: true`，不能仅靠升级解除。staging 采用已获准的 Wrangler 补充发布，开发、构建和迁移继续使用 cf；生成配置须核对模式、目标、全部拆分模块及静态资源，不读取或重建既有运行时 Secrets。直接 API 发布仍需另行授权，不修改 CLI 内部实现或重建 Worker。
- production 密钥交接文件仅含原四项，不含 EMAIL_API_KEY；不能据此认定配置齐全。备份导出、OWNER_EMAIL 及启用外部目标在模块接入时声明，不上传假值。
- 原生凭证路径需禁用相关应用日志以避免平台附加 URL，invocation/traces 未脱敏前保持关闭；认证小样本/静态配置不等于全部业务平台验证。
- Time Travel 隔离能力、网页任务生命周期与全流程时限仍未验；无法满足时让站长决定，不擅自加 Queues/Workflows 或原地覆盖生产。

### 6.9 环境与备份

- staging 和 prod 是两套完全独立的资源，各自有自己的 Worker、D1 和 R2。
- 两环境不复制完整片库：可分别建立完整资料占位，staging 仅存少量自生成测试媒体/字幕，prod 保存正式片源；扫描只访问本环境绑定。
- **开发与发布顺序（2026-10-06 确认）**：开发阶段使用本地环境与 staging，production 可以提前准备隔离资源映射、配置声明及本地构建 / dry-run。所有 v1 主要功能（认证与管理、片库与播放、进度/片单/讨论、备份与恢复）开发完成且相关测试和 staging 验收通过后，才在第六阶段补齐 production 上线配置与 Secrets，执行正式迁移、部署及上线验收；这些操作仍需站长明确授权。production 未上线不作为工程基础或第三至第五阶段未完成的依据。
- D1 利用 Time Travel 功能，可以恢复到最近 30 天内的任意时间点。
- 备份先调用 D1 导出 API 并存入私有 R2，再加密供直接下载或上传 WebDAV / S3。配置完整的 WebDAV 或 S3 目标后，站长可在网页设定自动备份频率和执行时间，由 Worker 定时入口执行；没有外部目标时仅支持手动备份，不启用定时备份。导出包含密码哈希和 TOTP 密钥，必须加密后才能离开 Cloudflare。备份默认保留 30 天。
- 网页数据库备份纳入 v1，提供直接下载、WebDAV 与 S3 三种目标，仅本环境 `OWNER_EMAIL` 指定的管理员可操作（6.9.4）；直接下载和外部存储均使用加密备份。
- WebDAV 地址必须能从公网通过 HTTPS 访问，最好用 443 端口。如果它在家里的 NAS 上，推荐用 Cloudflare Tunnel 暴露出来，不需要在路由器上开端口。
- Cloudflare API Token、WebDAV / S3 目标与凭证、备份加密密钥都存在 Worker Secrets 里；指定站长的 `OWNER_EMAIL` 使用 Worker 环境变量，不向浏览器公开。
- 视频原片只在站长本地冷备份，不存第二份云端副本。

#### 6.9.1 绑定、Secrets 与集中配置

每个环境分别配置下列逻辑名称，实际资源标识和值不写入公开仓库。执行工具、帮助核对、迁移与失败处理遵循 [AGENTS 工具规则](../../AGENTS.md#cloudflare-cli)，本文只维护环境配置方案。

| 类别 | 建议名称与用途 |
| --- | --- |
| Worker bindings | `DB`：本环境自有 D1；`MEDIA_BUCKET`：私有 R2；`ASSETS`：公开素材；`AUTH_RATE_LIMITER`、`ADMIN_RATE_LIMITER`、`EMAIL_RATE_LIMITER` 可作辅助防滥用。认证入口使用 Better Auth 的 D1 持久化限流；站点发信/管理业务配额仍由 D1 精确判定。各环境资源与计数隔离。 |
| Worker 配置 | `APP_ENV, APP_ORIGIN, WEBAUTHN_RP_ID, TURNSTILE_SITE_KEY`，以及**发信服务的发件人地址与发件域名、邮件服务商 API 基础地址**、备份目标数据库标识、Cron 调度入口和兼容日期；业务备份频率/执行时间由站长在网页设置（6.9.2），不固定为每日 04:00。真实 Cloudflare 标识只保存在本机/平台配置，缺失或混用环境时拒绝运行。发件域名需按服务商要求配置 SPF/DKIM（必要时的 DMARC），staging 与 prod 用不同的发件人标识以便区分测试邮件。`node:crypto` 支持按选定兼容日期核实，不能只凭 Vitest 自动兼容通过就认定生产可用。 |
| 站长配置 | `OWNER_EMAIL`：本环境唯一获准使用网页备份的管理员邮箱，仅服务端读取；缺失、格式无效或没有匹配的正常管理员时拒绝网页备份访问，不回退到“任意管理员”。随备份模块声明并提供样例占位值，实际邮箱不入库。 |
| Worker Secrets | `BETTER_AUTH_SECRET`：库 Cookie/JWT 签名以及 TOTP/备用码认证加密，必需且每环境独立；`TURNSTILE_SECRET_KEY`：人机验证；`EMAIL_API_KEY`：Postal HTTPS API，传输层已声明，staging 已配置；`CLOUDFLARE_API_TOKEN`：备份导出最小权限；`BACKUP_ENCRYPTION_KEY`：备份加密；`WEBDAV_URL, WEBDAV_USERNAME, WEBDAV_PASSWORD`：启用 WebDAV 时的 HTTPS 目标及凭证。已取消独立 `TOTP_ENCRYPTION_KEY` 与可选 `AUTH_SECRET` 设计；当前声明认证/播放/Turnstile/备份加密/邮件五项，备份导出凭证随模块加入必需声明，外部目标凭证仅对启用目标要求完整，不以占位值部署。production Secrets 尚未上传。 |
| S3 备份 Secrets | `S3_BACKUP_ENDPOINT, S3_BACKUP_REGION, S3_BACKUP_BUCKET, S3_BACKUP_ACCESS_KEY_ID, S3_BACKUP_SECRET_ACCESS_KEY`：预配置的 HTTPS S3 兼容目标及其独立最小权限凭证；与媒体访问隔离，不向浏览器下发。随备份模块按启用的目标声明，未配置的目标在网页中不可选，不为未启用目标强制填写假凭证。 |
| 仅站长本机 | `TMDB_API_KEY`、目标环境资源映射和离线导入所需的最小权限 D1/R2 凭证；不把导入管理能力做成浏览器接口，不给 Worker 播放路径额外的上传管理 token。 |
| 集中默认配置 | 站点业务默认：邀请额度 2、邀请码 30 天、预留 15 分钟、看完 90%、进度 15 秒、备份 30 天、评论 1000 字/每页 10 条/回复每批 10 条、管理高影响操作 30 次/分钟、发信间隔 60 秒/每用途每小时 5 次。认证配置统一维护 6.3 的原生参数及显式选择：滚动会话 30 天/updateAge 1 天/freshAge 5 分钟、验证与重置链接各 1 小时、二步挑战 5 分钟、备用码 10 个、TOTP 6 位/30 秒/±1 步、原生尝试/锁定/IP 限流。settings 与原生配置已调整并通过运行探针和第三阶段验收；播放、进度和备份等配置随对应阶段验证。 |

**密钥轮换（已确认）**：**手动轮换，不设定期自动轮换**。每个环境的密钥**相互独立**，同一密钥不复用于不同环境。保管方式为三处：线上 Worker Secrets、站长的密码管理器、以及**离线副本**。旧密钥必须**保留到引用它的全部备份都被删除或重加密之后**才能弃用，**包括受保护而超期保留的最后一份副本**；**缺密钥的备份不算可恢复副本**。

本机 `.dev.vars` 使用前确认已被 git 忽略；样例仅用占位符。播放/备份格式保留自己的密钥版本；Better Auth 密文沿用库格式，不强加自定义 AAD/版本字段。手动更换 `BETTER_AUTH_SECRET` 前，在 Cloudflare 内用旧 Secret 解密并按新 Secret 重加密保留的 TOTP/备用码，完成校验再切换；不能直接换 Secret 导致现有验证器全部不可用。旧备份需要对应认证 Secret 和备份 Secret。轮换流程及恢复后凭证清理均须实测，不宣称库会自动迁移密文。

#### 6.9.2 定时备份执行与失败行为

- **调度条件与设置**：只有本环境 WebDAV 或 S3 目标配置完整，站长才可以在网页设置并启用备份频率与执行时间。时间以**北京时间（Asia/Shanghai）**展示和保存，执行时换算为 UTC；不再固定每日 04:00。仅使用直接下载或只有私有 R2 暂存时不能开启定时备份；未设置启用时不自动运行。定时入口每次重新检查所选外部目标，目标配置失效时不继续导出或报告成功，网页展示不可执行状态。导出造成的维护/查询影响仍是已知代价，应随所设执行时间向站长说明。

1. 定时入口按本环境已启用的频率与时间发起全量 D1 SQL 导出，包括 schema 和全部业务数据；导出无法通过普通 D1 binding 替代。当前官方 API 是 `POST /accounts/{account_id}/d1/database/{database_id}/export`，首次使用 `output_format: 'polling'`，之后以返回的 bookmark 填入 `current_bookmark` 持续轮询同一任务，直至完成或失败；不能伪造同步 dump API。
2. 导出期间数据库可能无法服务查询，持续轮询中断时平台会取消导出。不得将仍在执行的导出留到下一次定时触发才继续。完成后及时读取返回的短期 `signed_url` 并流式存入私有 R2 备份对象；不能把下载 URL 返给浏览器、写日志或交给 WebDAV / S3 抓取。
3. R2 记录本次备份 ID、环境、备份时间、导出 bookmark、schema 版本、长度和 SHA-256；只有完整写入并校验后才标记 R2 完成。备份控制状态可放在私有 R2 元数据/伴随记录，不因此追加业务表；重试复用已验证的备份 ID，避免重复导出和混淆日期。
4. 从 R2 加密后上传所选 WebDAV / S3 目标：WebDAV 用 HTTPS `PUT`，S3 用 HTTPS S3 兼容 API。采用带版本的认证加密封装（建议 AES-GCM；若分块，每块独立唯一 nonce、认证序号/总块数，并验证最终完整性）；大小不得要求整个 SQL 常驻内存，采用有界缓冲/流处理。目标只能来自 Secret，不跟随把授权头带到其他主机的重定向。**只有 R2 完成、加密完整、所选外部目标上传成功并回读校验通过后，才记录该目标“备份完整成功”。**
5. **上传后回读校验（已确认）**：`PUT` 成功后再用 HTTPS `GET` 把对象**流式读回**，校验**长度和 SHA-256** 与本地记录一致。**ETag 不能代替内容哈希**校验。回读可能耗时，按实际耗时在 staging 实测并纳入 15 分钟时限评估（6.16）。
6. 导出/R2/WebDAV/S3 任一失败都不创建对应成功标记：保留完整 R2 副本和**脱敏失败记录**，由站长**人工触发重试**。**不设置自动重试调度，也不做主动失败告警。**
7. **保留策略**：默认保留 `30 天`，但**每一端（R2、WebDAV 与 S3）的最后一份完整可恢复副本受保护、可超过保留期不被删除**。清理绝不触碰媒体对象，备份与媒体清理前缀严格隔离；清理失败可重试，不把部分失败当作已删除。

Cron 当前最长执行时间为 15 分钟，导出轮询、加密、上传和回读校验的全流程都要在这 15 分钟内实测；必须整体由 scheduled 生命周期等待，不依赖 HTTP 返回后 30 秒的 `waitUntil`。必须在 staging 测量备份大小、耗时和内存，并验证按网页所设频率/时间正确触发；若全流程装不进单次时限，**报告站长**决定调度或恢复办法，**不擅自引入 Queues、Workflows 或其他新产品**。

#### 6.9.3 手动恢复顺序与完整性

1. 站长选择正确环境及恢复点，**先暂停该目标的写入和导入，并保留当前状态所在的旧库**（不先删、不先覆盖），再执行恢复。
2. **默认恢复目标是隔离的 D1 目标**：先恢复到隔离目标并完成校验，通过后才切换。**Time Travel 的隔离能力不作假定**——按官方现有能力核实后再决定；**若无法构建隔离目标，如实报告站长，不自行对生产库做原地覆盖恢复。**
3. 优先按事故选择 Time Travel 或完整备份。网页下载、WebDAV 或 S3 副本须验证密文认证、备份元数据、长度和校验，先在 Cloudflare 内解密到私有对象再导入；不在本机下载未加密 SQL，不让包含密码哈希/TOTP 数据的明文副本离开 Cloudflare。
4. SQL 恢复使用当时官方支持的导入流程。当前 D1 REST import 为 `init → 上传 SQL → ingest → poll`，参数和临时地址以官方响应为准；上传及轮询在 Cloudflare 内完成，不能把 SQL 文本交给站长本机 CLI 作为中间明文文件。在隔离目标确认 schema 兼容、外键完整、业务计数与摘要一致后，再执行目标切换。
5. 验证 `media_files` 和字幕关联的 R2 对象确实存在且长度/校验匹配；**恢复 D1 不会恢复 R2 媒体，也不会恢复 Worker Secrets**。缺媒体时需从站长本地冷备及字幕原件重新导入；尚未补齐的文件保持不可播，不先开放错误地址。
6. **重新开放前统一撤销**：删除旧 Better Auth 会话、临时 verification 记录并撤销未使用邀请码及全部二步备用码；切换认证签名 Secret，使恢复点带回的邮箱 JWT 失效；媒体按会话鉴权，删除旧会话即同时作废恢复点带回的播放权限。切换认证 Secret 前在 Cloudflare 内以旧 Secret 解密并重加密保留的 TOTP，备用码以库可识别的空组作废；验证完整后才切换，不靠已恢复的数据库版本计数拒绝旧凭证。密码哈希与通行密钥按恢复点保留，TOTP 设备保留；恢复可能带回后来解绑的设备，重开前由站长复核。此运维步骤尚待实现和演练。
7. **角色与封禁状态由站长逐条复核**；无法确认的账号保持**维护状态**而不是直接放行。
8. **邀请码**：恢复出的全部未使用码撤销后，`validUnused = 0`，`occupied = used`，`available = total - used`；已用记录仍占额度，不因恢复返还（6.5.2）。
9. **旧讨论（已确认做法）**：恢复点中的历史评论和回复**照原样恢复**，不做自动识别或自动清理。维护期间由管理员**人工 review 并重新手动删除**需要移除的内容。**不引入隐藏标记、软删除、删除 ID 台账，也不批量清空正常讨论**；**接受无法自动识别全部历史删除**这一事实，**不宣称历史备份或恢复点已被擦除**。

#### 6.9.4 站长专用网页备份

- **身份判定**：每个页面、状态接口、创建/重试、定时设置及下载请求都在服务端核对有效 Better Auth 会话与当前 D1 身份：邀请注册已完成、当前邮箱已验证、未封禁、角色为 `admin`，且当前邮箱按注册邮箱规范化规则与本环境 `OWNER_EMAIL` 完全匹配。不信任客户端传入的邮箱、角色或界面隐藏状态，不增加 `owner` 角色或首个登录者自动成为站长的规则。
- **即时失效**：管理员降权、封禁、退出、撤销会话、验证后更换邮箱或 `OWNER_EMAIL` 配置生效后，下一个请求重新判定权限。邮箱不再匹配的原站长不能继续访问备份；仍匹配邮箱的普通成员也无此权限。
- **页面与操作**：站长在站内备份页查看当前环境、备份列表与状态，手动创建备份，选择直接下载、WebDAV 或 S3，并对失败的任务手动重试。普通成员、其他管理员与访客不显示入口，直接调用接口仍被拒绝。写操作经业务写入来源与 JSON 校验，页面及下载响应均 `noindex` / `no-store`。
- **共用流程**：网页与定时备份复用 6.9.2 的 D1 全量导出、私有 R2 完整性校验、版本化认证加密与脱敏失败记录。仅下载不要求同时上传 WebDAV / S3；已校验的完整 R2 副本可复用，外部上传失败不重新导出已完成的数据库。手动导出前明确提示成员查询可能受影响，不能暗示导出完全无维护影响。
- **直接下载**：Worker 仅返回本环境完整且经过校验的加密备份文件，不把未加密 SQL、R2 对象路径、D1 `signed_url` 或长期凭证交给浏览器。浏览器保存的是可恢复的加密文件，所需历史密钥由站长按 6.9.1 独立保管，不附在下载文件中。
- **WebDAV / S3**：目标及凭证只从本环境 Worker 配置/Secrets 读取，网页只选择目标类型，不接收任意远端 URL 或凭证。WebDAV 按 6.9.2 的 HTTPS PUT/GET 处理，S3 使用 HTTPS S3 兼容 API；上传后均流式回读并校验长度与 SHA-256，ETag 不代替内容校验。目标缺配置时明确不可用，不影响其他已配置目标；按所选目标分别展示完整/失败状态，不把部分成功报告为全部成功。
- **定时设置**：只有 WebDAV / S3 目标配置完整后才提供可用的频率与执行时间设置；仅下载时禁用并说明原因。服务端对启用请求执行相同校验，不能靠伪造表单绕过。设置只作用于本环境，可关闭定时备份；频率/时间与启用状态保存在私有备份控制记录，不因配置调度新增业务角色或公开凭证。
- **保留与失败**：私有 R2、WebDAV 和 S3 的各端保留策略均按 6.9.2 保护最后一份完整可恢复副本；站长自行下载的本地文件不由 Worker 清理。失败由网页展示脱敏结果并人工重试，不新增自动重试或主动告警。媒体冷备和 6.9.3 的隔离手动恢复流程继续适用，网页备份不包含一键覆盖生产库的恢复功能。
- **实现门槛**：先完成第三阶段真实认证与管理员门禁，再在第六阶段实现备份页与处理流程。网页触发任务的执行生命周期、中断和重试行为须在 staging 验证，不能依赖请求结束后短暂的 `waitUntil` 完成整次导出，也不未经确认引入新 Cloudflare 产品。

#### 6.9.5 远程数据库迁移与运维工程细节

- **staging 云端构建**：仅监听 `startrekchina/video-site` 的 `dev`，关闭其他分支/PR 预览；Node 24.21.0、pnpm 12.6.0，使用锁文件安装依赖。构建命令为 `bash scripts/build-staging.sh`，先下载固定版本并校验 SHA-256 的 Linux FFmpeg/ffprobe 到被忽略的 `.cloudflare/build-tools`，再依次运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm test:tools`、`pnpm build:staging`；自生成媒体仍不提交到 Git。部署命令为 `pnpm db:migrate:staging && pnpm deploy:staging:prebuilt --message "GitHub dev $WORKERS_CI_COMMIT_SHA"`，迁移继续使用 cf。任一步失败即停止，不改用本机上传或静默忽略失败；核对来源 SHA、迁移结果、实际生效版本和受影响入口后才能认定发布成功。
- **GitHub PR 检查**：`.github/workflows/ci.yml` 在每个 PR 及手动触发时于 GitHub Actions 运行 `pnpm typecheck`、`pnpm test`、`pnpm test:tools` 和 `pnpm build`（development），Node/pnpm 版本与 staging 构建一致，ffmpeg 取 Ubuntu 软件源版本。只读权限、不使用 Secrets、不迁移或部署；`dev` 推送仍由 staging 构建把关，两者互不替代。
- **Wrangler 补充发布边界**：固定 Wrangler 4.150.0；4.151.0 引用的 workerd 版本尚不能从 npm 安装。`scripts/prepare-staging-wrangler.mjs` 使用与 cf 一致的官方 Build Output 解析器和配置转换函数，拒绝非 staging、多 Worker、Container、缺失产物及尚未适配的模块类型；配置仅生成在被忽略的 `.cloudflare/wrangler-staging/wrangler.json`。发布使用既有 ESM 拆分模块及静态素材，不重新打包、不保留手写资源映射；Wrangler 默认保留线上 Secrets，不使用 Secrets 文件。文本变量、绑定、域名、Cron 和日志设置以构建产物为准，production 仍使用 cf 且未获发布授权。
- **构建环境**：在 Workers Builds 单独配置 `STAGING_*` 与 Cloudflare 账户标识，资源标识作为构建 Secret 保存，不注入 production 配置。沿用 staging 构建 token；核对其 Worker 部署与目标 D1 迁移权限，缺权限时报告开发者，不默认为可用。运行时认证、播放、邮件等 Secrets 保留在现有 staging Worker，不复制到 Git 或构建日志；构建机不依赖本机 `.env`。
- **远程迁移执行与 D1 触发器兼容**：远程迁移统一使用 `pnpm db:migrate:staging` 与 `pnpm db:migrate:production`，脚本自行创建 `.cloudflare` 父目录，干净 checkout 无需先开发或构建。针对 Cloudflare D1 `/query` 接口将触发器内裸 `CASE…END` 错认作触发器结束导致回滚的已知问题（参考 [Cloudflare 问题记录 #4727](https://github.com/cloudflare/workers-sdk/issues/4727)），`scripts/migrate-remote.mjs` 会在临时副本中为该表达式补充等价括号，再交由 `cf d1 migrations apply --dir` 执行；CLI 正常记录原文件名并执行增量判断，原始文件和本地已应用迁移不改写，临时文件执行后清除。迁移失败先核对状态和根因，不直接重复失败的原始命令或切换工具重跑。
- **封禁邀请码状态增量迁移**：`0011_member_security_invitation_expiry_guard.sql` 按完整文件名排在原 0011 后，替换封禁触发器，仅作废有效未使用码并原子撤销会话；已过期、已用及已作废码保留原记录。staging 已应用，production 未应用；不改写原 0011，也不批量重置历史 `revoked_at`。
- **Secrets 与交接文件**：本机 `.dev.vars.staging.secrets.json` / `.dev.vars.production.secrets.json` 是被忽略的独立密钥交接文件，只含原有四项密钥，未包含站长另行配置的 `EMAIL_API_KEY`；仅在获准本机直接部署的例外任务中，可用 `pnpm exec cf deploy --prebuilt --mode staging --secrets-file .dev.vars.staging.secrets.json` 上传文件中的密钥，不作为 Git 集成的常规步骤。播放改用会话鉴权后代码不再读取 `PLAYBACK_HMAC_KEY`；staging Worker 上残留的该 Secret 无害，删除属于云端操作，另经开发者授权。
- **应用日志与敏感凭据脱敏**：线上环境关闭包含请求 URL 的 invocation logs，并在平台启用 `redact_query_string`；密码重置链接等原生敏感路径（如 `/api/auth/reset-password/`）禁止产生应用日志，避免平台日志附加包含凭据的完整请求路径。邮件 fetch 请求采用 `redirect: "manual"` 并拒绝所有非 2xx（包含 3xx），一次请求、不跟随重定向、不自动重发。

平台行为核对于 2026-10-04，开发时按实际兼容日期再核实：[D1 batch / Sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[外键](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[R2 ranged read / If-Range 边界](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Rate Limiting 一致性](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)、[D1 export](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)、[D1 import](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/)、[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)、[Workers 执行时限](https://developers.cloudflare.com/workers/platform/limits/)、[URL invocation logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)。

### 6.10 成本估算

以下为原需求中的历史估算，不是 2026-10-11 的新报价核验；上线前按当前套餐和实际用量复核。

| 项目 | 估算 |
| --- | --- |
| Workers Paid | 5 美元/月 |
| R2 存储（单档 1080p MP4，约 1.7 TB） | 约 26 美元/月 |
| R2 出口流量 | 免费 |
| R2 读写操作和 D1 | 在这个规模下基本都在免费额度内 |
| 邮件发信（注册验证、找回、通知） | 使用站长已购买的发件服务；实际套餐限额和追加费用按已购服务核对，不再按其他服务商的免费额度估算 |
| Cloudflare 小计 | 约 31 美元/月；邮件服务的已有支出及追加费用需另计，是否满足 50 美元总预算以实际费用核对 |

以后如果增加 HLS 多档码率，存储会涨到 2.2 至 3 TB，每月约 38 至 50 美元，那时需要重新评估是否保留原始 MP4。

## 验证方法

复用本地模拟 Cloudflare export/import、WebDAV/S3，虚构数据且不使用生产明文备份。构造上传成功但回读不一致、ETag 相同内容不同、部分失败和最后副本过期等情况；staging 另验真实耗时、维护影响、调度、生命周期和隔离恢复。早期平台/配置准备见[历史计划](../archive/plan-20261007.md)，认证和播放实测见各模块报告，不将其推广为备份/完整容量通过。


## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
