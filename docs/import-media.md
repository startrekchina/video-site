# 资料占位与 R2 自动关联

站长先初始化 manifest 范围的全部作品、季和集，再独立把媒体上传到本环境 R2。服务器默认每 5 分钟验证并关联完整对象。网站没有媒体上传或内容管理页面，TMDB key 只存在站长本机。

**实现状态**：本文的原画 VP9 与向下编码规则是已确认的目标规格。代码基线 `6ecce6b` 尚不接受无后缀原画；本地另有未提交的 H.264 主档草稿，也不符合目标规格，不在本次交付中。迁移集不包含 `0022` 媒体清理，不再通过该脚本删除原画记录。完成实现与验证前，不能用现有预检或扫描判断 VP9 主档是否可导入，文档交付不代表媒体功能已完成。范围见[播放计划 QT1](plan/playback.md#qt1-原生主档与固定编码档位)。

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
library/series/800002/S02/E03.480p.mp4
library/series/800002/S02/E03.zh-CN.main.vtt
library/series/800002/S02/E03.zh-TW.bilingual.vtt
library/series/800002/S02/E03.zh-CN.main.alt.vtt
library/movie/800001/movie.mp4
library/movie/800001/movie.480p.mp4
library/movie/800001/movie.zh-CN.bilingual.vtt
```

季/集号至少两位，无多余前导零。字幕语言只能是 `zh-CN`（简体）或 `zh-TW`（繁体），轨道为 `main`（中文）或 `bilingual`（中英双语），同类多条时加后缀（如 `main.alt`）。D1 字幕标识为 `language.trackKey`（如 `zh-TW.bilingual`），因此简繁同名轨道不冲突。显示名由轨道标识推出：`zh-CN.main` 简中、`zh-CN.bilingual` 简英、`zh-TW.main` 繁中、`zh-TW.bilingual` 繁英；附加轨道在括号里只加后缀，如 `zh-CN.main.alt` 显示“简中（alt）”，播放页排在同类主轨之后。其他语言（含 `en`、`zh`、`zh-HK`、小写 `zh-cn`）和轨道名（如 `zh-CN.alternate`）都算命名错误。范围外、没有占位或命名错误的对象跳过并计入 `unknown`；不猜片名。已关联记录的对象键不再符合命名时，下一次完整扫描像对待已删除对象一样清除其已验证版本，R2 对象保留。站长的上传工具负责 multipart 和断点恢复，扫描只读取已完成对象，不提供上传替代命令。

Worker 的 staging / production 配置声明 `*/5 * * * *` Cron，通过当前环境 R2 binding 扫描。默认每页 1000 项，每次最多验证 20 个新/变更对象、6 分钟窗口；D1 保存最后处理对象键及互斥租约。已发布且 ETag/长度未变的对象跳过完整校验。失败对象在下一轮完整扫描重试，后续对象可以继续处理。

MP4 须为 faststart，只有一条视频轨和一条 AAC 音轨。服务器有界读取元数据（最多 32 MiB），核对 box 边界、编码、时长和码率，再流式计算整个文件长度及 SHA-256；不把大视频整体读入内存。VTT 最大 5 MiB，验证 UTF-8、头、cue 时间、设置、安全标签和实体，拒绝 STYLE/REGION。验证前后复核对象版本；期间变化不发布。

目标扫描规则：每个单元必须有无后缀的 `E03.mp4` 或 `movie.mp4` 主档，编码为 VP9 profile 0（8 位 4:2:0）；同目录可按已确认制作组合另放档位文件。可选 `2160p`、`1080p` 须为 VP9 profile 0（8 位 4:2:0），`720p`、`480p` 须为 H.264 的 Baseline/Main/Extended/High（8 位 4:2:0）；编码不符计入 `failed`。只有已验证主档决定可播状态与单元的 `duration_seconds`，可选档位不能代替主档。无已验证主档时档位不读取、不挂接，记 `media_sync_variant_unattached`，`reason` 为 `ORIGINAL_MISSING`；档位与主档时长差超过 1 秒时同样不挂接，`reason` 为 `DURATION_MISMATCH`。档位键名排在主档之前，因此全新单元通常先关联主档，再在下一轮挂接档位；某个可选档位失败不影响主档和其他档位。

关联 MP4 时，实际时长和媒体记录在同一 D1 批次提交。失败保留完整 R2 对象供重试。缺失或已验证版本被覆盖时，播放入口返回脱敏 404；不会把未验证的新字节当成已验证片源。扫描不删除对象。

用同一名称重新上传即替换。下一轮扫描发现版本变化后，先撤下该记录的已验证版本，再按首次关联的规则完整验证新文件：通过则在原记录上更新校验和、长度、版本、时长和码率，主档同时更新单元时长；记录 ID、播放地址及成员的进度、讨论和弹幕不变。字节完全相同的重传只更新版本，计入 `skipped`。新文件未通过验证时计入 `failed`，该档位从清晰度选项、字幕从字幕菜单中消失，主档未验证时单元显示片源暂缺，直到重新上传合格文件；被覆盖的旧文件不会恢复，需从站长自己的冷备找回。

替换主档后，时长与它相差超过 1 秒的档位不再出现在清晰度选项中，需要同名重新上传时长相符的档位。主档与档位一起重传时，档位先与旧主档时长比较，可能先记 `DURATION_MISMATCH`，主档验证后在下一轮挂接相符的档位。

扫描日志以 `media_sync_completed` 汇总数量，每次替换另记 `media_sync_replaced`：包含 `unitId`、资源类型 `resourceType`（video/subtitle）、作品类型 `kind`、作品 `tmdbId`、季号 `season`、集号 `episode`、字幕 `language` 和复合轨道标识 `trackKey`，档位另带 `variant`。电影的季集号、视频的字幕字段为 null；简繁同名轨道可分别定位。记录不含存储对象键、路径、校验和或凭证。

## 迁移 0022 与现有媒体

当前迁移集不包含 `0022_quality_tier_codecs.sql`，不以数据库迁移删除原画或其他媒体记录，也不新增清理迁移替代它。该脚本只做数据清理、不改变表结构，移除它不需要结构补偿或编号重排。项目迁移脚本按目录中的实际 SQL 文件提交给 CLI，未执行的环境不会再执行该脚本。

已经执行过的环境保留数据库迁移历史，不删除或伪造已应用记录；移除源文件不撤销已发生的数据删除。迁移执行状态尚未查询，不能据此宣称现有记录已恢复。目标 VP9 主档规则仍须在预检、扫描和播放实现中对齐；移除清理脚本本身不等于现有 H.264 主档符合目标规格。

已执行旧删除版本的环境，若原画数据库行已删除而 R2 文件仍在，目标恢复路径是在主档重编码为合规 VP9 后，由对齐后的扫描完整验证并重建关联；主档缺失时从自己的冷备取源制作。新建媒体行不保证恢复旧媒体 ID 或 `/media/<id>` 地址，单元 ID、进度、讨论和弹幕保留，刷新页面取得新地址。必须保留旧媒体 ID 时需要从迁移前备份核对恢复，不能由文件推断。实际恢复与云端写入另行授权。

## 压制规格

片源由站长在本机或远程服务器离线压制，项目不做转码。所有视频均重新编码以减少 R2 占用，主档不使用 `-c:v copy`。主档保持所提供片源的原始分辨率、帧率（有去隔行或胶转磁需要时另按片源处理）与画面比例，不保留源码率，不作无意义放大；可选档位只从同一源文件直接向下生成，不从其他有损档位再次转压。原画是相对于所提供片源尺寸的标签，不表示无损或原生拍摄画质。原生分辨率、无同尺寸重复档位及只向下制作由站长准备片源时负责，数据库不保存来源分辨率，扫描不核验制作过程。全部文件用 MP4 封装并加 `-movflags +faststart`：

| 档位 | 视频 | 说明 |
| --- | --- | --- |
| 原生主档 `original` | VP9 profile 0，`-pix_fmt yuv420p` | 文件名无档位后缀；不论源分辨率多少均用 VP9 |
| `2160p`、`1080p` | VP9 profile 0，`-pix_fmt yuv420p` | 仅为可用档位身份，不据此推导未确认的制作组合 |
| `720p`、`480p` | H.264 High 或更低，`-pix_fmt yuv420p` | 兼容所有目标浏览器 |

音频统一为一条 AAC 轨，声道按片源保留：单声道 96 kbps、立体声 160 kbps、5.1 声道 384 kbps；7.1 片源用 `-ac 6` 混缩为 5.1、384 kbps。片源有多条音轨时只保留要播放的一条，字幕另按上文命名为 VTT。同一单元各档位须来自同一剪辑版本，时长相差不超过 1 秒。

### 制作组合与片源检查

制作组合以 [B 6.6](detailed-requirements.md#66-播放与媒体分发)的表格为准。960p 只制作原画与 480p；1080p 制作原画、720p、480p，不另做同分辨率的 `.1080p.mp4`。其他源分辨率的组合待确认，不能根据后缀白名单自动生成全部较低档位。

例如 `1420×1080`、方形像素的片源：主档保留 `1420×1080` 并重新编码为 VP9，另从源文件生成保持画面比例的 720p、480p AVC 文件；不拉伸到 `1920×1080`，也不强制改成 4:3。已有 AI 放大或调色的片源，其原画标签仅指当前提供的源尺寸。

制作前检查扫描方式、帧率、像素与显示宽高比、音轨语言及分集。默认不裁边、降噪、锐化、补帧或烧字幕，不仅凭老片身份就去隔行或逆胶转磁。多音轨不能盲选默认轨；例如第一条为德语、第二条为英语时，英语原声须明确选择第二条音轨。合集先核对单元边界及字幕时间轴，不能复制同一合集冒充多集，也不能按总时长对半切分。

### 压制参数与并发

已知压制服务器为 AMD EPYC 9634 的 20 个虚拟核心，常态可用内存约 40 GB。单文件编码无法充分利用全部核心，两个文件并行且每个任务多线程的方式已有站长实测。批量制作采用两个编码任务并行的组织方式，不把两集的所有清晰度同时展开成多个额外任务。

以下仅为待样片验证的候选值，不是已确认的质量或体积标准：

| 输出 | 编码器 | 候选参数 |
| --- | --- | --- |
| 原画 VP9 | `libvpx-vp9` | `CRF 32`、`b:v 0`、`deadline good`、`cpu-used 2`、`row-mt 1` |
| 720p AVC | `libx264` | `preset slow`、`CRF 22` |
| 480p AVC | `libx264` | `preset slow`、`CRF 23` |

每任务 8 个编码线程是试跑起点，不是定稿；VP9 分块数按输出尺寸试压，不一律开到最大。编码线程数不等于 FFmpeg 整个进程的 CPU 硬上限，解码及滤镜还可能使用其他线程。以相同质量要求下的总吞吐和内存峰值决定线程配置，不以 CPU 占用必须达到 100% 为目标。

先取代表性片段比较人物、暗部、运动及特效，再用完整一集核对音画与字幕同步、实际体积和编码耗时，确认参数后批量处理。CRF 不保证固定码率或文件大小，不同编码器的 CRF 不能直接比较；当前不规定未经样片验证的固定视频码率，也不增加数据库 CRF 或 preset 字段。

原画同样为 VP9，不能解码 VP9 的设备只能手动选择已提供且可解码的低清档；不能把原画当作 AVC 兼容回退。播放器不自动降档，目标设备兼容性仍须实测。

## 可选本机媒体预检

转换 ASS 字幕时本机需要 PATH 上的 FFmpeg。将映射放在被忽略的目录：

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
    "videos": {"original": "./episode.mp4", "720p": "./episode.720p.mp4", "480p": "./episode.480p.mp4"},
    "subtitles": [{"language": "zh-CN", "trackKey": "main", "sourcePath": "./subtitle.ass"}]
  }]
}
```

```powershell
node scripts/import-media.mjs preflight --environment staging --mapping .cloudflare/import/mapping.json
```

媒体路径相对映射文件；`videos` 必须有 `original`，可选其他档位键；电影没有季集号，没有字幕时使用空数组。检查 manifest 的类型/季集身份、JPG→存在的 WebP 映射，每个档位用与服务器扫描相同的 MP4 检查核对编码与档位、时长、码率和 faststart，各可选档位与主档时长相差不超过 1 秒，并流式计算校验和。ASS 转 VTT 只生成内存字节并警告样式丢失；站长须自行保存合格 VTT 后上传。报告移除本机路径和配置，`cloudWrites` 恒为 0。旧 `import` 上传命令退出码为 2，不执行写入。

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
