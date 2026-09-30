# video-site

星际迷航中国（StarTrekChina）粉丝社区的邀请制私人观看站，计划部署在 `video.startrekchina.org`。

## 当前状态

需求已确认，正在探索前端高保真原型。仓库里暂时还没有可以运行的应用代码。

## 文档

- [需求文档](docs/requirements.md)：v1 的范围、用户故事、实现决策和测试决策。
- [协作约定](AGENTS.md)：语言、Git 流程、目录结构和安全规则。
- [海报素材说明](public/assets/posters/star-trek/README.md)：海报来源和命名规则。

## 技术栈（计划）

- 运行时：Cloudflare Workers
- 框架：React Router v7（框架模式）
- 数据库：Cloudflare D1
- 媒体存储：Cloudflare R2（私有）
- 播放器：ArtPlayer

本地开发和部署步骤会在工具链确定后补充。

## 许可证

[MIT](LICENSE)。海报等第三方素材的版权归原权利人所有，不适用本许可证。
