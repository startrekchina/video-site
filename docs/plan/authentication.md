# 登录、账号、邀请与权限

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A1/A2/A6、B 6.0/6.2.2/6.3–6.5/7。T2.4/T2.7 及第三阶段已验收；旧 POC 仅是旧契约差距证据，不重新开启选型。production 邮件和 Secrets 交由 operations 的 T6.2，认证小样本不代表全站容量。

## 任务与验证摘要

- [x] T2.4 采用 Better Auth；旧 POC 29 项行为/差距测试及[报告](../../spikes/better-auth/REPORT.md)已归档，不视为正式验收。
- [x] T2.7 锁定 1.7.7、0008/0009 增量迁移、原生配置/21 项探针、关于页文案与 8 视图复核完成。
- [x] T3.1 邀请注册归属/续作、HTTP 防护、Postal 单次发信及用途配额、登录/验证/找回页面接通；实际验证/找回邮件与新密码登录经站长确认。
- [x] T3.2 二步/备用码、通行密钥 UV、本人会话管理、改密及本人改邮箱完成；站长确认真实 TOTP/备用码、电脑撤销手机会话、通行密钥登录有效。
- [x] T3.3 幂等邀请、额度/角色/封禁/单个解封、邀请链和首管本机提升完成；多层关系及其他成员操作弹窗的桌面/手机浅深色复核通过。

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
| 所有认证端点强制自定义 csrfToken/精确账号限流 | 库 Origin/Fetch Metadata 和 IP+路径限流，业务防护单独保持（6.1.1、6.3.2） |
| 所有认证写入同批回滚、JWT 单一且一次消费 | 原生多步写入与 JWT 生命周期，注册以业务完成门禁隔离部分状态（6.0、6.2.2） |

