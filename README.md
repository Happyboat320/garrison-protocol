# 卫戍协议：盟约下半 · 手动验收版

非官方同人项目。主入口已连接历史下半期数据、运营控制器与 native 战斗循环。

本仓库：[Happyboat320/garrison-protocol](https://github.com/Happyboat320/garrison-protocol) · 单机上游：[Yilegendoflink/garrison-protocol](https://github.com/Yilegendoflink/garrison-protocol)

在线试玩：[单机 / 联机入口](https://happyboat.tech/garrison-protocol/) · [上游单机](https://yilegendoflink.github.io/garrison-protocol/)

给后续开发者的当前事实见 [AGENTS.md](AGENTS.md)。

## 概述

你也没玩够，我也没玩够。我有没用完的codex额度，所以这个项目就这么出现了

数据库来自PRTS。一部分玩法逻辑来自我和群友的记忆，还有一部分是一点点自由发挥 添加一抹奇幻色彩。

彩蛋部分代码来自 https://github.com/ophixation/325calculator

## 当前版本

已接上主对局的：本期 112 名可见预设、初始／精锐养成、技能选择、地图裁切、轮次；购买、晋升、装备、两段式部署、准备／作战／决策／结算、存档；大厅 → 战前准备 → 对局；词条预算随机波次与编制台；职业分支基础层；公共结算（伤害／治疗／回复／流失／退场）；112 名 `descriptor-v1` 适配入口（`needsSpecialHandler=0`）；战斗费用账本与整备资金分离；部分敌人移动／攻击策略。

最终回合已接入 boss_4 昆图斯、boss_5 卢西恩与 boss_7「萨米的意志」：每局按本期权重抽取；最终 Boss 有真实生命，限时为 100 秒加开战时剩余生命，击破本体即胜，30 名增援从上下红门进入，漏门每名扣 1 秒。昆图斯的断裂生殖召唤技能按用户要求忽略。其余常规 Boss 与隐秘核心未开放；战斗画布仍使用放大头像，Spine 动画未接入。

功能分支上的提交不等于已发布内容。敌人特殊行为的已实现范围、剩余缺口和暂停检查点见 [敌人行为审计](docs/ENEMY_BEHAVIOR_GAP_AUDIT.md)；2026-09-23 的逐条修复（普攻伤害类型权威化、正面减伤/阻挡神经损伤/重生/群攻/阻挡占用/施法失衡免疫/载客失衡门禁）、随机池登记门禁与 **BOSS／领袖未进池的成因分析**见 [审计修复与 BOSS 入池缺口](docs/ENEMY_AUDIT_FIX_2026-09-23.md)。

切走标签页时战斗**不再自动暂停**（隐藏时 `requestAnimationFrame` 停摆，改由定时器按真实时间补帧），
口径、浏览器节流限制与未闭环清单见 [后台继续运行](docs/BACKGROUND_LOOP_2026-09-23.md)。

S.E.E.S. 联动四人（虎狼丸／埃癸斯／岳羽由加莉／结城理）＋特殊盟约【塔尔塔罗斯】／【S.E.E.S.】＋装备「S.E.E.S.臂章」以**隐藏内容**形式实装：平时是隐藏档，只有本地存档的特殊标记打开（大厅「输入密码」→ `20100305`，或战前准备页的开关）后，策略选择里才会出现【S.E.E.S.】；**只有选了这条策略**，四人与臂章才进商店池，回合结束时剩余资金会换成【塔尔塔罗斯】层数、每 25 层发一名 S.E.E.S. 干员。数据来源、逐项数值与待补的技能行为见 [联动的口径与施工记录](docs/SEES_CONTENT.md) 与 [联动四人实装记录](docs/PERSONA3_COLLAB_OPERATORS.md)。

2026-09-13 的地图裁切、预置工事、分支规则修正仍然有效，详见 [BRANCH_RULES.md](BRANCH_RULES.md)。

## 已知差异

此版本可供人手动点，**不是完整复刻成品**。

- 未取得服务端完整商店／奖励池权重，当前采用受候选条件限制的等权抽取。
- 112 名均有适配层入口，不等于技能／天赋／模组已逐项对照。能力状态表里 `verified` 只覆盖抽样场景。
- 特殊召唤站位选择、精确动作释放帧、部分敌人特殊能力、地图环境／装置动态破坏仍有缺口。
- 战斗盟约、复杂策略、特殊刷新／冻结、道具和机变仍在补；不要把侧栏盟约计数当成效果已全部执行。
- 本仓库已有独立 2–4 人联机扩展；完整甄选／助战档案仍未接入。联机沿用单机已实现范围，不代表全部原作机制完成。

页面「已知差异」也会提示这些范围。手动反馈时请导出存档并附复现步骤。

## 本地运行与构建

直接打开根目录 `index.html`，或运行 `npm run dev` 后访问 http://127.0.0.1:5502 。开发需要 Node.js 22+（Pages 使用 24）。`npm run build` 只编译；推送 `main` 会自动构建独立 Pages，普通发布工作流不运行测试。上游自动同步流程会先运行构建和联机检查，详见 [发布说明](PUBLISHING.md)。

## 本仓库联机扩展

联机直接复用当前单机的游玩代码和显示，通过 `multiplayer/` 中的生成器追加网络接口，原 `dist/` 源码保持独立。
房主开始后先展示本局盟约禁用，全员确认再轮流选择不重复的策略；公共决策六选、独立生命、串行联防与共享 Boss 血量由房间协调。
队友视角与表情放在可拖动悬浮框内。BWIKI 图片表情按分类选择，发送后在头像旁显示 5 秒。

```bash
npm ci --prefix multiplayer
npm run build
npm start --prefix multiplayer -- --max-rooms 10 --max-connections 56
```

当前生产最多 10 房、56 连接，HTTPS/WSS 经 Caddy 转发到本机 Node.js 服务。网页自动同步上游不等于 VPS 自动更新；规则版本不一致时拒绝联机。
从零安装 Node、构建、systemd 自动启动、Caddy HTTPS/WSS、限流设置、更新与排障见 [服务端详细部署](docs/MULTIPLAYER_SERVER_DEPLOYMENT.md)。运行与复用边界见 [联机 README](multiplayer/README.md)，参数及防护见 [服务端安全说明](docs/MULTIPLAYER_SERVER_SECURITY.md)，定时同步见 [上游自动更新](docs/UPSTREAM_AUTO_SYNC.md)。
博客不再发布本游戏，旧 `/ark/` 已删除；独立地址为 `/garrison-protocol/`。

## 源码入口

- `dist/native-play.js`、`dist/native-lobby.js`、`dist/native.css`：大厅、战前准备、对局与两段式部署。
- `dist/native-session.js`：主对局、商店、装备、阶段与存档。
- `dist/native-economy.js`、`dist/garrison.js`、`dist/strategy.js`：运营事件。
- `dist/native-battle.js`、`dist/native-combat.js`、`dist/native-effects.js`、`dist/native-operator-effects.js`：战斗循环、结算与逐名适配。
- `dist/native-sp.js`、`dist/native-waves.js`、`dist/native-wave-editor.js`：技力与波次编制。
- `scripts/build-native.mjs`：将固定历史库编入客户端。
- 我方干员模型资源、动作清单和自制动画包约定见 [动画数据库](data/operator-animations/README.md)；独立采集与校验，尚未接入棋盘播放。
- `dist/legacy.html`：此前的演示与资料库。

期次资料见 `data/modes/alliance-lower/README.md`。早期阶段文档作为历史记录保留；当前事实以本页和 `AGENTS.md` 为准。

## TODO

- 补全大部分特殊敌人行为机制，例如复活、解压缩
- 补全最终BOSS战
- 实装小人动画和更精致的特效
- 支持自定义追加原创干员、盟约、敌人、BOSS
- 完善独立联机扩展与上游接口适配，按公开规模补充认证和网络防护

## 来源

规则来源：[PRTS 下半期页面](https://prts.wiki/w/卫戍协议：盟约_下半)。基础数据使用固定提交的公开游戏数据镜像，每份表及关卡记录来源。头像清单见 `dist/assets/prts/manifest.json`，旧素材清单见 `dist/assets/asset-manifest.json`。联机表情来自 [BWIKI 游戏表情一览](https://wiki.biligame.com/arknights/游戏表情一览)，来源记录见 `multiplayer/shared/emotes.js`。

角色、美术与原始游戏内容的权利属于鹰角网络及相关权利人，本项目非官方产品。公开下载地址不代表原始素材采用开放许可。
