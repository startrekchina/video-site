# 部署、备份与运维

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A7、B 6.9/6.10/6.16/7，依赖第三至第五阶段主要功能。T6.1 的暂存、认证加密、手动备份、WebDAV/S3、各端保留、隔离恢复工具及条件式定时调度具有本地实现。开发者确认频率由站长在配置完整的外部渠道后于管理面板自行设置；当前控件提供每天、每周或每隔 1–30 天及北京时间。staging 已实测站长页面 S3 手动备份与回读、北京时间定时备份及隔离恢复演练，见 [T6.1 staging 备份与恢复演练](#t61-staging-备份与恢复演练)；2026-10-22 的新隔离恢复库经开发者真实设备验收，旧登录失效、密码/TOTP、已有通行密钥及播放均通过，原 staging 和 Cron 已恢复；staging 当前密钥的独立副本已保存，并与现存全部备份核对指纹（2026-10-29），production 密钥在上传其 Secrets 时同样保存；单次备份内存证据仍有缺口，T6.1 整体仍未完成验收。媒体与字幕冷备由站长在项目之外自行完成，不属于本计划的任务或上线门槛。T6.2 production 发布待实施。staging 已接通 GitHub `dev` 云端自动发布，production 只有资源/密钥准备记录和构建/dry-run，不是已发布。

staging 已连接当前仓库 `startrekchina/video-site` 的 `dev`，启用推送构建且关闭其他分支/PR 预览；cf strict 限制下使用 Wrangler 补充发布。配置转换的 3 项定向用例、23 项工具测试、类型检查、staging 构建和 Wrangler dry-run 通过，15 个服务端模块完整打包。实际云端发布、运行时绑定及入口烟测通过，不替代专项功能、性能和实机验收。production 不启用自动发布。

staging 构建触发器排除 `docs/*`、`*.md` 与 `prototypes/*`（开发者 2026-10-15 授权）：推送只改这些文件时不构建、不部署，GitHub 上也不显示构建状态；同一推送含其他文件时照常构建。`test/` 不排除，测试改动仍经过 staging 构建中的测试门禁。一次推送超过 20 个提交或 3000 个文件，或没有文件改动时，平台忽略路径规则强制构建。规则由 `cf builds triggers update` 维护，见 [Build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)。

## 任务与验收

- [x] 备份明文生命周期的实现与本地自检（2026-10-26）：实现见下方私有暂存规则。备份/调度定向 27 项通过，覆盖明文删除失败重试、加密失败保留源、源缺失重新导出、无明文上传重试、密文缺失拒绝、下载及最后副本保护。旧源前缀回收检查成功备份明文已删除、密文仍保留；中断夹具在加密阶段注入故障，确认状态读取不自动执行、人工重试复用源且不重复导出。未受影响的时间计算等用例复用此前 221 项扩展回归结果；类型检查通过，最终应用源码的 development 构建结果有效，测试夹具调整不影响构建产物。真实 Workers 断线仍须 staging 复验。

- [x] B9 / B24 的实现与本地自检（2026-10-25）：备份配置不可用且无活动租约时 Cron 继续扫描；旧目标副本单列待处理，当前位置清理独立执行。站长显式确认、同源校验、时间戳与 ETag 条件写、占锁拒绝及幂等返回均有覆盖，确认不发远端 DELETE，最后 R2 副本继续保护。备份、外部目标和定时 98 项、备份页面 3 项通过；真实组件的桌面/390px 手机夹具验证提示、取消无提交、冲突后保留待处理状态及成功后结束记录，接口用虚构响应。staging 与真实外部服务未复验。

- [x] B7 外部上传收尾的实现与本地自检：取得 R2 源后、交给 fetch 前的取消及 PUT 网络异常均在 finally 关闭源流，保留加密对象和失败回执规则。四个新增用例在修复前均复现源流未取消，修复后 WebDAV/S3 成功、失败、取消及回读共 13 项通过；真实外部服务沿用后续 staging 门槛。

- [x] 后端审查修复的复验范围：领取租约前登记断线收尾；恢复读取与上传失败时停止流并清理；新操作检查旧明文；配置、控制记录及空库校验、实际对象保护点均有实现和后端回归。备份/恢复 103 项及可选密钥元数据下载补测 1 项、存储和外部目标用例有有效本地证据；备份页 3 项集成测试通过，原 60 秒准备超时未放宽。真实组件夹具的损坏提示、空态、分页及旧位置确认通过。这些路径依赖断线或故障注入，开发者 2026-10-29 确认以本地证据为准，不在 staging 复验（[复验记录](../staging-recheck-20261029.md)）；备份网页的完整生命周期与中断重试仍随 T6.1 staging 实测。

后端审查自检基线为 `dev@13de80c` 的本工作树差异（2026-10-25）。Windows 本地 `TEMP`/`TMP` 指向工作树的 `.cloudflare/test-tmp`；受限沙箱不能完整读取依赖声明，类型检查在可读取依赖的本地环境执行，不改检查规则。媒体扫描、片单及备份追加修复覆盖 `media-sync`、`library`、`library-titles`、`backups`、`backup-targets`、`backup-schedule`、`backup-page` 共 7 个文件 140 项，未变链路沿用同工作树已有证据，不重复计算用例。类型检查和最终主站开发构建通过；恢复工具构建、冻结锁文件安装与未变恢复内核验证沿用已有结果。浏览器使用真实组件和虚构 API 响应，不能代替真实外部服务验证。新迁移尚未应用到云端，真实平台中断、外部服务与旧备份升级流程仍待 staging 验证。

- [x] PR #42 已复现缺陷的实现、自检与复核：恢复断线收尾、回执重试、各端保留、坏调度与媒体扫描隔离，以及 Devin 指出的新完成副本保护点。范围与证据见[审查复核](#pr-42-备份审查复核)，不等于平台或开发者验收。
- [x] PR #42 恢复工具断线收尾：开发者 2026-10-29 确认以本地证据为准，不在 staging 复验。
- [x] PR #42 密钥指纹的弱口令风险（开发者 2026-10-29 决定）：不改指纹或备份格式，靠随机生成的高熵 Secret 防范，生成方式见 [6.9.1 密钥轮换](#691-绑定secrets-与集中配置)；开发者确认 staging 现有两把密钥为随机生成，不轮换。理由见下方[审查复核](#pr-42-备份审查复核)。其余静态发现未确认，不按已修复交付。

- [x] T6.1 恢复后的真实设备验收（2026-10-22）：最新完整 S3 备份在新建 APAC 隔离库导入，18 张业务表、媒体关联、TOTP 重加密和凭证清理复核通过；开发者确认旧登录失效、原密码/TOTP、已有通行密钥及 SNW S02E02 播放、拖动、字幕与进度通过。原 staging 版本、33 个绑定和 Cron 已恢复，五项入口烟测与外键检查通过。临时 Worker、隔离库、演练版本及 keyring 已清理，开发者确认导入 Token 已手动撤销。媒体冷备与密钥独立副本尚未准备，T6.1 整体保持未完成，见[完整记录](../staging-readiness-20261022.md)。
- [x] staging 密钥独立副本（2026-10-29）：开发者确认已把本机交接文件中的 `BACKUP_ENCRYPTION_KEY` 与 `BETTER_AUTH_SECRET` 存入密码管理器和离线副本。两项的 SHA-256 指纹与 R2 中现存 7 份 staging 备份记录（2026-10-17 至 10-26）全部一致，对应密文均在，现存备份不依赖历史密钥。比对只读，未输出密钥或指纹；S3 外部副本未单独核对。
- [x] 恢复时缺失媒体不中止的实现与本地自检（开发者 2026-10-29 选定）：站长在恢复点之后直接删除已关联的视频或字幕，删除前后的备份都能恢复，缺失项计入 `mediaMissing`，规则见[隔离恢复工具](#隔离恢复工具)第 7 步。`test/backup-restore.test.ts` 22 项通过，新用例覆盖删除后恢复照常完成、清空版本、同名补传后扫描恢复版本；类型检查与恢复工具构建通过。主站不引用该模块，未重建。staging 实测（2026-10-29，`4614f25`，开发者授权新建隔离库与临时 Worker）：10-26 19:06 的备份导入新建 APAC 隔离 D1 用时 8 秒，恢复与单独 `validate` 均返回 `mediaMissing` 3（换样本时删除的 3 个旧 H.264 原画）、`mediaPending` 5（之后同名替换的 720p/480p 与 3 条早期测试字幕），两次业务摘要一致；只读核对 8 条媒体记录版本均已清空，缺失项正是 R2 中已不存在的 3 个原画。按旧实现这份备份会在校验时失败。未执行凭证清理与切换；临时 Worker、隔离库与本机密钥文件已删除，R2 恢复暂存无残留，开发者确认导入 Token 已撤销。
- 2026-10-22 上线前复验：邀请/封禁迁移及媒体拒绝通过；100 次请求与 150 次有界并发 Range 成功，不能代替真实码率容量。控制台有 24 小时内存汇总，尚未对应单次备份峰值；浏览器冷缓存、真正冷启动、完整实际费用仍有缺口。官方价格已核对，账单接口返回 `403`；保留 T6.2 未完成。

- [x] 同步 `main` 的 PR 合并规则、协作约定和验收条件；规则一致性、62 个本地链接/锚点及 `git diff --check` 自检通过。仅验证文档，未调整 GitHub 分支保护或云端发布配置，DEP1 保持待实施。
- [ ] DEP1 按 [B 6.9.5](../detailed-requirements.md#695-github-分支构建与发布)接通并验收 Workers Builds 分支发布：先完成 staging，production 接通与验收遵守 T6.2 上线门槛；核对 `main` 的 PR 合并与分支保护、现有 cf 工具链兼容性、构建/运行时配置、迁移顺序与失败中止。正式站按 [ENV1](#env1-预览环境并入同一个-worker) 的同一 Worker 结构接入，ENV1 在上线前完成。
- DEP1 staging 自动发布自检（2026-10-14）：GitHub `push_event` 来源 `dev` 的 `1ce197c`，构建 `f447c6db-bdc2-4ac5-a3e0-72d718f3c343` 在云端通过锁文件安装、类型检查、272 项应用测试、23 项工具测试、staging 构建、cf 增量迁移和 Wrangler 发布。版本 `f77d338b-efaa-412d-b81d-ef1612bf00d0` 于 18:18 北京时间生效，100% 流量，版本消息记录完整来源 SHA；未从本机上传。D1 的 `0008_legacy_invitation_guard_retirement.sql`、`0011_member_security_invitation_expiry_guard.sql`、`0013_invitation_source_guard.sql` 已应用，只读迁移列表无待应用项；11 个既有 Secrets、D1/R2 和四个限流绑定与发布前一致。
- DEP1 staging 入口烟测：无 Cookie 的 `/`、`/about` 返回 `200`，`/series` 和 `/watch/series_103516_s1_e1` 返回 `302` 到登录，匿名 `/media/00000000-0000-4000-8000-000000000000` 返回 `401`；入口带 `noindex`、`no-store, private` 和 `nosniff`，首页引用的客户端 JS 返回 `200`。Chrome 当前剧集→电影只读导航正常，无客户端 error；Node 直连连接重置，系统 HTTP 客户端可访问。专项性能与实机/开发者验收及 production 链路仍待完成。
- staging 媒体桶迁至 APAC（2026-10-16，开发者授权）：新桶对象与原桶逐一一致，Workers Builds 构建 Secret 与本机 `.env` 改指新桶，`38457f4` 起生效；原 ENAM 桶按开发者决定暂时保留作回退备份，过程见[账号与性能计划](authentication.md#t458-数据位置与成员机房测量)。
- staging 诊断恢复核验：首次多提交[复验](../staging-revalidation-20261014.md)确认 D1 优化、核心安全与日志脱敏，并定位签发 R2 串行等待；仅并行 HEAD 的修复已通过 A/B/B/A 实测，三个签发入口中位耗时降低约 24%–26%，历史尾延迟未复现、尚未整体验收。cf 恢复原始 `cbb16db` 版本 `323dc854-6954-48a5-a543-30d40827a7bf` 至 100% 流量，11 个 Secrets、绑定和观测配置一致；首次 6 账号/4 版本与修复复测 2 账号/2 版本分别清理。恢复后实际请求日志确认原版本且无诊断事件；修复随后经 PR #26 进入 `dev` 并随 staging 自动发布，没有 production 操作。
- 诊断版本清理边界：平台拒删最新上传版本（API 10339）；沿已确认的 strict 补充路径，以固定 Wrangler 4.150.0 `versions upload` 上传无探针的干净 `cbb16db` 副本 `512c4b13-b83b-459a-99db-5f6466385a55`，只上传、不部署，再用 cf 删除停用诊断版本。该原版副本保留且未激活，原始版本继续 100% 流量；不能将其称为未清除的诊断或已发布修复。清理时一次 D1 `fetch failed` 重试后通过，未扩大删除范围；完整[恢复与清理证据](../staging-revalidation-20261014.md#修复恢复与清理)及 JSON 独立记录。
- [x] T6.1a 私有 R2 暂存与流式认证加密内核：长度/SHA-256 回读、认证封装与可恢复性校验、失败保留完整源副本；实现及本地自检通过，不代表 T6.1 验收。
- [x] T6.1b 手动备份服务端链路：逐请求站长门禁、D1 导出、状态查询、加密下载及人工重试；实现、并发/断线/失败脱敏/环境隔离本地自检通过；staging 已实测加密下载、断线即时收尾及同 ID 重试。
- [x] T6.1c 外部目标、各端保留与隔离恢复工具的实现、自检和复核；验证范围见下方摘要，平台演练不以本地模拟替代。
- [x] T6.1a2 站长页面与调度设置 API 的实现、自检和复核：逐请求 OWNER_EMAIL + 正常管理员、来源和 JSON 门禁；配置写入私有 R2。SSR 覆盖渠道选择与失效提示，浏览器仅覆盖缺配置态和关闭设置保存，完整操作仍待 staging 验证。
- [x] T6.1a3 Cron 调度实现、自检和复核：条件领取执行槽、复用完整备份流程、与手动备份/清理互斥、同轮暂停媒体扫描；北京时间边界、关闭/修改、失效与失败不自动重试、并发和状态保存失败的本地模拟通过。
- [x] T6.1 本地模拟权限、环境、下载可恢复性、部分失败、重试和保留；staging 实测网页执行生命周期/中断重试、全定时流程 15 分钟、存储访问与内存成本。
  - 网页生命周期、两阶段断线重试、并发拒绝、定时时限及 S3 回读已有 staging 实测，见 [T6.1 staging 备份与恢复演练](#t61-staging-备份与恢复演练)。开发者 2026-10-29 确认：production 只用 S3，WebDAV 回读不作门槛（见 [6.9](#69-环境与备份)）；大库耗时与内存按[复测条件](#692-定时备份执行与失败行为)处理。
- [x] T6.1 演练隔离手动恢复、重加密与旧凭证清理、角色/封禁/设备复核、历史讨论人工重删；补齐密钥保管和恢复说明。
  - 隔离恢复做过三次：10-21、10-22（切换 staging 并经开发者实机验收），以及 10-29 用现行工具恢复与校验。重加密与旧凭证清理在 10-21、10-22 通过，相关函数此后未改。`review` 列出的 1 名正常管理员与 2 台设备经开发者 2026-10-29 确认为本人账号及其通行密钥。演练恢复点与切换在同一天，期间无讨论删除，人工重删经开发者确认不适用；管理员删除已另有 staging 验证。密钥保管见 6.9.1 的密钥轮换规则，staging 副本已核对，恢复步骤见[隔离恢复工具](#隔离恢复工具)。
- [ ] T6.2 全部主要功能、相关测试与 staging 端到端通过，核对日志、权限/封禁、并发、预算及平台边界。
- [ ] T6.2 补齐 production 独立 Secrets、邮件与 S3 备份目标，核 Worker/D1/R2/Turnstile/域名和隔离；获明确授权后正式迁移、部署与 HTTPS/权限/安全头验收，记录发布版本。

## 备份内核边界

`app/lib/backup-storage.server.ts` 负责 SQL 流存入本环境私有 R2、回读核对长度/SHA-256、加密与认证回读；`backups.server.ts` 负责导出、权限、任务生命周期和保留，`backup-targets.server.ts` 负责外部目标传输，`backup-restore.server.ts` 负责隔离导入、完整性与凭证处理。内核不承担 HTTP 路由、Cron 或业务表职责，不影响媒体扫描的 `library/` 前缀。

- 对象只使用 `backups/<environment>/<UUID>/` 前缀；源 SQL 和完成记录不可覆盖。只有源对象回读成功才写源完成记录；加密失败保留完整源供重试，源 SQL 缺失时重新导出到新源 ID。已验证密文的上传重试复用原密文，不依赖暂存 SQL 或源元数据文件；密文版本或长度不符时拒绝重试，保留原任务及外部回执。
- 密文及其任务引用持久化后单独删除暂存 `source.sql`：外部渠道在上传前处理，仅下载在成功记录保存后处理；保留密文及必要元数据，不等待密文保留期，也不因最后副本保护而长期保留明文。删除前核对密文 ETag 与长度；失败记为清理失败，后续自动或手动清理会再次处理，包括已有密文但上传失败的任务。暂存对象刚写入时最多等待 1.1 秒避开 R2 同对象写入频率限制，不让时钟差异扩大等待。
- 封装使用标准 `node:crypto` 的 AES-256-GCM 单流认证，不自建分块密码协议。每份密文随机 salt/nonce，HKDF-SHA-256 派生文件密钥；版本、环境、备份 ID、创建时间、schema、源长度/摘要、密钥指纹均由 AAD 认证。导出 bookmark 只写私有完成记录，不放入密文文件头。密钥由至少 32 字节的高熵 Worker Secret 提供，不使用用户密码；密钥指纹只用于识别历史密钥，不包含密钥本身。
- 固定前缀和有界 JSON 头后是等长密文及末尾 16 字节认证标签。workerd 要求解密前设置标签，因此通过 R2 条件范围读取预取同一对象版本的末尾 16 字节，再流式验证长度/SHA-256、GCM 标签及还原内容摘要；认证成功前不向调用方输出明文。后续恢复同样须在 Cloudflare 私有暂存中完成整份认证后才能导入。
- 使用 `FixedLengthStream` 保留 R2 写入的已知长度与背压；流式哈希/加密不拼接整份 SQL。格式校验拒绝超出 AES-GCM 单条消息限制（`2^36 - 32` 字节）的源。当前使用 R2 单次 `put`，接入 D1 导出时还须核对上游长度与平台单次写入限制，不宣称支持任意大小数据库。
- 内核错误由 HTTP 调用方归类，不直接展示上游异常。没有完成记录的对象不能用于下载或算作成功副本；过期清理覆盖任务源前缀的残留，未过期的完整源供人工重试。
- 本地验证覆盖完整往返、空/多块输入、错误密钥、篡改/截断/追加、环境不匹配、源/密文读回损坏、存储失败、取消及不覆盖；不重跑未受影响的 UI/认证/媒体链路。类型检查与 development 构建仍执行。真实平台生命周期、内存/时限、网页与外部目标、保留策略和隔离恢复不由此切片宣称通过。

平台依据（2026-10-16 文档核对）：[Workers node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)、[FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/)、[R2 条件写入与校验](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。本工程兼容日期保持 `2026-09-25`；运行时支持还须本地 Workers 测试及后续 staging 验证。

### T6.1a 验证摘要

2026-10-16，基于 `3f21b5b` 工作树的备份内核差异：`pnpm test test/backup-storage.test.ts` 17 项通过，覆盖空/多块 SQL、独立 Web Crypto 还原、144 MiB 生成流、密钥/环境/ID 不匹配、头/密文/标签篡改、截断/追加、读回损坏、对象版本变化、上传/完成记录失败、人工重试、不覆盖及取消。`pnpm typecheck`、`pnpm build` 和差异检查通过，未改已有测试基线；内核没有密钥或明文输出接口，私有源与密文完成记录只在对应校验后生成。故障注入中的断流伴随本地 R2 的连接中断日志，测试断言通过；cf/Vite 的既有配置弃用与测试缺少本机 Secrets 提示仍存在，测试使用虚构密钥。

144 MiB 用例证明该规模下的本地流式路径可完成，不是 staging 峰值内存、平台时限或真实 D1 导出证据。内核测试不替代 HTTP 门禁与生命周期测试；后者见 T6.1b 验证摘要。未连接云端、创建真实备份、演练恢复或发布。

## 手动备份链路

入口 `/admin/backups` 的创建请求先复用实时会话/成员校验，再核对 `admin` 与 `OWNER_EMAIL` 的邮箱大小写规范化匹配。当前有效成员的邮箱已由 Better Auth 验证，缺失、无效或不匹配的站长配置拒绝访问，不新增平行邮箱校验器或角色。状态、重试和下载均独立鉴权；JSON 写入需要同源及显式确认维护影响。

`backups.server.ts` 维护本环境任务、D1 REST 导出与 HTTP 生命周期，`backup-storage.server.ts` 承担暂存、认证加密与完整性校验。数据流为站长请求 → 本环境 R2 条件租约/任务记录 → D1 全量 polling export → 私有 R2 校验 → 加密及回读 → 完成记录；原始 SQL、bookmark、signed URL 和路径只在服务端，不进入状态响应。导出前读取迁移列表摘要，导出开始后不依赖 D1 查询。导出目标 ID 与 DB 绑定从同一配置派生，不接受客户端资源 ID。

断线监听在租约写入前登记；收尾等在途领取及初始任务写入结束，串行保存中断状态并按 ETag 释放自己的租约。控制记录按任务、源元数据与回执用途校验，源元数据规则复用存储内核；损坏记录不能用于下载、重试或清理。列表保留可读任务，并通过 `invalidJobs` 明确报告损坏项；清理遇到损坏记录整体失败，不据此删除对象。保护点按实际对象识别：R2 使用源 ID，外部使用目标与文件名，避免其他任务引用同一份文件却记载更早时间时误删最后副本。损坏租约始终拒绝新备份和清理；定时扫描先保守等待该 R2 对象的 `uploaded` 时间加 14 分钟，超过现有任务最长执行时间才解除扫描排斥，仍报告控制记录错误，不把坏租约当作空闲租约覆盖。

配置预检同时检查备份密钥和认证 Secret 的最低长度；两者均须使用独立高熵随机值。文件头的 SHA-256 指纹只用于选钥，长度检查不能保证熵，不支持用可猜测口令代替 Secret；本地检查不代表已检查或轮换线上密钥。

- HTTP 请求等待全流程，14 分钟主动截止。客户端断线会结束本次调用，请求自身的 catch/finally 不再执行，只有 `waitUntil` 登记的工作可在约 30 秒宽限内继续；因此断线由请求 `signal` 的 abort 监听同步登记收尾：备份把运行中任务记为 `BACKUP_INTERRUPTED` 并释放租约，清理直接释放租约。任务状态写入串行执行，断线收尾不会与请求自身的写入竞争同一 ETag。`waitUntil` 只保护小型状态写入和租约释放，不承载备份或清理。主备份在截止前完成校验后先持久化结果，再用原截止时间内的剩余窗口清理，不另起完整超时窗口。清理失败或超时只记录 `cleanup` 失败，不翻转备份成功；清理结果保存失败仍返回错误，`cleanup: null` 不表示清理成功。进程直接终止时，尚未保存完成结果的任务在租约到期后显示中断并允许人工重试；已保存的成功结果保留。staging 必须实测连接、中断及平台限制。
- `backup-control/<environment>/` 保存任务与全环境单任务条件租约，`backups/` 保存源和密文，不新增业务表。每次导出前写入不可覆盖的 `sources/<sourceId>.json` 归属索引，保留任务 ID 与创建时间；重试换源后，索引仍可定位旧源残留。外部写入前额外持久化已校验密文与目标意图，防止中断后丢失远端对象归属。有效租约直到显式释放或到期均阻止其他备份、清理及定时媒体扫描，不因任务已经显示完成而提前放行清理并发。任务及租约相邻写入至少间隔 1.1 秒；状态保存和租约释放使用各自 ETag，过期执行者不能覆盖新尝试或释放新租约。列表按反向时间 ID 分页，每页最多 20 项，仅返回公开任务 ID 作为翻页位置。
- 人工重试保留任务 ID；已有源完成记录时复用源及原导出日期，已校验密文在外部失败时仍保留下载与重试引用、已验证回执及未完成上传意图，不重新导出或加密。否则使用新的源 ID，不覆盖上次残留。已完整成功的备份拒绝重试，不因清理失败重复上传，过期清理通过独立入口重试。目标位置变更不将原失败任务静默改投新位置；需恢复原配置重试或创建新任务。失败只记录固定分类，不保存上游错误文本、URL 或凭证。导出失败另在 Worker 日志写入 `backup_export_rejected`，只含任务 ID、HTTP 状态、导出状态和数值 API 错误码，供定位上游拒绝原因。
- 下载只接受完成记录指向的文件，创建时已通过 SHA-256/GCM 校验，下载通过条件读取锁定同一 ETag/长度；ETag 仅锁定版本，不替代首次内容校验。更换备份密钥不阻止下载原密文，恢复仍需要对应历史密钥。
- `download`、WebDAV/S3 与定时入口共用导出与认证加密，未配置的目标单独不可选。本地 `development` 禁止远程导出；线上需补齐独立 `D1_EXPORT_TOKEN`、站长邮箱和备份密钥并另行获准发布。
- 单次 R2 写入仍是当前边界：导出必须返回未压缩的可靠长度，SQL 大小为单次上传上限预留封装空间；缺少长度或超限明确失败，不缓存整份文件或伪造成功。真实 D1 导出响应、实际库规模及大文件路径需 staging 验证后再判断是否需要 multipart。

平台依据（2026-10-16）：[D1 export](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)、[Workers duration](https://developers.cloudflare.com/workers/platform/limits/#duration)、[R2 limits](https://developers.cloudflare.com/r2/platform/limits/)。T6.1b 接口切片验证新增备份入口及共享 Worker 分发/配置，不覆盖后续 UI、外部目标、清理与恢复工具；完整差异验证见 T6.1c。

### T6.1b 验证摘要

2026-10-16，基于 `3f21b5b` 工作树的手动备份差异：最终 `pnpm test test/backups.test.ts` 26 项通过；此前同轮 `test/auth.test.ts`、`test/auth-http.test.ts`、`test/http.test.ts` 的 50 项以及 `test/backup-storage.test.ts`、`test/security.test.ts` 的 19 项通过结果仍覆盖最终差异，共 95 项应用定向验证，不是全量回归。`node --test scripts/prepare-staging-wrangler.test.mjs` 3 项、最终 `pnpm typecheck` 和 `pnpm build` 通过；既有测试用例未修改。

场景覆盖：匹配邮箱的正常管理员成功，其余身份和失效会话在每个入口拒绝；同源/JSON/维护确认；导出轮询与认证加密下载；配置缺失、外部目标、长度/编码/大小限制拒绝；上游错误及重定向不泄露凭据；完整源复用、日期保留；并发及重试发布窗口互斥、过期执行者无法覆盖新尝试；模拟请求断线/执行超时、进程中断残留与最终状态写入失败；文件版本改变拒绝下载、历史密文可下载、环境隔离与分页。复核确认未把整次任务交给 `waitUntil`，未新增 Cron、业务表、依赖或云端产品。

Cloudflare 导出响应均为模拟，D1/R2 使用本地 workerd；未做浏览器、真实 D1 export、staging 生命周期/内存/时限或恢复演练。该接口切片不含页面验证，本地 development 不允许调用远程导出。线上发布前必须另行配置对应环境的 OWNER_EMAIL 与运行时导出 Token；构建凭证不会作为备份权限交付。本轮未提交、推送或部署。

## 备份接口映射

| 入口与方法 | 权限 | 请求 / 响应 |
| --- | --- | --- |
| 备份页面 / `GET /admin/backups` | 仅站长 | loader 直接复用状态服务，展示目标、列表、创建/重试、加密下载与调度设置；创建和重试先经对话框说明维护影响；创建、重试、清理与保存调度的结果以 toast 反馈，时间按北京时间显示为 `YYYY-MM-DD HH:mm`。 |
| `GET /admin/backups/status?after=<任务ID>`、`GET /admin/backups/:id` | 仅站长 | 返回本环境备份时间、状态、可用目标和脱敏失败信息；列表的 `invalidJobs` 为当前页损坏任务 ID，页面明确提醒检查，单项读取损坏记录返回 `503 / BACKUP_RECORD_INVALID`。不返回原始 SQL、对象键、上游下载地址或外部存储凭证。 |
| `POST /admin/backups`、`POST /admin/backups/:id/retry`、`GET /admin/backups/:id/download` | 仅站长 | 创建/重试接收 `{target: "download" / "webdav" / "s3", maintenanceConfirmed: true}`，校验来源、JSON、目标配置；重试目标类型不变。仅下载本环境已完整校验且未清理的 R2 密文，不能重定向到 R2 或 D1 地址。外部失败仍可下载完整密文，不表示外部成功。 |
| `POST /admin/backups/:id/close-external` | 仅站长 | 接收 `{confirmed: true, updatedAt}`，只处理当前位置配置不再匹配的旧回执；活动租约拒绝。记录版本变化返回 `409 / BACKUP_STATE_CHANGED`，同源校验及 ETag 条件写阻止误确认。保存 `externalClosedAt` 后重复提交幂等，不设置 `externalDeleted`，不调用远端删除；站内完整密文仍按现有下载和保留规则管理。 |
| `PUT /admin/backups/schedule` | 仅站长，设置/启用须有配置完整的 WebDAV / S3 目标 | JSON 字段：`enabled`、`target: "webdav" / "s3"`、`frequency: "daily" / "weekly" / "interval"`、`time: "HH:mm"`；weekly 的 `weekday` 为 0–6（周日为 0），interval 的 `intervalDays` 为 1–30，其余对应字段为 null。校验来源、JSON 和目标配置；渠道失效仍允许保持原参数关闭。返回本环境调度状态，不接受直接下载或私有暂存目标。 |

业务 JSON 沿用 `{data, requestId}` / `{error, requestId}`。创建与重试的 `200` 表示任务结果已经持久化，不表示所选目标成功；页面检查 `data.status === "complete"`，失败展示固定的 `failure.code/message`。状态保存失败直接返回错误。页面 loader 直接复用服务函数，不发内部 HTTP 请求。`POST /admin/backups/cleanup` 以空 JSON 人工重试清理，仍要求站长及同源门禁。

任务公开状态包含 `updatedAt`、`externalPending` 和 `externalClosedAt`，不公开旧目标地址或凭证。清理结果的 `status` 为 `complete`、`failed` 或 `pending`；存在旧位置待处理项时返回 `pending` 计数，当前位置同时有实际失败则仍为 `failed`。页面单独提示旧位置待处理，确认对话框要求先迁移到可恢复的位置或完成旧位置清理；保留历史记录，站内副本也已清理时显示“已结束”，不将人工移交宣称为远端删除。

### 外部目标与各端保留

- WebDAV 目标目录由站长预建，文件平铺在预配 HTTPS 目录；S3 使用预配 HTTPS endpoint 的 path-style bucket URL，`aws4fetch@1.0.20` 签名已知 SHA-256，不将流体交给签名库缓存，也不采用库的自动重试。`Accept-Encoding: identity` 在签名后设置，保持未压缩回读且不让运行时对该传输头的调整影响签名。PUT/GET/DELETE 均拒绝重定向，凭证不转发至其他主机。
- PUT 后流式 GET 核对长度/SHA-256，不能以 ETag 代替。外部失败不影响完整 R2 密文的下载，任务仍显示所选目标失败，不能把这份下载副本报告为外部成功。
- 默认 30 天。清理分页读取控制记录，以已持久化、具有认证/备份历史密钥且仍可校验的副本确定各端保护点；已保存成功的本次任务也参与保护点选择，仍在执行的任务不能作为删除依据。保护点仅授权删除严格早于它的过期副本，不能因新副本暂时不可读或缺密钥而删除更新的恢复选项。R2 用已认证对象的版本与长度确认，外部保护点重新流式回读核验。每个外部目标位置独立识别，不对变更后的地址删除旧位置文件。
- R2 与外部副本独立清理、独立记录；一端受保护不导致另一端永久超期保留。失败或控制状态保存失败不报告全部删除，人工清理可重试；没有可信保护点时不删除该端。清理在网页/定时的完整备份流程或人工请求中执行。只列举本环境任务及源归属索引的 `backups/<environment>/<sourceId>/`，不触碰媒体、本机下载及其他环境。换源遗留前缀满 30 天且不再被任务引用时，也必须有可信 R2 保护点才删除；先清空源前缀，成功后删除归属索引。
- 旧位置回执与当前配置不匹配时保留为待处理，不尝试跨位置验证或删除，也不阻塞当前位置清理；站长确认后的旧回执停止自动追踪，源与回执元数据保留。未确认前恢复原配置会重新纳入该位置的正常保护和清理，已确认记录不重新开启重试。
- `BACKUP_KEYRING` 是可选私有 JSON 数组，元素为历史 `{backupKey, authSecret}` 条目，最多 20 组；当前条目由现有 Secrets 派生。备份认证头记录两个密钥的 SHA-256 指纹；加密与认证 Secret 按各自指纹独立查找，不要求来自同一条目。重试可以用新备份密钥加密旧 SQL，而 SQL 中的 TOTP 仍使用旧认证 Secret。清理只把两种所需密钥均实际持有的副本算作可恢复；缺记录或缺密钥不推测可恢复，也不销毁剩余恢复选项。历史密钥仍须在密码管理器和离线保管，轮换时同步 Secret 清单。

### 隔离恢复工具

`tools/backup-restore/` 是临时运维 Worker，不接入站点网页、Git 自动发布或生产恢复按钮。它复用备份内核，以独立操作 Token 保护唯一 `/operate` 接口，拒绝浏览器 Origin 和非 JSON；同一隔离目标以 R2 条件租约串行执行。Token、旧/新认证 Secret 和备份历史密钥只放 Worker Secrets。构建需先安装主项目依赖，再安装该目录的固定 cf/Vite 工具链；cf 要求独立项目在自己的 manifest 声明开发服务器，因此保留独立锁文件，不另建业务实现。

官方 [Time Travel 文档](https://developers.cloudflare.com/d1/reference/time-travel/)明确说明目前不能 clone/fork 新库，不能拿原地 Time Travel 代替本项目的默认隔离恢复。可执行路径是新建空 D1 后用完整备份导入，旧库始终保留。没有获准的隔离目标时停止，不覆盖旧库。

恢复工具与恢复点的 schema 必须匹配。当前业务汇总包含 `0018_reply_cursor.sql` 的回复游标水位；缺少该表的旧备份不能直接通过当前工具的完整校验，不代表密文或其中的数据失效。当前站点另要求 `0019_email_sender_quota.sql` 的发信索引。`0021_playlist_short_ids.sql` 只改片单 ID 取值、不改表结构：此前的备份恢复后片单仍是 UUID，新地址打不开，须按正常顺序补跑迁移。首次发布前不维护旧开发 schema 的兼容层。需要恢复旧备份时，须先确定对应 Git 版本的 schema、汇总校验和增量升级顺序，在保留当前鉴权、取消收尾与明文清理约束的隔离流程中演练；不能直接部署缺少这些修复的旧工具，也不能跳过缺表校验或删除旧备份。该路径尚未在 staging 演练，不能用当前版本的恢复证据替代。

空库检查包含表、视图、索引和触发器，只排除 SQLite/Cloudflare 自身对象。恢复读取复用内核的可取消流消费；MD5 读取和上传生产端分别跟踪，删除明文前等待解密写入及这些本地流收尾，不等待已经断线的远程导入请求恢复。上传网络或 HTTP 错误会中止生产端并释放读取器；非成功的元数据响应主动取消响应体。领取新恢复租约前，工具自动检查旧 `plaintextKey` 只能位于本环境的恢复暂存前缀，等待同键写入间隔后删除；删除失败返回 `503 / RESTORE_PLAINTEXT_CLEANUP_FAILED` 并保留原控制记录，不能覆盖唯一清理线索。

1. 获得目标环境、维护窗口、临时 Worker/新 D1 和资源写入授权。确认无备份任务执行且定时保持关闭，暂停成员写入与媒体导入，保留旧库；工具本身不会暂停线上服务、切换绑定或重新开放。
2. 在 `tools/backup-restore/.env` 设置 `.env.example` 中的映射，源 D1 与隔离 D1 ID 必须不同。准备被忽略的 `.dev.vars.restore-secrets.json`：`D1_IMPORT_TOKEN`（仅隔离 D1 导入所需的 D1 Edit）、`BACKUP_ENCRYPTION_KEY`、`BETTER_AUTH_SECRET`、`RESTORE_NEW_AUTH_SECRET`、`RESTORE_OPERATOR_TOKEN`，引用历史密钥时另加 `BACKUP_KEYRING`。新认证 Secret 和操作 Token 各自独立、高熵且至少 32 字节；本次流程中不更换新 Secret。`sanitize` 和 `credentials` 共用密钥清单校验，新认证 Secret 不得复用任何当前或历史认证/备份密钥，而不只排除恢复点所选的旧认证 Secret。
3. 本地准备：`pnpm --dir tools/backup-restore install --frozen-lockfile`；进入该目录执行 `pnpm build` 和 `pnpm exec cf deploy --dry-run`。部署须另有明确授权，获准后才执行 `pnpm exec cf deploy --prebuilt --secrets-file .dev.vars.restore-secrets.json`。临时 Worker 的 workers.dev 地址仅用于带 Token 的本机运维请求；完成后按授权删除临时 Worker，不删除旧库或备份。
4. 可直接使用本环境 R2 已认证密文；从本机/WebDAV/S3 恢复时，只向 Cloudflare 私有 R2 上传加密文件，按文件头的环境、源 ID 与密钥指纹选择对象，文件名可采用新的 `encrypted-<UUID>.bin`。不能上传/下载本机中间明文 SQL，也不能把外部地址或凭据放入操作请求。
5. 本机 `.dev.vars.restore-client.json` 只含 `endpoint`（HTTPS `/operate`）及 `operatorToken`。将请求和结果放在被忽略的 `.cloudflare/`：`node tools/backup-restore/operate.mjs .dev.vars.restore-client.json .cloudflare/restore-request.json .cloudflare/restore-result.json`。结果文件使用独占创建，避免覆盖证据；Token 不放命令行或 URL。请求示例见下表。
6. `restore` 仅接受空隔离库，先整份认证，再锁定同一密文版本流式解密至 `backup-restore/` 私有暂存；回读确认后在 Cloudflare 内执行官方 `init → PUT → ingest → poll`，上传 URL 不携带 API Token。上传内容在 SQL 前加 `PRAGMA foreign_keys=OFF;`，`etag` 取实际上传字节的 MD5：D1 导出按建表顺序写数据，被迁移重建的父表（如 `playable_units`）排在引用它的子表之后，即使导出自带 `defer_foreign_keys`，D1 远程导入仍以 `D1_RESET_DO` 拒绝；外键完整性由导入后的 `validate` 复核。同一内容导入失败后，`init` 直接返回缓存的失败结果，原样重试无效；失败响应的 `importError` 只透出 `D1_*` 错误码，不含上游文本。导入的 `active` 或无 status 中间响应沿同一 bookmark 继续轮询，只有 `complete` 才进入数据校验；明确失败、未知状态及进行中 bookmark 变化均拒绝。SQL 暂存无论导入结果均尝试删除，密文保持不变。断线的明文删除与条件释放租约由 abort 监听登记到 `waitUntil`，不依赖导入请求恢复执行；明文监听持续到清理结束，覆盖 `head`、同键写入间隔和 `delete` 期间的断线，清理失败也撤销监听。删除等待在途解密写入结束，并遵守同键写入间隔。租约在领取前即登记断线收尾，私有 `backup-restore-control/<environment>/<targetId>.json` 的 `plaintextKey` 保存本次暂存路径，不向站点浏览器返回。硬终止或宽限期耗尽时仍可能残留；开始下一次操作前须按该记录检查并清理明文，不删除密文。导入后不再是空库，失败时不盲目重新导入或删库，先检查阶段，必要时另建隔离目标。
7. `validate` 核对迁移摘要、SQLite/外键完整性、业务计数/有序摘要及媒体关联。每条媒体与字幕记录都检查 R2 对象：版本和长度都与已认证恢复点相同则复用之前的全量哈希证据；对象存在但版本不同时，工具不读取或哈希该对象，只清空隔离库中该记录的 `r2_etag` 并计入 `mediaPending`；对象缺失时同样清空 `r2_etag`，计入 `mediaMissing`，不中止恢复。切换后站点扫描按[同名替换](catalog.md#rep1-同名替换)规则重新验证：字节相同只恢复版本，内容不同但通过验证则改写记录，未通过保持不可播；完成前这些片源不可播（档位和字幕从选项中移除，没有已验证档位的单元显示片源暂缺），每轮最多验证 20 个对象。`mediaPending` 与 `mediaMissing` 也计入恢复点中本就未验证（`r2_etag` 为空）的记录；`media_files`、`subtitle_tracks` 摘要与恢复点的差异只来自本次清空版本的记录，最多为两者之和。缺失的片源在站长从自己的冷备按原名补传、扫描重新验证前不可播；`mediaMissing` 明显偏大（如目标存储桶不对）时先核对再切换。摘要结果与选定恢复点及恢复前记录复核，不把模拟导入当作平台成功。
8. `sanitize` 在 Cloudflare 内先验证全部旧 TOTP、生成并回验新密文，再用 D1 原子 batch 重加密 TOTP、清空库可识别的备用码组、撤销会话/verification/未用邀请/未完成注册/原生临时 Token。密码、设备、已用邀请和讨论保留。旧认证 Secret 按文件头指纹从 keyring 选取，不能默认等于当前认证 Secret；单次工具上限 1000 个 TOTP，超限明确停止。`sanitize` / `credentials` 断线时，`waitUntil` 等待在途凭证操作成功或失败后才条件释放租约；D1 写入不因客户端断线而撤销，未结束前其他恢复操作仍返回 `409 / RESTORE_BUSY`。硬终止、宽限期及租约期限的限制仍适用，不能以此保证无限期互斥。
9. `credentials` 用新 Secret 只读复核 TOTP、空备用码及旧凭证清理结果。`sanitize` 断线或结果不明时先执行此检查，不盲重试、换 Secret 或直接开放。分批 `review` 核对成员角色、封禁和设备；管理员维护期间人工 review 历史讨论并重新手动删除，不加删除台账或清空讨论。不明确的账号继续保持维护。
10. 完成数据、媒体、凭证和人工复核后，再经授权切换应用 D1 绑定与新认证 Secret，检查旧会话/邮箱 JWT 失效、新登录/TOTP/设备、已用邀请额度和播放；旧库保留。没有满足这些条件，任何工具响应都不是重新开放授权。

| 操作 | JSON 请求字段（标识均取选定恢复点，不能跨环境） |
| --- | --- |
| 恢复导入 | `action: "restore"`, `id`（源 UUID）, `file`（`encrypted-<UUID>`）, `keyId`, `authKeyId` |
| 数据复核 | `action: "validate"`, `schemaVersion` |
| 凭证清理 | `action: "sanitize"`, `authKeyId`（恢复点旧认证指纹）, `maintenanceConfirmed: true` |
| 清理结果复核 | `action: "credentials"`, `authKeyId`（同上） |
| 人工复核资料 | `action: "review"`, 可选 `after`（上页返回值），每页 100 个成员及其设备元数据；不返回认证秘密，`readyToOpen` 固定为 `false` |

### T6.1c 验证与缺口

调度比较基线为已推送 `dev` 的 `62b1683`。直接改动 → 受影响入口 → 验证范围：私有 R2 调度/任务记录 → 北京时间计算、配置门禁、并发与中断 → 调度模拟；共享 scheduled → 备份与媒体扫描互斥/正常扫描 → 定时入口及媒体回归；站长表单与请求方法 → PUT 权限、来源/JSON、页面状态 → HTTP、客户端默认方法、SSR 和局部浏览器。媒体传输、讨论及认证业务规则不变，不重复已验收的实机/长播，不以局部改动重跑全站浏览器验收。

2026-10-17 调度最终自检覆盖 70 项：`test/backup-schedule.test.ts` 19 项、`test/backups.test.ts` 35 项、`test/backup-page.test.ts` 2 项、`test/auth-client.test.ts` 2 项、`test/media-sync.test.ts` 12 项。测试分批执行：备份 34 项同轮通过，新增 PUT 用例在夹具修正后单独复验通过，未修改原有验收断言；最终输入类型校验补强后复跑调度 19 项，其他未受影响的同轮结果复用。类型检查与 development 构建通过；不是最终全量回归或 staging 验收。

外部目标、保留与隔离恢复的既有证据对应 `10e666b`（`62b1683` 仅补文档）：应用全量 362 项、备份恢复定向 52 项、工具测试 21 项、虚构资源映射的 staging 构建与必需 Secret 清单断言通过。恢复/加密内核、工具、资源映射、依赖和配置未改变，复用这些证据，不把它们记成本次调度的执行结果。cf beta.12 的必需 Secret 检查与保留已有 Secret 路径按固定版本实现核对，真实发布仍须复核运行时配置。

场景覆盖站长页面 SSR 与入口/直连权限、各端独立保留、缺历史密钥不删除、换源残留清理、外部失败及最终状态超时后复用完整密文。SQL 演练在 Workers 测试环境生成虚构库的有效 SQL，经加密/认证/解密/模拟 import 实际写入另一 D1 binding，逐表业务计数与摘要一致，再验证 TOTP、密码、设备、已用邀请和讨论保留；新备份密钥加密旧认证 Secret 的源可按独立指纹恢复。Cloudflare REST、WebDAV/S3 网络仍是模拟，不代表真实服务可访问或 15 分钟/内存验收。恢复工具已用虚构资源映射完成最终独立构建和 cf dry-run，核对源/目标 ID 不同且历史 keyring 非部署必需项，没有部署。测试和构建的 cf/Vite 既有弃用及本地缺 Secrets 提示仍存在，未用真实凭证消除提示。

本地浏览器（当前工作树，虚构 Nova 站长，development）：1440×1000 与 360×800 检查维护提示、空记录、缺配置禁用、勾选维护确认仍不能创建、关闭设置的实际 PUT 保存及成功反馈；手机无横向溢出，未捕获客户端 error。SSR 另验仅 S3 可用时初选正确、已保存渠道失效时可提示关闭。可用渠道的启用/修改/关闭、手动创建/下载/失败重试的完整浏览器操作受 development 禁远程导出的边界限制，未用生产旁路替代。仅作手机视口模拟，不是实机验收。测试页面已关闭，6120 保留当前代码服务供复用。

站长页面体验（2026-10-17）：保存位置与频率用站内分段选择，记录状态用胶囊标签，下载/重试与记录同行，任务 ID 与密钥指纹收进“详细信息”；维护影响由创建/重试的确认对话框统一说明，不再依赖页面勾选；页面只保留状态、错误、维护影响与密钥提醒，删去控件已能表达或重复的说明；失败分类和错误码文案改为站长可读的短句，服务端与客户端错误码文案一致。未改变权限、请求字段、维护确认参数或备份行为。本地以虚构 Nova 站长和虚构 R2 记录检查 1440 与 360 宽度、深浅色、确认对话框及拒绝 toast；本地禁止远程导出，成功路径的实际交互待 staging 发布后复核。

staging 实测结果与剩余缺口见 [T6.1 staging 备份与恢复演练](#t61-staging-备份与恢复演练)。

staging 站长配置：指定用户名与邮箱已交叉核对为同一已验证、注册完成的正常账号，角色为 `admin`。站长邮箱由本环境 Workers Builds 的 `STAGING_OWNER_EMAIL` Secret 提供，构建生成运行时 `OWNER_EMAIL`，避免后续自动发布丢失配置；其他构建变量保持不变。运行时邮箱与账号匹配已核对，不在仓库保存真实邮箱。此项不代表备份渠道已就绪或 T6.1 已验收。

2026-10-17 staging 交付：`dev` 的 `6809761` 经 Workers Builds 自动发布，应用全量 386 项、工具 21 项、类型检查和 staging 构建通过；版本 `61d59218-ea51-4d87-bf20-efa66f673e24` 承载 100% 流量，来源 SHA 一致。除站长邮箱外的运行时绑定及 11 个 Secrets 与发布前一致；公开首页 `200`，匿名备份页跳转登录，状态接口 `401`，均为 `private, no-store`。未使用指定账号代登录或执行备份，完整浏览器操作及平台演练缺口不变；production 未操作。

staging 手动加密下载证据（2026-10-17）：站长页面约 8.1 秒完成，SQL 752,484 字节、密文 753,083 字节，下载文件头、长度、`.stcnbak` 文件名及 `private, no-store`/`noindex` 响应头核对通过，密文中无 SQL 明文。导出和导入分别使用仅授予 D1 Edit 的独立 `D1_EXPORT_TOKEN` / `D1_IMPORT_TOKEN`，不复用构建部署凭证；运行时无效 Token 的可观察结果是 `backup_export_rejected` 的 `HTTP 401`、API 错误码 `10000`，任务不生成产物。

D1 polling 契约由[官方导出测试](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/__tests__/d1/export.test.ts)交叉核对：`HTTP 202 / status: "active"` 表示导出进行中，须沿同一 bookmark 继续轮询，只有 `complete` 后才下载 SQL 并暂存、加密。实现接受 `active` 及无 status 的中间响应，未知状态、明确失败及 bookmark 变化仍拒绝。

轮询本地证据（`8d3880e`）：`pnpm test test/backups.test.ts test/backup-schedule.test.ts` 59 项通过，覆盖成功与拒绝边界；`pnpm typecheck`、使用私有环境映射的 staging 构建和 `git diff --check` 通过。D1 REST 为模拟，既有 cf/Vite 配置弃用提示保留，本地结果不替代 staging 实际备份、时限和内存验证。

轮询修复 staging 交付（2026-10-17）：`8d3880e` 快进合入并推送 `dev`，Workers Builds 构建 `69834604-6e02-47ae-ab70-7b79e107ecbd` 成功，31 个应用测试文件共 391 项、工具 21 项、类型检查及 staging 构建通过。版本 `36706559-1760-4d26-9ad4-72a201021617` 承载 100% 流量，来源 SHA 匹配；运行时绑定、环境配置、11 个 Secret 绑定及兼容日期与发布前一致。匿名首页 `200`、备份页 `302` 到登录、状态接口 `401`，均带 `noindex` 和 `private, no-store`；未操作 production。

staging 备份断线证据（2026-10-17，`087b9c1` / 版本 `b1e7efb0`）：手动下载在 3 秒后中止，约 1 秒状态为 `BACKUP_INTERRUPTED`，随即同 ID 人工重试成功，下载 753,083 字节，文件头与响应头核对通过。备份与清理的本地用例在请求永不恢复时验证独立收尾，外部上传后超时保留下载与回执；7 个备份测试文件共 119 项及 `pnpm typecheck` 通过。清理请求与隔离恢复工具的真实断线不由这次 staging 手动备份证据覆盖。

### PR #42 备份审查复核

比较基线为 `dev` 的 `39d271e`。范围是审查第 1–5 项及直接相关的 Devin 评论，不将静态阅读结论视为复现。

- 恢复 Worker 的断线用例分别保持导入请求未决、暂停明文 `head` 或 `delete`，只等待 `waitUntil`：明文删除、租约释放、替代租约不被覆盖、密文保留及私有暂存路径记录均须满足。清理暂停期间，即使租约已释放，后台工作仍须等待明文删除完成。实现只托管中断收尾，不托管整个恢复；[请求取消信号](https://developers.cloudflare.com/changelog/post/2025-05-22-handle-request-cancellation/)与[最多 30 秒的宽限期](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)不能保证硬终止后的清理。
- 已回读验证的外部副本在任务超时后仍保留回执；重试拒绝不同目标位置，恢复原位置可继续。新副本回读失败或缺密钥时，不删除比保护点更新的副本；本次已持久化完成的副本可保护并清理过期前份，R2 与外部端分别验证。
- 坏调度记录不启动导出；没有活动租约时媒体扫描仍运行，Cron 继续报告原错误；活动租约或无法确认租约状态时不冒险扫描。调度记录仍须由授权运维修正，不静默重置。
- 虚构弱口令的字典试验可匹配文件头中的两个 SHA-256 指纹，未读取真实 Secret。代码长度检查不能证明熵。只改指纹收益有限：文件密钥由 HKDF 快速派生，弱备份密钥本可通过 GCM 标签离线验证；弱认证 Secret 也可由成员用自己的签名 Cookie 离线验证，改指纹只去掉备份文件外泄者的一条途径。密钥随机生成时指纹不泄露可用信息，因此开发者决定不改格式、不轮换，按 6.9.1 随机生成。
- Devin 的“外部备份失败仍可下载”符合 B 6.9.2/6.9.4：失败的是外部目标，下载仍只允许本环境完整验证的 R2 密文，目标状态不改成成功；既有失败后下载与重试用例覆盖，不作为漏洞修改。

恢复收尾的本地自检（2026-10-24）：`pnpm exec vitest run test/backup-restore.test.ts test/backup-restore-http.test.ts` 35 项、`pnpm typecheck`、`pnpm build`（development）及恢复工具使用 `.env.example` 虚构映射的独立构建通过。凭证写入延迟后成功或失败的两个新增用例先复现提前释放，再确认断线收尾等待写入、期间拒绝其他请求、结束后可再次领取。其余备份审查证据复用 2026-10-23 的调度与媒体扫描 39 项，以及 `test/backups.test.ts`、`test/backup-storage.test.ts`、`test/backup-targets.test.ts`、`test/backup-page.test.ts` 的 78 项；相关实现、断言、依赖和配置未变，不记为此次重跑。Windows 默认临时目录的 workerd 权限失败通过工作树内 `TEMP` / `TMP` 解决；cf/Vite 弃用与测试缺 Secret 提示保留，故障注入的连接中断日志不作为成功证据。

真实恢复断线、Cron/CPU 上限与单次备份内存仍需 staging 专项验证。既有 10 月 21–22 日导入、外键和登录演练仅覆盖当时版本，不代表本次改动已平台复验。第 6–14 项不在此次修复范围，未重新验证；文档仅整理相关段落的当前规则及可追溯证据。未改变已有测试断言、依赖、锁文件或部署配置，不以定向自检替代发布流水线门禁。界面与业务权限未变，不重复全站浏览器、实机或无关模块测试，不执行 production 操作。

### T6.1 复核修复验证

比较基线为 `99508fe`，证据针对本次备份恢复修复。直接改动 → 受影响入口 → 验证范围：D1 导入轮询 → 隔离恢复 → `active`/无 status、明确失败/未知状态/bookmark 变化及明文暂存清理；恢复密钥校验 → `sanitize`/`credentials` → 当前与全部历史认证/备份密钥拒绝复用、独立新密钥允许；传输头签名顺序 → WebDAV/S3 的 PUT/GET/DELETE → 保留 identity、S3 SignedHeaders 排除该头及内容回读；主备份/清理分阶段持久化与租约 → 手动备份、清理、Cron 和定时媒体扫描 → 清理越界仍保留成功、不重复上传、互斥、条件释放、状态写入失败及最后副本保护。两处等价精简由有界元数据导入与加密内核用例覆盖，不改变权限、数据表或资源配置。

2026-10-17 本地 115 项定向范围分批全部通过：最终 `pnpm test test/backups.test.ts` 42 项通过，包含三条串行场景及相邻的换源残留清理；同轮七文件命令中另外六个文件的 73 项通过结果复用，分别为 `test/backup-restore.test.ts` 12 项、`test/backup-restore-http.test.ts` 14 项、`test/backup-targets.test.ts` 9 项、`test/backup-storage.test.ts` 17 项、`test/backup-schedule.test.ts` 19 项、`test/backup-page.test.ts` 2 项。其业务实现、依赖、配置及数据前提未变，不重复执行。任务 `running → complete → cleanup` 和租约 `领取 → 条件释放 → 再次领取` 的同键写入须间隔 1.1 秒；连续创建后保留清理、连续拒绝三种格式、过期运行任务恢复这三条用例按开发者确认使用 15 秒执行预算，避免原 5 秒预算引发超时及残留异步影响。全部业务断言、其他用例时限、测试运行器和备份的 14 分钟截止保持不变。

`pnpm typecheck`、`pnpm build`（development）及 `tools/backup-restore/` 中以 `.env.example` 虚构资源映射执行的 `pnpm build` 全部通过；这些结果对应同轮修复代码，后续仅调整三条测试的执行预算与文档，不改变运行代码、类型契约、依赖或资源配置，复用而不重建。Standards 与 Spec 两轴静态复核均无新增阻断项，三份改动文档的 78 个本地路径/锚点和 `git diff --check` 通过。测试保留既有 cf/Vite 弃用提示；先前故障注入及超时残留的连接中断日志不作为通过证据，以完整备份文件的最终断言结果为准。

未运行全量应用/工具测试：差异局限于备份恢复内核及其调用方，未改认证、讨论、媒体传输、测试运行器、依赖或发布配置，定时入口的媒体扫描互斥由调度用例覆盖。未改页面布局或交互实现，HTTP/SSR 用例覆盖受影响返回值与权限，不重复全站浏览器/实机验收。真实 staging 的网页下载/中断、S3 上传回读、15 分钟/内存和隔离恢复仍未验证。本次 Git 交付已获开发者授权：提交、快进合入并推送 `dev`，由既有流水线触发 staging 自动发布；发布状态与真实链路验证单独核对，不操作 production。

### T6.1 staging 备份与恢复演练

2026-10-21，开发者授权配置外部渠道、新建隔离 D1 及临时恢复 Worker；production 未操作。

- **外部渠道**：123 云盘官方 WebDAV 对 GET 返回 302 签名 CDN 地址，回读不跟随重定向，任务按设计失败并保留密文；WebDAV 尚未用直接返回内容的服务端复验。S3 兼容目标（path-style，经反向代理）由站长页面手动备份成功，密文 756,315 字节，S3 回读长度与 SHA-256 一致。
- **定时备份**：设定每天 19:05（北京时间）、渠道 S3；Cron 每 5 分钟检查，19:06:10 领取。导出、加密、上传与回读共 16.3 秒，含保留清理共 38.8 秒，远低于 14 分钟截止；下次执行时间推进到次日 19:05。平台不提供单次内存指标，调用日志也未开启，内存只能以任务完成、未被平台终止为间接证据。此后每日定时备份均成功；备份创建与调度代码自 `29fff7e` 起未变，10-27、10-28 两次含清理分别为 59.0、36.3 秒。
- **网页生命周期复测**（2026-10-29，`4f7901b`，开发者授权）：站长页面操作，共 5 个任务、7 次运行。
  - S3 手动备份 27.9 秒完成，密文 787,191 字节，过期清理完成；加密下载 18.8 秒完成，经页面链接取回 787,191 字节，文件头 `STCNBKP1`、`.stcnbak` 文件名、`private, no-store` 与 `noindex` 核对通过，内容无 SQL 明文。
  - 导出阶段断线：3.4 秒中止请求，约 2 秒后任务记为 `BACKUP_INTERRUPTED`；页面“重试”沿用同一任务并重新导出，23.3 秒完成。
  - 上传阶段断线：密文持久化后（10.9 秒）中止，1.1 秒后记为中断并保留密文；页面重试沿用原导出时间、不重新导出，17.9 秒完成上传与回读。
  - 备份进行中再次创建或请求清理均返回 `409 BACKUP_BUSY`，不生成新任务。
  - 维护影响：导出期间需要 D1 的请求（含成员讨论读取与备份状态）连续约 2 秒返回 `500 INTERNAL_ERROR`，其余时间正常；不重新导出的重试期间无失败。
  - 内存：控制台最近 1 小时（覆盖以上运行）497 次调用，内存 P50/P90/P99/P999 为 26.25/29.87/31.07/31.15 MB，超内存与超 CPU 均为 0；同时查看的 24 小时 P999 为 25.2 MB。控制台按调用汇总，不是单次备份峰值，且库导出仅约 0.79 MB。
  - 未验证：WebDAV（staging 当前未配置）及直接返回内容的回读服务、大库下的耗时与内存；R2 操作次数未单独统计。新增的 5 条成功记录按 30 天保留策略清理，未手动删除。
- **隔离恢复**：恢复点为上述定时备份。新建 APAC 空 D1；临时恢复 Worker 只绑定隔离 D1 与 staging 媒体桶并关闭日志，导入 Token 仅授予 D1 Edit 且次日到期；无 Token、错误 Token 与 GET 请求均返回 `403`。
  - 首次导入被 D1 以 `D1_RESET_DO` 拒绝，而 staging 源库 `PRAGMA foreign_key_check` 为 0 违规，原因与修复见[隔离恢复工具](#隔离恢复工具)第 6 步。修复后导入 11 秒完成；`validate` 的迁移摘要、`quick_check`、外键检查与媒体关联通过，18 张业务表的行数与备份内 INSERT 数逐表一致。演练时的上传逻辑与当前实现相同；`importError` 字段在演练后补充，由本地用例覆盖。
  - `sanitize` 用新认证 Secret 重加密 1 个 TOTP、清空备用码，撤销 8 个会话及未用邀请、未完成注册，保留密码、2 台设备与讨论；`credentials` 复核通过；`review` 返回 1 名正常 `admin`、2 台设备，`readyToOpen: false`。
  - 收尾：临时 Worker 与本机 Secrets 文件已删除，私有 R2 无恢复明文残留；隔离 D1 与导入 Token 由开发者决定是否删除。
- **未验证**：切换到恢复库后的登录、TOTP、设备与播放（需另行授权切换 staging 绑定）；媒体冷备确认。历史讨论人工重删只在切换线上时执行，本次演练不涉及。
- **修复自检**：比较基线为 `e68adda`。直接改动 → 受影响入口 → 验证范围：
  - 导入上传内容与 `etag` → 隔离恢复 `restore` → 上传以前导行开头，`init`/`ingest` 的 `etag` 等于实际上传字节的 MD5，既有导入、轮询与拒绝用例不变；
  - D1 拒绝码 → 恢复 Worker 失败响应 → `D1_RESET_DO` 作为 `importError` 返回，自由文本不透出，明文暂存已清理；
  - 解密暂存删去不再使用的 MD5 → 只有恢复路径调用 → 暂存与认证用例。

  `test/backup-restore.test.ts`、`test/backup-restore-http.test.ts`、`test/backup-storage.test.ts` 共 46 项通过。经开发者确认改了 3 处旧断言：两处上传内容改为「前导行 + 原 SQL」，并删除解密阶段的 MD5 断言。`pnpm typecheck`、development 构建及恢复工具的虚构映射构建均通过。存储用例既有的连接中断日志在 `dev` 上同样出现，恢复用例没有未捕获异常。本地未跑全量回归：改动只涉及恢复导入及其 Worker 入口，备份创建、外部目标与调度不调用这些路径。

### ENV1 预览环境并入同一个 Worker

需求见 [A7](../requirements.md) 与 [B 6.9.5](../detailed-requirements.md#695-github-分支构建与发布)。

**已确认**（开发者 2026-10-29）：
- 正式与预览属于同一个 Worker：`main` 经 Workers Builds 发布正式版本，`dev` 发布名为 `dev` 的预览，不再保留独立的 staging Worker。
- 预览绑定预览专用的 D1、R2、Secrets 与域名，不与正式环境共用数据。
- 发布只由推送触发 Workers Builds 在云端构建与部署，本机不直接部署；云端命令可以调用项目 CLI。
- 构建脚本统一：两个环境执行相同的安装、类型检查、测试与构建步骤；差异全部来自构建变量和 `cloudflare.config.ts` 按环境生成的绑定与变量。当前构建产物中与环境有关的只有构建提交和 React Router 模式字符串，后者除 `development` 外都按正式模式运行。
- 登录与通行密钥只信任本环境的固定地址（现有代码以 `APP_ORIGIN` 为唯一可信来源和通行密钥域名），不信任整个 `workers.dev` 子域：该子域下还有站长的其他 Worker，浏览器视为同一站点，整体信任会让它们的页面能以成员身份向预览站发请求。
- 合并时统一改称 preview：文档与代码中的 `staging`、环境名 `APP_ENV`、构建变量 `STAGING_*` 及脚本名一并改为 preview。D1 与媒体桶保留现有资源和名称，只在配置中对应。
- 合并在 production 首次上线前完成，正式站一开始即为最终结构；依据见下方小实验。
- 预览地址为 `dev.video.startrekchina.org`：正式域名 `video.startrekchina.org` 设为“Production and Preview”，在控制台维护，配置的 `domains` 留空。
- 预览不运行定时任务，不增加手动触发入口：媒体扫描只由定时任务启动，预览中新上传或同名替换的视频与字幕不会被关联，已关联的保持可播；定时备份不执行，网页手动备份照常可用。涉及扫描或定时备份的改动以自动化测试为准，Cron 时限只能在正式环境观察。
- 旧 staging 备份在预览环境首份备份成功后删除（私有 R2 与 S3 中的副本）：环境名改为 preview 后，它们的 R2 路径、文件头和外部文件名仍带 `staging`，新代码不再识别，也不会自动清理。

**小实验结论**（2026-10-29）：临时 Worker 读取测试站资源，在实验分支上验证，未改动 `dev`、`main`、测试站与正式站 Worker；临时 Worker、预览、域名、DNS 记录和远程分支均已删除。
- **接入**：控制台导入仓库建出的 Worker 仍是旧版预览模式（非正式分支执行“Version command”），须在 Settings → Builds 做一次不可逆的“Switch to Worker Previews”，正式站 Worker 接入时同样需要。对话框提示自定义命令须调用 `npx wrangler preview`，实际接受了 `cf previews deploy`。仓库连接由同一账户的 Worker 共用，清理时只删 Worker 的构建配置。
- **发布**：正式版本用 `cf deploy --prebuilt`、预览用 `cf previews deploy --prebuilt`，都在 Workers Builds 中发布成功，同一个 Worker 不必改用 Wrangler 发布。`cf` 没有设置 Previews Base 运行时 Secrets 的命令，用 `wrangler preview base-config secret put` 或控制台填写；Base Secrets 只作用于之后新建的预览，已有预览用 `wrangler preview secret put --name <预览名>` 单独更新。
- **构建**：两边执行同一个 `scripts/build.sh`，云端 40 个测试文件 615 项通过。平台不会为预览构建设置 `CLOUDFLARE_PREVIEW_BUILD`，要在 Previews Base 的构建变量中设为 `true`；`cloudflare.config.ts` 据此收到 `isPreview`，生成预览的地址与绑定。预览产物不能含 `domains` 与 `triggers`，配置须在 `isPreview` 时省略两者，因此预览不会有定时任务。
- **分支**：Previews 没有分支过滤；切换后预览触发器并入 Previews 配置，触发器接口拒绝修改它。每个分支第一次推送都会建一条预览记录并构建一次。构建脚本用 Previews Base 构建变量 `PREVIEW_BRANCH` 判断，其他分支直接退出，预览命令同样跳过，构建记为成功但不发布；没有发布过的预览地址返回 404。单条预览可关闭“自动构建”，关闭后推送不再构建。
- **地址**：自定义域名设为“Production and Preview”后，预览地址为 `<预览名>.<该域名>`，另有按部署编号的地址；预览名由分支名转换（`/` 变为 `-`，`dev` 仍为 `dev`）。两层子域的证书随 Worker 自定义域名自动签发：区域为免费套餐、未开 Total TLS，每个 Worker 自定义域名的证书都含 `*.<该域名>`，不依赖只覆盖一级子域的 Universal SSL。`cf deploy` 用配置中的 `domains` 整体替换 Worker 的自定义域名（`replace_state=true`）并复位预览开关，实测重新发布后预览地址失效；`domains` 为空时 `cf deploy` 不改动域名，重新发布后预览地址保持可用。按 cf 代码，未写进 `domains` 的域名也会被这次替换移除，所以只要使用预览域名，正式与预览域名都改在控制台维护。现有 `video-development.startrekchina.org` 不能沿用为预览地址，因为预览地址总在某个域名下再加一级。`previewUrls: true` 时 `workers.dev` 预览地址可用，但正式版本的每个版本也会出现可访问的 `<版本>-<Worker 名>` 地址。
- **验证**：正式与预览地址的首页和会话接口（经 D1）均返回 200；登录请求只接受本环境地址，对方地址与测试站地址返回 403。
- **未实测**：定时任务（临时 Worker 未配置，以免它扫描和备份测试站数据；预览产物本就不能带定时任务）、R2 读取、真实登录与播放。

**实施步骤**（涉及提交、推送和云端设置的步骤各自取得授权；实验提交保留在本地分支 `exp/env1-preview`，可作参考）：
1. 统一构建脚本 `scripts/build.sh`，替换 `build-staging.sh`：两环境执行相同的安装、类型检查、测试与构建，模式固定为 `production`；`PREVIEW_BRANCH` 存在且不是当前分支时直接退出。
2. `cloudflare.config.ts`：两环境同一个 Worker 名；`isPreview` 时使用预览地址 `https://dev.video.startrekchina.org` 与预览资源（现有 staging D1 与媒体桶），并省略 `domains` 与 `triggers`；正式配置的 `domains` 留空。
3. 正式站 Worker 接入：控制台连接仓库，正式分支 `main`，切换到 Worker Previews。正式部署命令在迁移正式库后执行 `cf deploy --prebuilt --mode production`；预览命令在当前分支等于 `PREVIEW_BRANCH` 时迁移预览库后执行 `cf previews deploy --prebuilt --mode production`，否则跳过。Previews Base 构建变量设 `CLOUDFLARE_PREVIEW_BUILD=true`、`PREVIEW_BRANCH=dev` 和预览资源变量；两边都排除只改文档或原型的路径。取得 production 发布授权前，正式部署命令只做检查、不发布。
4. 在控制台为正式站 Worker 添加 `video.startrekchina.org` 并设为“Production and Preview”；Turnstile 允许的主机名加入 `dev.video.startrekchina.org`。
5. 预览 Secrets 写入 Previews Base：认证与备份密钥沿用站长保存的现有值，Turnstile、邮件、导出 Token 和 S3 由站长重新填写。
6. 统一改称 preview，同步需求、计划、AGENTS 与运维说明。
7. 推送 `dev` 生成预览，核对来源提交、迁移、登录（密码、TOTP、通行密钥）、播放与网页备份；确认正式版本不受影响。预览首份备份成功后删除旧 staging 备份。
8. 经授权停用并删除旧 staging Worker 及其构建配置，D1 与媒体桶由预览继续使用。

## 当前运维风险

- cf beta.12 固定 strict 检查因 staging 最近由 script API 更新而拒绝上传；官方 beta.16 同样固定 `strict: true`，不能仅靠升级解除。staging 采用已获准的 Wrangler 补充发布，开发、构建和迁移继续使用 cf；生成配置须核对模式、目标、全部拆分模块及静态资源，不读取或重建既有运行时 Secrets。直接 API 发布仍需另行授权，不修改 CLI 内部实现或重建 Worker。
- production 密钥交接文件仅含原四项，不含 EMAIL_API_KEY 或运行时备份 Token；不能据此认定配置齐全。备份导出、站长邮箱、外部目标及 keyring 已声明，真实配置与权限尚未验证，未启用的目标不上传假值。
- 原生凭证路径需禁用相关应用日志以避免平台附加 URL，invocation/traces 未脱敏前保持关闭；认证小样本/静态配置不等于全部业务平台验证。
- Time Travel 官方尚不支持新库克隆，默认隔离恢复使用完整备份；手动与定时备份已在 staging 实测，大库导出按 6.9.2 的复测条件处理，不擅自加 Queues/Workflows 或原地覆盖生产。

### 6.9 环境与备份

- staging 和 prod 是两套完全独立的资源，各自有自己的 Worker、D1 和 R2。
- 两环境不复制完整片库：可分别建立完整资料占位，staging 仅存少量自生成测试媒体/字幕，prod 保存正式片源；扫描只访问本环境绑定。
- **开发与发布顺序（2026-10-06 确认）**：开发阶段使用本地环境与 staging，production 可以提前准备隔离资源映射、配置声明及本地构建 / dry-run。所有 v1 主要功能（认证与管理、片库与播放、进度/片单/讨论、备份与恢复）开发完成且相关测试和 staging 验收通过后，才在第六阶段补齐 production 上线配置与 Secrets，执行正式迁移、部署及上线验收；这些操作仍需站长明确授权。production 未上线不作为工程基础或第三至第五阶段未完成的依据。
- D1 利用 Time Travel 功能，可以恢复到最近 30 天内的任意时间点。
- 备份先调用 D1 导出 API 并存入私有 R2，再加密供直接下载或上传 WebDAV / S3。配置完整的 WebDAV 或 S3 目标后，站长可在网页设定自动备份频率和执行时间，由 Worker 定时入口执行；没有外部目标时仅支持手动备份，不启用定时备份。导出包含密码哈希和 TOTP 密钥，必须加密后才能离开 Cloudflare。备份默认保留 30 天。
- 网页数据库备份纳入 v1，提供直接下载、WebDAV 与 S3 三种目标，仅本环境 `OWNER_EMAIL` 指定的管理员可操作（6.9.4）；直接下载和外部存储均使用加密备份。
- production 的外部目标只配置 S3（开发者 2026-10-29 确认），WebDAV 不配置、页面显示未配置。以后要启用 WebDAV，先在 staging 用该服务实测上传与回读；读取时跳转到其他地址的服务（如 123 云盘）按设计不可用。
- WebDAV 地址必须能从公网通过 HTTPS 访问，最好用 443 端口。如果它在家里的 NAS 上，推荐用 Cloudflare Tunnel 暴露出来，不需要在路由器上开端口。
- Cloudflare API Token、WebDAV / S3 目标与凭证、备份加密密钥都存在 Worker Secrets 里；指定站长的 `OWNER_EMAIL` 使用 Worker 环境变量，不向浏览器公开。
- 媒体与字幕原件的冷备由站长在项目之外自行完成，项目不提供冷备功能或配合，也不存第二份云端副本。

#### 6.9.1 绑定、Secrets 与集中配置

每个环境分别配置下列逻辑名称，实际资源标识和值不写入公开仓库。执行工具、帮助核对、迁移与失败处理遵循 [AGENTS 工具规则](../../AGENTS.md#cloudflare-cli)，本文只维护环境配置方案。

| 类别 | 建议名称与用途 |
| --- | --- |
| Worker bindings | `DB`：本环境自有 D1；`MEDIA_BUCKET`：私有 R2；`ASSETS`：公开素材。认证入口使用 Better Auth 的 D1 持久化限流；站点发信/管理业务配额由 D1 精确判定。各环境资源与计数隔离。 |
| Worker 配置 | `APP_ENV, APP_ORIGIN, WEBAUTHN_RP_ID, TURNSTILE_SITE_KEY`，以及**发信服务的发件人地址与发件域名、邮件服务商 API 基础地址**、备份目标数据库标识、Cron 调度入口和兼容日期；业务备份频率/执行时间由站长在网页设置（6.9.2），不固定为每日 04:00。真实 Cloudflare 标识只保存在本机/平台配置，缺失或混用环境时拒绝运行。发件域名需按服务商要求配置 SPF/DKIM（必要时的 DMARC），staging 与 prod 用不同的发件人标识以便区分测试邮件。`node:crypto` 支持按选定兼容日期核实，不能只凭 Vitest 自动兼容通过就认定生产可用。 |
| 站长配置 | `OWNER_EMAIL`：本环境唯一获准使用网页备份的管理员邮箱，仅服务端读取；缺失、格式无效或没有匹配的正常管理员时拒绝网页备份访问，不回退到“任意管理员”。随备份模块声明并提供样例占位值，实际邮箱不入库。 |
| Worker Secrets | `BETTER_AUTH_SECRET`：库 Cookie/JWT 签名以及 TOTP/备用码认证加密，必需且每环境独立；`TURNSTILE_SECRET_KEY`：人机验证；`EMAIL_API_KEY`：Postal HTTPS API，传输层已声明，staging 已配置；`D1_EXPORT_TOKEN`：独立运行时备份导出凭证，只授予本账号 D1 Edit；`BACKUP_ENCRYPTION_KEY`：至少 32 字节的高熵备份加密密钥。基本五项作为 cf 部署必需 Secret；可选 `BACKUP_KEYRING` 与外部目标在本地配置声明以推导类型，线上由站长按需预配并由 CLI 保留，不放入部署必需列表，不以占位值部署。备份 Token 不复用构建部署凭证，也不沿用 CLI 与 Workers Builds 存放部署凭证的 `CLOUDFLARE_API_TOKEN` 变量名，避免两类凭证混填；production Secrets 尚未上传。 |
| 外部备份 Secrets | `WEBDAV_URL, WEBDAV_USERNAME, WEBDAV_PASSWORD`：预配的 HTTPS WebDAV 目录及凭证；`S3_BACKUP_ENDPOINT, S3_BACKUP_REGION, S3_BACKUP_BUCKET, S3_BACKUP_ACCESS_KEY_ID, S3_BACKUP_SECRET_ACCESS_KEY`：预配的 HTTPS S3 兼容目标及其独立最小权限凭证。与媒体访问隔离，不向浏览器下发；仅对启用目标要求完整，未配置的目标在网页中不可选，不为未启用目标强制填写假凭证。在 Worker 控制台添加时全部选「密钥」类型：文本变量会在下一次自动发布时按构建配置被覆盖；控制台保存而未部署时只生成新版本，部署后才生效。 |
| 仅站长本机 | `TMDB_API_KEY`、目标环境资源映射和离线导入所需的最小权限 D1/R2 凭证；不把导入管理能力做成浏览器接口，不给 Worker 播放路径额外的上传管理 token。 |
| 集中默认配置 | 站点业务默认：邀请额度 2、邀请码 30 天、预留 15 分钟、看完 90%、进度 15 秒、备份 30 天、评论 1000 字/每页 10 条/回复每批 10 条、管理高影响操作 30 次/分钟、发信间隔 60 秒/每用途每小时 5 次。认证配置统一维护 6.3 的原生参数及显式选择：滚动会话 30 天/updateAge 1 天/freshAge 5 分钟、验证与重置链接各 1 小时、二步挑战 5 分钟、备用码 10 个、TOTP 6 位/30 秒/±1 步、原生尝试/锁定/IP 限流。settings 与原生配置已调整并通过运行探针和第三阶段验收；播放、进度和备份等配置随对应阶段验证。 |

**密钥轮换（已确认）**：**手动轮换，不设定期自动轮换**。每个环境的密钥**相互独立**，同一密钥不复用于不同环境。保管方式为三处：线上 Worker Secrets、站长的密码管理器、以及**离线副本**。旧密钥必须**保留到引用它的全部备份都被删除或重加密之后**才能弃用，**包括受保护而超期保留的最后一份副本**；**缺密钥的备份不算可恢复副本**。

**密钥生成**：`BETTER_AUTH_SECRET`、`BACKUP_ENCRYPTION_KEY` 及恢复工具的 `RESTORE_NEW_AUTH_SECRET`、`RESTORE_OPERATOR_TOKEN` 一律用命令随机生成，不用自拟口令；每个值单独生成一次，例如 `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`（48 字节随机数，输出 64 个字符）。备份文件头的 SHA-256 指纹只在随机密钥下安全，见 [PR #42 审查复核](#pr-42-备份审查复核)。

本机 `.dev.vars` 使用前确认已被 git 忽略；样例仅用占位符。播放/备份格式保留自己的密钥版本；Better Auth 密文沿用库格式，不强加自定义 AAD/版本字段。手动更换 `BETTER_AUTH_SECRET` 前，在 Cloudflare 内用旧 Secret 解密并按新 Secret 重加密保留的 TOTP/备用码，完成校验再切换；不能直接换 Secret 导致现有验证器全部不可用。旧备份需要对应认证 Secret 和备份 Secret。轮换流程及恢复后凭证清理均须实测，不宣称库会自动迁移密文。

#### 6.9.2 定时备份执行与失败行为

- **调度条件与设置**：只有本环境 WebDAV 或 S3 目标配置完整，站长才可以在网页设置并启用备份频率与执行时间。时间以**北京时间（Asia/Shanghai）**展示和保存，执行时换算为 UTC；不再固定每日 04:00。仅使用直接下载或只有私有 R2 暂存时不能开启定时备份；未设置启用时不自动运行。定时入口每次重新检查所选外部目标，目标配置失效时不继续导出或报告成功，网页展示不可执行状态。导出造成的维护/查询影响仍是已知代价，应随所设执行时间向站长说明。
- **执行槽与数据归属**：私有 `backup-control/<environment>/schedule.json` 保存设置与下次时间，默认关闭；同键写入间隔至少 1.1 秒，ETag 条件写入拒绝并发覆盖。每次保存计算严格晚于当前时刻的下次执行；interval 以保存当日的北京时间日期为锚点。复用每五分钟 Cron，延迟多个时点只执行一次，不循环补跑；领取时推进下次时间并保存任务 ID，目标失效/任务冲突也消费本次槽，不自动重试失败。完整任务记录是完成状态的权威，进程中断后超时显示失败；并发编辑的设置不会被旧任务结束写回覆盖。scheduled 等待整个备份，本轮有备份或检测到有效手动租约时不运行媒体扫描，其余正常 tick 保持扫描。读取调度失败且可确认没有活动租约时，先扫描再抛原调度错误；已进入备份执行、锁仍有效或锁状态读取失败时，不启动媒体扫描。

1. 定时入口按本环境已启用的频率与时间发起全量 D1 SQL 导出，包括 schema 和全部业务数据；导出无法通过普通 D1 binding 替代。当前官方 API 是 `POST /accounts/{account_id}/d1/database/{database_id}/export`，首次使用 `output_format: 'polling'`，之后以返回的 bookmark 填入 `current_bookmark` 持续轮询同一任务，直至完成或失败；不能伪造同步 dump API。
2. 导出期间数据库可能无法服务查询，持续轮询中断时平台会取消导出。不得将仍在执行的导出留到下一次定时触发才继续。完成后及时读取返回的短期 `signed_url` 并流式存入私有 R2 备份对象；不能把下载 URL 返给浏览器、写日志或交给 WebDAV / S3 抓取。
3. R2 记录本次备份 ID、环境、备份时间、导出 bookmark、schema 版本、长度和 SHA-256；只有完整写入并校验后才标记 R2 完成。备份控制状态可放在私有 R2 元数据/伴随记录，不因此追加业务表；重试复用已验证的备份 ID，避免重复导出和混淆日期。
4. 从 R2 加密后上传所选 WebDAV / S3 目标：WebDAV 用 HTTPS `PUT`，S3 用 HTTPS S3 兼容 API。采用带版本的认证加密封装（建议 AES-GCM；若分块，每块独立唯一 nonce、认证序号/总块数，并验证最终完整性）；大小不得要求整个 SQL 常驻内存，采用有界缓冲/流处理。目标只能来自 Secret，不跟随把授权头带到其他主机的重定向。**只有 R2 完成、加密完整、所选外部目标上传成功并回读校验通过后，才记录该目标“备份完整成功”。**
5. **上传后回读校验（已确认）**：`PUT` 成功后再用 HTTPS `GET` 把对象**流式读回**，校验**长度和 SHA-256** 与本地记录一致。**ETag 不能代替内容哈希**校验。回读可能耗时，按实际耗时在 staging 实测并纳入 15 分钟时限评估（6.16）。
6. 导出/R2/WebDAV/S3 任一失败都不创建对应成功标记：保留完整 R2 副本和**脱敏失败记录**，由站长**人工触发重试**。**不设置自动重试调度，也不做主动失败告警。**
7. **保留策略**：默认保留 `30 天`，但**每一端（R2、WebDAV 与 S3）的最后一份完整可恢复副本受保护、可超过保留期不被删除**。清理绝不触碰媒体对象，备份与媒体清理前缀严格隔离；清理失败可重试，不把部分失败当作已删除。

Cron 当前最长执行时间为 15 分钟，导出轮询、加密、上传和回读校验的全流程都要在这 15 分钟内实测；必须整体由 scheduled 生命周期等待，不依赖 HTTP 返回后 30 秒的 `waitUntil`。必须在 staging 测量备份大小、耗时和内存，并验证按网页所设频率/时间正确触发；若全流程装不进单次时限，**报告站长**决定调度或恢复办法，**不擅自引入 Queues、Workflows 或其他新产品**。

**大库复测条件**（开发者 2026-10-29 确认）：现有 staging 实测对应约 0.79 MB 的导出。任一环境备份页“详细信息”中的文件大小超过 50 MB 时，在 staging 用同等规模的虚构数据重测耗时、内存及导出期间的查询中断；由站长查看记录发现，不新增告警。

#### 6.9.3 手动恢复顺序与完整性

1. 站长选择正确环境及恢复点，**先暂停该目标的写入和导入，并保留当前状态所在的旧库**（不先删、不先覆盖），再执行恢复。
2. **默认恢复目标是隔离的 D1 目标**：先恢复到隔离目标并完成校验，通过后才切换。**Time Travel 的隔离能力不作假定**——按官方现有能力核实后再决定；**若无法构建隔离目标，如实报告站长，不自行对生产库做原地覆盖恢复。**
3. 优先按事故选择 Time Travel 或完整备份。网页下载、WebDAV 或 S3 副本须验证密文认证、备份元数据、长度和校验，先在 Cloudflare 内解密到私有对象再导入；不在本机下载未加密 SQL，不让包含密码哈希/TOTP 数据的明文副本离开 Cloudflare。
4. SQL 恢复使用当时官方支持的导入流程。当前 D1 REST import 为 `init → 上传 SQL → ingest → poll`，参数和临时地址以官方响应为准；上传及轮询在 Cloudflare 内完成，不能把 SQL 文本交给站长本机 CLI 作为中间明文文件。在隔离目标确认 schema 兼容、外键完整、业务计数与摘要一致后，再执行目标切换。
5. 核对 `media_files` 和字幕关联的 R2 对象；版本或长度与恢复点不同、或对象缺失的记录清除已验证版本并分别计数，切换后由媒体扫描完整验证，完成前不可播；**恢复 D1 不会恢复 R2 媒体，也不会恢复 Worker Secrets**。缺媒体时由站长从自己的冷备按固定命名重新上传；尚未补齐的文件保持不可播，不先开放错误地址。
6. **重新开放前统一撤销**：删除旧 Better Auth 会话、临时 verification 记录并撤销未使用邀请码及全部二步备用码；切换认证签名 Secret，使恢复点带回的邮箱 JWT 失效；媒体按会话鉴权，删除旧会话即同时作废恢复点带回的播放权限。切换认证 Secret 前在 Cloudflare 内以旧 Secret 解密并重加密保留的 TOTP，备用码以库可识别的空组作废；验证完整后才切换，不靠已恢复的数据库版本计数拒绝旧凭证。密码哈希与通行密钥按恢复点保留，TOTP 设备保留；恢复可能带回后来解绑的设备，重开前由站长复核。工具入口及当前演练边界见[隔离恢复工具](#隔离恢复工具)，真实 staging 演练尚未完成。
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
- **保留与失败**：私有 R2、WebDAV 和 S3 的各端保留策略均按 6.9.2 保护最后一份完整可恢复副本；站长自行下载的本地文件不由 Worker 清理。失败由网页展示脱敏结果并人工重试，不新增自动重试或主动告警。6.9.3 的隔离手动恢复流程继续适用，网页备份不包含一键覆盖生产库的恢复功能。
- **实现门槛**：先完成第三阶段真实认证与管理员门禁，再在第六阶段实现备份页与处理流程。网页触发任务的执行生命周期、中断和重试行为须在 staging 验证，不能依赖请求结束后短暂的 `waitUntil` 完成整次导出，也不未经确认引入新 Cloudflare 产品。

#### 6.9.5 远程数据库迁移与运维工程细节

- **媒体迁移 0022**：迁移集不包含该清理脚本，不通过数据库迁移删除原画记录，不补空迁移或重排编号。未执行环境不再执行，已执行环境保留应用历史，删除源文件不回滚其数据影响。VP9 主档规则与关联重建具有本地实现及自检，实际云端状态未查询、数据未恢复，详见[导入说明](../import-media.md#迁移-0022-与现有媒体)。推送 `dev` 仍走既有 staging 自动检查、剩余迁移与部署流程，不更改或绕过流水线；查询执行状态与实际数据恢复不是本次移除文件的前置条件，恢复写入须另行授权。

- **staging 云端构建**：仅监听 `startrekchina/video-site` 的 `dev`，关闭其他分支/PR 预览；Node 24.21.0、pnpm 12.6.0，使用锁文件安装依赖。构建命令为 `bash scripts/build-staging.sh`，先下载固定版本并校验 SHA-256 的 Linux FFmpeg（生成测试媒体与转换 ASS 用）到被忽略的 `.cloudflare/build-tools`，再依次运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm test:tools`、`pnpm build:staging`，构建时把平台提供的 `WORKERS_CI_COMMIT_SHA` 写入成员页脚的构建提交，发布后可用它核对来源 SHA；自生成媒体仍不提交到 Git。部署命令为 `pnpm db:migrate:staging && pnpm deploy:staging:prebuilt --message "GitHub dev $WORKERS_CI_COMMIT_SHA"`，迁移继续使用 cf。任一步失败即停止，不改用本机上传或静默忽略失败；核对来源 SHA、迁移结果、实际生效版本和受影响入口后才能认定发布成功。
- **GitHub PR 检查**：`.github/workflows/ci.yml` 在每个 PR 及手动触发时于 GitHub Actions 运行 `pnpm typecheck`、`pnpm test`、`pnpm test:tools` 和 `pnpm build`（development），Node/pnpm 版本与 staging 构建一致，ffmpeg 取 Ubuntu 软件源版本。只读权限、不使用 Secrets、不迁移或部署；`dev` 推送仍由 staging 构建把关，两者互不替代。
- **Wrangler 补充发布边界**：固定 Wrangler 4.150.0；4.151.0 引用的 workerd 版本尚不能从 npm 安装。`scripts/prepare-staging-wrangler.mjs` 使用与 cf 一致的官方 Build Output 解析器和配置转换函数，拒绝非 staging、多 Worker、Container、缺失产物及尚未适配的模块类型；配置仅生成在被忽略的 `.cloudflare/wrangler-staging/wrangler.json`。发布使用既有 ESM 拆分模块及静态素材，不重新打包、不保留手写资源映射；Wrangler 默认保留线上 Secrets，不使用 Secrets 文件。文本变量、绑定、域名、Cron 和日志设置以构建产物为准，production 仍使用 cf 且未获发布授权。
- **R2 大文件上传补充**：`cf r2 objects put` 单次请求上限 300 MB，且其 API 客户端每个请求 30 秒超时，经本机代理上传约 80 MB 以上的文件会超时。站长本机上传超过 64 MB 的 staging 测试媒体时，改用固定 Wrangler 4.150.0 的 `wrangler r2 object put <bucket>/<key> --file <文件> --remote`（须显式 `--remote`，否则写入本地模拟），沿用其 OAuth 登录，不导出 token；较小文件仍用 cf。2026-10-29 用该路径上传 3 个 150 秒测试单元的约 227 MB 原画与 83–89 MB 的 1080p。Wrangler 单个对象上限为 300 MiB，更大的文件仍需分段上传工具，未纳入本路径。
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
| R2 存储（原生主档与可选档位） | 主档容量尚未计量，合计费用待样片核定 |
| R2 出口流量 | 免费 |
| R2 读写操作和 D1 | 在这个规模下基本都在免费额度内 |
| 邮件发信（注册验证、找回、通知） | 使用站长已购买的发件服务；实际套餐限额和追加费用按已购服务核对，不再按其他服务商的免费额度估算 |
| Cloudflare 小计 | 原生主档与选用档位合计后核定；邮件服务的已有支出及追加费用需另计，是否满足 50 美元总预算以实际费用核对 |

原生主档与向下档位的总容量须按 [B 6.6](../detailed-requirements.md#66-播放与媒体分发)的制作组合和样片实测计算，不按每集固定四档或原画保留源码率估算。全库时长约 720 小时的参考尚未结合实际 VP9/AVC 编码结果，不能据此确认总预算；正式片源上传前按实际合计复核，接近预算时由站长决定制作取舍，涉及已确认组合的调整须先确认需求。

## 验证方法

复用本地模拟 Cloudflare export/import、WebDAV/S3，虚构数据且不使用生产明文备份。构造上传成功但回读不一致、ETag 相同内容不同、部分失败和最后副本过期等情况；staging 另验真实耗时、维护影响、调度、生命周期和隔离恢复。早期平台/配置准备见[历史计划](../archive/plan-20261007.md)，认证和播放实测见各模块报告，不将其推广为备份/完整容量通过。


## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
