# 卫戍协议 · 联机扩展

联机直接使用本仓库当前单机的游玩代码和原生界面。商店、手牌、装备拖放、部署朝向、技能、地形特效、干员档案与伤害报告均来自 `dist/native-play.js`，没有另一个联机棋盘或商店实现。网页计算战斗，Node.js 服务同步房间与公共规则。

## 运行与构建

使用 Node.js 22+（生产为 24.21.0）。在仓库根目录：

```bash
npm ci --prefix multiplayer
npm run build
npm start --prefix multiplayer -- --max-rooms 10 --max-connections 56
```

默认最多 10 个房间。可用 `npm start --prefix multiplayer -- --max-rooms 10 --max-connections 56` 或 `MAX_ROOMS=10` 配置容量；消息频率、流量参数与架构/防护说明见[服务端安全文档](../docs/MULTIPLAYER_SERVER_SECURITY.md)。

访问 `http://服务端IP:8080/`，输入 IP/端口，创建房间后分享房间号。HOST/PORT 可以覆盖监听地址；本机 HTTP 页面能使用 WS，HTTPS 页面必须使用 WSS。

```bash
npm run build
npm run build:pages --prefix multiplayer
```

构建生成 `.pages/`，本仓库 `.github/workflows/pages.yml` 独立部署这个目录，所有任务固定 Ubuntu 24.04 LTS。**不再由博客构建或复制游戏**。独立项目地址是 `https://happyboat320.github.io/garrison-protocol/`；当前账号根 Pages 已绑定 `happyboat.tech`，线上地址为 `https://happyboat.tech/garrison-protocol/`。路径是仓库名，`/ark` 不再使用。

默认联机地址 `23-238-114-57.sslip.io`、端口 `443`、WSS。静态清单记录网页规则指纹；服务端指纹不一致时拒绝入房，避免前后端玩法不一致。换自有服务域名可在构建时设置 `MULTIPLAYER_PUBLIC_URL=wss://域名/socket`。

## 如何复用单机

原 `dist/` 源码不改。`scripts/build-native-ui.mjs` 在每次构建/启动/测试时读取当前源码，自动生成以下入口（生成物不提交）：

- `client/native-play.generated.js`：原 UI 主体只调整 ESM 导入路径和冻结波次表的预览参数，再追加 `client/native-extension.js`。后者仅接管挂载会话、网络动作、存档隔离、只读视角与双画布，直接调用原 `render/action/draw/updateHud/showResult`。
- `generated/native-{session,economy,battle,waves}.js`：从同一单机源码生成，只注入三个边界接口——传入房主冻结的波次表、备战效果后等待全员就绪、战斗实例工厂。备战卫戍/盟约/策略/S.E.E.S.、鸭爵波次与追加悬赏仍由原代码执行。
- `client/session.js`：只负责独立生命、漏怪来源账本、串行联防、悬赏归属、公共 Boss 血量和联网恢复；战斗算法继承上述原生模块。
- `client/presentation.js`：传输表现状态，用原存档恢复接回原战斗对象，然后交给原绘图函数。队友对象禁止 perform/tick，快照不会参与服务端规则结算。
- `client/app.js`：只显示连接/房间、本局禁用预览、头像/表情、策略互斥与六项轮选；不实现游戏商店、部署、棋盘或战报。

后续修复单机只需修改原模块并重新构建，联机自动带入。构建检查所有注入点：上游接口改变会明确失败，需核对接线；不能无条件承诺任意未来重构无需适配。不要编辑生成文件。生成器属于联机目录，单机的原构建、入口与存档键完全独立。

## 已确认联机规则

