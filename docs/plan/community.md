# 进度、收藏、片单与讨论

返回[核心计划](../../PLAN.md)。先读 [A 核心需求](../requirements.md)及 [B 详细需求](../detailed-requirements.md)，只按本次任务读取相关模块。本文是技术方案与执行记录，不新增产品规则；6.x/7.x 节号未带文件名时指 B，保留的技术章节编号用于承接旧引用。

## 范围与状态

承接 A4/A5、B 6.7/6.12/7。第五阶段自 2026-10-16 进行中，第四阶段已收尾；已有表结构、只读数据和原型展示不等于正式写入/交互完成。以下任务是既有范围的拆解，不增加新产品能力。

## 任务与验收

- [ ] T5.1 接入 15 秒/暂停/离开进度上报、expectedRevision、跨设备读取、自动/手动已看；验证 409 丢弃不重放、回看可保存更小位置、手动未看归零及重新达 90% 可完成。
  - 实现与本地自检（2026-10-16，基于 `f264f63`；播放器测试夹具增补与 B 6.7.1 新增规则经开发者确认）：`app/lib/progress.server.ts` 以单条条件 upsert 写入，首条记录要求 `expectedRevision` 为 0；播放器在可播后每 `settings.progressReportInterval` 秒、暂停、播完、页面隐藏或离开单元时上报，同一时刻只有一个请求，位置变化不足 1 秒不报，409 时采用返回的版本并视该位置为已处理，只有之后的位置变化才再上报；播放页“标记为已看 / 已看完”与作品页单集切换、电影标记沿用原型并在写入后重新加载页面数据。
  - 验证：`test/progress.test.ts` 5 项覆盖条件写入、阈值完成、回看保留已看完与较小位置、陈旧版本 409 不改数据、手动未看归零后陈旧上报被拒并可重新完成、无媒体单元手动标记、输入校验、跨站/非 JSON/游客/缓存期内撤销拒绝及成员隔离；`test/player.test.ts` 新增 3 项覆盖单请求、共享版本、409 丢弃不重放、暂停/播完/隐藏/离开上报、时长截断与起点生效前不报。`pnpm typecheck`、`pnpm test`（21 个文件 272 项）、`pnpm build` 通过。本地 6120 浏览器以虚构成员与自生成 3 分钟视频 14 项通过：15 秒内定时上报、暂停上报、另一设备从保存位置续播并显示“上次看到”、手动已看写入全片时长与未看归零、另一设备陈旧标记被拒并提示刷新、播放设备随后的陈旧上报 409 被丢弃且下一次播放上报以新版本保存并保留已看完、作品页无片源单集可标记与取消。未做 staging、手机与深色模式检查。
- [ ] T5.1 修正继续观看漏项与切集串起点，接入自然下一集提示/取消倒计时/自动播放受阻回退；每单元读取自己的起点，只有真实可播单元可返回地址。
- [ ] T5.2 接入作品收藏、有序片单、私有/站内公开与所有者写权限；验证重复添加返回同一条、不改顺序、并发重排整体成功或拒绝。
- [ ] T5.2 接入混合作品/单集队列：按顺序展开、首次去重、跳过已看、逐单元续播，全部已看留片单页，结束不跳自然下一集或循环。
- [ ] T5.3 评论/回复/赞踩/稳定排序/分页接真实后端，验证受限 Markdown、归属、长度、并发单一反馈、分对话草稿与发送中切换/失败重试。
- [ ] T5.3 管理员删除顶层对话或单条回复，验证关联赞踩一起删除、无正文/占位/孤立记录、数量分页正确、已删目标 404；封禁保留讨论，历史恢复人工重删。
- [ ] 各项通过类型检查、相关测试、构建、原型对照和桌面/手机验收，记录真实数据结果与差异，再进入运维里程碑。

## 数据与并发方案

| 对象 / 表名 | 字段与约束 |
| --- | --- |
| 观看进度 `watch_progress` | 主键 `(user_id, playable_unit_id)`；`position_seconds, completed, updated_at, revision`；`revision` 已启用（6.7.1），上报携带 `expectedRevision` 条件写入，冲突返回 `409 / REVISION_CONFLICT`。总时长来自已导入媒体，不相信客户端提交的时长；自动完成与手动“未看”的交互按 6.7.1。 |
| 收藏 `favorites` | 主键 `(user_id, work_id)`，仅收藏作品；重复添加和删除已不存在的收藏都返回同一最终状态。 |
| 片单 `playlists` / 条目 `playlist_items` | 片单记录 `id, owner_user_id, title, visibility, revision, created_at, updated_at`，`visibility` 为 `private` / `members`；条目记录稳定 `id, playlist_id, work_id?, playable_unit_id?, position`。两种目标必须且只能选一个，各自有外键；`(playlist_id, position)` 唯一，并对同一目标设**唯一约束**（`playlist_id` + 目标类型 + 目标 ID），使同一目标在一个片单内只能有一条（6.7.1.1）。公开只扩大站内读取权限，不改变所有者的写权限。 |
| 评论 `comments` / 回复 `comment_replies` | 评论记录 `id, playable_unit_id, author_user_id, body_markdown, created_at`；回复记录 `id, comment_id, author_user_id, reply_to_user_id?, body_markdown, created_at`。单元、评论和成员关联均设外键；回复通过所属评论确定单元，回复目标与所属对话一致。作者取自当前会话，正文遵循 6.12。管理员删除按 6.12.4 从当前业务数据库直接移除记录，不增加软删除标记或正文归档。顶层评论删除时一并移除其全部回复及关联赞踩；单条回复删除时移除该回复及其赞踩。不增加成员自助编辑/删除、举报或审核/恢复入口。 |
| 赞踩 `discussion_votes` | `user_id, comment_id?, reply_id?, value`；目标必须且只能选评论或回复，外键保证目标存在，`value` 仅 `1` / `-1`。分别对 `(user_id, comment_id)`、`(user_id, reply_id)` 的有效目标设唯一约束；切换反馈更新同一记录，取消则删除，不能同时留下赞和踩。 |

