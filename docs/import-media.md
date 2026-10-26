# 资料占位与 R2 自动关联

站长先初始化 manifest 范围的全部作品、季和集，再独立把媒体上传到本环境 R2。服务器默认每 5 分钟验证并关联完整对象。网站没有媒体上传或内容管理页面，TMDB key 只存在站长本机。

## 资料初始化

项目要求 Node 22.18 或更新版本。配置目标资源与 `TMDB_API_KEY` 到本工作树被 Git 忽略的 `.env`，然后执行：

```powershell
node scripts/import-media.mjs catalog --environment staging
node scripts/import-media.mjs catalog --environment staging --execute
```

第一条只读取 TMDB 并报告数量，第二条先获取并验证完整资料，再通过项目 cf CLI 对 D1 执行一个原子批次。重复执行用 TMDB 当前数据更新双语资料、年份和单集首播日期，保留已有作品/季/单元 ID、媒体实际时长、进度及讨论。TMDB 没有时长或首播日期时保存 null，首播日期不是 `YYYY-MM-DD` 时整次停止、不写入；没有媒体的占位不获得播放授权。

执行写入前，目标数据库须已应用到 `0017_episode_air_dates.sql`（写入首播日期列）或更后的迁移，否则整批原子失败；按[运维说明](plan/operations.md#695-远程数据库迁移与运维工程细节)中的目标环境迁移命令操作，不能把本地迁移完成视为云端已迁移。

目标必须显式为 `staging` 或 `prod`。必需配置为目标环境的 `STAGING_D1_DATABASE_ID` / `STAGING_MEDIA_BUCKET_NAME` 或 `PRODUCTION_D1_DATABASE_ID` / `PRODUCTION_MEDIA_BUCKET_NAME`，执行时还须具备该环境构建配置和 cf 登录。缺配置、身份歧义、另一环境资源共用、TMDB 失败都会停止；不能默认写 prod。

默认读取当前工作树 `.env`，同名 shell 变量优先；`--env-file <文件>` 仅使用该文件的配置。真实配置不进入公开仓库。需要网络代理时，在进程环境中设置 `HTTPS_PROXY` / `NO_PROXY`，并用 `node --use-env-proxy ...` 启动支持该选项的 Node；工具不更改系统代理。

资料来源为英文详情和对应 translations 接口，中文只读取 `zh-CN` 原始翻译；缺失保留 null，由页面回退英文。单集首播日期取该集英文详情的 `air_date`，原样保存为文本。作品、季、集、父子身份及翻译身份分别校验；429/5xx/网络错误最多重试两次。标准输出只报告目标环境、状态和数量，不输出 key、资源标识或上游正文。[TMDB 电影翻译](https://developer.themoviedb.org/reference/movie-translations)、[季翻译](https://developer.themoviedb.org/reference/tv-season-translations)、[集翻译](https://developer.themoviedb.org/reference/tv-episode-translations)是资料来源。

## 固定命名与扫描

下例为虚构身份，展示逻辑命名格式，不是真实桶地址：

```text
library/series/800002/S02/E03.mp4
library/series/800002/S02/E03.720p.mp4
library/series/800002/S02/E03.zh-CN.main.vtt
library/series/800002/S02/E03.zh-TW.bilingual.vtt
library/series/800002/S02/E03.zh-CN.main.alt.vtt
library/movie/800001/movie.mp4
library/movie/800001/movie.zh-CN.bilingual.vtt
```

季/集号至少两位，无多余前导零。字幕语言只能是 `zh-CN`（简体）或 `zh-TW`（繁体），轨道为 `main`（中文）或 `bilingual`（中英双语），同类多条时加后缀（如 `main.alt`）。D1 字幕标识为 `language.trackKey`（如 `zh-TW.bilingual`），因此简繁同名轨道不冲突。显示名由轨道标识推出：`zh-CN.main` 简中、`zh-CN.bilingual` 简英、`zh-TW.main` 繁中、`zh-TW.bilingual` 繁英；附加轨道在括号里只加后缀，如 `zh-CN.main.alt` 显示“简中（alt）”，播放页排在同类主轨之后。其他语言（含 `en`、`zh`、`zh-HK`、小写 `zh-cn`）和轨道名（如 `zh-CN.alternate`）都算命名错误。范围外、没有占位或命名错误的对象跳过并计入 `unknown`；不猜片名。已关联记录的对象键不再符合命名时，下一次完整扫描像对待已删除对象一样清除其已验证版本，R2 对象保留。站长的上传工具负责 multipart 和断点恢复，扫描只读取已完成对象，不提供上传替代命令。

Worker 的 staging / production 配置声明 `*/5 * * * *` Cron，通过当前环境 R2 binding 扫描。默认每页 1000 项，每次最多验证 20 个新/变更对象、6 分钟窗口；D1 保存最后处理对象键及互斥租约。已发布且 ETag/长度未变的对象跳过完整校验。失败对象在下一轮完整扫描重试，后续对象可以继续处理。

MP4 须为 faststart、单 H.264 视频轨与 AAC 音轨。服务器有界读取元数据（最多 32 MiB），核对 box 边界、时长和码率，再流式计算整个文件长度及 SHA-256；不把大视频整体读入内存。VTT 最大 5 MiB，验证 UTF-8、头、cue 时间、设置、安全标签和实体，拒绝 STYLE/REGION。验证前后复核对象版本；期间变化不发布。

清晰度档位与原画同目录同主文件名，后缀只能是 `.2160p`、`.1080p`、`.720p`、`.480p`（如 `E03.720p.mp4`），校验与原画相同。档位只挂到已有原画记录的单元，且时长与原画相差不超过 1 秒；不满足时不读取或不挂接，记 `media_sync_variant_unattached`，`reason` 为 `ORIGINAL_MISSING` 或 `DURATION_MISMATCH`。对象按键名排序时档位排在原画之前，因此新上传一集时档位在下一轮扫描挂接。单元的可播状态与 `duration_seconds` 只由原画决定；某个档位失败不影响原画和其他档位。

关联 MP4 时，实际时长和媒体记录在同一 D1 批次提交。失败保留完整 R2 对象供重试。缺失或已验证版本被覆盖时，播放入口返回脱敏 404；不会把未验证的新字节当成已验证片源。扫描不删除对象。

用同一名称重新上传即替换。下一轮扫描发现版本变化后，先撤下该记录的已验证版本，再按首次关联的规则完整验证新文件：通过则在原记录上更新校验和、长度、版本、时长和码率，原画同时更新单元时长；记录 ID、播放地址及成员的进度、讨论和弹幕不变。字节完全相同的重传只更新版本，计入 `skipped`。新文件未通过验证时计入 `failed`，原画所在单元显示片源暂缺，档位从清晰度选项、字幕从字幕菜单中消失，直到重新上传合格文件；被覆盖的旧文件不会恢复，需从站长自己的冷备找回。

替换原画后，时长与新原画相差超过 1 秒的已有档位不再出现在清晰度选项中，需要同名重新上传时长相符的档位。原画和档位一起重传时，因档位排在原画之前，第一轮扫描会拿档位与旧原画时长比较，记一条预期中的 `DURATION_MISMATCH`，下一轮才挂上档位。

扫描日志以 `media_sync_completed` 汇总数量，每次替换另记 `media_sync_replaced`：包含 `unitId`、资源类型 `resourceType`（video/subtitle）、作品类型 `kind`、作品 `tmdbId`、季号 `season`、集号 `episode`、字幕 `language` 和复合轨道标识 `trackKey`，档位另带 `variant`。电影的季集号、视频的字幕字段为 null；简繁同名轨道可分别定位。记录不含存储对象键、路径、校验和或凭证。

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
    "subtitles": [{"language": "zh-CN", "trackKey": "main", "sourcePath": "./subtitle.ass"}]
  }]
}
```

```powershell
node scripts/import-media.mjs preflight --environment staging --mapping .cloudflare/import/mapping.json
```

媒体路径相对映射文件；电影没有季集号，没有字幕时使用空数组。检查 manifest 的类型/季集身份、JPG→存在的 WebP 映射、ffprobe 编码/时长/码率、faststart 和流式校验和。ASS 转 VTT 只生成内存字节并警告样式丢失；站长须自行保存合格 VTT 后上传。报告移除本机路径和配置，`cloudWrites` 恒为 0。旧 `import` 上传命令退出码为 2，不执行写入。

字幕项只含 `language`、`trackKey`、`sourcePath`，取值规则与上文扫描命名相同；显示名由轨道标识推出，带 `displayName` 等其他字段报“格式错误或含未支持字段”。语言或轨道不合规时在任何 TMDB 请求之前报错，退出码为 1。每个单元的字幕按 `language.trackKey` 去重：`zh-CN/main` 与 `zh-TW/main` 可并存，同语言不同轨道（如 `main` 与 `main.alt`）可并存，同语言同轨道重复时拒绝预检。

本机保存转换结果可用 `ffmpeg -i subtitle.ass subtitle.zh-CN.main.vtt`，再用 VTT 路径重新预检；字体、定位等 ASS 样式不会保留。

## 验证与当前边界

```powershell
pnpm test:tools
pnpm test
pnpm typecheck
pnpm build:staging
```

测试使用虚构资料、自生成视频和回环模拟 TMDB。真实 TMDB 预检已取得 27 部作品、52 季、974 个单元；本地 scheduled 已关联 121 分钟生成视频，重复扫描没有重复引用。原子 upsert/回滚、依赖保留、格式/版本变化、失败重试、互斥、分页和失败文件后继续扫描均有检查。

`--tmdb-mock-url http://127.0.0.1:<port>/3/` 仅限回环无凭证 HTTP，使用固定假 key，禁止搭配 `--execute`；模拟结果不作为云端验收。staging 构建/dry-run 通过；站长授权本次 T4 官方 API 部署例外后，0012、完整资料占位和 5 分钟 Cron 已配置，实际扫描、非法字幕修复后的自动重试、第二次完整初始化的 ID/引用/实际时长保留均已通过。staging 121 分钟自然播放及平台用量/日志已验证，审查中的 12 项设计偏离已修复并复验，本阶段真实手机反馈仍待完成，详见 [第四阶段记录](https://github.com/startrekchina/video-site/blob/803be06/docs/screenshots/phase4/README.md)。
