# 第三阶段本地验收记录

2026-10-06，在正式工程 `cf dev`（`0.0.0.0:6120`）中验收。页面以 `prototypes/frontend-v1/src/pages/` 的账号、邀请、管理、登录和注册页为基准，复制经审查的展示组件后接入真实 loader 与认证接口；正式构建不引用原型目录。

Chrome 扩展弹出面板持续挡住自动操作，因此本轮使用 Codex 内置浏览器完成可操作范围。截图中的 `Orbit.QA`、邮箱及邀请关系均为本地虚构数据。注册截图使用无效的 `ui-preview-invite` 作为纯界面预览，未提交注册。截图不包含有效邀请码原文、会话 token、验证链接或二步备用码。

## 布局截图

桌面视口 1440×1000，手机视口 360×800；长页使用完整页面截图。

| 页面 | 桌面浅色 | 桌面深色 | 手机浅色 | 手机深色 |
| --- | --- | --- | --- | --- |
| 账号 | [截图](account-desktop-light.jpg) | [截图](account-desktop-dark.jpg) | [截图](account-mobile-light.jpg) | [截图](account-mobile-dark.jpg) |
| 邀请 | [截图](invites-desktop-light.jpg) | [截图](invites-desktop-dark.jpg) | [截图](invites-mobile-light.jpg) | [截图](invites-mobile-dark.jpg) |
| 管理成员 | [截图](admin-desktop-light.jpg) | [截图](admin-desktop-dark.jpg) | [截图](admin-mobile-light.jpg) | [截图](admin-mobile-dark.jpg) |
| 登录 | [截图](login-desktop-light.jpg) | [截图](login-desktop-dark.jpg) | [截图](login-mobile-light.jpg) | [截图](login-mobile-dark.jpg) |
| 注册资料 | [截图](register-account-desktop-light.jpg) | [截图](register-account-desktop-dark.jpg) | [截图](register-account-mobile-light.jpg) | [截图](register-account-mobile-dark.jpg) |

其他视图：[邀请码注册第一步（桌面）](register-invite-desktop-light.jpg)、[第一步（手机）](register-invite-mobile-light.jpg)、[密码对话框（桌面）](password-dialog-desktop-dark.jpg)、[密码对话框（手机）](password-dialog-mobile-light.jpg)、[邀请码期限（手机）](invite-expiry-mobile-light.jpg)、[全站邀请码](admin-invites-desktop-dark.jpg)、[邀请关系](admin-tree-desktop-dark.jpg)。

## 对照结果与必要适配

- 账号页沿用原型的标题、资料行、三个分区、图标行、分隔条及桌面侧栏；操作使用原型对话框。邀请页恢复双栏统计、居中生成按钮、邀请码状态行和空态；管理页恢复三栏统计、成员表格、行菜单及成员／邀请码／邀请关系三个标签页。登录与注册恢复窄列、居中卡片、表单间距和简洁页脚。
- 保留现有字体、色彩、线条、圆角和响应式 token。状态按钮用 CSS 和现有图标实现加载／完成反馈，没有新增动画依赖。对话框限制最大高度并支持内部滚动；手机表格在自身容器中横向滚动，页面没有横向溢出。
- 按当前需求保留注册邮箱、邮箱验证及本人修改邮箱；用户名 3–30 位、密码 8–128 位、邀请码默认 30 天，以需求文档为准。注册第一步只进入资料填写，邀请码有效性由最终服务端提交确认，界面不伪装为已通过验证。
- 原型的假 Turnstile 替换为官方组件；小于 300 px 的容器使用 compact 尺寸并预留高度，其余使用 normal。本机仅使用官方测试配置；测试 token 不证明实际站点的防机器人效果。
- 账号资料、密码更新时间、通行密钥、会话和备用码余量来自本人数据，不沿用假设备、假地理位置或模拟身份。TOTP 采用真实手动密钥设置，原型的假二维码未迁移；新备用码仍使用原型网格、复制、下载和保存确认。既有邀请码读取不返回原文；仅本次创建结果可以复制原文或链接。
- 管理操作遵循已确认的 TOTP 与新鲜会话要求，禁用自封禁／自降权；不保留旧管理员重置密码入口。列表不返回其他成员邮箱、凭证、邀请码摘要或会话 token。

## 已完成的验证

浏览器验证了本地既有虚构账号的正常登录／退出、账号资料、密码对话框打开／取消／Esc、邀请码生成及复制链接、期限对话框、管理三标签切换、搜索空结果／清除、邀请关系根节点，以及手机导航和浅／深色布局。注册第一步与资料步骤可以往返，切换登录后重新进入注册会清空上次状态；没有在浏览器提交新密码、注册或二步凭证。

`pnpm typecheck`、`pnpm test`（10 文件、158 项）、`pnpm test:tools`（4 项）、development／staging／production 构建及两环境 `cf deploy --prebuilt --dry-run` 通过。隔离 workerd/D1 测试覆盖认证门禁、跨站防护、邀请码并发和幂等、邮件配额、重定向拒绝、凭证路径日志抑制、原生 TOTP／备用码、会话撤销、密码故障分支、管理员保护、连带边界、搜索和分层分页；浏览器可见的普通成员管理页返回 403。

首次全量运行曾因冷启动 SSR 编译及并行密码哈希超过测试时限失败。测试并发限制为 2，SSR 预热上限为 60 秒，普通请求断言仍保留原时限；最终全量通过，不将超时误记为功能通过。

## 尚未完成

真实 WebAuthn 验证器和手机安全上下文、找回/重置/登录的客户端确认、Postal 套餐限额、staging 的认证专项 CPU／内存/并发尚未验收；验证邮件实际送达及邮箱验证、虚构凭证日志探针已通过。找回邮件 accepted、三个恢复/登录 POST 为 200，D1 已更新密码并建立修改后的会话，服务端链路通过。正常版本的 44 次请求执行错误为 0，CPU P50 12.006 ms / P99 197.124 ms，V8 isolate memory P99 29,975,306 bytes，仅代表这一批页面/接口样本。额外本地验收成员的创建命令因可能发送验证邮件被自动审批拒绝，改用隔离测试覆盖数据场景；浏览器中其他成员的管理弹窗和多层邀请关系仍需补验。上述事项保持在 PLAN 中未勾选，不能据本记录宣称第三阶段整体验收完成。

本地成果随后按站长授权部署到 staging：11 个迁移及代码/静态资源在线，访客页面、成员/管理员门禁、跨站拒绝、UV 选项与静态 noindex 通过。初次应用日志字段抽查通过后，进一步探针发现平台附带路径 token，已抑制原生重置凭证路径日志；13 条新样本中该路径事件为 0、普通表单事件为 1，全部元数据均不含唯一虚构 token。站长真实注册已完成，首次邮件及两次手动重发因 Workers 不支持 `redirect: "error"` 而在请求发出前失败；改为 `manual` 后匿名探针正常返回，修复已部署、临时诊断入口已移除，随后手动重发实际收到邮件并完成验证，D1 状态已核对。远程触发器解析和 cf strict 的处置见 README 及 PLAN。production 未上线、Git 未推送。本地服务保持运行，启动命令为 `pnpm dev`；已有 6120 实例时直接复用。
