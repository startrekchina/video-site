# 资料占位与 R2 自动关联

站长先初始化 manifest 范围的全部作品、季和集，再独立把媒体上传到本环境 R2。服务器默认每 5 分钟验证并关联完整对象。网站没有媒体上传或内容管理页面，TMDB key 只存在站长本机。

## 资料初始化

项目要求 Node 22.18 或更新版本。配置目标资源与 `TMDB_API_KEY` 到本工作树被 Git 忽略的 `.env`，然后执行：

```powershell
node scripts/import-media.mjs catalog --environment staging
node scripts/import-media.mjs catalog --environment staging --execute
```

第一条只读取 TMDB 并报告数量，第二条先获取并验证完整资料，再通过项目 cf CLI 对 D1 执行一个原子批次。重复执行更新双语资料，保留已有作品/季/单元 ID、媒体实际时长、进度及讨论。TMDB 没有时长时保存 null；没有媒体的占位不获得播放授权。

执行写入前，目标数据库须已应用 `0012_catalog_placeholders.sql` 或后续迁移；按 README 的目标环境迁移命令操作，不能把本地迁移完成视为云端已迁移。

目标必须显式为 `staging` 或 `prod`。必需配置为目标环境的 `STAGING_D1_DATABASE_ID` / `STAGING_MEDIA_BUCKET_NAME` 或 `PRODUCTION_D1_DATABASE_ID` / `PRODUCTION_MEDIA_BUCKET_NAME`，执行时还须具备该环境构建配置和 cf 登录。缺配置、身份歧义、另一环境资源共用、TMDB 失败都会停止；不能默认写 prod。

默认读取当前工作树 `.env`，同名 shell 变量优先；`--env-file <文件>` 仅使用该文件的配置。真实配置不进入公开仓库。需要网络代理时，在进程环境中设置 `HTTPS_PROXY` / `NO_PROXY`，并用 `node --use-env-proxy ...` 启动支持该选项的 Node；工具不更改系统代理。

资料来源为英文详情和对应 translations 接口，中文只读取 `zh-CN` 原始翻译；缺失保留 null，由页面回退英文。作品、季、集、父子身份及翻译身份分别校验；429/5xx/网络错误最多重试两次。标准输出只报告目标环境、状态和数量，不输出 key、资源标识或上游正文。[TMDB 电影翻译](https://developer.themoviedb.org/reference/movie-translations)、[季翻译](https://developer.themoviedb.org/reference/tv-season-translations)、[集翻译](https://developer.themoviedb.org/reference/tv-episode-translations)是资料来源。

## 固定命名与扫描

下例为虚构身份，展示逻辑命名格式，不是真实桶地址：

```text
library/series/800002/S02/E03.mp4
library/series/800002/S02/E03.zh-CN.main.vtt
library/series/800002/S02/E03.en.main.vtt
library/movie/800001/movie.mp4
library/movie/800001/movie.zh.main.vtt
```

季/集号至少两位，无多余前导零；语言为 zh/en 及可选地区，轨道标识稳定。D1 字幕标识为 `language.trackKey`，因此不同语言的 main 不冲突。范围外、没有占位或命名错误的对象跳过；不猜片名。站长的上传工具负责 multipart 和断点恢复，扫描只读取已完成对象，不提供上传替代命令。

Worker 的 staging / production 配置声明 `*/5 * * * *` Cron，通过当前环境 R2 binding 扫描。默认每页 1000 项，每次最多验证 20 个新/变更对象、6 分钟窗口；D1 保存最后处理对象键及互斥租约。已发布且 ETag/长度未变的对象跳过完整校验。失败或冲突对象在下一轮完整扫描重试，后续对象可以继续处理。

MP4 须为 faststart、单 H.264 视频轨与 AAC 音轨。服务器有界读取元数据（最多 32 MiB），核对 box 边界、时长和码率，再流式计算整个文件长度及 SHA-256；不把大视频整体读入内存。VTT 最大 5 MiB，验证 UTF-8、头、cue 时间、设置、安全标签和实体，拒绝 STYLE/REGION。验证前后复核对象版本；期间变化不发布。

关联 MP4 时，实际时长和媒体记录在同一 D1 批次提交。失败保留完整 R2 对象供重试；相同单元/轨道却不同校验和报冲突，不覆盖旧引用。缺失或已验证版本被替换时，播放入口返回脱敏 404；不会把新字节当成已验证片源。扫描没有删除或自动替换能力。

## 可选本机媒体预检

本机需要 PATH 上的 FFmpeg（含 ffprobe）。将映射放在被忽略的目录：

```json
{
  "environment": "staging",
  "resources": {
    "d1DatabaseId": "00000000-0000-4000-8000-000000000001",
    "mediaBucketName": "fictional-staging-media"
  },
  "media": [{
    "kind": "series", "tmdbId": 800002,
    "seasonNumber": 2, "episodeNumber": 3,
    "videoPath": "./episode.mp4",
    "subtitles": [{"language": "zh-CN", "displayName": "简体中文", "trackKey": "main", "sourcePath": "./subtitle.ass"}]
  }]
}
```

```powershell
node scripts/import-media.mjs preflight --environment staging --mapping .cloudflare/import/mapping.json
```

媒体路径相对映射文件；电影没有季集号，没有字幕时使用空数组。检查 manifest 的类型/季集身份、JPG→存在的 WebP 映射、ffprobe 编码/时长/码率、faststart 和流式校验和。ASS 转 VTT 只生成内存字节并警告样式丢失；站长须自行保存合格 VTT 后上传。报告移除本机路径和配置，`cloudWrites` 恒为 0。旧 `import` 上传命令退出码为 2，不执行写入。

本机保存转换结果可用 `ffmpeg -i subtitle.ass subtitle.zh.main.vtt`，再用 VTT 路径重新预检；字体、定位等 ASS 样式不会保留。

## 验证与当前边界

```powershell
pnpm test:tools
pnpm test
pnpm typecheck
pnpm build:staging
```

测试使用虚构资料、自生成视频和回环模拟 TMDB。真实 TMDB 预检已取得 27 部作品、52 季、974 个单元；本地 scheduled 已关联 121 分钟生成视频，重复扫描没有重复引用。原子 upsert/回滚、依赖保留、格式/版本变化、失败重试、互斥、分页和失败文件后继续扫描均有检查。

`--tmdb-mock-url http://127.0.0.1:<port>/3/` 仅限回环无凭证 HTTP，使用固定假 key，禁止搭配 `--execute`；模拟结果不作为云端验收。staging 构建/dry-run 通过；站长授权本次 T4 官方 API 部署例外后，0012、完整资料占位和 5 分钟 Cron 已配置，实际扫描、非法字幕修复后的自动重试、第二次完整初始化的 ID/引用/实际时长保留均已通过。staging 121 分钟自然播放及平台用量/日志已验证，仅真实手机反馈待完成，详见 [第四阶段记录](screenshots/phase4/README.md)。
