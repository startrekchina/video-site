# 登录、账号、邀请与权限

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A1/A2/A6、B 6.0/6.2.2/6.3–6.5/7。T2.4/T2.7 及第三阶段已验收；T4.5 云端 D1 优化、核心安全/日志及签发 HEAD 并行修复的同条件收益证据成立，但历史尾延迟、完整矩阵与开发者确认仍待补齐，性能未整体验收；并行修复经 PR #26 进入 `dev` 并随 staging 自动发布。T4.5.7/T4.5.8 为开发者确认的后续请求次数与数据位置优化。本模块统筹片库和播放调用方。旧 POC 仅是旧契约差距证据，不重新开启选型。production 邮件和 Secrets 交由 operations 的 T6.2，认证小样本不代表全站容量。

## 任务与验证摘要

- [x] T2.4 采用 Better Auth；旧 POC 29 项行为/差距测试及[报告](../../spikes/better-auth/REPORT.md)已归档，不视为正式验收。
- [x] T2.7 锁定 1.7.7、0008/0009 增量迁移、原生配置/21 项探针、关于页文案与 8 视图复核完成。
- [x] T3.1 邀请注册归属/续作、HTTP 防护、Postal 单次发信及用途配额、登录/验证/找回页面接通；实际验证/找回邮件与新密码登录经站长确认。
- [x] T3.2 二步/备用码、通行密钥 UV、本人会话管理、改密及本人改邮箱完成；站长确认真实 TOTP/备用码、电脑撤销手机会话、通行密钥登录有效。
- [x] T3.3 幂等邀请、额度/角色/封禁/单个解封、邀请链和首管本机提升完成；多层关系及其他成员操作弹窗的桌面/手机浅深色复核通过。
- [x] 邀请来源数据层补强的实现与本地自检：增量约束及旧表重建衔接完整；经开发者确认修正一行既有夹具，原断言保留。新增 28 项包含在全量 219 项中全部通过，类型检查、构建和隔离本地库 14 个迁移通过；staging 已应用 0013，运行中的本机开发库未迁移，staging 功能验收待完成。
- [x] 主题 3 PR #23 审查回归修复及本地同步：完成后连续注册、仅更换邀请码与封禁/解封时保留过期码三项新增场景在本地 dev 通过，远程迁移工具 4 项通过；PR 工作树受影响的 43 项 Workers 用例、类型检查与 development 构建通过。封禁增量迁移与应用代码已通过 `dev` 云端自动发布到 staging，专项功能与平台验收待完成。

证据：[第三阶段记录](../screenshots/phase3/README.md)、[新基线截图](../screenshots/phase2-better-auth/README.md)、[历史过程](../archive/plan-20261007.md)。认证平台 8 次 HTTP 检查、最多 2 路并发，6 条样本 CPU P99 83.573 ms、isolate memory P99 19,952,700 bytes，错误 0；不是完整容量结论。套餐每小时 3,000/每日 24,000 封已确认，月额度/API 频率未知，不能推断无限。

### 6.3.4 采用决定与核对依据

2026-10-06 站长明确同意调整需求以适配 Better Auth。采用的是库原生认证流程与配置/插件接口，邀请与权限仍是本站业务；保留 UV、即时封禁、跨站防护和业务配额门禁，不以重写库核心实现旧三路径恢复或自管会话协议。

