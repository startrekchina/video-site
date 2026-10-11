# 播放与媒体交付

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A3/A8、B 6.6/6.14/7，依赖认证即时门禁与片库可播资源。T4.3/T4.4 功能、HTTP、121 分钟长时和设计复验通过；真实手机未验收。下一集/进度/片单队列由 community 负责。

## 任务与验证摘要

- [x] T4.3 30 分钟播放 token、签发/续期配额、逐请求身份/环境/资源校验及 R2 流式 GET/HEAD/Range 实现，错误/缓存头及到期取消通过测试。
- [x] T4.4 迁入 ArtPlayer 5.4.0，字幕/键盘/拖动、提前续期/有限退避、保留位置/状态/字幕及手动重试通过本地和 staging 验证。
- [x] T4.4 自生成 121 分钟视频按 1 倍速自然播完，742 样本无解码错误，四次播放中续期 200，平台用量/日志核对通过；换源恢复 2.46–3.30 秒，不声称无缝。
- [x] T4.4 修复 F01/F08/F09 黑框、居中、短屏、信息/字幕/选集和字体；320/375px、桌面短屏/手机横屏与更新后 staging 解码复验通过。本轮未重跑两小时，长时结果保留为修复前功能基线。
- [ ] T4.4-mobile 收到并核对真实手机触屏拖动、中英文字幕及原生全屏反馈；与 catalog 实机输入/切季都通过后才结束第四阶段。

证据：[第四阶段](../screenshots/phase4/README.md)、[长时数据](../screenshots/phase4/staging-playback-report.json)、[设计修复](../screenshots/design-fixes-20261007/README.md)。平台 134 请求、7118.834 ms CPU、错误 0，146 条日志无已知凭证泄漏；样本不代表完整容量。保留既有 6120 服务，不重启或另起端口。

#### 6.6.1 token 载荷与撤销边界

- token 使用 HMAC-SHA-256，格式草案为 `base64url(payload).base64url(signature)`；签名覆盖带用途前缀的载荷原始字节，不重新序列化后验签。载荷包含 `v, kid, environment, purpose, userId, sessionId, playableUnitId, mediaFileId, iat, exp`，`purpose` 固定为 `playback`，`exp - iat` 不超过已定的 30 分钟。`kid` 只从服务端允许的密钥版本集合选取，不接受客户端指定算法或密钥来源。
- `environment` 和用途前缀防跨环境/跨协议重用；每个环境的签名密钥独立。载荷不包含 R2 bucket、key、URL 或明文会话 token；ID 可读，签名并不加密载荷。
- 严格限制 token 长度和解码结构，拒绝不认识的版本、错误用途、异常时间及多余的重复 query 参数；以固定长度的签名字节用常量时间校验，不用字符串 `===`。验签通过前不查 R2、不向响应泄露对象元数据。
- 成员绑定在资源入口核对请求者的服务端身份，不能用请求体/query 的成员 ID 代替；请求者未登录或 token 的成员与请求者不同均拒绝。
- **媒体与字幕共用同一个播放 token（已确认）**：视频和该单元下**所有已挂接的 VTT 字幕轨**都用同一个 token 访问，因此取消按资源分别签发专用 token 的方案，载荷不再要求 `resourceType` 区分媒体与字幕。签发时该单元只允许一个 v1 MP4，token 绑定 `playableUnitId` + `mediaFileId` + 当时的 `userId` / `sessionId` / `environment`。
- 授权边界：媒体只授权载荷指定的 `mediaFileId`；同一 `playableUnitId` 下已挂接的 VTT 字幕轨允许共用 token。替换为其他媒体文件或其他单元的字幕 ID 时拒绝，不限制同单元中英文字幕之间的切换。
- **每次 GET / HEAD / Range 都做即时鉴权**：同源请求带 Cookie，token 的 `sessionId` 对应 Better Auth 会话 ID，合并主库检查会话有效、成员注册已完成/邮箱已验证/未封禁、用户与会话匹配。不再依赖自定义 `credentialVersion`；外部播放密钥 `kid` 承担恢复后的 token 世代隔离。退出、撤销会话、邮箱密码重置、改密换会话或封禁后，下一个媒体请求拒绝。不缓存鉴权结果，复制 token 给其他成员无效。
- 一次已开始的流不会因数据库改动自动收回已发出的字节。实现必须在 token 到期时停止继续输出并取消 R2 读取，避免无 Range 的长响应越过“封禁后最多 30 分钟”的上限；到期前签发的续期不延长旧流的截止时间，新的签发/续期重新检查状态。即时鉴权只影响新请求，已开启的流最晚仍在旧 token 到期时停止，30 分钟上限不变。

#### 6.6.2 R2 与 HTTP Range 契约

鉴权先于 HEAD、Range 判断、条件响应和任何 R2 读取。Worker 使用私有 R2 binding，将资源 ID 映射到 D1 中的对象键，不重定向到 R2，也不返回可绕过 Worker 的预签名地址。

