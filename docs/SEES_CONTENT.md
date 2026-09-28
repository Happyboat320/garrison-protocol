# S.E.E.S. 联动内容（设计口径与施工状态）

用户 2026-09-27 设计的整块联动玩法。本文记录**口径与数值**、已经落地的部分、以及**尚未接线**的清单。

## 1. 用户口径（原样记录）

- 只有本地存档的特殊标记 `flags.sees === true` 时，**策略选择里**才能看到「策略：S.E.E.S.」（策略头像暂时占位）；标记不为 true 时，**战前准备里也看不到**相关角色（与装备）。
- 只有**选择这个策略**时，相关干员与装备才加入商店池（「卡池中可能出现【S.E.E.S.】干员与装备」）。
- 策略效果：自动激活盟约【塔尔塔罗斯】；**回合结束时消耗剩余所有资金**，每消耗 1 资金【塔尔塔罗斯】层数 +5。
- 特殊盟约【塔尔塔罗斯】0/0：每获得 25 层，随机获取一个**不高于当前商店阶级**的【S.E.E.S.】干员，尽可能不与场上已有的重复；**层数上限 264，满了不再增长**。
- 核心盟约【S.E.E.S.】3/3：每 20 秒可触发一次——造成**弱点伤害**时，对全场所有敌人造成等同于场上全体【S.E.E.S.】干员攻击总和的 **n% 真实伤害**；当【塔尔塔罗斯】层数 **>= 264** 时，冷却变为 **1 秒**。
  - **n 随层数线性成长：0 层 5% → 264 层 40%**（用户 2026-09-27 追加口径；此前定的固定 20% 已被取代）。
  - 文案里不写 `>=`：`native-rich-text` 的门禁会把 `<`／`>` 当成富文本标签残留，数据里一律写成「达到 264 层」。
- 干员分层效果：
  | 干员 | 阶级 | 效果 |
  | --- | --- | --- |
  | 虎狼丸 | 1 | 不占用部署位；造成的伤害变为**弱点伤害** |
  | 岳羽由加莉（油咖喱） | 2 | 【塔尔塔罗斯】层数增长每资金额外 +2（初始）／+4（精锐） |
  | 埃癸斯（艾吉斯） | 3 | 攻击、生命随【塔尔塔罗斯】层数增幅：**每层 +0.2%**（264 层 → +52.8%） |
  | 结城理 | 6 | 每次击倒敌人或自身被击倒，【塔尔塔罗斯】层数 +5（初始）／+10（精锐） |
- 装备「S.E.E.S.臂章」3 阶：造成物理／魔法伤害时，额外造成相当于该次伤害 **10%（初始）／20%（精锐）** 的**弱点伤害**；装备者为【S.E.E.S.】盟约时，再额外造成 **10%／20%** 的**真实伤害**。
- 策略初始生命 **30**。

## 2. 已经落地

| 文件 | 内容 |
| --- | --- |
| `data/modes/alliance-lower/sees-content.json` | 内容登记表：策略、两条盟约、四名干员的阶级与专属卫戍说明、臂章、**全部数值**（含 `tartarusLayerCap: 264`、`coreTrueDamagePercentBase/Max: 0.05/0.40`、`coreFastThreshold: 264`、`aigisPerLayer: 0.002` 等）与文案 |
| `scripts/lib/sees-content.mjs` | 构建期注入器：把登记表并进 `source`（策略／盟约／干员阶级、盟约归属、三合一精锐记录与两档 garrison 描述／臂章的两档记录＋效果表），`build-protocol` 与 `build-native` 各调一次（后者**必须在联动干员建档之后**，否则 `bondIds` 与 `garrisonIds` 会被覆盖回空），并把 sees 清单写进 catalog／运行时 |
| `dist/native-sees.js` | 运行时公式与谓词（**纯函数模块，不 import session／battle／play**）：`seesUnlocked`／`isSeesBand`／`seesRun`／`operatorAllowed`／`itemAllowed`／`dataForPrep`／`visibleBands`；层数账本 `tartarusLayers`／`addTartarusLayers`（**封顶读数据**）；`coreTrueDamagePercent`（5%→40% 线性）；`coreCooldown`（≥264 → 1 秒，否则 20 秒）；`layersPerFund`（5 ＋ 由加莉 2/4）；`settleFundsToLayers`／`grantCountForLayers`／`seesGrantCandidates`；`isSeesOperator`／`weaknessSource`／`freeDeploy`／`makotoKillLayers`／`aigisLayerScale`／`bondPanelCount` |
| `dist/native-session.js` | 卡池门控（`eligible`／装备池走 `operatorAllowed`／`itemAllowed`、`ensureStock` 为四人铺库存）、`settleTartarusRound()`（开战前结算）、虎狼丸不占部署位的上限判定 |
| `dist/native-battle.js` | `seesCoreStrike`（核心盟约的弱点伤害触发与冷却）、`seesArmbandStrike`（臂章追加伤害）、命中类型路由加 `weaknessSource` |
| `dist/native-equipment.js` | `seesArmbandScales`：读臂章黑板 `weakness_scale`／`true_scale`（`sees_armband_damage` 行） |
| `dist/native-effects.js` | 结城理「击倒敌人／自身被击倒 +5/+10」（敌人退场、击倒通知、傀儡师致死三处） |
| `dist/native-collab-aigis.js` | 埃癸斯随【塔尔塔罗斯】层数的攻／血增幅（`statMods` 的 `ratio` 通道） |
| `dist/native-bond-ban.js` | `SEES_EXCLUSIVE_BONDS`：两条专属盟约不进禁用池、不进盟约下拉 |
| `dist/native-play.js` / `dist/native-prep.js` / `dist/native.css` | 策略列表与已选策略的可见性回落、战前准备过 `dataForPrep`、侧栏显示层数、策略头像占位块 |

