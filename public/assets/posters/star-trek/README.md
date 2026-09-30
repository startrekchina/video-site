# 星际迷航官方海报素材库(TMDB)

后续剧集/电影导入真实海报时使用的图片素材。来源:[The Movie Database (TMDB)](https://www.themoviedb.org),
抓取自各条目的官方海报图库,选片规则:**无字(textless)优先,其次分辨率最高**,均为英文/无语言版本,
原图为 TMDB `original` 尺寸 JPG。

## 目录结构

- `public/assets/posters/star-trek/`(本目录,提交到 git):WebP 压缩版,质量 80,保留原分辨率,79 张约 30 MB,前端高保真原型直接引用此目录
- `assets-raw/posters/star-trek/`(仓库根目录,仅本地保留,不入 git):JPG 原图,79 张约 63 MB,生产环境导入 R2 时使用
- 两处文件同名,仅扩展名不同(原型用 `.webp`,原图 `.jpg`);`manifest.json` 中 `file` 字段记录的是原图 `.jpg` 文件名
- 原图丢失时可按 `manifest.json` 中 `image` 字段的 TMDB 地址重新抓取

## 文件命名

```
{类型}-{年份}-{英文名 slug}[-s{季号}].jpg
```

- 类型:`movie` / `series`
- 季号:`s01` 起,表示该季的专属海报;无季号为整部主海报
- 示例:`movie-1982-star-trek-ii-the-wrath-of-khan.jpg`、`series-1987-star-trek-the-next-generation-s03.jpg`

## 内容

- 电影 14 部(1979–2025,含《31区》)
- 剧集 13 部(1966–2026,含动画版、短途、下层舰员、神童等)
- 季度海报 52 张(各剧每季一张)
- 合计 79 张,约 62 MB;另有 `manifest.json` 逐张记录标题(中/英)、年份、TMDB ID、原图地址

## 选片说明

- `manifest.json` 中 `text_free` 标记该图是否无片名/标题文字(51 张无字)。
- 深空九号主海报及其多数季度海报在 TMDB 上无无字版本,保留官方含标题版本(`note` 字段有标注)。
- 《星际旅行7:斗转星移》无字版仅 736x1104,为 TMDB 可得的最高无字版本。
- 海报版权归原发行方所有,素材仅供本项目内部导入使用。