库事实依据为 POC `spike/auth-poc-report` 的 workerd 结果与 1.7.7 发布源码；当前官方资料核对于 2026-10-06：[自有数据库](https://better-auth.com/docs/concepts/database)、[会话](https://better-auth.com/docs/concepts/session-management)、[用户名](https://better-auth.com/docs/plugins/username)、[二步验证](https://better-auth.com/docs/plugins/2fa)、[通行密钥](https://better-auth.com/docs/plugins/passkey)、[改邮箱与改密](https://better-auth.com/docs/concepts/users-accounts)、[安全防护](https://better-auth.com/docs/reference/security)、[captcha](https://better-auth.com/docs/plugins/captcha)。官方新版本说明不能自动覆盖锁定版本行为；差异用正式集成用例验证。

## 原生配置与发信接入

- 锁定 better-auth/passkey 1.7.7，自有 D1 adapter，username/twoFactor/passkey/captcha 插件，关闭 telemetry。本站保持邀请、角色、封禁、配额及授权边界，不开放额外库能力。
- 注册 autoSignIn=false、requireEmailVerification=true、sendOnSignUp=false，业务完成后发信；邮箱验证 autoSignInAfterVerification=false，链接 1 小时。重置 revokeSessionsOnPasswordReset=true；改邮箱 enabled=true、updateEmailWithoutVerification=false，确认额外要求本人会话。
- session.expiresIn=30 天、updateAge=1 天、freshAge=300；关闭 cookieCache/secondaryStorage。twoFactorCookieMaxAge=300；原生 scrypt N=16384/r=16/p=1，库原生盐/哈希和认证加密，不复用播放/备份密钥。
- 通行密钥请求 UV，并在 afterVerification 拒绝 userVerified=false；只设置 userVerification 不代表服务端强制。origin/RP 固定本环境，不重写 WebAuthn。
- rateLimit 开启 D1 database storage、可信 Cloudflare IP，参数按 B 6.3.2；captcha 传 x-captcha-response 并核 allowedHostnames/expectedAction。包装 HTTP 先验来源/IP/Turnstile，不假定 auth.api 内调会执行 onRequest 插件。
- Postal HTTPS fetch：POST /api/v1/send/message，Content-Type application/json 与 X-Server-API-Key；映射 to/from/reply_to/subject/plain_body（接口也支持 html_body，当前传输仅纯文本）。同时检查 HTTP 与 JSON status，只取必要 data.message_id；服务接受不等于送达。
- 传输最多一次、10 秒、manual 重定向且拒绝非 2xx，不自动补发；失败/超时捕获脱敏，超时记未确认，不回滚注册或封禁。验证用途共用邮箱摘要配额，找回另计，D1 条件写入计入首次/失败/超时；通知不受站内发送上限，仍受上游限制。
- 本环境发件子域及 From/Reply-To/API 地址从本机/平台配置；staging 测试发件人与 production 区分，Reply-To 同收信地址；域名及 SPF/DKIM/DMARC 由站长维护。异步发信纳入请求生命周期，不留未等待 Promise。详细运行限制见根 README。

### 6.2.1 认证与邀请存储映射

| 对象 / 表名 | 字段与约束 |
| --- | --- |
| 认证用户 `user` | 按锁定版本的 Better Auth schema 保存 `id, name, email, emailVerified, username, displayUsername, createdAt, updatedAt` 和插件字段。用户名按 6.3 的原生规则校验/规范化，当前邮箱小写化并唯一；密码哈希在 `account` 的 credential 记录中，不复制到业务成员表。日期序列化沿用 adapter，HTTP 输出 ISO 8601；0008 迁移的 D1 DATE 列实测保存 ISO 8601 文本，adapter 还原 Date，与旧业务表 UTC 毫秒列分别处理。 |
| 成员业务资料 `member_profiles` | 与 Better Auth 用户 ID 一对一关联，记录 `role, status, registration_state, invited_by_user_id, invite_quota`；角色仅 `member/admin`，邀请关系完成后不可改，不允许自邀请。业务外键统一使用同一个稳定用户 ID，不生成第二套成员身份；库 updateUser 不接受客户端改角色、状态、邀请来源或注册完成标记。0009 已建立映射与业务外键；第三阶段 HTTP 与各受保护 loader 已接入独立成员门禁。 |
| 验证状态 `verification` | 按 Better Auth schema 保存密码重置和认证挑战等临时记录，接受库的标识/值存储格式与消费方式。注册/改邮箱验证使用签名 JWT，不要求额外的 `email_verification_tokens` 哈希账本；重发不保证撤销旧 JWT。 |
| 邮件发送记录 `email_deliveries` | `id, user_id?, to_email_key, purpose, provider_message_id?, status, error_code?, created_at`；`purpose` 区分注册验证、重发验证、密码找回、管理员通知、安全提醒。只记录邮箱摘要而非原文；用于限流计数、排查发信失败和避免重复发信，不保存邮件正文或链接原值。 |
| 会话 `session` | 使用 Better Auth 原生 `id, token, userId, createdAt, updatedAt, expiresAt, ipAddress, userAgent`；token 唯一，用户外键存在。原值留在自有 D1，Cookie 由认证 Secret 签名；期限按 6.3.3 滚动更新，不要求 `token_hash/last_active_at/credential_version` 自定义认证列。 |
| 邀请码 `invitations` | `id, code_hash, issuer_user_id, used_by_user_id, created_at, expires_at, revoked_at, used_at`；码哈希唯一，消费人唯一。`issuer_user_id` 允许为空，只用于本机准备的 bootstrap 码，空 issuer 不代表任何成员。过期由服务端时间计算并按字段派生“有效、已用、作废、过期”，不需要为每个到期码跑定时任务。额度的 `total` / `occupied` 定义见 6.5.2。 |
| 认证账号与插件表 `account / twoFactor / passkey / rateLimit` | `account` 保存 credential 密码哈希；`twoFactor` 保存库加密的 TOTP 密钥、二步备用码及锁定状态；`passkey` 保存公钥、计数器与设备属性，`credentialID` 增补唯一约束；`rateLimit` 用于库持久化 IP/路径计数。沿用库原生加密和 schema，不另建密码恢复码或管理员 `reset_links` 表。 |
| 注册预留 `registration_attempts` | 服务端随机尝试令牌的 SHA-256 作为 `id`，绑定邀请码、预先生成的 `expected_user_id`、用户名/邮箱规范化后的 `identity_key` 摘要、已创建认证用户和期限，记录预留/完成/失败。不保存密码或原始尝试令牌；ID、邀请码及归属字段不可改写/REPLACE。仅同一有效预留可完成邀请码消费和成员业务资料激活；未完成认证用户不得访问成员功能。业务关联与并发约束见 6.2.2。 |

#### 6.2.2 D1 写入与幂等

- 0009 迁移不自动转换旧密码或设备凭证：旧成员必须先经审查关联到相同 ID、用户名、邮箱与验证状态的原生用户，credential 记录须保留已转换的相同密码哈希，旧待邮箱与自定义临时/设备凭证表须为空。否则 `legacy_auth_requires_review` 拒绝执行并回滚；不能直接把旧哈希或密文视作原生兼容，也不为通过迁移删除未审查的数据。符合前置条件后保留业务资料、角色、封禁、邀请关系和稳定 ID，退役旧自定义认证表。当前工程尚无正式成员，真实成员的旧认证转换不在本迁移中自动进行。
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
| `GET /invites/data`、`POST /invites/create`、`POST /invites/:id/revoke` | 正常成员，仅自己发出的码；管理员不限额度 | 发码接收 `operationId, expiresAt?` 和 CSRF；返回本次原码、ID、状态/期限及剩余额度，列表返回状态和已使用成员的必要站内标识。不能作废已用码；重复作废自己的未用码幂等成功。 |
| `GET /admin/members/data`、`/stats`、`/invitations`、`/roots`、`/:id/invited`、`/:id/ban-preview` | 正常管理员 | 分页返回角色、状态、额度及邀请关系；全站统计独立计数，搜索用户名上限 30 字符。成员/邀请码/各层邀请链每页 20 条，连带预览返回总数及前 20 个站内标识，实际提交重检范围。无邀请码原码/哈希、密码哈希、TOTP/备用码密文或会话凭证。 |
| `POST /admin/members/:id/ban`、`/quota`、`/role`、`/unban` | 正常管理员，已绑定 TOTP 且会话新鲜 | 接收 `cascade`、`total`、`role` 或单个解封目标，带业务 CSRF；5 分钟内新建会话可执行多次操作，不绑定 operation/target、不一次消费。旧会话重新正常登录。无 `/reset-link`；自封禁/自降权/末位管理员与邀请链边界仍在业务原子批次中保护，解封不恢复会话/邀请码、不额外发信。 |

## 业务原子边界与故障处置

0011 在 credential 密码更新同一语句撤销全部旧会话；密码写入失败保留旧状态，后续库写入仍可能部分失败。封禁、未用码作废与会话删除同一业务提交，注册完成/封禁竞态及管理员自保护用条件写入并发重检。邀请额度不用限流计数器；过期由时间派生，不逐码定时清理。高影响管理 action 实际检查 createdAt/freshAge，不以配置值替代。

密码已改但后续失败时不能提示“密码未变”；原生多步故障、重试及安全门禁按 B 6.4.1/7 验收。更换认证 Secret 前先解密/重加密保留的 TOTP/备用码，运维步骤见 operations。


## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
