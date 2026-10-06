# Better Auth 旧需求兼容性 POC

2026-10-06；对应调整前需求与 PLAN T2.4。旧评估结论是 Better Auth 1.7.7 不满足当时的自定义认证契约；**站长随后明确决定调整需求并采用 Better Auth，该选型阻塞已解除。** 当前规则以本地 `dev` 的 `docs/requirements.md` 第 6.0、6.2.2、6.3–6.5 节为准，可执行 `git show dev:docs/requirements.md` 阅读；本 POC 分支保留旧实验，不将旧快照当作当前需求。

本 POC 独立于正式工程，只有虚构成员和测试 Secret。已在 workerd（`nodejs_compat`、兼容日期 2026-09-25）完成 29 项测试与类型检查；其中使用旧自定义哈希/策略，差距用“断言差异存在”的测试表达。该结果既不代表旧兼容门槛通过，也不代表新原生配置/邀请门禁已验收；正式工程尚未接入库。真实 WebAuthn、staging CPU/内存/并发仍未验证。

## 运行

在本分支的 `spikes/better-auth/` 执行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

测试每条用例重置 D1 并应用独立迁移，不创建云端资源。类型由 `cf workers types` 生成；正式应用的测试与构建仍在仓库根目录运行。

## 历史逐项核对（调整前标准）

下表保留原始 A1–A7/B1–B10 的检查标准、当时结论与证据，包括“不能沿用”“硬要求”等当时规则用语；它们不再是当前验收条件。“源码”不表示端到端通过。路径 `BA` 为 `node_modules/better-auth/dist`、`PK` 为 `node_modules/@better-auth/passkey/dist`。

| 检查点 | 结论 | 证据与差距 |
| --- | --- | --- |
| A1 scrypt N=16384 / r=8 / p=5、盐与参数、常量时间比较、不规范化 | 本地通过 | `src/password.ts` 与 `test/scrypt.test.ts`，库 hash / verify 可配置。上一轮本机单次约 122 ms，只是本地耗时，staging 成本待测。库默认 NFKC 及 r=16 / p=1 不能沿用。 |
| A2 用户名、密码规则 | 配置 / 钩子通过 | `test/rules.test.ts` 验证用户名 3–12 位 ASCII、大小写去重与展示保留；密码 10–128 位 0x21–0x7E，拒绝空格、中文、emoji、tab。配置 username 插件与 `src/policy.ts`。实际登录入口的大小限制、错误脱敏仍须正式 action 实现。 |
| A3 注册 + 邀请码 + 恢复码的原子性 | **不通过** | `test/gaps.test.ts` 注入 account INSERT 失败，signUp 报错后 user 行仍存在、account 为 0。D1 adapter 的 `transaction=false`，`runWithTransaction` 只是顺序执行；不能把库 signUp 调用加入 D1 `batch()`。注册不存在邀请码及恢复码的一体消费流程。 |
| A4 `__Host-session` 属性、仅存哈希、180 天绝对 / 30 天不活跃、页面续活、普通改密 | **部分 / 不通过** | 精确 Cookie 名及 HttpOnly / Secure / Lax / Path=/ / 无 Domain 已运行验证（关闭自动 `__Secure-` 前缀并显式设置 secure）。同一测试确认 session.token 等于返回 bearer token，库存明文。`getSession` 实测把 179 天旧会话延到原绝对上限之外。可关自动刷新，但页面限定活跃、两个上限及 Cookie 同步需项目实现。`BA/api/routes/update-user.mjs` 的 `revokeOtherSessions` 删除全部会话后新建，重置创建时间；不开则不换当前标识，均不满足需求。 |
| A5 三条恢复路径、旧会话 / 恢复码 / 链接、设备处理 | **不通过** | 故障注入确认 reset-password 先消耗凭证，再写密码；写失败时凭证丢失、旧密码及会话保留。`BA/api/routes/password.mjs` 仅提供邮箱重置，可配置撤销会话；没有恢复码重置及管理员来源的业务流程，没有三条路径对应的 TOTP / passkey / 所有旧凭证原子撤销。GET 预览仅查找不消费（源码通过）。 |
| A6 CSRF、错误结构、关闭库限流 | **部分** | `gaps.test.ts` 验证带 Cookie 的跨 origin 请求 403、关闭 rateLimit 生效。同源匿名注册无 csrfToken 仍成功，需项目补齐匿名 CSRF。库返回 `{code,message}`，需转换为需求错误结构并补 Retry-After / 精确 D1 计数，不以插件 IP 限流替代。日志需脱敏，不能把库默认日志直接用于正式请求。 |
| A7 D1 CRUD | 本地通过 | `test/d1-signup.test.ts`：自定义哈希注册、待验证账号、无自动会话；`harness.test.ts`：迁移。此项不证明事务通过。 |
| B1 强制 WebAuthn UV、固定 RP ID / origin | **源码部分** | `PK/index.mjs` 注册 / 登录校验均写死 `requireUserVerification:false`，登录选项 preferred。显式 origin / rpID 可配置；afterVerification 钩子位于写凭证 / 建会话之前，可拒绝 userVerified=false，但补救钩子及真实验证器尚未运行，不能标通过。 |
| B2 challenge 用途、成员、到期、一次消费 | D1 消费本地通过；仪式源码核对 | PK 的 verification value 带 registration / authentication 与注册成员，5 分钟；先消费再核对用途 / 成员。`gaps.test.ts` 并发消费仅一次成功。只用 D1，不启用 KV secondaryStorage。可设 verification.storeIdentifier=hashed；WebAuthn 签名 / origin / RP 仪式仍待真验证器。 |
| B3 通行密钥免 TOTP、密码必需 TOTP | **源码部分 / 运行发现绕过能力** | twoFactor 仅拦截密码登录，passkey 直接建会话（需先补强 UV）。`two-factor-gaps.test.ts` 确认密码阶段创建后删除瞬时会话，且 trustDevice=true 可签发绕过后续 TOTP 的信任 Cookie。备用码登录与 OTP 路由需禁用；不能按现状宣称“密码阶段仅创建挑战”。 |
| B4 passkey counter 与 credential ID 唯一 | 源码部分 | SimpleWebAuthn 对同步密钥 0/0 放行、异常只拒绝本次，符合需求；PK schema 仅 index，需 D1 UNIQUE。正式迁移已为 credential_id 建唯一约束，未接库内部表。 |
| B5 TOTP 六位、30 秒、±1 步 | 源码符合；本地正常码通过 | twoFactor totpOptions 默认 digits=6 / period=30，utils verify 默认 window=1。正式边界仍须六位数字校验。 |
| B6 独立密钥、认证加密、AAD 绑定成员 / 用途 / 版本 | **不通过** | `BA/crypto/index.mjs` 与 twoFactor：XChaCha20-Poly1305 随机 nonce，但使用全局 Cookie Secret，无 AAD，无加解密注入点，无法接独立 TOTP_ENCRYPTION_KEY。AES-GCM 是建议，独立密钥与 AAD 是硬要求。 |
| B7 TOTP 时间步防重放 | **不通过（实测）** | 同一验证码在两个密码挑战中并发均返回 200；库不保存 lastAcceptedStep，verify 仅返回布尔值。挑战一次消费不能代替时间步防重放。 |
| B8 待验证挑战 5 分钟 / 10 次 / 一次消费 / 不重置失败数 | **部分 / 不通过** | 5 分钟可配置（POC 已设置 300）；成功后的同一挑战拒绝重放。每挑战 `beginAttempt(5)` 写死五次，与十次要求不同。实测新的密码阶段保留账号失败计数；库另有账号级十次 / 900 秒锁，不能代替“五次后 Turnstile / 15 分钟无失败解除”。已登录再验证不计挑战次数。先建后删会话见 B3。 |
| B9 十个恢复码、只存哈希、重生成撤销旧组 | **部分 / 不通过** | 实测默认 10 个、替换旧组，但可用全局 Secret 解密取回全部原码；存的是可逆密文，不是哈希。库有自定义 encrypt / decrypt 接口，预期仍是可恢复的码数组，不直接支持业务恢复码哈希表；其作用是第二因素登录，不是需求中的密码恢复。重生成仅校验密码，未强制 TOTP 再验证。 |
| B10 管理员证明绑定账号 / 会话 / 操作 / 目标 / 5 分钟 / 10 次 / 一次消费 | **不通过** | verify-totp 对已登录用户重复成功，返回 token / user；客户端 operation / target 不参与校验，没有上述证明。需独立业务挑战，与库 session 的 freshAge 不等价。 |