| 原要求 | 当前决定 |
| --- | --- |
| 严格旧用户名/ASCII 密码/自定义 scrypt | username/密码/哈希采用锁定库默认行为（6.3） |
| 哈希会话、180 天绝对期限、页面限定活跃 | D1 原生 token、30 天滚动、API 读取可刷新（6.3.3） |
| 三条密码恢复路径、注册即发恢复码 | 邮箱找回 + 二步备用码；移除管理员重置（6.4） |
| 独立 TOTP 加密/AAD、时间步账本、10 次挑战 | 原生加密/账号锁定/5 次挑战，接受跨挑战码复用边界（6.3.1） |
| 每项管理操作一次性 TOTP 证明 | TOTP 已绑定 + 5 分钟新鲜登录会话（6.5.1） |
| 所有认证端点强制自定义 csrfToken/精确账号限流 | 库 Origin/Fetch Metadata 和 IP+路径限流；业务写入同样只校验来源并要求 JSON（[T4.7](foundation.md#t47-业务写入来源与-json-校验)），业务配额单独保持（6.1.1、6.3.2） |
| 所有认证写入同批回滚、JWT 单一且一次消费 | 原生多步写入与 JWT 生命周期，注册以业务完成门禁隔离部分状态（6.0、6.2.2） |

库事实依据为 POC `spike/auth-poc-report` 的 workerd 结果与 1.7.7 发布源码；当前官方资料核对于 2026-10-06：[自有数据库](https://better-auth.com/docs/concepts/database)、[会话](https://better-auth.com/docs/concepts/session-management)、[用户名](https://better-auth.com/docs/plugins/username)、[二步验证](https://better-auth.com/docs/plugins/2fa)、[通行密钥](https://better-auth.com/docs/plugins/passkey)、[改邮箱与改密](https://better-auth.com/docs/concepts/users-accounts)、[安全防护](https://better-auth.com/docs/reference/security)、[captcha](https://better-auth.com/docs/plugins/captcha)。官方新版本说明不能自动覆盖锁定版本行为；差异用正式集成用例验证。

## 原生配置与发信接入

- 锁定 better-auth/passkey 1.7.7，自有 D1 adapter，username/twoFactor/passkey/captcha 插件，关闭 telemetry。本站保持邀请、角色、封禁、配额及授权边界，不开放额外库能力。
- 注册 autoSignIn=false、requireEmailVerification=true、sendOnSignUp=false，业务完成后发信；邮箱验证 autoSignInAfterVerification=false，链接 1 小时。重置 revokeSessionsOnPasswordReset=true；改邮箱 enabled=true、updateEmailWithoutVerification=false，确认额外要求本人会话。
- session.expiresIn=30 天、updateAge=1 天、freshAge=300；关闭 cookieCache/secondaryStorage。twoFactorCookieMaxAge=300；原生 scrypt N=16384/r=16/p=1，库原生盐/哈希和认证加密，不复用播放/备份密钥。
- 通行密钥请求 UV，并在 afterVerification 拒绝 userVerified=false；只设置 userVerification 不代表服务端强制。origin/RP 固定本环境，不重写 WebAuthn。

### 本地认证验收边界

- **Turnstile 测试桩**：本地官方 Turnstile 测试服务返回 `example.com` 且没有 `action`。仅在 `development` 环境且 Site Key / Secret 均等于官方 always-pass 配对时接受对应测试响应；`test`、`staging` 和 `production` 仍严格校验本站 hostname 与 auth action。客户端保留窄卡片，在容器小于 300px 时切换官方 compact 控件并预留其高度。
- **局域网验收配置**：局域网验收须将本地 `.env` 中的 `APP_ORIGIN` 配为实际访问 origin；RP ID 随该 origin 的 hostname 生成，来源校验不因调试而放宽。通行密钥还需浏览器认可的安全上下文（HTTPS 或 localhost）。
- **测试并发与资源调度**：本地测试并发设为两路，避免原生密码哈希与 Worker 模块图同时争用 CPU。HTTP suite 单独预热 SSR 编译，允许最多 60 秒；普通单请求保留 5 秒测试阈值。模拟发信不向真实服务发送邮件，浏览器验收仅使用虚构本地账号。
- **失败边界**：注册、改邮箱和重置失败可能留下部分原生状态，相关故障注入与重试行为见集成测试与 [B 6.4.1](../detailed-requirements.md#641-原生流程的失败边界)。
- **注册尝试选择**：已完成尝试的 Cookie 在身份或邀请码改变时启动新尝试，相同输入保留原令牌与密码校验，实现幂等重放；失败且尚未创建原生用户时，更换身份或邀请码也可开始新尝试。已创建的未完成原生身份继续绑定原尝试，不能因输入变化认领或改写旧账号。
- **注册重试验证**（2026-10-14）：建号前失败后仅更换邀请码的 HTTP/D1 回归在本地 `dev` 单独通过；PR #23 的认证 HTTP/注册专项 34 项、类型检查及 development 构建通过。未重跑全量回归或云端验收。
- rateLimit 开启 D1 database storage、可信 Cloudflare IP，参数按 B 6.3.2；captcha 传 x-captcha-response 并核 allowedHostnames/expectedAction。包装 HTTP 先验来源/IP/Turnstile，不假定 auth.api 内调会执行 onRequest 插件。
- Postal HTTPS fetch：POST /api/v1/send/message，Content-Type application/json 与 X-Server-API-Key；映射 to/from/reply_to/subject/plain_body（接口也支持 html_body，当前传输仅纯文本）。同时检查 HTTP 与 JSON status，只取必要 data.message_id；服务接受不等于送达。
- 传输最多一次、10 秒、manual 重定向且拒绝非 2xx，不自动补发；失败/超时捕获脱敏，超时记未确认，不回滚注册或封禁。验证用途共用邮箱摘要配额，找回另计，D1 条件写入计入首次/失败/超时；通知不受站内发送上限，仍受上游限制。
- 本环境发件子域及 From/Reply-To/API 地址从本机/平台配置；staging 测试发件人与 production 区分，Reply-To 同收信地址；域名及 SPF/DKIM/DMARC 由站长维护。异步发信纳入请求生命周期，不留未等待 Promise。部署与日志限制见[运维说明](operations.md#695-远程数据库迁移与运维工程细节)。

### 6.2.1 认证与邀请存储映射

| 对象 / 表名 | 字段与约束 |
| --- | --- |
| 认证用户 `user` | 按锁定版本的 Better Auth schema 保存 `id, name, email, emailVerified, username, displayUsername, createdAt, updatedAt` 和插件字段。用户名按 6.3 的原生规则校验/规范化，当前邮箱小写化并唯一；密码哈希在 `account` 的 credential 记录中，不复制到业务成员表。日期序列化沿用 adapter，HTTP 输出 ISO 8601；0008 迁移的 D1 DATE 列实测保存 ISO 8601 文本，adapter 还原 Date，与旧业务表 UTC 毫秒列分别处理。 |
| 成员业务资料 `member_profiles` | 与 Better Auth 用户 ID 一对一关联，记录 `role, status, registration_state, invited_by_user_id, invite_quota`；角色仅 `member/admin`，邀请关系完成后不可改，不允许自邀请。业务外键统一使用同一个稳定用户 ID，不生成第二套成员身份；库 updateUser 不接受客户端改角色、状态、邀请来源或注册完成标记。0009 已建立映射与业务外键；第三阶段 HTTP 与各受保护 loader 已接入独立成员门禁。 |
| 验证状态 `verification` | 按 Better Auth schema 保存密码重置和认证挑战等临时记录，接受库的标识/值存储格式与消费方式。注册/改邮箱验证使用签名 JWT，不要求额外的 `email_verification_tokens` 哈希账本；重发不保证撤销旧 JWT。 |
| 邮件发送记录 `email_deliveries` | `id, user_id?, to_email_key, purpose, provider_message_id?, status, error_code?, created_at`；`purpose` 区分注册验证、重发验证、密码找回、管理员通知、安全提醒。只记录邮箱摘要而非原文；用于限流计数、排查发信失败和避免重复发信，不保存邮件正文或链接原值。 |
| 会话 `session` | 使用 Better Auth 原生 `id, token, userId, createdAt, updatedAt, expiresAt, ipAddress, userAgent`；token 唯一，用户外键存在。原值留在自有 D1，Cookie 由认证 Secret 签名；期限按 6.3.3 滚动更新，不要求 `token_hash/last_active_at/credential_version` 自定义认证列。 |
| 邀请码 `invitations` | `id, code_hash, issuer_user_id, used_by_user_id, created_at, expires_at, revoked_at, used_at`；码哈希唯一，消费人唯一。消费人的 `member_profiles.invited_by_user_id` 必须与 `issuer_user_id` 一致，NULL 按 bootstrap 根成员比较，由 0013 的邀请 INSERT/UPDATE 与成员 INSERT 护栏保护。`issuer_user_id` 允许为空，只用于本机准备的 bootstrap 码，空 issuer 不代表任何成员。过期由服务端时间计算并按字段派生“有效、已用、作废、过期”，不需要为每个到期码跑定时任务。额度的 `total` / `occupied` 定义见 6.5.2。 |
| 认证账号与插件表 `account / twoFactor / passkey / rateLimit` | `account` 保存 credential 密码哈希；`twoFactor` 保存库加密的 TOTP 密钥、二步备用码及锁定状态；`passkey` 保存公钥、计数器与设备属性，`credentialID` 增补唯一约束；`rateLimit` 用于库持久化 IP/路径计数。沿用库原生加密和 schema，不另建密码恢复码或管理员 `reset_links` 表。 |
| 注册预留 `registration_attempts` | 服务端随机尝试令牌的 SHA-256 作为 `id`，绑定邀请码、预先生成的 `expected_user_id`、用户名/邮箱规范化后的 `identity_key` 摘要、已创建认证用户和期限，记录预留/完成/失败。不保存密码或原始尝试令牌；ID、邀请码及归属字段不可改写/REPLACE。仅同一有效预留可完成邀请码消费和成员业务资料激活；未完成认证用户不得访问成员功能。业务关联与并发约束见 6.2.2。 |

#### 6.2.2 D1 写入与幂等

- 0009 迁移不自动转换旧密码或设备凭证：旧成员必须先经审查关联到相同 ID、用户名、邮箱与验证状态的原生用户，credential 记录须保留已转换的相同密码哈希，旧待邮箱与自定义临时/设备凭证表须为空。否则 `legacy_auth_requires_review` 拒绝执行并回滚；不能直接把旧哈希或密文视作原生兼容，也不为通过迁移删除未审查的数据。符合前置条件后保留业务资料、角色、封禁、邀请关系和稳定 ID，退役旧自定义认证表。当前工程尚无正式成员，真实成员的旧认证转换不在本迁移中自动进行。
- `0008_legacy_invitation_guard_retirement.sql` 在 0009 重建前移除 PR #21 的旧成员反向触发器，避免它在旧 `invitations` 已删除时阻塞表重命名；旧邀请侧触发器随旧表退役。`cf` 按编号、再按文件名排序，衔接迁移位于两个 0008 基础迁移之后、0009 之前；当前 `dev` 未安装旧触发器时为无操作。完整迁移链必须完成后才启用目标应用，不能停在没有新表护栏的中间状态。
- `0013_invitation_source_guard.sql` 先核对已有消费记录：错配时以 `invitation_source_requires_review` 拒绝整条迁移并保留原数据，不能自动改写邀请人来通过迁移。数据一致时安装 NULL 安全的双向护栏，既保护邀请码直接 INSERT/UPDATE/REPLACE，也保护延迟外键下先消费、后创建成员的顺序；成员身份和来源的既有不可变规则继续生效。回归入口为 `test/invitation-source.test.ts`，包括两种有效旧表升级、普通/bootstrap 错配、REPLACE、成功写入及失败批次回滚。
- 站点业务输入使用参数绑定、版本化迁移、单条条件写入及 D1 `batch()`；不使用跨网络调用的交互式事务。条件更新 0 行不会自动回滚 batch，后续写入必须受同一成功条件约束或由约束拒绝整批。
- Better Auth 原生 D1 adapter 的多次认证写入不保证整个流程原子提交；不要求用自定义 adapter 改写其事务模型。正式实现必须接受并测试 user/account 部分创建、重置凭证已消费但改密失败等状态，保留可重试或可修复的结果，不能把异常包装成成功。
- 邀请注册采用三步：**D1 条件预留邀请码 → 调用库创建待验证认证用户 → 在业务原子批次中消费邀请码、建立邀请关联并标记注册完成**。预留默认 15 分钟，在预留期间不能被另一个尝试抢占；完成提交重新检查期限、发出人状态和封禁竞态。完成后才发验证邮件。
- 预留和部分认证记录可持久存在；失败不烧掉邀请码、不转为已用码的永久占用，发码阶段的原占用仍按 6.5.2 计算。重试以服务端尝试 ID 和同一归属继续，不能凭客户端 userId 认领他人的账号；已存在用户名/邮箱冲突不消费码。过期/失败预留在后续请求或本机运维中安全释放，部分认证账号保持无成员权限，清理不得删除已完成成员及其业务数据。不引入跨产品事务、异步队列或新的自动清理服务。
- 当前注册服务在调用库前持久化目标用户 ID，使用原生 `user.create.before` 钩子指定该 ID；只按该 ID 读取真实用户，不把用户名/邮箱相同或库的模拟成功响应视为归属证明。同一尝试令牌持有者可在邀请码仍可用、且没有其他有效预留时续作或续订过期预留；已有 credential 必须按库验证密码，缺失时仅给该尝试自己的未完成用户补建原生 credential，不覆盖已有密码，每用户最多一条 credential。HTTP 接入时令牌只通过 HttpOnly Cookie 传递，不进 URL、业务响应或日志。
- `0010_registration_ownership.sql` 的触发器让成员资料插入、邀请码消费和尝试完成在同一 SQL 原子边界内提交，重新校验期限、发出人正常状态、邀请关联和原生 credential；任何一步失败都回滚业务激活。原生用户/credential 仍可保留为无成员权限的部分记录，重试不创建第二个账号；直接注册参数不能指定角色、邮箱验证状态或目标用户 ID。注册服务及 HTTP 防护/发信回调已通过第三阶段验收；必要入口以外仍关闭。
- 所有成员 loader/action、媒体、认证会话建立与认证设备绑定门禁均检查注册完成、邮箱已验证及正常状态。直接调用库 signUp 不能绕过邀请流程；不需要的注册、邮箱密码直登、账号删除、任意资料更新和 OTP 路径关闭或受同一服务端门禁约束。
- 原生邮箱 JWT 验证、改邮箱、密码重置和备用码消费按库行为执行，不承诺与邀请、设备处理或所有旧凭证撤销同批完成。密码重置撤销会话失败时保持可观察失败并重试撤销；所有新请求仍读主库，不能依赖缓存延迟。
- 发码、作废、额度调整、封禁、业务成员激活、片单重排等本站业务继续使用 D1 原子边界。发码以发出人/操作类型内唯一 `operationId` 防重扣，响应丢失不重复生成；不提供事后查询邀请码原值的接口。
- 进度、收藏按组合主键写入；片单修改以 `expectedRevision` 条件提交，失败整体拒绝，不能部分重排。
- 鉴权与一次性凭证读取走 D1 主库，不启用读副本或认证 Cookie 缓存。若以后用 Sessions API，合并鉴权查询作为 `withSession('first-primary')` 首次查询；成员状态还纳入敏感业务条件写入，防止封禁与提交竞争。

### 6.5.1 认证与管理接口映射

路径是接口草案，正式路由以实现/README 为准；权限和行为始终受 B 约束。

| 入口与方法（草案） | 权限 | 请求 / 响应 |
| --- | --- | --- |
| `POST /api/auth/sign-in/username` | 访客 | `username, password` 及 `x-captcha-response`；按原生客户端处理下一二步挑战或登录结果，设置库 Cookie。v1 不开放绕过策略的其他密码登录入口。 |
| `/api/auth/passkey/*` | 登录或成员绑定/删除流程 | 使用库生成选项、验证及设备管理端点；注册完成/邮箱/封禁/归属、origin/RP 和 UV 门禁见 6.3.1，不手写 assertion 验证。 |
| `POST /auth/register`（邀请注册包装入口） | 有效邀请码的访客 | `username, email, password, invitationCode` 及人机验证，采用 6.2.2 的预留/创建/完成。返回待验证状态，不返回成员会话或备用码；异常可留下无成员权限的待处理记录，不烧码。直接 sign-up 入口禁用或受同一门禁。 |
| `GET /api/auth/verify-email?token=...`、`POST /api/auth/send-verification-email` | 注册验证公开；改邮箱验证须本人会话 | 注册验证可 GET 完成、重复确认且不自动登录；重发提交 email/callbackURL 和 captcha。改邮箱验证绑定库 token 内旧/新邮箱并要求本人会话；会话缺失时将 token 留在 HttpOnly Cookie，跳转无凭证参数的登录页，再由 `/account/email-confirm` 续作，避免第三方登录控件接触 JWT。所有回跳受本站限制。 |
| `POST /api/auth/change-email` | 正常成员，库敏感会话校验 | `newEmail, callbackURL`；按 6.0.4 发信，验证前保留旧邮箱，不增加匿名改邮箱、永久待邮箱占用或逐操作 TOTP 证明。 |
| `POST /api/auth/request-password-reset`、`GET /api/auth/reset-password/:token`、`POST /api/auth/reset-password` | 找回公开；重置须有效凭证 | 申请提交 `email, redirectTo` 及 captcha，统一反馈；GET 不消费并跳转本站表单，POST 提交 `token, newPassword` 一次消费。成功撤销会话但保留设备和备用码，失败按 6.4.1 重试，不承诺多步原子性。 |
| `POST /api/auth/two-factor/verify-totp`、`/two-factor/verify-backup-code` | 已通过密码的待二步流程；库对应已登录操作 | 由库挑战 Cookie 绑定，提交 code/备用码；不接受 trustDevice，备用码不能重设密码。挑战期限、次数、账号锁与限流按 6.3。 |
| `POST /api/auth/sign-out`、本站 `GET /account/sessions`、`POST /account/sessions/:id/revoke` | 本人有效会话 | 退出清 Cookie；本站列表用 ID 与脱敏设备信息，不返回其他人的凭证，撤销在服务端映射本人的 token。 |
| `POST /api/auth/change-password`、`/two-factor/enable`、`/two-factor/disable`、`/two-factor/generate-backup-codes` | 正常成员，仅自己 | 使用原生 currentPassword/newPassword 或 password 字段；改密设置 `revokeOtherSessions=true`，备用码/TOTP 材料按库本次流程展示，敏感会话与密码确认不改成自定义证明。 |
| `GET /invites/data`、`POST /invites/create`、`POST /invites/:id/revoke` | 正常成员，仅自己发出的码；管理员不限额度 | 发码接收 `operationId, expiresAt?`，经业务写入来源与 JSON 校验；返回本次原码、ID、状态/期限及剩余额度，列表返回状态和已使用成员的必要站内标识。不能作废已用码；重复作废自己的未用码幂等成功。 |
| `GET /admin/members/data`、`/stats`、`/invitations`、`/roots`、`/:id/invited`、`/:id/ban-preview` | 正常管理员 | 分页返回角色、状态、额度及邀请关系；全站统计独立计数，搜索用户名上限 30 字符。成员/邀请码/各层邀请链每页 20 条，连带预览返回总数及前 20 个站内标识，实际提交重检范围。无邀请码原码/哈希、密码哈希、TOTP/备用码密文或会话凭证。 |
| `POST /admin/members/:id/ban`、`/quota`、`/role`、`/unban` | 正常管理员，已绑定 TOTP 且会话新鲜 | 接收 `cascade`、`total`、`role` 或单个解封目标，经业务写入来源与 JSON 校验；5 分钟内新建会话可执行多次操作，不绑定 operation/target、不一次消费。旧会话重新正常登录。无 `/reset-link`；自封禁/自降权/末位管理员与邀请链边界仍在业务原子批次中保护，解封不恢复会话/邀请码、不额外发信。 |

## 业务原子边界与故障处置

0011 在 credential 密码更新同一语句撤销全部旧会话；密码写入失败保留旧状态，后续库写入仍可能部分失败。封禁、未用码作废与会话删除同一业务提交，注册完成/封禁竞态及管理员自保护用条件写入并发重检。邀请额度不用限流计数器；过期由时间派生，不逐码定时清理。高影响管理 action 实际检查 createdAt/freshAge，不以配置值替代。

密码已改但后续失败时不能提示“密码未变”；原生多步故障、重试及安全门禁按 B 6.4.1/7 验收。更换认证 Secret 前先解密/重加密保留的 TOTP/备用码，运维步骤见 operations。

### 邀请来源补强验证

比较基线为 `dev` 的 `3ccb29e`，现有迁移未改写。经开发者确认，`test/member-actions.test.ts:60` 使用 `member("Quinn", true, user.id)` 准备与普通码发出人一致的消费成员，既有额度、并发和幂等断言保留。直接改动为跨表一致性约束及旧表重建衔接；影响注册完成、发码/消费、邀请列表、额度与封禁链的数据关系。先运行 schema、成员迁移、注册与邀请管理五个 suite，发现既有额度夹具冲突后扩大至全量应用回归。未改变页面交互、库版本、测试执行条件或外部服务行为，不重跑无关浏览器/长播验收，不将本地结果视为 staging 验收。

2026-10-13 自检：新增用例在旧迁移上复现三个错配及 INSERT OR REPLACE，四项按预期失败；修复后的新增 28 项全部通过。夹具修正后，`pnpm test test/member-actions.test.ts` 的 9 项及 `pnpm test` 的 16 个文件、219 项全部通过，`pnpm typecheck` 再次通过；`git diff --check` 通过。构建和迁移复用本次修复先前的成功结果：`pnpm build` 及 `cf d1 migrations apply <测试占位 ID> --local --persist-to .cloudflare/invitation-guard-migration-test` 的 14 个迁移通过，此后只有测试夹具与记录变化，应用、迁移、依赖和配置未变。本机开发库、既有服务和云端数据未修改；这表示实现与本地自检通过，不表示 staging 或阶段验收完成。


## T4.5 请求级身份与 D1 往返优化

本专项只优化已实现功能的数据访问，保留 B 6.1.1、6.2.2、6.3.3、6.5、6.6 和 7 的安全与失败行为。实施顺序为 T4.5.1 → T4.5.2 → T4.5.3 → T4.5.4 → T4.5.5 → T4.5.6，后续 T4.5.8 → T4.5.7；与第四阶段实机反馈收集互不替代，全部验收后才进入第五阶段。

### 优化前现状与证据边界

静态核对基线为本地 `dev` 的 `e3fbdd9`；执行时记录实际起始 SHA 并重查调用方，不假定代码保持不变。

| 路径 | 当前可确认的重复或串行工作 | 验证重点 |
| --- | --- | --- |
| `workers/app.ts` → root/子 loader | `currentMember()` 每次创建认证实例并调用 `getSession()`、`memberById()`，没有共享身份上下文 | SSR、Single Fetch `.data`、单路由请求分别测量；父子 loader 可能并行或属于不同请求，不能把静态调用次数直接相加成串行耗时 |
| `watch.loader` → `authorizePlayback()` | `pageMember()` 后再次经过 `liveMember()` → `requireMember()`，再单独 JOIN session/user/member_profiles | 区分重复基础解析与最终授权所需的实时条件，不直接删除所有 JOIN |
| `createSiteAuth()` 包装钩子与原生端点 | `/get-session`、二步端点等包装门禁另调 `createAuth().api.getSession()`，库内部仍可能读取会话；建立会话前后也有成员门禁 | 以锁定 1.7.7 源码和真实 HTTP 流程确认钩子顺序、已有上下文、状态变更及 Cookie 行为 |
| 签发、媒体与字幕 | 签发依次读取身份、片源、配额、字幕；资源入口分开读取授权片源与目标元数据 | 合并有依赖关系的 SQL，批量提交独立读取；保留资源归属、配额和主库授权 |
| 片库与管理 | 片库已有 batch 与紧凑 DTO；管理写入已有 SQL 权限条件 | 只优化测量证实的剩余重复工作，不重做已完成优化、不删原子权限条件 |

[2026-10-07 性能报告](../performance-navigation-20261007.md)证明关闭重复 schema 检查、批量和缩小查询范围有效，但没有完整的逐请求 D1 分解。本专项的查询预算与收益必须重新测量，不承诺未验证的毫秒数或容量。

### 实现约束

1. **一次请求的只读阶段，基础身份按需解析一次。** 在 Worker `fetch` 入口分配服务端请求上下文，经 React Router `AppLoadContext` 和现有 HTTP 入口显式传递；基础解析首次调用即保存 Promise，供并行调用共享成功、匿名或失败结果。请求克隆/内部转发仍显式传递同一上下文，不只靠 `Request` 对象地址识别请求。注册创建指定用户等不同配置的认证实例不强行合并。
2. **请求隔离且失败关闭。** 成员状态、会话有效性及媒体授权结果不通过模块级变量、按 Cookie/session 的跨请求缓存、KV/Cache API 或读副本复用；原生会话识别可按 [T4.5.7](#t457-每请求单次-d1-往返) 使用 Better Auth 认证 Cookie 缓存，但每个请求仍由本站主库 SQL 判定会话行与成员状态。每次新的 HTTP 请求创建新上下文并从主库判断当前身份；数据库异常不当作游客成功或旧身份继续使用。客户端 DTO、请求参数和转发头不能充当可信身份上下文。此限制不排除[成员间共享的非个性化片库资料短缓存](catalog.md#服务端片库缓存边界)；每次媒体请求仍须从主库实时鉴权。
3. **基础复用不替代最终授权。** 角色/封禁/注册/邮箱、会话有效性、资源归属及 ownership 条件仍在对应信任边界检查；管理员写入保留 TOTP、新鲜会话、自保护、末管和 SQL 原子权限条件。会话建立、改密/退出/撤销、邮箱验证等改变身份后，废弃旧快照；必要的新阶段重检或库内部查询单列，不为满足计数删除。请求开始的快照不能作为最终敏感写入的唯一依据。
4. **保持 Better Auth 的所有副作用。** 不手写 Cookie 验签、会话协议或修改库内部实现。保留 30 天滚动、1 天刷新、5 分钟新鲜度、原生挑战/限流和现有 schema 策略；优先利用锁定版本公开钩子中的可信会话结果，避免包装层再次解析。无法通过支持的接口消除的原生查询单独记录，不用补丁或升级库扩大任务。
5. **响应头单独管理。** 复用身份时不让多个 loader 修改同一个 `Headers`，统一收集并在实际响应出口合并 Cookie。保留多个 `Set-Cookie`，同名会话的新发/清除优先于旧滚动续期，不能因重复追加或框架合并丢失；成功、重定向、错误及独立数据响应均验收。身份和私密诊断信息不进入 loader DTO。
6. **SQL 数量与往返分开优化。** JOIN/条件写入用于合并相关判断，`batch()` 用于减少独立语句的应用层等待，batch 内仍按多条 SQL 计数，不宣称数据库并行。只返回必要字段，避免 JOIN 扇出、扩大扫描或重复简介；新增索引须有查询计划/扫描量证据，按新迁移交付，不改写既有迁移。

### 任务与验收

#### T4.5.1 逐请求基线与回归信号

- [x] 在本地测试建立最小 D1 调用计数/时间线探针，覆盖 Better Auth 和业务实际使用的同一 binding，包括 `withSession()`、`batch()` 与单语句执行；只计执行，不把 prepare/bind 重复计入。透传能力、方法绑定、结果/异常和会话语义保持不变，不建设通用监控框架。
- [ ] 按实际 Worker 请求标识记录：D1 API 往返数、SQL 语句数、调用起止及依赖、串行关键链、基础身份解析次数、库/业务分组耗时、可获得的 D1 执行时间与 rows read/written。并行等待不直接求和，库耗时与其包含的 D1 耗时不重复相加，缺失指标标记不可得。
- [ ] 覆盖 `/`、`/series`、`/movies`、`/title/:id`、`/watch/:id` 的 SSR 和实际 `.data` 导航，以及媒体 GET/HEAD/Range、字幕、`/api/auth/get-session`、本人会话撤销和管理员写入；区分无 Cookie、有效成员、需滚动续期、无效/撤销/封禁及无片源场景。标注一次浏览器操作产生的多个独立请求。
- [x] 获准后在 staging 以同一最小探针采集优化前基线，保存 SHA、环境/数据规模、Cookie 续期状态和采样方法，供 T4.5.6 同条件对比；未授权时先完成本地可验证工作并记录云端待验，不用 10 月 7 日导航样本代替本次基线。
- [x] 在真实重复路径留下可变红的自动化断言，固定只读请求的身份解析数、D1 往返/串行预算；基线必须先因重复而失败，再用于验证后续修复，不能仅断言请求 200。变红证据留报告，最终预算断言与对应修复同一原子提交，不向 `dev` 集成失败的中间状态。完整基线、命令、实际 SHA 和路由预算写入专项验证报告，本计划只保留摘要与链接。

验收：能够对一个播放页请求和一个 Range 请求给出完整脱敏调用时间线，区分包装重复与库必要工作；测试可稳定复现具体重复，没有用源码调用次数冒充线上往返数。

#### T4.5.2 请求级身份与页面调用方

- [x] 在 `workers/app.ts`、`member.server.ts` 接入懒加载请求上下文，将 root、home、catalog、title、watch、account、invites、admin 的现有身份入口迁到同一解析结果；按需创建认证实例，不为了公开无 Cookie 页面额外访问 D1。不引入并存的旧/新身份路径。
- [x] 迁移现有业务 HTTP 调用方与测试夹具的上下文传递，明确每个真实请求的生命周期；`currentMember`、`requireMember`、`pageMember` 保留各自匿名/错误/登录跳转行为，但不再次读取同一基础身份。播放专属 SQL 整理由 T4.5.4 验证。
- [x] 在原生会话结果之后的主库成员查询中统一需要的会话/成员条件，为替换独立 `liveMember()` 复核提供等价证据；会话在两次读取之间已撤销、过期或成员失效时仍拒绝。保留响应头与当前用户 DTO 边界。
- [x] 增加并行调用共享 Promise、匿名/异常复用、不同请求/不同成员隔离和 Cookie 传播测试。`test/catalog.test.ts` 现有同一 `Request` 跨数据库变更的直接调用，沿统一实现的默认参数每次创建新上下文；原用例无需改写。新增显式共享、不同上下文和真实 HTTP 即时撤销测试，不以对象地址缓存。

验收：同一只读请求中本站基础 `getSession()` 至多执行一次，成员基础查询不因 loader/内部函数数量增加；第二个独立请求即使 Cookie 相同也重新判断。无需依赖父 loader 已执行，子 loader 独立请求仍安全。

#### T4.5.3 原生认证包装复用与状态变更

- [x] 核对 `auth.server.ts`、`auth-http.server.ts`、`account.server.ts` 的实例/钩子调用图；对 `/get-session`、已登录二步操作、改邮箱确认和撤销本人会话，复用支持的原生上下文或本请求解析结果，消除包装层的第二套基础查询。待二步挑战与已登录敏感操作分别验证，不混用身份。
- [x] 保留新会话建立前后的成员状态门禁、验证注册完成/邮箱/封禁及必要竞态重检；先证明结果仍可信且没有状态变化，再合并重复 `memberById()`。会话创建或撤销后的旧快照不得继续授权，原生必要的密码/挑战/凭证查询不计作可删重复。
- [x] 复跑原生滚动 Cookie、改密新会话覆盖旧续期 Cookie、退出/撤销清除 Cookie、注册部分失败、邮箱验证/改邮箱、TOTP/备用码、通行密钥 UV、Origin/CSRF/限流用例；原生查询无法安全复用时记录具体端点、次数和原因，不以绕过库门禁换取数字达标。

验收：包装层不重复解析同一只读阶段的身份，库剩余查询可归因；原生响应/副作用与既有契约一致。若消除某项查询必须改库内部实现或改变产品行为，停止该项并报告站长，不默认为已完成。

#### T4.5.4 媒体授权与元数据合并

- [x] `watch.loader` 与 `authorizePlayback()` 使用同一请求身份，移除已被统一主库解析等价覆盖的 `liveMember()` 独立查询；POST 签发/续期和每个媒体/字幕请求仍建立自己的上下文并实时授权。
- [x] 将视频入口的授权片源存在性与目标元数据读取合并；字幕入口在同一查询中核对绑定 MP4 仍存在、字幕属于同一单元且格式有效，再返回必要元数据。需要最后时点重检的会话/成员条件纳入最终授权 SQL，而不是再调用 Better Auth。
- [x] 签发所需 MP4 与字幕读取按依赖关系合并或 batch，保留恰好一条 MP4、无片源错误、原有轨道顺序和 30 分钟载荷；配额保持条件写入及准确 `Retry-After`，正常媒体不耗签发额度。最终条件 0 行须区分无权限、资源失效与配额耗尽，不统统返回 429。
- [x] 在授权成功后才读取 R2；保留对象大小/ETag 一致性、授权前不泄露大小/类型、GET/HEAD/Range/If-Range、到期取消和客户端断开行为。不增加跨请求媒体元数据缓存，不为减少 D1 调用删除 R2 完整性检查。

验收：已识别的播放页/签发/资源重复路径各至少减少一次 D1 API 往返或一个串行等待阶段，逐路径报告实际结果；每个新的 GET/HEAD/Range/字幕请求仍走主库授权。退出、撤销、改密/重置、封禁之后的下一请求拒绝，旧流的 token 到期截止不变。

#### T4.5.5 有证据的业务查询收尾

- [x] 根据 T4.5.1 基线检查 `catalog.server.ts`、root 与页面之间的统计/作品读取，以及管理/邀请读取；仅合并同请求确有重复或串行瓶颈的查询，没有证据的路径记录“无需改动”。同请求内可复用与请求参数/用户绑定的结果；不建设通用仓储或插件式缓存层。共享片库只读缓存按[片库缓存边界](catalog.md#服务端片库缓存边界)评估，不作为本专项必做项。
- [ ] 保持紧凑卡片、当前作品/首页限定范围、搜索/分页/排序、本人进度/收藏隔离和缺媒体行为；现有管理员原子权限 SQL、业务写入来源与 JSON 校验、幂等/配额和失败处理不得裁剪。新增或修改 SQL 用真实 D1 夹具验证语义、扫描量和必要索引，不仅 mock 返回值。

验收：每项 SQL 改动都能对应一条基线证据及前后预算；不引入整库单集返回或 payload 膨胀，无瓶颈路径不为统一风格重构。

#### T4.5.6 安全、性能与交付复验

- [x] 自动化覆盖独立 HTTP 请求的即时封禁/撤销/过期/未验证/未完成注册；注入身份读取后权限变化，确认管理员最终条件写入仍拒绝且无部分成功。复验自封禁、自降权、末管、注册与封禁竞态、配额并发和跨成员数据隔离。
- [x] 复验 token 篡改/错环境/错成员/错会话/错单元、媒体关系失效、未授权 HEAD/Range 元数据保护及跨到期流取消；新增身份计数断言与现有 `auth`、`auth-http`、`catalog`、`member-actions`、`playback`、`http` 等集成测试一起运行，不以测试模式额外 schema 查询混淆运行环境基线。
- [x] 运行 `pnpm test:tools`、`pnpm typecheck`、`pnpm test`、`pnpm build`；授权后核对 `cf --help`/当前能力，执行 staging 构建、dry-run、部署和复验。cf 优先，Wrangler 仅补充已确认且获准的能力缺口，不把任意失败自动转为另一工具重试；推送及触发自动发布须有明确授权，本专项不包含 production 部署。
- [ ] 获准后对优化前后各自固定 SHA，以同一 staging 数据、会话状态、设备/网络和探针口径采样，主要只读/媒体路径每组至少 20 个预热样本，冷启动及续期样本单列；报告 D1 往返、SQL 数、串行阶段、基础解析数、库/业务耗时、响应体、TTFB/导航中位数与 P95。媒体只比较响应头/首字节与授权关键链，不把整段流播放时长计入 D1 等待。小样本只作描述，不当作容量结论；耗时回退超出噪声时复测并解释，不能仅以查询数下降宣布成功。
- [x] 计数不包含夹具准备和探针自身的额外查询；会话撤销、封禁、改密及管理员写入仅操作专用虚构账号与数据，逐例重建可比状态。采样遵守既有限流/配额，不临时关闭门禁、不做真实成员的破坏性压测；已有 `6120` 服务继续复用并保留。
- [x] 诊断默认关闭且只在获准的本地/staging 范围开启，复用白名单路由族与随机 requestId，不输出原始 SQL/绑定值、Cookie、邮箱、会话凭证、URL/query、对象键或 Secrets。保留重置凭证路径禁止应用日志及现有平台 query 脱敏限制；实际检查平台日志附加内容，不能保证脱敏的路径禁用诊断。诊断头不留在公开响应，临时探针清除后复跑关键用例。
- [x] 专项报告记录可复现命令、SHA、前后路由预算、必要剩余查询、失败/未验项、日志核验和诊断清理结果；同步本模块、播放/片库验证摘要及根计划/README。未取得 staging 授权或未完成复验时保持未完成，不用本地测试替代云端效果。

完成门槛：安全契约不变、本站只读基础身份最多解析一次、目标重复路径的 D1 往返/串行等待可验证下降、库开销可归因、全部相关检查通过且 staging 无未解释回退。真实手机验收仍按 T4.2-mobile/T4.4-mobile 独立完成。

#### T4.5.7 每请求单次 D1 往返

开发者 2026-10-15 确认，在 T4.5.8 之后实施。staging 实测每次 D1 调用墙钟 62–77 ms，SQL 执行仅约 0.2 ms，页面延迟主要由串行往返次数决定。

- [ ] 启用 Better Auth `session.cookieCache`（`jwe` 格式，时长实施时确定，库默认 300 秒）。缓存有效时原生会话识别不读 D1；锁定版本在配置数据库时强制关闭无库刷新，缓存过期后照常读库并滚动续期。
- [ ] 本站成员 SQL 每个请求仍在主库核对会话行、成员状态与邮箱验证，撤销、改密、封禁后的下一个请求立即拒绝；成员核对与各页面自己的查询合为同一 batch。普通页面目标为 1 次串行 D1，媒体请求为 1 次 D1 加 1 次 R2。
- [ ] 按同条件方法复测页面与媒体请求，撤销、改密、封禁即时生效的既有用例全部通过。

验收：撤销与封禁的即时性不变；目标路径的串行 D1 次数按上述预算下降，并有 staging 同条件测量。

#### T4.5.8 数据位置与成员机房测量

staging 实测 Worker 均在 HKG 运行，单次 R2 操作 240–290 ms、单次 D1 调用 62–77 ms，数据很可能不在成员附近；成员实际接入的机房也未知。

- [ ] 经授权只读查询 staging D1 与 R2 的实际位置；在路由日志加入非敏感的 `colo` 字段，统计成员实际接入机房。
- [ ] 数据不在成员附近时，评估创建时位置提示（staging 需重建，production 宜在首发前创建）或 Smart Placement；资源重建与数据迁移另行确认。

### 当前进展与阻塞

固定对照为 `0fa2284`→`cbb16db`。请求内 Promise 共享、原生包装复用、Cookie 合并和媒体查询合并已进入 dev；本地变红证据、24 个前后场景及 3 个补充场景见[本地报告](../performance-request-identity-20261013.md)。

2026-10-14 staging 复验覆盖 20 组、每版每组 25 个预热 HTTP 样本，取得 964 个配对预热探针；播放页 D1 15→7、Range 6→4、云端会话接口 8→6。47 项专用虚构账号安全断言、35 路原子配额、平台附加日志核验通过；272 项应用测试、23 项工具测试、类型检查和构建通过。完整指标、当前/旧版时间线及边界见[云端报告](../staging-revalidation-20261014.md)和[数据](../staging-revalidation-20261014.json)。

签发 HEAD 并行修复（2026-10-14）：以原始 `cbb16db` 为基线，仅改变共享签发函数的独立 R2 HEAD 调度。A/B/B/A 每版每路径 20 个 warm 样本，合计 240 HTTP/226 配对；HTML/数据/续期 TTFB 中位数 1062→788、996→751、898→684 ms，D1/R2 次数不变，HEAD 重叠及 R2 等待约 500→258 ms 支持因果归因。相关本地 62 项、类型检查和构建通过；云端 22 项安全断言针对复验时版本，最终的视频失败立即返回路径仅经本地验证；平台完整事件敏感值扫描无匹配；数据与首次多提交对照分开保存。

**性能尚未整体验收**：首次多提交对照的 3 秒以上尖峰本轮连原版也未复现，不能宣称并行修复解释了历史尾延迟。开发者 staging 浏览器验收（2026-10-15，代码同 `78914f2`，其后仅文档变更）：150 次真实浏览器导航正文更新中位数 358–379 ms、P95 397–446 ms；手机冷缓存 LCP 出现一次 3.05 秒慢样本，复测 0.92 秒，原因未定。还缺真正冷启动、冷缓存慢样本归因、全部敏感插件独立成本及完整云端安全场景，开发者也未确认性能验收，因此同条件性能完成项仍未勾选；既有局部证据不代替整项验收。

首次 6 个虚构账号/4 个诊断版本和修复复测 2 个虚构账号/2 个诊断版本均已清理；staging 恢复原始 `cbb16db` 版本、100% 流量，11 个 Secrets/绑定与 observability 不变。恢复后的实际请求日志确认原版本且无探针事件。平台 latest 保护要求保留一个未激活、无探针的干净原版副本，详见[清理证据](../staging-revalidation-20261014.md#修复恢复与清理)。修复随后经 PR #26 进入 `dev` 并随 staging 自动发布，发布后版本未单独复测；没有 production 操作或关闭既有开发服务器；真实手机和长播按各自计划验收。

## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
