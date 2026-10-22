# 隔离备份恢复工具

仅供获授权的本机运维使用，不是站点网页功能。它只能向不同于源库 ID 的空 D1 导入，不切换线上绑定，不自动重新开放服务。

配置、命令、阶段请求、失败处理和验收边界统一见[运维计划的隔离恢复工具](../../docs/plan/operations.md#隔离恢复工具)。先在仓库根安装依赖，再运行 `pnpm --dir tools/backup-restore install --frozen-lockfile`；进入该目录执行 `pnpm build`。`.env.example` 只含虚构资源标识，构建/dry-run 不表示已获准部署。

真实资源映射写本目录 `.env`，Secrets/本机 Token 文件使用被忽略的 `.dev.vars*`，请求及敏感结果放 `.cloudflare/`，均不得提交。明文 SQL 只在 Cloudflare 内的私有暂存与 D1 import 流程中处理。
