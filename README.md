# 星际舰队档案馆 (Starfleet Archive)

> 星际迷航中国（StarTrekChina）粉丝社区邀请制私人观看站，计划部署于 `video.startrekchina.org`。

专为《星际迷航》中文粉丝打造的私人观影站点。基于 Cloudflare 全栈无服务器（Serverless）架构构建，融合经典 LCARS 视觉交互美学，提供高画质、多字幕的流媒体播放及社区账号体系。

---

## 核心特性

- 🛸 **LCARS 视觉风格与响应式交互**
  - 经典 LCARS 界面美学，自适应桌面端、平板与移动设备
  - 沉浸式星图大屏、时间刻度标尺与暗色影院模式
  - 支持深色、浅色模式与快捷键操控（全站快捷命令面板 `⌘K` / `Ctrl+K`）

- 🔐 **完备的账号与安全认证体系**
  - **邀请制入舰**：单次有效邀请码、邀请关系链追踪与配额控制
  - **现代认证标准**：支持 WebAuthn / Passkey 通行密钥免密登录、基于时间戳的双因素认证（TOTP）及一次性备用码
  - **严密的数据隐私**：零第三方追踪、密码高强度加盐哈希（scrypt）、敏感操作二次验证与多端会话管理

- 🎬 **影视资料归档与流畅播放**
  - 剧集与电影按上映年份及编年时间轴完整归档，支持季集浏览与中英片名检索
  - 基于 ArtPlayer 的定制流媒体播放器，支持多音轨与中英双语 VTT 字幕自由切换
  - 跨设备自动保存与同步观看进度，支持从断点无缝续播（规划中）

- 🛡️ **云原生边缘架构与私有存储**
  - 纯 Serverless 边缘架构，全球低延迟访问
  - 媒体资源存储于私有 Cloudflare R2，使用自研短期 HMAC-SHA256 签名鉴权保护片源地址
  - 业务与认证数据存储于自建 Cloudflare D1 边缘关系型数据库

- ⚙️ **管理员控制台**
  - 成员状态管理（封禁、解封、管理员权限变更）
  - 邀请码批量签发、作废及多层级邀请树状图追踪

---

## 技术架构

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **运行时与边缘计算** | Cloudflare Workers | Edge Serverless 全球边缘计算运行时 |
| **应用与全栈框架** | React Router v7 | Framework Mode (SSR) + React 19 |
| **数据库** | Cloudflare D1 | 边缘分布式 SQLite 关系型数据库 |
| **对象存储** | Cloudflare R2 | S3 兼容的私有对象存储，零出口流量费 |
| **身份认证** | Better Auth 1.7.7 | 支持 username / 2FA / Passkey / Captcha 等插件 |
| **安全与风控** | Cloudflare Turnstile | 隐式智能人机验证，保护敏感交互 |
| **播放器** | ArtPlayer | 定制化流媒体播放核心，支持多字幕与快捷键 |
| **样式与组件** | Tailwind CSS v4 + Base UI | 现代化原子样式与无障碍交互原语 |

---

## 开发进度与路线图

项目采用阶段式里程碑推进，当前处于**第四阶段收尾**阶段：

| 阶段 | 核心目标 | 当前状态 |
| :--- | :--- | :---: |
| **第一阶段：工程基础与全栈运行时** | Cloudflare Workers + React Router v7 + D1 架构搭建，确立 LCARS 视觉规范与设计基线 | ✅ 已完成 |
| **第二阶段：邀请机制与关系链模型** | 邀请码生成、额度流转、层级追踪与违规连带治理模型 | ✅ 已完成 |
| **第三阶段：安全认证与管理控制台** | 成员注册登录、通行密钥（Passkey）、TOTP 双因素认证、设备会话管理与管理员治理后台 | ✅ 已完成 |
| **第四阶段：片库归档与流媒体播放** | 影视编年资料库、本地媒体自动关联、ArtPlayer 播放器、双语 VTT 字幕与 HMAC 私网流媒体鉴权 | 🟡 收尾中 (当前) |
| **第五阶段：观影记录与社区互动** | 云端跨设备播放进度同步与继续观看、个人收藏、自定义片单与单集讨论互动 | ⏳ 规划中 |
| **第六阶段：灾备恢复与生产正式发布** | 站长自动化加密冷备份、异地容灾恢复演练与 Production 正式发布 | ⏳ 规划中 |

> 📌 详细的实施细节、技术决策与进展简报，请参阅 [开发总计划 (PLAN.md)](PLAN.md) 与 [项目进展简报 (docs/progress.md)](docs/progress.md)。