进度/收藏按组合主键，进度与片单以 expectedRevision 条件写入；冲突按 B 丢弃旧事件，不能取最大位置或无限重放。片单完整重排在原子批次提交，目标唯一约束与条件写入保证并发重复添加幂等。条目顺序唯一，作品及其单集是不同目标；播放时再按单元 ID 去重。

讨论直接删除，顶层级联回复与反馈、单条回复仅关联自己的反馈；外键和同一事务/批次防止孤立记录和部分删除。无软删除/删除台账或新成员删除能力。智能排序复用原型置信度/参与度规则，阅读列表保持稳定；数据与真实权限取代原型账本。

## HTTP 映射草案

| 入口与方法（草案） | 权限 | 请求 / 响应 |
| --- | --- | --- |
| `PUT /me/progress/:playableUnitId` | 正常成员，仅自己 | 经业务写入来源与 JSON 校验；接收 `expectedRevision`（非负整数）与 `positionSeconds`（自动上报，有限非负、不超过已导入媒体时长）或 `completed`（手动标记）二者之一。成功返回 `data: { positionSeconds, completed, updatedAt, revision }`；版本不符返回 `409 / REVISION_CONFLICT`，`error.revision` 为当前版本（尚无记录时为 0）。自动上报只接受有可播媒体的单元，否则 `404 / MEDIA_MISSING`；不存在的单元 `404 / NOT_FOUND`；输入无效 `400 / INVALID_INPUT`。成员 ID 只取自会话。跨设备读取由片库/播放页 loader 返回各单元的位置、状态与 `revision`，不另设 GET。 |
| `GET /me/favorites`、`PUT/DELETE /me/favorites/:workId` | 正常成员，仅自己 | 返回作品集合/最终收藏状态；不能把集 ID 当作品收藏。 |
| `GET /playlists/:id`、`POST /playlists`、`PATCH/DELETE /playlists/:id`、条目 action | 正常成员；写入仅所有者 | 读取自己的私有或任何站内公开片单；写入接收 `title, visibility, expectedRevision`，条目接收目标类型与 ID，重排接收完整有序条目 ID。返回片单、目标概要和版本，不接受修改 `ownerUserId`。他人私有片单统一 `404`。重复添加同一目标按 6.7.1.1 返回已存在条目且不改顺序。 |
| `GET/POST /units/:playableUnitId/comments`、`GET/POST /units/:playableUnitId/comments/:commentId/replies` | 正常成员，讨论限当前单元 | GET 按 6.12 的排序与分页返回正文、作者、时间、回复数量、赞数量和本人反馈，不返回踩数量；POST 接收 `bodyMarkdown, replyToUserId?`，经业务写入来源与 JSON 校验，作者由会话确定。校验单元存在、评论属于该单元、回复目标与对话一致及正文安全，成功返回新内容。已删除评论、回复及其赞踩不出现在读取结果中，也不计入数量、排序或分页；直接读取或向已删除目标回复、赞踩返回脱敏 `404`。不提供成员自助编辑/删除、举报或审核接口。 |
| `PUT/DELETE /units/:playableUnitId/comments/:commentId/vote`、`PUT/DELETE /units/:playableUnitId/replies/:replyId/vote` | 正常成员，仅修改自己的反馈 | PUT 接收 `value`（`1` / `-1`），经业务写入来源与 JSON 校验；DELETE 取消反馈。服务端校验目标归属单元，按成员/目标唯一约束写入，返回赞数量和本人最终反馈，不返回踩数量。已删除目标返回脱敏 `404`，不重新创建反馈记录。 |
| `DELETE /units/:playableUnitId/comments/:commentId`、`DELETE /units/:playableUnitId/replies/:replyId` | 正常管理员，目标属于该单元 | 经业务写入来源与 JSON 校验，按 6.12.4 原子删除：顶层评论连同全部回复及其赞踩一起移除，单条回复连同其赞踩移除；成功仅返回删除成功结果，不返回被删正文或已删除记录。目标不存在时返回脱敏 `404`。未认证、已封禁或普通成员的删除请求被拒绝，不提供成员自助删除接口。 |

## 验证计划

复用 Workers Vitest、本地 D1/R2、虚构成员与生成媒体；以请求/响应和持久化结果验收，不断言内部函数调用。测试矩阵以 B 第 7 节为准，重点覆盖并发、归属隔离、删除失败、迟到上报、片单末尾和真实设备交互。尚无本模块完整实现或验收报告，不复用原型截图冒充完成。


## 验证与记录规则

按 [AGENTS 文档同步规则](../../AGENTS.md#正式开发计划与文档同步)维护任务、证据与状态。
