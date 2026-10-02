# 独立 GitHub Pages 与联机服务发布

更新：2026-10-02。本仓库为 [Happyboat320/garrison-protocol](https://github.com/Happyboat320/garrison-protocol)，单机上游为 [Yilegendoflink/garrison-protocol](https://github.com/Yilegendoflink/garrison-protocol)。
当前网站：[happyboat.tech/garrison-protocol/](https://happyboat.tech/garrison-protocol/)。博客不再检出或复制本项目，旧 `/ark/` 已删除。

## 静态网页发布

- 推送 `main` 或手动运行 `.github/workflows/pages.yml`，构建并发布本仓库独立 Pages。没有路径过滤，文档提交也触发。
- 固定 Ubuntu 24.04 LTS、Node.js 24；先 `npm run build`，再 `node multiplayer/scripts/build-pages.mjs`。
- 发布产物是 `.pages/`，含入口页、原单机 `dist/`、联机页面/共享模块/生成适配模块及本地表情 PNG。
- 普通 Pages 工作流只构建和部署，不运行自动测试或 `release:check`；修改代码前需自行完成相应检查。
- `github-pages` 环境部署，仅部署任务有 `pages:write` 与 `id-token:write`；串行发布，不中断正在进行的部署。
- `.pages/deployment.json` 记录实际检出的 `sourceCommit`、`deployedAt`、`testsRun=false` 和 `runUrl`；线上可直接访问 `/garrison-protocol/deployment.json` 核对版本。
- 项目路径使用仓库名 `/garrison-protocol/`；根站点绑定域名时沿用该域名。CNAME 是域名，不能设置 URL 路径。

手动构建静态产物：

```bash
npm run build
npm run build:pages --prefix multiplayer
```

换联机端域名时，构建可设置 `MULTIPLAYER_PUBLIC_URL=wss://你的域名/socket`；默认使用 `wss://23-238-114-57.sslip.io/socket`。
表情已随仓库保存，构建不请求 BWIKI。

## 自动同步上游

`.github/workflows/sync-upstream.yml` 每 6 小时检查上游 `main`，也可手动运行。
无新提交时跳过；无冲突合并后执行构建、联机单元测试、浏览器流程与 Pages 子路径检查，全通过才普通推送。
随后直接调用可复用 Pages 工作流并检出候选提交完整 SHA，避免 `GITHUB_TOKEN` 推送不触发普通 push 工作流的问题。
冲突或检查失败不更新网站；完整行为及权限要求见 [上游自动更新](docs/UPSTREAM_AUTO_SYNC.md)。

`testsRun=false` 只表示 Pages 发布任务自身不运行测试；同步流程的检查结果应看同步任务日志，不能据此认定没有验证。
若合并推送已成功、随后 Pages 失败，需单独重跑 Pages；再跑同步会判断提交已合并而跳过。

## 联机服务单独更新

Pages 是静态文件托管，不运行 Node.js。联机服务在 VPS `/opt/garrison-protocol`，由 systemd `garrison-multiplayer` 启动，Caddy 提供 HTTPS/WSS。
当前上限为 10 房、56 连接。网页自动同步不自动更新或重启 VPS。

网页 `multiplayer/version.json` 的 `rulesHash` 必须与联机服务 `/health` 一致；不一致时客户端拒绝入房。
生产更新应等待房间结束，使用相同源码与构建产物，提前生成适配模块，清理已删除的旧模块，再重启服务。
房间在内存中，重启会清空；仅改 CSS 不改变规则指纹，仅改服务器资源限制也无需改客户端协议。

架构与快速启动见 [联机 README](multiplayer/README.md)，完整安装和维护步骤见 [服务端部署](docs/MULTIPLAYER_SERVER_DEPLOYMENT.md)，启动参数与安全边界见 [服务端说明](docs/MULTIPLAYER_SERVER_SECURITY.md)。

## 排障与历史

先查看对应 Actions 日志，再核对线上 `deployment.json`；构建成功或提交存在不等于部署成功。
Pages 来源需选择 GitHub Actions；fork 定时任务若被禁用需单独启用。普通发布不需要额外 PAT 或仓库 Secret。

2026-09-13 上游曾用 `gh-pages` 静态分支发布，2026-09-14 改为 Actions；旧研究副本不再需要同步。
2026-10-02 曾尝试通过博客 `/ark` 复制游戏，现已取消，独立发布以本文和本仓库工作流为准。