staging 的 Workers Builds 已监听 GitHub `dev`，推送后在云端完成测试、构建、D1 迁移和发布；`cf` strict 限制下使用 Wrangler 补充上传，其配置从已验证产物生成。实际自动发布、Secrets/资源绑定保留和入口烟测通过；[专项复验](docs/staging-revalidation-20261014.md#并行修复的同条件复测)确认 D1 优化、核心安全/日志，以及签发 HEAD 并行修复约 24%–26% 的同条件中位耗时收益。历史尾延迟与真实手机仍未验收；该修复经 PR #26 进入 `dev` 并随 staging 自动发布，诊断版本已删除。production 未启用自动发布；配置、清理边界及状态见[运维计划](docs/plan/operations.md)。

---

## 快速上手

### 环境要求

- **Node.js**：`>= 22.18`（推荐 Node 24）
- **包管理器**：`pnpm >= 12`

### 本地开发

1. **安装依赖**
   ```bash
   pnpm install --frozen-lockfile
   ```

2. **准备本地环境配置**
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   > 提示：`.dev.vars` 包含本地开发所需的占位 Secrets，请确保 `BETTER_AUTH_SECRET` 填写了至少 32 字符的密钥。

3. **应用本地数据库迁移**
   ```bash
   pnpm db:migrate:local
   ```
   > 将 `migrations/` 下的版本化迁移应用到本地模拟 D1 数据库中。

4. **启动本地开发服务器**
   ```bash
   pnpm dev
   ```
   > 服务默认启动并监听在 `http://localhost:6120`。

### 初始化管理员账号

在本地开发环境中，可通过专用脚本生成初始邀请码并提升管理员权限：

```bash
# 生成初始邀请码（显示在终端控制台）
pnpm admin:bootstrap invite --env=development --execute

# 使用生成的邀请码在网页中完成注册并验证邮箱后，提升该用户为管理员：
pnpm admin:bootstrap promote <username> --env=development --execute
```

### 常用命令

| 命令 | 描述 |
| :--- | :--- |
| `pnpm dev` | 启动本地 Cloudflare 开发服务器（默认端口 6120） |
| `pnpm typecheck` | 生成 Cloudflare Workers 绑定类型与路由类型，并运行 TypeScript 类型检查 |
| `pnpm test` | 使用 Workers Vitest 在本地模拟环境中运行测试套件 |
| `pnpm test:tools` | 运行本机工具与播放续期的 Node 测试，不触及云端 |
| `pnpm db:migrate:local` | 将数据库迁移应用到本地开发数据库 |
| `pnpm build` | 执行开发构建，生成产物至 `.cloudflare/output/v0` |
| `pnpm admin:bootstrap` | 管理员初始化工具（初始邀请码签发与首管提权） |

测试视频的生成命令、ffmpeg 前置条件和输出位置见[测试媒体准备](docs/plan/foundation.md#测试媒体准备)；测试并发与 SSR 预热边界见[本地认证验收边界](docs/plan/authentication.md#本地认证验收边界)。远程数据库迁移命令及兼容处理见[运维说明](docs/plan/operations.md#695-远程数据库迁移与运维工程细节)。

---

## 项目文档

详细的工程设计、架构规范、演进计划及运维指南均收录于 [`docs/`](docs/) 目录中：

| 领域 | 推荐阅读 | 说明 |
| :--- | :--- | :--- |
| **需求与规格** | [A 核心需求](docs/requirements.md)<br>[B 详细需求与规则](docs/detailed-requirements.md) | 产品目标、功能范围、业务规则、默认值与边界条件 |
| **计划与进展** | [核心开发计划](PLAN.md)<br>[项目进展简报](docs/progress.md) | 阶段划分、当前里程碑、关键依赖与实施进展 |
| **架构与方案** | [工程基础规范](docs/plan/foundation.md)<br>[认证与账号方案](docs/plan/authentication.md)<br>[片库与元数据方案](docs/plan/catalog.md)<br>[播放与鉴权方案](docs/plan/playback.md) | 技术基线、数据流转、安全模型与性能指标 |
| **媒体与片库** | [媒体导入与自动关联指南](docs/import-media.md) | 影视资料初始化、本地媒体预检、固定命名规范及定时同步 |
| **部署与运维** | [运维与部署计划](docs/plan/operations.md)<br>[Agent 协作约定](AGENTS.md) | 多环境配置（Local / Staging / Production）、备份恢复及发布规范 |

---

## 许可证与版权说明

- 本项目代码遵循 [MIT License](LICENSE) 开源。
- 《星际迷航》（Star Trek）及相关剧集、电影、标识、海报与剧照版权归 Paramount Global 及其原权利人所有。
- 本站仅作为粉丝社区受邀成员内部技术与文化交流使用，不公开索引且不具商业营利性质。