- 2–4 人；头像上传/裁切，固定表情广播。房主点击「开始游戏」后先展示本局固定的盟约禁用与干员名单，全员确认后依次选策略且不重复。
- 游玩阶段的队友视角与表情放在可拖动悬浮框内，位置在本地保留、窗口缩小时自动限制在可见范围；表情在发送者头像旁弹出，5 秒后消失。表情使用 [BWIKI 游戏表情一览](https://wiki.biligame.com/arknights/游戏表情一览) 的分类图片，默认打开盟约下半。悬浮框宽 300px，表情按钮 48×48px、每行 5 个，网格最高 154px，超出滚动。
- 公共悬赏六项都是已准入精英，装备与战术也各六项；多名玩家依次选，不重复。
- 独立生命，归零淘汰。道中都结束后才联防；最快至多两名完美玩家先 C 后 D 接力。
- 联防敌人刷新出生状态，友方保留上一战全部状态；最终按原漏怪来源和敌人扣血值扣生命，每名每轮最多 10 点；悬赏由实际击倒者领取。
- 最终 Boss 原单机默认血量（原表 ×0.75）再乘 3/5/7，按开局 2/3/4 人固定；地图独立，共享剩余血量。
- 准备期可看队友；联防自动看当前兜底者，两名时左右展示，右边为等待/结束状态。
- 原单机难度、回合日程、商店和技能规则继续保留；开战全员准备，固定 1×，不允许独立暂停。刷新短期续接，淘汰后可观战。

表情图片由维护脚本 `python3 multiplayer/scripts/import-wiki-emotes.py` 手动导入到 `client/emotes/`，来源 URL、文件名与页面 revision 保留在 `shared/emotes.js`。当前 revision 337086：7 类可用、57 张图片；去除重复历史预览，保留其中不重复的旧表情。`duel` 分类在来源页无图片，不添加虚构素材。图片随静态站点发布，运行及 CI 构建不请求 BWIKI；网络只传固定表情 ID，服务端拒绝外部 URL。素材版权归原权利人。

## 服务端部署（Ubuntu 24.04 LTS）

以下命令用于新服务器，需有 sudo 权限。已有服务器部署在 `/opt/garrison-protocol`，Node.js 24.21.0，服务名 `garrison-multiplayer`；已有机器直接看下方更新步骤。房间与恢复点均在内存中，重启会清空。

生产链路为 `浏览器 → WSS :443 → Caddy → 127.0.0.1:8080 Node.js`。客户端战斗计算在浏览器，Node 负责房间、同步、轮选与跨玩家结算；GitHub Pages 只提供静态网页。

### 1. 安装环境

安装 Git、curl、证书和 rsync：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates rsync
```

安装 Node.js 24。下面以 Linux x86_64 为例，ARM64 服务器把 `linux-x64` 换成 `linux-arm64`。从 [Node.js 官方发布目录](https://nodejs.org/dist/) 下载，并核对官方 SHA256 清单：

```bash
mkdir -p /tmp/garrison-node-install
cd /tmp/garrison-node-install
curl -fLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
curl -fLO https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
awk '$2 == "node-v24.21.0-linux-x64.tar.xz"' SHASUMS256.txt | sha256sum -c -
sudo tar -xJf node-v24.21.0-linux-x64.tar.xz -C /opt
export PATH=/opt/node-v24.21.0-linux-x64/bin:$PATH
node --version
npm --version
```

`export PATH` 只对当前 shell 生效，后续维护时需再次设置。systemd 使用 Node 的绝对路径，不依赖登录 shell；更换 Node 版本或架构时同步调整服务配置。

### 2. 拉取与构建

初次安装用 HTTPS 克隆公开仓库，无需把个人 GitHub SSH 私钥放进游戏服务目录：

```bash
sudo git clone https://github.com/Happyboat320/garrison-protocol.git /opt/garrison-protocol
sudo chown -R "$(id -un):$(id -gn)" /opt/garrison-protocol
cd /opt/garrison-protocol
npm ci --prefix multiplayer --omit=dev
npm run build
npm run build:native --prefix multiplayer
```

维护账号负责构建文件；运行服务使用 systemd 的 DynamicUser。生成模块必须提前写好，因为运行时文件系统只读。`npm ci --omit=dev` 只安装运行依赖，不含浏览器测试工具；需要测试时按下方「验证」安装完整依赖。

首次可以前台启动，确认构建正常，再按 Ctrl+C 停止：

```bash
HOST=127.0.0.1 PORT=8080 npm start --prefix multiplayer -- --max-rooms 10 --max-connections 56
```

在服务器另一个终端执行 `curl -fsS http://127.0.0.1:8080/health`，应返回 `ok: true` 与 `rulesHash`。这里监听本机，远程浏览器暂时无法直接访问；局域网临时测试可改 `HOST=0.0.0.0` 并从 HTTP 网页使用 WS，公网正式部署继续使用回环监听与 Caddy。

### 3. 设置 systemd 自动启动与资源限制

复制模板，检查 Node 绝对路径与项目目录符合本机安装：

```bash
cd /opt/garrison-protocol
sudo install -m 644 multiplayer/deploy/garrison-multiplayer.service /etc/systemd/system/garrison-multiplayer.service
sudo systemd-analyze verify /etc/systemd/system/garrison-multiplayer.service
sudo systemctl daemon-reload
sudo systemctl enable --now garrison-multiplayer
sudo systemctl status garrison-multiplayer --no-pager
sudo journalctl -u garrison-multiplayer -n 30 --no-pager
```

模板设置最多 **10 房、56 连接**，Node 监听 `127.0.0.1:8080`，崩溃自动重启。使用 DynamicUser、NoNewPrivileges、PrivateTmp 与只读文件系统，内存软限 512 MiB、硬限 768 MiB，TasksMax=64、文件描述符上限 4096。内存硬限可能导致进程退出和房间丢失。

| 启动参数 | 环境变量 | 默认值 |
| --- | --- | --- |
| `--max-rooms` | `MAX_ROOMS` | 10 |
| `--max-connections` | `MAX_CONNECTIONS` | 房间上限 × 4 + 16 |
| `--max-messages-per-second` | `MAX_MESSAGES_PER_SECOND` | 100 |
| `--max-bytes-per-second` | `MAX_BYTES_PER_SECOND` | 8388608（8 MiB） |

参数必须为正整数，CLI 优先于环境变量。房间满只拒绝新建，已有房间仍可加入和重连；结束/断线保留的房间也占名额。单条消息最多 2 MiB，未完成入房的连接 10 秒超时。

调整生产参数推荐用 `sudo systemctl edit garrison-multiplayer` 创建覆盖配置，例如：

```ini
[Service]
ExecStart=
ExecStart=/opt/node-v24.21.0-linux-x64/bin/node multiplayer/server/index.js --max-rooms 10 --max-connections 56 --max-messages-per-second 100 --max-bytes-per-second 8388608
```

保存后执行 `sudo systemctl daemon-reload` 和 `sudo systemctl restart garrison-multiplayer`；重启前确认房间已结束。覆盖 ExecStart 时必须先清空旧值；模板已带 CLI 限制，仅新增 MAX_ROOMS 环境变量不会覆盖现有 CLI。

### 4. 域名与 Caddy HTTPS/WSS

准备一个域名，例如 `game.example.com`，添加指向 VPS 公网 IP 的 A 记录；有 IPv6 才添加对应 AAAA。公网 DNS 解析应正确，云安全组需允许 TCP 80/443，SSH 按管理需要放行；Node 的 8080 不需要对公网开放。

当前服务器使用 `23-238-114-57.sslip.io`，由 sslip.io 将域名中的 IP 解析到本机。部署到另一台服务器时必须换成自己的域名或对应 IP 的 sslip.io 地址。域名不隐藏 IP，也不提供抗 DDoS。

通过 [Caddy 官方 Debian/Ubuntu 软件源](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) 安装；已有 Caddy 的服务器跳过安装：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

安装后在 `/etc/caddy/Caddyfile` 添加以下站点，保留机器上其它已有站点配置：

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
curl -fsS https://game.example.com/health
```

Caddy 自动申请/续期证书并转发 WebSocket。首次申请失败查看 `sudo journalctl -u caddy -n 50 --no-pager`，核对 DNS 和 80/443 的可达性。不要直接覆盖已有 Caddyfile 或更改全局防火墙造成其它站点/SSH 中断。

### 5. 配置静态网页连接地址

联机端可直接访问 `https://game.example.com/`，也可让 GitHub Pages 提供网页。Pages 构建使用 `MULTIPLAYER_PUBLIC_URL` 指定默认 WSS 地址：

```bash
cd /opt/garrison-protocol
MULTIPLAYER_PUBLIC_URL=wss://game.example.com/socket npm run build:pages --prefix multiplayer
```

此命令只生成 `.pages/`，不直接发布。若使用本仓库 GitHub Pages，在 `.github/workflows/pages.yml` 的「组装单机与联机入口」步骤设置同名环境变量，再推送并等待 Actions 成功。默认配置连接当前生产 sslip.io 地址；不需要改域名时保留默认值。

站点部署与域名路径说明见 [PUBLISHING.md](../PUBLISHING.md)。HTTPS 网页必须使用 WSS；在连接表单中输入 `game.example.com`、端口 `443`，勾选加密连接，创建房间后把房间号发给队友。

### 6. 验证部署与排障

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS https://game.example.com/health
curl -fsS https://happyboat.tech/garrison-protocol/multiplayer/version.json
sudo systemctl is-active garrison-multiplayer caddy
sudo journalctl -u garrison-multiplayer -n 30 --no-pager
sudo ss -ltnp
```

若使用自建静态网站，第三条命令替换成自己网站的 `multiplayer/version.json` 地址。网页 `rulesHash` 必须与目标服务 `/health` 一致；再用两个浏览器创建/加入同一房间，确认禁用预览、策略轮选与原生准备界面能进入。

| 现象 | 检查方式 |
| --- | --- |
| Caddy 返回 502 | 检查 Node 服务状态、本机 `/health` 与反代端口 |
| HTTPS 或证书失败 | 检查 A/AAAA 解析、TCP 80/443、Caddy 日志 |
| 网页提示规则版本不同 | 使用与 Pages 相同提交与构建产物更新 VPS，核对 `rulesHash`；清理被删除的遗留 JS |
| 服务启动失败 / EROFS | 检查 Node 路径、目录读取权限、构建生成文件；不要关闭只读防护来掩盖漏构建 |
| 服务器房间已满 / 连接 503 | 查看启动日志的限制，等待保留房间释放或确认是否有异常连接；不要直接驱逐现有玩家 |
| 服务被内存限制杀死 | 查看 journal 和 `systemctl show garrison-multiplayer -p MemoryCurrent -p MemoryMax`，排查流量及资源消耗 |

### 7. 更新与回退

[上游自动同步](../docs/UPSTREAM_AUTO_SYNC.md) 每 6 小时检查并发布静态网站，**不会更新或重启 VPS**。维护时等待房间结束，停止服务后再替换文件，避免旧进程与新静态文件混用。

当前生产目录按发布产物维护；下面以另一个干净 Git 工作副本构建再复制为例。`git pull --ff-only` 遇到本地改动或分叉时应人工检查，不强行重置。首次使用先克隆；已存在工作副本时跳过 clone：

```bash
git clone https://github.com/Happyboat320/garrison-protocol.git ~/garrison-release
cd ~/garrison-release
git pull --ff-only origin main
git rev-parse HEAD
npm ci --prefix multiplayer --omit=dev
npm run build
npm run build:native --prefix multiplayer
```

确认提交与 Pages 的 `deployment.json` 一致后，备份和替换：

```bash
sudo systemctl stop garrison-multiplayer
sudo cp -a /opt/garrison-protocol "/opt/garrison-backup-$(date -u +%Y%m%dT%H%M%SZ)"
sudo rsync -a --delete dist/ /opt/garrison-protocol/dist/
sudo rsync -a --delete multiplayer/ /opt/garrison-protocol/multiplayer/
sudo systemctl start garrison-multiplayer
curl -fsS http://127.0.0.1:8080/health
```

`rsync --delete` 只作用于明确的游戏 dist 与 multiplayer 目录，清理被删除的旧模块；本例连同安装好的运行依赖和生成模块一起复制。它不更新 `/etc` 下的服务覆盖配置或 Caddy 配置，配置变更要另行核对。不要将自己的私钥、环境文件放进这两个会被替换的目录。

备份可用于回退同一发布版本的 dist 与 multiplayer；回退后若与线上网页指纹不同，必须同步回退静态网页或重新部署匹配版本。不要仅重启旧服务器却继续使用新版 Pages。备份不会保存运行中的内存房间。

当前安全措施与局限见 [服务端安全说明](../docs/MULTIPLAYER_SERVER_SECURITY.md)：这是朋友间联机架构，不提供完整防作弊或专门抗 DDoS。

## 验证

```bash
npm test --prefix multiplayer
npx --prefix multiplayer playwright install chromium
npm run test:browser --prefix multiplayer
npm run test:pages --prefix multiplayer
```

单元测试包含原生代码复用、准备期一致性、只读视角、联机规则、上游合并/冲突撤销、房间容量/消息限流以及表情分类/素材白名单。四浏览器使用原生商店两次点击确认、手牌拖放和朝向部署，测试禁用确认、浮框拖动/位置保留、分类切换/表情图片加载/5 秒消失、联防分屏、刷新续接、六选与公共 Boss。战斗案例使用真实引擎和受控快进，不代表所有回合的人工长局验收。静态测试验证独立 `/garrison-protocol/` 子路径与跨服务连接。

历史单机检查：全量测试有 29 项失败；没有因联机更新重跑全量并宣称全部通过。原生相关 54 项回归当时 53 项通过，S.E.E.S. 装备池的源码字符串断言失败（原测试查找 `itemAllowed(i,this)`）；该失败发生在未改动的原源码。

截至 2026-10-02，最近一次联机单元测试 42/42 通过；四浏览器完整流程、Pages 子路径与图片表情广播通过。表情框缩小后另验证静态入口与公网按钮尺寸。原项目构建成功，公网网页与服务端规则指纹一致。这是已运行的检查记录，不代表人工完整长局或全部原作机制验收。
