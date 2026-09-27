# S.E.E.S. 策略：施工完成记录与剩余缺口（2026-09-27）

本文原为「未完成内容清单」，**2026-09-27 当天已按清单全部接线完成**，现在改成完成记录：
每一条都写明落点，另外记下**与初版设计不同的三处实现口径**，以及真正还没闭环的部分。

- 口径与数值的权威来源仍是 `docs/SEES_CONTENT.md`（用户 2026-09-27 原样记录）。
- 四人自身的引擎通道限制见 `docs/PERSONA3_COLLAB_OPERATORS.md` 的「未闭环」小节。
- 回归：`tests/native-sees.test.mjs`（19 条）。

## 1. 完成清单（P0／P1 全绿）

### P0 · 打开注入

| 项 | 落点 |
| --- | --- |
| 构建接线 | `scripts/build-protocol.mjs`、`scripts/build-native.mjs` 各调一次 `applySeesContent(...)`；**build-native 里必须在联动干员建档之后**（那段会重建 `charChessDataDict[chessId]`，先注入会被覆盖回 `bondIds: []`） |
| 运行时清单 | `catalog.sees` → `data.sees = {bandId, bondIds, roster, items, numbers}`（`native-sees.seesNumbers` 等读的就是它） |
| 浏览器包 | `scripts/build-browser.mjs` 的清单加了 `'native-sees.js'` |
| 计数变化 | 策略 40→41、装备 59→60、盟约 23→25、`effectTemplates` 70→72；`visibleOperators` 仍 112、`enemies` 215、`artAssets` 380 不变 |
| 门禁同步 | `tests/native-collab-operators.test.mjs`（阶级改按 S.E.E.S. 分层 1/2/3/6、四人挂 `seesShip` 但仍不进默认池）、`tests/native-bond-ban-ui.test.mjs`（eligible 走 `operatorAllowed`）、`tests/native-battle-bar.test.mjs`（计数改 `deployCount`） |

### P0 · 三个「放行了也拿不到」的坑

| 坑 | 修法 |
| --- | --- |
| 盟约恒不激活 | `protocol.activeBonds(data,units,modeId,band)` 多收 band；该策略局把 `seesShip`／`tartarusShip` 额外算进 allowed（【塔尔塔罗斯】0/0 阈值恒满足）。`native-economy.bonds()`／`native-archive.runRecord` 都传 `s.bandId` |
| 没有库存 | `protocol.ensureStock` 的过滤改成 `o.charId&&(!o.isHidden||(o.sees===true&&isSeesBand(s)))`——默认局连库存都不铺 |
| 装备的 `sees` 标记丢失 | `build-protocol` 的 `items` 映射补 `sees:!!s.sees`；装备池过滤改走 `itemAllowed` |

### P1 · 可见性与卡池

- 策略列表／已选策略回落：`native-play.visibleBands(data,archiveNow())` ＋ `guardedBandId()`（简报、`begin` 创建对局、关掉特殊标记后都走它）。
- 战前准备：`renderPreparePage` 过 `dataForPrep(data,archive)`——未解锁时名册 112 名／装备 56 件，与改动前逐项一致；解锁后 116／57。
- 禁用池：`native-bond-ban.SEES_EXCLUSIVE_BONDS` 从 `bondIds()` 里剔掉两条专属盟约（禁用机制仍只认 23 个盟约，下拉与简报同步收窄）。
- 卡池：`NativeSession.eligible()` 走 `operatorAllowed`；`drawFromPool` 的装备分支走 `itemAllowed`；四人没有精锐形态 → `gain` 不会触发三合一，效果发人不会把回合开始回滚。

### P1 · 结算与战斗

| 机制 | 落点 |
| --- | --- |
| 回合结算 | `NativeSession.settleTartarusRound()`，由 `startBattle()` 在 `beginBattle()` **之前**调用 |
| 核心盟约 | `NativeBattle.seesCoreStrike()`：`hit()` 里 `weaknessHit` 那一帧触发，冷却账本 `battle.s.seesCoreNextAt` |
| 臂章 | `native-equipment.seesArmbandScales()` ＋ `NativeBattle.seesArmbandStrike()` |
| 虎狼丸 | 伤害转弱点（`weaknessSource` 接进命中类型路由）＋ 不占部署位（`canDeploy` 按「放下去之后」的计数判、界面 `deployCount`） |
| 埃癸斯 | `native-collab-aigis` 的 `statMods` 钩子，`out.ratio.atk/maxHp += aigisLayerScale-1` |
| 结城理 | `commitExit` 敌人分支（击倒）、`notifyKnockdown`、`runFatal` 的傀儡师分支（自身被击倒）；**另**：S3「开辟明日的剑刃」的两段替身（塔纳托斯·改 → 俄耳甫斯·改）与人格面具配色由 `native-collab-makoto`／`native-fx` 实现（battle 实例补丁绕过引擎的提前 return，细节见 `docs/PERSONA3_COLLAB_OPERATORS.md` §5.4.1） |
| 面板 | `native-play.bondSidebarHtml` 里【塔尔塔罗斯】显示层数（`bondPanelCount`），不再印 0/0 |
| 头像占位 | `.native-strategy-placeholder`（本期资源清单里没有 `band_sees`） |