数值与公式都在数据层，代码不写死；臂章的 `giveBondId` 定为 `seesShip`，所以和「形变同构体」一起装备时，`refreshEquipmentBonds` 会把 `seesShip` 发给携带者（转职 SEES 盟约，不需要另写判定）。

## 3. 施工结果（2026-09-27 全部接线完成）

施工清单与逐条落点、以及**与初版设计不同的三处实现口径**见 [`docs/SEES_STRATEGY_REMAINING.md`](SEES_STRATEGY_REMAINING.md)（那份文件现在是「完成记录 ＋ 剩余缺口」）。摘要：

- 注入打开并同步了计数：策略 40→41、装备 59→60、盟约 23→25（禁用机制仍只认原来 23 个）。
- 可见性：未解锁时策略列表、战前准备名册（112 名／56 件）与改动前**逐项一致**；解锁后四人进名册、臂章进装备页。
- 卡池：四人平时 `isHidden` 且**没有库存**，只有 `band_sees` 局才 `eligible()` 放行并铺库存；臂章在数据层 `hideInShop:true`，由 `itemAllowed` 在策略局放行进池。
- 结算：**开战前**（`beginBattle` 会清零资金）把剩余资金 × 每资金层数换成【塔尔塔罗斯】层数，每 25 层发一名干员，已发到第几档记在 `s.seesGrants`；层数额度**不含**衍生敌人带来的击倒。
- 战斗：核心盟约的弱点伤害触发按 20 秒／1 秒冷却节流；臂章追加弱点伤害（盟约时再追加真实伤害）；虎狼丸转弱点且不占部署位；埃癸斯按层数增幅；结城理击倒加层。
- 精锐化：四人各收集 3 张基础卡后合成为 `isGolden` 精锐档；精锐档不进入卡池，仍只通过合成获得。由加莉与结城理的卫戍档案按形态分别显示 +2/+4 与 +5/+10，不再在基础描述里并列标注精锐加成。
- 回归：`tests/native-sees.test.mjs`（19 条，含门控／封顶／公式／发人／触发节流／臂章／四名干员效果／接线门禁），并对上限、比例、发放节奏、臂章比例、埃癸斯每层值、由加莉精锐档做了「改数据 → 行为跟着变」的断言。

## 4. 仍然存在的缺口

- 四人原表没有 autochess 精锐记录；按用户修正后的口径，客户端为四人登记了三合一精锐形态。岳羽由加莉与结城理的精锐卫戍分别显示其已生效数值（+4／+10），不把初始与精锐值并列写在描述里。
- 策略头像没有官方资源（`band_sees` 不在 380 项资源清单里），用 `.native-strategy-placeholder` 占位。
- 两条专属盟约没有原表黑板行：数值与机制由 `native-sees` 承担，面板的「当前动态数值」改由 `protocol.seesPanelLines` 按 `data.sees.numbers` 单独渲染；`strategyCoverage()` 会把 `sees_round_end_fund_to_layers` 报成 `pendingKeys`（有意为之，见 `STRATEGY_EFFECT_AUDIT.md`）。
- 逐名干员自身仍未闭环的引擎通道见 `docs/PERSONA3_COLLAB_OPERATORS.md` 的「未闭环」小节与 §5.6（伤害类型改写、`attack@max_target`、替身形态对空、法术闪避、友军术法充盈进结算、无视闪避开关、技能级溅射半径均已补齐；剩下的是攻击间隔近似、起飞／降落、触发型效果登记、S1 治疗近似等）。