| 请求 | 外部行为 |
| --- | --- |
| `GET` 无 Range | `200 OK`，流式返回整文件，`Content-Length` 为对象总字节数，不带 `Content-Range`。到 token 截止时间取消尚未发送的流。 |
| `GET` 单个有效字节范围 | 支持 `bytes=start-end`、`bytes=start-`、`bytes=-suffix`，把原始 Range 头交给 R2 的 ranged read，不能先取全文件再切片；返回 `206`，以实际返回范围计算头和长度。end 超出尾部时截断到文件末尾。 |
| 范围无法满足 | start 超出文件、反向范围或零长度 suffix 返回 `416 Range Not Satisfiable`，`Content-Range: bytes */total`，无媒体 body；总大小仅在授权通过后可见。 |
| 非法 Range / 未支持的范围形式 | 格式不合法返回 `400`；非 bytes 单位和有效的多范围请求在 v1 忽略 Range，按无 Range 返回 `200`，不声称支持 multipart，也不拼成错误的单段 206。 |
| `HEAD` | 经过相同授权，忽略 Range，`200` 返回完整 GET 的元数据和总长度，没有 body；用 R2 `head()`，不为了 HEAD 拉取视频内容。 |
| `If-Range` | 不能直接假定 R2 支持；Worker 校验 ETag/时间条件，匹配才保留 Range，否则返回完整 `200`。v1 可不实现其他条件缓存响应；任何条件响应都不能绕过鉴权。 |
| 文件缺失 / 方法不支持 | 缺失返回脱敏 `404`，记录资源 ID 供排查；其他方法返回 `405` 及 `Allow: GET, HEAD`，不开放浏览器上传。 |

- 成功响应设 `Accept-Ranges: bytes`；206 的 `Content-Range` 为 `bytes start-end/total`，`Content-Length = end - start + 1`。R2 对象 `size` 是总大小，不当作部分 body 长度；依据返回的 `range` 核对实际范围，不仅依据请求的 end。
- MP4 使用 `video/mp4`，字幕使用 `text/vtt; charset=utf-8`；字幕接受同样的资源鉴权和 GET/HEAD 规则。只复制允许的 R2 HTTP 元数据，再覆盖安全/缓存头，不能让上传的 `cacheControl` 变成公开缓存。
- R2 `body` 以流交给响应；增加截止时间/取消处理时也不能整体 `arrayBuffer()` 或缓存进内存。媒体不压缩、不改写字节，不能让 Content-Length 与 Range 语义偏离；客户端断开时取消上游读取。
- v1 不将授权媒体响应放进共享 CDN/Cache API；query token 和 Cookie 不能成为“忽略查询参数缓存”的入口。签发结果、200、206、416 和错误均按私密缓存边界处理。日志/追踪必须剔除 query 的 `token`、恢复凭证和 R2 下载地址；按当前官方文档，默认 invocation log 会记录请求 URL，若不能脱敏则关闭该项并保留白名单应用日志，部署前验证实际日志。

## 播放器与授权接口

| 入口与方法（草案） | 权限 | 请求 / 响应 |
| --- | --- | --- |
| `POST /playback/tokens` | 正常成员 | `playableUnitId, mediaFileId, csrfToken`；检查文件确属该单元且可用，签发绑定 `playableUnitId` + `mediaFileId` + 当前成员与会话的播放 token，返回 `url, expiresAt` 和该单元字幕轨的 ID/名称/语言（字幕用同一 token 访问）。续期重复此接口重新鉴权，旧 token 不是续期凭据；续期时机与重试按 6.6.1.1。 |
| `GET/HEAD /media/:mediaFileId`、`/subtitles/:subtitleTrackId` | 有效播放 token + 当前 Cookie 会话 | query 接收 `token`；每次按 6.6.1 从 D1 主库核对原生会话、注册/邮箱/封禁状态与播放密钥版本；媒体只授权载荷中的 `mediaFileId`，字幕须属于同一单元。返回字节流或脱敏错误，资源 ID 只在服务端映射 R2，不接受客户端对象路径。 |


ArtPlayer 在浏览器懒加载，同源 MP4/VTT；切单元重建并读取目标起点，取消旧单元迟到响应。续期按 B 6.6.1.1 提前 5 分钟、5/15/30 秒最多三次，401/403 停止，到期暂停；换 URL 保留位置、暂停/播放和字幕。Token 放 query 以兼容 video 无自定义请求头，日志须剔除。

正式授权入口为 POST /playback/:id/authorize（早期 /playback/tokens 为草案），服务端验证单元和文件归属、当前会话与 CSRF；签发和续期使用同一授权逻辑。资源入口 /media/:id、/subtitles/:id，Cookie 加同一 token，不接受客户端对象路径。


## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
