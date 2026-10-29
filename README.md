# 星际舰队档案馆 (Starfleet Archive)

> 星际迷航中国（StarTrekChina）粉丝社区邀请制私人观看站，计划部署于 `video.startrekchina.org`。

专为《星际迷航》中文粉丝打造的私人观影站点。基于 Cloudflare 全栈 Serverless 架构，采用克制的“私人档案馆／线稿图纸”视觉方向，提供固定片库、流媒体播放、观看记录与成员互动。

---

## 核心特性

- **邀请制账号与安全**：邮箱验证、用户名密码、WebAuthn / Passkey、TOTP 与一次性备用码；支持会话管理、邀请额度和管理员治理。
- **片库与播放**：既定剧集与电影归档，支持中英片名搜索、首映年份时间轴、ArtPlayer 多档清晰度、简中／简英／繁中／繁英 VTT 字幕与弹幕。
- **观看记录与社区**：跨设备同步进度、续播和已看状态，支持收藏、有序片单、评论、回复与赞踩。
- **私有媒体授权**：视频和字幕存于私有 Cloudflare R2，每次请求由 Worker 按当前成员会话鉴权，媒体地址本身不含凭证。
- **桌面与移动界面**：深浅色主题、响应式布局和键盘快捷键；LCARS 色彩仅用于访客星图，不扩展到全站控件。

---

## 技术架构

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **运行时** | Cloudflare Workers | 单体 Worker 承载 SSR 与服务端逻辑 |
| **应用框架** | React Router v7 + React 19 | Framework Mode (SSR) |
| **数据库** | Cloudflare D1 | SQLite 兼容的 Serverless 关系型数据库 |
| **对象存储** | Cloudflare R2 | 私有媒体、字幕与备份对象存储 |
| **身份认证与人机验证** | Better Auth 1.7.7 + Cloudflare Turnstile | 用户名、二步验证、通行密钥与敏感入口保护 |
| **播放器** | ArtPlayer | 多档清晰度、VTT 字幕与弹幕插件 |
| **样式与组件** | Tailwind CSS v4 + Base UI | 原子样式与无障碍交互原语 |

`cloudflare.config.ts` 是环境配置的权威来源；`cf` 与 Cloudflare Vite 插件使用锁定的 beta 版本，技术约束见[工程基础规范](docs/plan/foundation.md#技术基线与限制)。

---

## 开发进度与路线图

当前处于**第六阶段（运维能力，实施中）**；工程基础及第三至第五阶段已验收，production 尚未发布。当前优先级、模块状态与阻塞见[开发总计划](PLAN.md)，成果、限制和下一步见[项目进展简报](docs/progress.md)。

---

## 快速上手

### 环境要求

- **Node.js**：`>= 22.18`（推荐 Node 24）
- **包管理器**：`pnpm 12`

### 本地开发

1. **安装依赖**
   ```bash
   pnpm install --frozen-lockfile
   ```

2. **准备本地环境配置**
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   > `.dev.vars` 只保存本地占位 Secrets，不要写入真实凭证；确保 `BETTER_AUTH_SECRET` 使用至少 32 字符的密钥。

3. **应用本地数据库迁移**
   ```bash
   pnpm db:migrate:local
   ```
   > 将 `migrations/` 下的版本化迁移应用到本地模拟 D1 数据库。

4. **启动本地开发服务器**
   ```bash
   pnpm dev
   ```
   > 默认地址为 `http://localhost:6120`，同时监听内网地址，便于局域网设备访问。

### 初始化管理员账号

本机工具用于生成首个邀请码，并将已注册、完成邮箱验证的正常成员提升为管理员：

```bash
# 生成初始邀请码（仅显示在终端）
pnpm admin:bootstrap invite --env=development --execute

# 使用生成的邀请码注册并完成邮箱验证后，提升该用户为管理员
pnpm admin:bootstrap promote <username> --env=development --execute
```

默认 development 邮件配置使用示例服务，不发送真实邮件；完整网页邮箱验证需使用已配置邮件通道的环境。

### 常用命令

| 命令 | 描述 |
| :--- | :--- |
| `pnpm dev` | 启动本地 Cloudflare 开发服务器（端口 6120） |
| `pnpm typecheck` | 生成 Workers 绑定类型与路由类型，并运行 TypeScript 类型检查 |
| `pnpm test` | 使用 Workers Vitest 在本地模拟环境中运行测试套件 |
| `pnpm test:tools` | 运行 `scripts/*.test.mjs` 的 Node 测试，不触及云端 |
| `pnpm db:migrate:local` | 将数据库迁移应用到本地开发数据库 |
| `pnpm build` | 执行 development 构建，生成产物至 `.cloudflare/output/v0` |
| `pnpm admin:bootstrap` | 生成初始邀请码或提升已完成验证的成员为管理员 |

测试媒体的生成命令与 FFmpeg 前置条件见[测试媒体准备](docs/plan/foundation.md#测试媒体准备)；测试并发、局域网访问与 SSR 预热边界见[本地认证验收边界](docs/plan/authentication.md#本地认证验收边界)。

### 媒体与资料导入

`scripts/import-media.mjs` 提供资料初始化和本机预检；媒体由站长独立上传，线上 Worker 定时验证并关联。原画及 `2160p`／`1080p` 使用 VP9 + Opus 的 WebM（Cues 前置），`720p`／`480p` 使用 H.264 + AAC 的 MP4（faststart）；每个视频只有一条音轨，最多两个声道。固定命名、预检命令和上传边界见[媒体导入与自动关联指南](docs/import-media.md)。

### 部署

正式站与预览环境是同一个 Worker，常规发布使用 Cloudflare Workers Builds：GitHub `dev` 的推送在云端执行检查、D1 迁移，并发布 `dev` 预览（`dev.video.startrekchina.org`）；只改文档或原型的推送按配置跳过，其他分支的推送不发布预览。云端切换完成前，预览仍由旧的独立 staging Worker 承担。production 尚未发布，也未启用自动部署；首次发布必须完成既定验收并取得开发者明确授权。统一构建脚本、环境隔离与 Secrets 见[运维与部署计划](docs/plan/operations.md)。

---

## 项目文档

详细规则、技术方案与运维记录收录于 [`docs/`](docs/)：

| 领域 | 阅读入口 | 内容 |
| :--- | :--- | :--- |
| **需求与规格** | [A 核心需求](docs/requirements.md)<br>[B 详细需求与规则](docs/detailed-requirements.md) | 产品范围、业务规则、默认值与验收边界 |
| **架构与方案** | [工程基础](docs/plan/foundation.md)<br>[认证与账号](docs/plan/authentication.md)<br>[片库与元数据](docs/plan/catalog.md)<br>[播放与鉴权](docs/plan/playback.md)<br>[进度与社区](docs/plan/community.md) | 各模块的技术方案、关键路径与验证摘要 |
| **部署与协作** | [运维与部署](docs/plan/operations.md)<br>[Agent 协作约定](AGENTS.md) | 环境隔离、备份恢复、发布流程与协作规则 |

---

## 许可证与版权说明

- 本项目代码遵循 [MIT License](LICENSE) 开源。
- 《星际迷航》（Star Trek）及相关剧集、电影、标识、海报与剧照版权归 Paramount Global 及其原权利人所有。
- 本站仅作为粉丝社区受邀成员内部技术与文化交流使用，不公开索引且不具商业营利性质。
