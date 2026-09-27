# S.E.E.S. 联动内容（设计口径与施工状态）

用户 2026-09-27 设计的整块联动玩法。本文记录**口径与数值**、已经落地的部分、以及**尚未接线**的清单。

## 1. 用户口径（原样记录）

- 只有本地存档的特殊标记 `flags.sees === true` 时，**策略选择里**才能看到「策略：S.E.E.S.」（策略头像暂时占位）；标记不为 true 时，**战前准备里也看不到**相关角色（与装备）。
- 只有**选择这个策略**时，相关干员与装备才加入商店池（「卡池中可能出现【S.E.E.S.】干员与装备」）。
- 策略效果：自动激活盟约【塔尔塔罗斯】；**回合结束时消耗剩余所有资金**，每消耗 1 资金【塔尔塔罗斯】层数 +5。
- 特殊盟约【塔尔塔罗斯】0/0：每获得 25 层，随机获取一个**不高于当前商店阶级**的【S.E.E.S.】干员，尽可能不与场上已有的重复；**层数上限 264，满了不再增长**。
- 核心盟约【S.E.E.S.】3/3：每 20 秒可触发一次——造成**弱点伤害**时，对全场所有敌人造成等同于场上全体【S.E.E.S.】干员攻击总和的 **n% 真实伤害**；当【塔尔塔罗斯】层数 **>= 264** 时，冷却变为 **1 秒**。
  - **n 随层数线性成长：0 层 5% → 264 层 40%**（用户 2026-09-27 追加口径；此前定的固定 20% 已被取代）。
- 干员分层效果：
  | 干员 | 阶级 | 效果 |
  | --- | --- | --- |
  | 虎狼丸 | 1 | 不占用部署位；造成的伤害变为**弱点伤害** |
  | 岳羽由加莉（油咖喱） | 2 | 【塔尔塔罗斯】层数增长每资金额外 +2（初始）／+4（精锐） |
  | 埃癸斯（艾吉斯） | 3 | 攻击、生命随【塔尔塔罗斯】层数增幅：**每层 +0.2%**（264 层 → +52.8%） |
  | 结城理 | 6 | 每次击倒敌人或自身被击倒，【塔尔塔罗斯】层数 +5（初始）／+10（精锐） |
- 装备「S.E.E.S.臂章」3 阶：造成物理／魔法伤害时，额外造成相当于该次伤害 **10%（初始）／20%（精锐）** 的**弱点伤害**；装备者为【S.E.E.S.】盟约时，再额外造成 **10%／20%** 的**真实伤害**。
- 策略初始生命 **30**。

## 2. 已经落地（本次提交）

| 文件 | 内容 |
| --- | --- |
| `data/modes/alliance-lower/sees-content.json` | 内容登记表：策略、两条盟约、四名干员的阶级、臂章、**全部数值**（含 `tartarusLayerCap: 264`、`coreTrueDamagePercentBase/Max: 0.05/0.40`、`coreFastThreshold: 264`、`aigisPerLayer: 0.002` 等）与文案 |
| `scripts/lib/sees-content.mjs` | 构建期注入器：把登记表并进 `source`（策略／盟约／干员阶级与盟约归属／臂章的两档记录＋效果表），供 build-protocol 与 build-native 共用。**目前默认关闭**（两个构建脚本里的调用被注释掉），因为运行时机制还没接线 |
| `dist/native-sees.js` | 运行时公式与谓词：`seesUnlocked`／`isSeesBand`／`operatorAllowed`／`itemAllowed`／`dataForPrep`／`visibleBands`；层数账本 `tartarusLayers`／`addTartarusLayers`（**封顶 264**）；`coreTrueDamagePercent(data, layers)`（5%→40% 线性）；`coreCooldown(data, layers)`（>=264 → 1 秒，否则 20 秒）；`layersPerFund`（5 + 由加莉 2/4） |

数值与公式都在数据层，代码不写死；臂章的 `giveBondId` 定为 `seesShip`，所以和「形变同构体」一起装备时，`refreshEquipmentBonds` 会把 `seesShip` 发给携带者（转职 SEES 盟约，不需要另写判定）。

## 3. 尚未接线（下一步施工清单）

1. **注入打开**：`scripts/build-protocol.mjs`／`scripts/build-native.mjs` 里 `applySeesContent(...)` 取消注释，并恢复 catalog 的 `sees` 清单（`bandId`／`bondIds`／`roster`／`items`／`numbers`）。打开后需要同步更新几处计数门禁：盟约数 23→25、装备 59→60、策略 40→41。
2. **可见性**：大厅策略选择与简报按 `visibleBands(data, archive)` 过滤（未解锁不显示 `band_sees`），策略头像用占位块；战前准备用 `dataForPrep(data, archive)` + `prepCatalog(data,{sees})` 放行四人与臂章；盟约禁用池与战前准备的盟约下拉把 `seesShip`／`tartarusShip` 排除（它们只在该策略局存在）。
3. **卡池门控**：`NativeSession.eligible()` 与 `drawFromPool` 的装备分支改成走 `operatorAllowed`／`itemAllowed`；同店库存 `s.stock` 补上四条 SEES 记录，让阶级掷点能找到他们；`takePromotion` 同步放行。
4. **回合结束结算**：`NativeSession.finishCurrentBattle` 里（band_sees 局）把 `s.funds` 全部换成层数：`addTartarusLayers(layersPerFund(data,this)*funds)`，随后 `setFunds(0)`；每跨过 25 层发一名干员（阶级 ≤ `s.level`，优先不重复场上已有的），走 `gain()`。
5. **核心盟约触发**：`native-battle.hit()` 里判定「这次是不是弱点伤害」（现有 `equipWeakness`／虎狼丸转化的那条路径），命中时按 `coreCooldown(data, layers)` 节流，对全场敌人按 `coreTrueDamagePercent(data, layers) × 场上 SEES 干员攻击总和` 结算真实伤害。
6. **干员效果**：虎狼丸「不占部署位」（`s.capacity` 与「N/M 部署」计数排除它）+ 伤害转弱点（复用 `equipWeakness` 的口径）；埃癸斯每层 +0.2% 攻/血（挂在 `dist/native-collab-aigis.js` 的 `statMods` 钩子上）；结城理击倒/被击倒 +5/+10（接在敌人退场与自身替身切换两处）。
7. **臂章效果**：`native-equipment.js` 读 `sees_armband_damage` 行的 `weakness_scale`／`true_scale`，在 `hit()` 的伤害结算后追加一次弱点伤害与（S.E.E.S. 盟约时的）真实伤害；实现后把 `tests/native-equipment-effects.test.mjs` 的 `PENDING` 登记删掉。
8. **面板**：盟约侧栏里【塔尔塔罗斯】显示 `tartarusLayers(s)`（而不是成员数）。
9. 回归：新增 `tests/native-sees.test.mjs`（门控、封顶、公式、发人、触发节流、臂章追加伤害），并对每个数值做「改数据 → 行为跟着变」的断言。

## 4. 施工状态

- 本次只落了**数据登记表＋公式＋谓词模块＋本文件**；注入与上面 9 条接线**都还没做**，所以现在游戏里看不到 S.E.E.S. 内容（策略列表、卡池、战前准备都与改动前一致），`npm test` 1359 全绿。
- 之所以先关着注入：半接线的状态会让「盟约数／装备数」这类计数门禁变红，宁可先把口径与公式钉死，再一次性接线。
