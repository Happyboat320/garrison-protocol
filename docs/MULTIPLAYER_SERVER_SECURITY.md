# 联机服务架构、启动与安全边界

## 地址从哪里来

`23-238-114-57.sslip.io` 是公共 DNS 服务 sslip.io 将域名中的 IP 解析为 `23.238.114.57`。
这是目前 VPS 的 IP；域名不是随机保密入口，也没有隐藏服务器 IP。
Caddy 自动申请并续期 TLS 证书，浏览器使用 HTTPS/WSS 加密传输。
游戏静态站点在 `happyboat.tech/garrison-protocol/`，GitHub Pages 提供；它通过 WSS 连接此 VPS。
sslip.io 不是流量代理，也不提供抗 DDoS。之后可换为自有子域名，但单纯换域名并不消除攻击风险。

## 运行架构

```mermaid
flowchart LR
  P[GitHub Pages 静态网页] --> B[玩家浏览器：原生游戏逻辑与绘制]
  B -->|WSS :443| C[VPS Caddy：TLS 与反向代理]
  C -->|本机 HTTP/WebSocket| N[Node.js 24 + ws :8080]
  N --> R[内存房间：同步 / 顺序选择 / 联防 / Boss 总血量]
```

浏览器执行单机原生战斗、商店和绘制，发送结果与视角快照；服务端校验身份、阶段与任务，统一跨玩家结算和消息转发。
没有数据库、账号密码系统或文件上传服务。头像由浏览器压成小尺寸 PNG/JPEG/WebP，再以消息形式发送。
房间、恢复点、视角快照都在进程内存中，重启会清空。公开的客户端可被修改，服务端没有重新演算每次伤害，因此不提供完整防作弊。

## 构建与启动

使用 Node.js 22+（当前生产为 24），从本仓库根目录运行：

```bash
npm ci --prefix multiplayer
npm run build
npm start --prefix multiplayer -- --max-rooms 10 --max-connections 56
```

`npm start` 的 prestart 会从当前单机源码生成联机适配模块；不需要单独编译另一套战斗引擎。
静态发布另运行 `npm run build:pages --prefix multiplayer`，产物为 `.pages/`。
若自建域名，构建时设置 `MULTIPLAYER_PUBLIC_URL=wss://你的域名/socket`，在 Caddy 配置该域名。
生产部署到 `/opt/garrison-protocol`，先构建生成文件，再用 systemd 启动；受限服务进程不负责写生成文件。
模板为 `multiplayer/deploy/garrison-multiplayer.service` 与 `multiplayer/deploy/Caddyfile`。

| CLI 参数 | 环境变量 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `--max-rooms` | `MAX_ROOMS` | 10 | 所有保留房间的总数，包括等待、游玩、结束和重连保留房间 |
| `--max-connections` | `MAX_CONNECTIONS` | 房间上限 × 4 + 16 | WebSocket 连接总数，包括尚未入房的连接 |
| `--max-messages-per-second` | `MAX_MESSAGES_PER_SECOND` | 100 | 单连接每秒消息数量 |
| `--max-bytes-per-second` | `MAX_BYTES_PER_SECOND` | 8388608（8 MiB） | 单连接每秒消息字节数 |

CLI 优先于环境变量，支持 `--max-rooms 10` 和 `--max-rooms=10`。所有值必须为正整数，非法参数导致启动失败。
HOST/PORT 环境变量指定监听地址与端口。当前生产固定 `HOST=127.0.0.1`、`PORT=8080`、最多 10 房、56 连接。
房间满时只拒绝新建，现有房间仍可加入和重连；不会驱逐正在玩的玩家。
等待房间断线两分钟后移除缺席玩家，空房回收；已开局断线按原规则处理，所有玩家离线超过 30 分钟回收。
它不限制每天建房总次数，也不保证名额不被恶意占满。

## 已有及本次补充的防护

- HTTPS/WSS 加密；Node 只监听本机，公网由 Caddy 接入。Caddy 管理 API 也只监听本机。
- 最大 10 房和 56 个 WebSocket；连接升级前检查容量，未完成有效入房的连接 10 秒后关闭。
- 单条 WebSocket 消息最多 2 MiB；单连接每秒最多 100 条、8 MiB，超限先于 JSON 解析断开。WebSocket 压缩关闭。
- 心跳清理失联连接；服务端发送队列超过 4 MiB 时断开慢接收者；房间日志只保留最近 100 条。
- HTTP 头部与请求超时，静态文件路径白名单与真实路径检查；仓库配置、Git、服务端源码不作为静态文件公开。
- 消息按玩家身份/阶段/任务校验；重连使用随机令牌。非法建房先校验资料，不留下空房占用名额。
- systemd 使用 DynamicUser、NoNewPrivileges、只读文件系统和 PrivateTmp；内存软限 512 MiB、硬限 768 MiB、线程/进程数 64、文件描述符 4096。硬限触发可能使服务重启并清空房间。

## 仍需知道的边界

公开服务可能被扫描、连接洪泛、占满房间或发送伪造游戏结果。以上措施减少应用层资源滥用，不能保证抵御分布式攻击或链路带宽被打满。
目前没有登录、房间密码、验证码、IP 封禁、专门抗 DDoS 或 WAF。房间号是邀请标识，不是强身份验证。
检查时本机 nftables 没有规则；不代表云厂商安全组也没有防护。没有贸然更改主机全局防火墙，避免影响 SSH 和其它服务。

若打算向大量陌生人公开，建议使用自有子域名接入支持 WebSocket 的防护代理及云厂商抗 DDoS，并按实际流量设连接建立速率限制；
只给朋友用可以进一步增加入房口令。云安全组可仅放行需要的 80/443，并限制 SSH 来源；这些需要结合现有管理方式配置。
Origin 检查可减少其它网页借用服务，但非浏览器客户端可伪造 Origin，不能替代认证。

查看当前限制与服务状态：

```bash
systemctl status garrison-multiplayer
journalctl -u garrison-multiplayer -n 30
systemctl show garrison-multiplayer -p MemoryCurrent -p MemoryMax -p TasksMax
```