侧栏会保留激活盟约，即使它的计数与层数都是 0；S.E.E.S. 局的【塔尔塔洛斯】因此从开局就显示为激活。

## 2. 与初版设计不同的三处口径（都是实现时定的，不是漏做）

1. **结算是「开战前」而不是「战斗结束后」**：`beginBattle()` 会把资金清零（资金只在备战期存在），所以「回合结束时消耗剩余所有资金」落在 `startBattle` 里。发放也发生在这一刻，新干员进整备区、下回合作战可用。
2. **臂章在数据层 `hideInShop: true`**：`hidden` 在本客户端是「不在默认可见集合里」的意思（战前准备按它过滤）。臂章默认隐藏 → 未解锁看不到；解锁后 `dataForPrep` 摘掉；本局进不进装备池由 `itemAllowed` 单独判。这样默认局与改动前逐项一致，也不需要给 `prepEquipmentRows` 加特例。
3. **衍生敌人不算结城理的「击倒」**：解压缩碎片／敌方召唤／分裂／幻影与顶栏击杀数同一口径（`e.derived` 为真时不计层数）。

## 3. 仍然没闭环的部分（2026-09-27 第二轮更新）

- **四人没有精锐形态**（`upgradeChessId: null`）：rel77 的本地资料包里**没有**这四人的卫戍棋记录（`data/gamedata/current` 只有 character_table／skill_table 等，没有 autochess 表），所以「岳羽由加莉精锐 +4」「结城理精锐 +10」这两档**没有权威数据可以照抄**。按项目「推不出来的宁可不做也不要编」的规矩**不发明精锐档**；公式仍在（`tests/native-sees.test.mjs` 用合成单位验证），要开放得先拿到原作数据或用户口径。臂章的 20% 档**是可达的**（装备走 `upgradeNum:2` 的三合一）。
- **策略头像**没有官方资源（380 项资源清单里没有 `band_sees`），用 `.native-strategy-placeholder` 占位块。
- **两条专属盟约没有原表黑板行**：数值与机制全部由 `native-sees` 承担，所以面板的「当前动态数值」在 `protocol.seesPanelLines` 里按 `data.sees.numbers` 单独算（层数上限／每资金层数／发放节奏／真实伤害比例／冷却／触发条件，见 `tests/native-sees.test.mjs`）；`strategyCoverage()` 仍会把 `sees_round_end_fund_to_layers` 报成 `pendingKeys`（`STRATEGY_EFFECT_AUDIT.md` 里已写明这是有意为之，不走策略事件解释器）。
- ✅ **核心盟约的表现**已补：`native-fx.drawSeesCore` 在触发点画扩散环＋「S.E.E.S. 弱点追击 n%」标签（`reduceFx` 只留静止环），由 `drawFx` 统一调用，纯表现。
- ✅ **非 S.E.E.S. 局不再出现这两条盟约**：`activeBonds` 只在该策略局才输出它们（侧栏、战报的盟约情况、`battle.on()` 都不再看到 0 层的空条目）。
- 逐名干员自身仍未闭环的引擎通道见 `docs/PERSONA3_COLLAB_OPERATORS.md` §5／§5.6：**伤害类型改写、`attack@max_target`、替身形态对空、法术闪避、友军术法充盈进结算、无视闪避开关、技能级溅射半径都已补齐**；剩下的是「攻击间隔用攻速近似」「起飞／降落（分支 pending）」「触发型效果只有她一处实现」「S1 改为治疗会走一次 0 伤害普攻」「普攻类型判闸门在陈策略／弱点装备组合下会少算」这些已知近似。

## 4. 顺手修掉的两处既有实现缺陷

- `layersPerFund` 只认 `profiles[chessId].isGolden`／`charChessDataDict[chessId].isGolden`，**漏了单位自己身上的 `isGolden`** → 由加莉精锐档永远读不到，已补。
- 「不占部署位」若只把该单位从计数里剔掉、判定却仍写 `count >= capacity`，会出现「满员后虎狼丸自己也上不去」；现在按「放下去之后」的计数判。
