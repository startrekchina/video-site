# 离线导入预检

T4.1 的本地预检工具在 802b 从已提交的 `896156b` 基点重新实现。当前只能检查输入、生成内存中的 VTT 和读取 TMDB 资料；**完整导入尚未实现**，`import` 子命令退出码为 2，不执行云端写入。

项目锁定的 `cf` 1.0.0-beta.12 在 `r2 objects put --help` 中声明单对象最大 300 MB；其命令注册表没有 multipart 创建、分片、列举、完成和中止能力。需求 6.8.1 要求大文件断点恢复，AGENTS 要求统一使用 cf，因此上传、校验远端对象、D1 原子挂接及幂等故障恢复均保持阻塞。没有部署上传 Worker，也没有切换到 S3 API 或 Wrangler。

## 启动

依赖项目所要求的 Node 和 PATH 中的 FFmpeg（含 `ffprobe`）。在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
node scripts/import-media.mjs --help
node scripts/import-media.mjs preflight --environment staging --mapping .cloudflare/import/mapping.json
```

目标必须显式为 `staging` 或 `prod`，并与映射中的环境一致。默认只读取当前工作树的 `.env`，同名 shell 变量优先；指定 `--env-file <文件>` 时只使用该文件内变量，避免混入 shell 中其他环境的资源。必需变量为 `TMDB_API_KEY` 和目标环境的 `STAGING_D1_DATABASE_ID` / `STAGING_MEDIA_BUCKET_NAME` 或 `PRODUCTION_D1_DATABASE_ID` / `PRODUCTION_MEDIA_BUCKET_NAME`。若另一环境已有配置，资源不得共用。真实配置放在忽略目录，不写入公开仓库。

## 本机映射

映射文件建议放在被忽略的 `.cloudflare/import/`。下例全部是占位资料；`tmdbId` 必须替换为仓库 manifest 中的实际数字身份，资源必须匹配本机所选环境。

```json
{
  "environment": "staging",
  "resources": {
    "d1DatabaseId": "00000000-0000-4000-8000-000000000001",
    "mediaBucketName": "fictional-staging-media"
  },
  "media": [
    {
      "kind": "series",
      "tmdbId": 800002,
      "seasonNumber": 2,
      "episodeNumber": 3,
      "videoPath": "./episode.mp4",
      "subtitles": [
        {
          "language": "zh-CN",
          "displayName": "简体中文",
          "trackKey": "zh-main",
          "sourcePath": "./subtitle.ass"
        }
      ]
    }
  ]
}
```

媒体路径相对于映射文件。电影使用 `kind: "movie"`，没有季号、集号；没有字幕时 `subtitles: []`。同一单元只能指定一个视频，轨道使用唯一的稳定 `trackKey`，语言限中文或英文。空 `media` 数组可只预检 manifest 资料。映射不能包含 API key 或其他未声明字段，不靠文件名猜身份。

## 已实现的检查

- manifest 以 TMDB 类型、作品 ID、季号确认范围，季必须有所属作品；`.jpg` 原图名映射到存在于静态素材目录的 WebP 海报，不上传海报。
- MP4 使用 ffprobe 核对容器、H.264/AAC、时长和码率，独立解析顶层 box 验证完整边界与 `moov` 在 `mdat` 前；流式计算长度和 SHA-256，检查预检期间文件是否变化。不合格文件报告文件名及原因，要求先转码。
- VTT 验证 UTF-8、头、cue 时间、设置、受限安全标签与实体；目前拒绝 STYLE/REGION。ASS 由本机 FFmpeg 转 VTT，明确警告字体、定位等样式丢失，转后同样验证。转换字节只在内存中，不保存或发布 ASS。
- TMDB 英文详情和对应 translations 接口分别读取，中文只使用 `zh-CN` 原始翻译；中文不存在时保留 null，展示可回退英文。作品、季与集的身份及翻译身份交叉核对。网络错误、429、5xx 最多重试两次，失败不产生可写入资料；不输出 key、上游正文或原始错误。[官方电影翻译接口](https://developer.themoviedb.org/reference/movie-translations)、[季翻译接口](https://developer.themoviedb.org/reference/tv-season-translations)、[集翻译接口](https://developer.themoviedb.org/reference/tv-episode-translations)是资料来源。

标准错误输出目标环境和失败说明；标准输出为 JSON 预检报告，包含公开逻辑 ID、双语资料、媒体属性、字幕校验和及警告，`status` 固定为 `preflight-only`、`cloudWrites` 与 `imported` 固定为 0。不输出本机路径、D1 ID、桶名或 key。该报告不是导入完成凭证。

## 验证边界

```powershell
pnpm test:tools
pnpm test
pnpm typecheck
pnpm build
```

工具测试使用临时虚构 manifest、自生成 H.264/AAC 片段和回环模拟 TMDB，不复制剧集或真实凭证。覆盖两次预检与实际 CLI、环境隔离、显式 env 文件优先、ASS 转换、非法 MP4/VTT、身份冲突、失败与限流重试及报告脱敏。测试需要 FFmpeg。

`--tmdb-mock-url http://127.0.0.1:<port>/3/` 只允许无凭证的回环 HTTP 服务，发送固定假 key，不向模拟服务发送本机 TMDB key；结果标记 `simulatedTmdb: true`。模拟结果不能证明真实 TMDB 或云端导入通过。上传中断、R2/D1 状态恢复、并发引用及完整对象保留尚未实现/验收，T4.1 整体保持未完成。
