# 单集列表剧照

来自 [TMDB](https://www.themoviedb.org/) 各剧集的季页面。通过 Kimi WebBridge 在浏览器中读取公开的单集卡片，以 TMDB ID、季号和集号匹配已有目录，不使用或保存 API Key。

- `manifest.json` 是素材索引，每集记录本地文件名、TMDB 图片地址和来源页面；缺图时 `file` 和 `sourceUrl` 为 `null`。
- 文件名为 `{剧集短码}-s{两位季号}e{两位集号}.webp`，例如 `tng-s03e26.webp`。
- TMDB 的 `w300` 图片作为压缩输入，避免季页面的 `face` 裁切版本丢失原始构图。
- 输出为 240×135、有损 WebP、质量 55、压缩等级 6。等比缩放后填黑边；4:3 画面不拉伸、不裁切。
- 原图和中间来源索引只在被 Git 忽略的 `assets-raw/episode-stills/` 中保存。
- 仅用于非播放页面的单集列表，不是播放器时间轴预览图。

## 重建

在 `prototypes/frontend-v1/` 中运行，需安装 Node.js、`curl.exe`、带 `libwebp` 的 FFmpeg，并连接 Kimi WebBridge 浏览器扩展。开始采集前，在 `WEBBRIDGE_SESSION` 指定的同一个任务会话中打开任一 TMDB 页面。

```bash
node scripts/fetch-episode-stills.mjs --all
node scripts/fetch-episode-stills.mjs --collect
node scripts/fetch-episode-stills.mjs --compress
```

`--collect` 读取季页面并写本地来源缓存；`--compress` 从缓存下载、压缩并写入素材索引；`--all` 完成两步。默认桥接地址为 `http://127.0.0.1:10086`，可通过 `WEBBRIDGE_URL` 覆盖。重复采集会复用已完整匹配的季缓存；需要刷新来源时，先移走本地 `sources.json`，并对照新结果确认素材变化。

版权归对应权利人所有。本目录延续海报素材的原型展示用途，不表示已取得再分发许可。