## 已确认采用决定与新验证任务

| 差距 | 当前处理 |
| --- | --- |
| A1/A2 默认哈希和账号规则 | 改为库默认 scrypt、密码长度/NFKC、username 规则；旧定制测试不证明这些新行为通过。 |
| A3/A5 D1 多步写入 | 接受部分认证状态，邀请码采用持久预留与业务完成门禁；密码找回仅邮箱路径，故障后重新申请/重试清理，不自建三路径原子恢复。 |
| A4 会话 | 原生 D1 token、30 天滚动/updateAge 1 天，改密可换全新会话；取消 180 天上限和仅页面续期，关闭 Cookie 缓存，即时权限仍读主库。 |
| A6 原生入口 | 保留库响应和 Origin/Fetch Metadata、持久化 IP/路径限流及 captcha；本站业务保留 CSRF、邮件/额度精确配额，包装入口不能绕过防护。 |
| B1/B3 通行密钥与二步 | 用库 afterVerification 补 UV 门禁；密码仍需 TOTP/备用码，v1 拒绝 trustDevice/OTP；接受库内部瞬时会话，不提前给客户端成员权限。 |
| B6/B7/B8 TOTP | 原生全局认证 Secret 加密、5 次挑战与账号锁；接受不同挑战可复用有效时间步的边界，不增加独立 AAD/时间步账本。 |
| B9/B10 备用码与管理 | 备用码只作第二因素，接受原生加密保存；管理员绑定 TOTP + 5 分钟新鲜会话，不再每操作签发一次性证明。 |

方案已确定，无需再次询问采用/替代。实现任务见当前 `PLAN.md` T2.7 与第三阶段；本次只同步文档，原 POC 测试和源码保持历史证据，不合入正式运行代码。

## 外部参考与后续验证

- [D1 batch 官方说明](https://developers.cloudflare.com/d1/worker-api/d1-database/)：SQL 失败回滚整批；条件写影响零行须由业务条件 / 约束让整批失败。
- [Better Auth session 官方说明](https://better-auth.com/docs/concepts/session-management)：有效期与刷新选项；本报告具体行为以锁定 1.7.7 的运行结果和发布源码为准。
- 新基线须另验 schema/日期/稳定成员 ID、原生默认密码/用户名、滚动会话、JWT/重置链接、备用码/锁定、IP 限流/captcha、注册/封禁/改邮箱门禁与故障续作。staging 验 scrypt 成本和脱敏日志，真实设备验 origin/RP/UV/counter/用途；未完成任务不标通过。
