# 卫戍协议 · 联机扩展

联机直接使用本仓库当前单机的游玩代码和原生界面。商店、手牌、装备拖放、部署朝向、技能、地形特效、干员档案与伤害报告均来自 `dist/native-play.js`，没有另一个联机棋盘或商店实现。网页计算战斗，Node.js 服务同步房间与公共规则。

## 运行与构建

使用 Node.js 22+（生产为 24.21.0）。在仓库根目录：

```bash
npm ci --prefix multiplayer
npm start --prefix multiplayer
```

访问 `http://服务端IP:8080/`，输入 IP/端口，创建房间后分享房间号。HOST/PORT 可以覆盖监听地址；本机 HTTP 页面能使用 WS，HTTPS 页面必须使用 WSS。

```bash
npm run build
npm run build:pages --prefix multiplayer
```

构建生成 `.pages/`，本仓库 `.github/workflows/pages.yml` 独立部署这个目录，所有任务固定 Ubuntu 24.04 LTS。**不再由博客构建或复制游戏**。独立项目地址是 `https://happyboat320.github.io/garrison-protocol/`；若账号根 Pages 已绑定 `happyboat.tech`，GitHub 会使用/跳转到 `https://happyboat.tech/garrison-protocol/`。路径是仓库名，`/ark` 不再使用。

默认联机地址 `23-238-114-57.sslip.io`、端口 `443`、WSS。静态清单记录网页规则指纹；服务端指纹不一致时拒绝入房，避免前后端玩法不一致。换自有服务域名可在构建时设置 `MULTIPLAYER_PUBLIC_URL=wss://域名/socket`。

## 如何复用单机

原 `dist/` 源码不改。`scripts/build-native-ui.mjs` 在每次构建/启动/测试时读取当前源码，自动生成以下入口（生成物不提交）：

- `client/native-play.generated.js`：原 UI 主体只调整 ESM 导入路径和冻结波次表的预览参数，再追加 `client/native-extension.js`。后者仅接管挂载会话、网络动作、存档隔离、只读视角与双画布，直接调用原 `render/action/draw/updateHud/showResult`。
- `generated/native-{session,economy,battle,waves}.js`：从同一单机源码生成，只注入三个边界接口——传入房主冻结的波次表、备战效果后等待全员就绪、战斗实例工厂。备战卫戍/盟约/策略/S.E.E.S.、鸭爵波次与追加悬赏仍由原代码执行。
- `client/session.js`：只负责独立生命、漏怪来源账本、串行联防、悬赏归属、公共 Boss 血量和联网恢复；战斗算法继承上述原生模块。
- `client/presentation.js`：传输表现状态，用原存档恢复接回原战斗对象，然后交给原绘图函数。队友对象禁止 perform/tick，快照不会参与服务端规则结算。
- `client/app.js`：只显示连接/房间、头像/表情、策略互斥与六项轮选；不实现游戏商店、部署、棋盘或战报。

后续修复单机只需修改原模块并重新构建，联机自动带入。构建检查所有注入点：上游接口改变会明确失败，需核对接线；不能无条件承诺任意未来重构无需适配。不要编辑生成文件。生成器属于联机目录，单机的原构建、入口与存档键完全独立。

## 已确认联机规则

- 2–4 人；头像上传/裁切，固定表情广播。房主点击「开始游戏」后先展示本局固定的盟约禁用与干员名单，全员确认后依次选策略且不重复。
- 游玩阶段的队友视角与表情放在可拖动悬浮框内，位置在本地保留、窗口缩小时自动限制在可见范围；表情在发送者头像旁弹出，5 秒后消失。
- 公共悬赏六项都是已准入精英，装备与战术也各六项；多名玩家依次选，不重复。
- 独立生命，归零淘汰。道中都结束后才联防；最快至多两名完美玩家先 C 后 D 接力。
- 联防敌人刷新出生状态，友方保留上一战全部状态；最终按原漏怪来源和敌人扣血值扣生命，每名每轮最多 10 点；悬赏由实际击倒者领取。
- 最终 Boss 原单机默认血量（原表 ×0.75）再乘 3/5/7，按开局 2/3/4 人固定；地图独立，共享剩余血量。
- 准备期可看队友；联防自动看当前兜底者，两名时左右展示，右边为等待/结束状态。
- 原单机难度、回合日程、商店和技能规则继续保留；开战全员准备，固定 1×，不允许独立暂停。刷新短期续接，淘汰后可观战。

## 生产服务

网站已配置[上游自动同步](../docs/UPSTREAM_AUTO_SYNC.md)：每 6 小时检查、无冲突合并，经构建和联机检查后自动发布独立 Pages。此任务不自动重启联机服务器。

生产目录 `/opt/garrison-protocol`；Node.js 24.21.0，systemd `garrison-multiplayer` 开机启动；Node 监听回环 `127.0.0.1:8080`，Caddy 提供公网 HTTPS/WSS 和自动续证。配置模板在 `deploy/`，临时公共域名解析到 `23.238.114.57`。

更新时先完成现有房间，用与 Pages 完全相同的构建复制 `dist/` 和 `multiplayer/` 到生产目录，安装依赖并运行 `npm run build:native --prefix multiplayer`，再 `systemctl restart garrison-multiplayer`。生成文件必须提前构建，服务以只读权限运行。房间暂存内存，重启会清空。

客户端计算结果，服务器验证身份/阶段/任务/去重，不重新演算伤害，适用于朋友间联机；不提供完整防篡改。

## 验证

```bash
npm test --prefix multiplayer
npx --prefix multiplayer playwright install chromium
npm run test:browser --prefix multiplayer
npm run test:pages --prefix multiplayer
```

单元测试包含原生代码复用、准备期一致性、只读视角与原联机规则。四浏览器使用原生商店两次点击确认、手牌拖放和朝向部署，测试联防分屏、刷新续接、六选与公共 Boss。战斗案例使用真实引擎和受控快进，不代表所有回合的人工长局验收。静态测试验证独立 `/garrison-protocol/` 子路径与跨服务连接。

原单机全量测试此前有 29 项失败；本次不改变原玩法代码，也不宣称原单机所有机制或 Spine 视觉已验收。当前原生相关 54 项回归中 53 项通过，S.E.E.S. 装备池的源码字符串断言失败（原测试查找 `itemAllowed(i,this)`）；该失败发生在未改动的原源码。

本次重构验证：25 项联机测试全部通过；四浏览器原生 UI 全流程（包含联防两画布等高）、独立项目子路径两人入房均通过。构建成功。
