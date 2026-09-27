# S.E.E.S. 联动四人实装记录（2026-09-23）

本文记录 PRTS 联动干员 **虎狼丸／埃癸斯／岳羽由加莉／结城理** 的数据来源、逐项数值，以及在本客户端里的实装口径。

## 1. 口径（先看这段）

| 项 | 决定 |
| --- | --- |
| 入池方式 | 只作**隐藏档**：`charShopChessDatas[chessId].isHidden = true` |
| 盟约 | **默认不给**：`charChessDataDict[chessId].bondIds = []`；**例外**：选了 S.E.E.S. 策略的局里挂 `seesShip`（见下） |
| 卫戍 | **不给**：`garrisonIds = []`（干员档案显示「无卫戍效果」） |
| 商店 | **默认不进池**：`NativeSession.eligible()` 过滤 `isHidden`，商店／具名池／`later` 池／晋升奖励都抽不到；**例外**：`band_sees` 局（`native-sees.operatorAllowed`）会进池并铺库存 |
| 名册 | **默认不列**：`catalog.roster` 只收 `charId && !isHidden`，战前准备仍是 112 名可见预设；**例外**：本地存档 `flags.sees` 打开后，`dataForPrep` 会把四人并入名册（116 名） |
| 阶级 | 商店阶级按 S.E.E.S. 策略的分层口径 **1／2／3／6**（用户 2026-09-27），**覆盖「阶＝星级」的默认规则**；登记表 `collab-operators.json` 的 `chessLevel` 仍按星级记原始阶，运行时以 `sees-content.json` 为准 |
| 精锐化 | **无**：`upgradeChessId = null`，四个隐藏档都没有精锐形态（所以「由加莉精锐 +4」那一档只有数据与公式，游戏内取不到） |
| 唯一入口 | **技能测试场**：「添加干员」的列表取 `data.profiles` 全部条目（含隐藏档） |
| 数值来源 | **不抄写**：实体／技能／范围在构建时从 `data/normalized/current.json`（rel77.0）取，登记表只存 charId／chessId／档位 |
| 潜能 | 一律按**无潜能**（`potentialRank = 0`）结算，与其他干员同一口径；四人「天赋效果加强／费用-1／攻击力+N」等条目**未建模** |
| 信赖 | 未建模（本客户端所有干员都不叠加信赖加成） |

**S.E.E.S. 策略带来的例外（用户 2026-09-27）**：进入隐藏内容的解锁状态（`flags.sees`）后，策略选择里会出现【S.E.E.S.】；**只有本局选了这条策略**，四人才进调配池（`operatorAllowed`）、才挂 `seesShip` 盟约并计入【S.E.E.S.】核心盟约的 3/3，臂章也才进装备池。完整口径与施工记录见 `docs/SEES_CONTENT.md` 与 `docs/SEES_STRATEGY_REMAINING.md`，回归 `tests/native-sees.test.mjs`。

登记表：`data/modes/alliance-lower/collab-operators.json`；构建接线：`scripts/build-native.mjs`（与 `chess_virtual_*` 同一做法，不打补丁进历史快照 `source.json`）。

## 2. 数据来源

| 来源 | 版本／修订 | 用途 |
| --- | --- | --- |
| PRTS 干员一览/data | `data/prts/snapshots/2026-09-12-prts/operators.json`；四页 revisionId 424872（虎狼丸）／427715（埃癸斯）／424276（岳羽由加莉）／425074（结城理） | 技能文案、备注（※可对空）、天赋候选与上线时间 |
| 游戏数据（Kengxxiao/ArknightsGameData 公开镜像） | `data/gamedata/current`，commit `0ef7f95`，`Stream://torappu-data/v077/rel77.0 Change:122801 on 2026/09/08` | **权威数值**：character_table／skill_table／range_table／uniequip_table |
| 规范化结果 | `data/normalized/current.json` | 构建时的实体／技能／范围来源 |
| PRTS 分支特性信息/data | revision 427899 | 游击手／裂空炮手的特性文本 |
| 分支内部 ID | `data/gamedata/current/uniequip_table.json` 的 `subProfDict` | 游击手＝`supportiveranger`（professionId 16＝SUPPORT） |
| 头像 | PRTS `File:头像_<名>.png`，脚本 `scripts/sync-collab-assets.mjs`（按 sha1 校验） | `dist/assets/prts/char_42*.png`，180×180 |

四人的 `teamId` 都是 `sees`（S.E.E.S.），来自 rel77 的 `character_table.json`。

## 3. 逐人记录

### 3.1 虎狼丸 `char_4220_kormr` → `chess_collab_kormr`

1 星近卫／剑豪（`sword`），近战位，1 阶。只有**一个**精英阶段，再部署 200 秒。

| 阶段 | 等级上限 | 范围 | 生命 | 攻击 | 防御 | 法抗 | 费用 | 阻挡 | 攻击间隔 | 再部署 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | 30 | `1-1` | 904 | 242 | 125 | 0 | 3 | 2 | 1.3 | 200 |

- 特性：剑豪分支「普通攻击连续造成两次伤害」（走 `BRANCH_POLICIES.sword`）。
- 天赋「黑色猎犬」（每个潜能档一条候选，本客户端取 pot0）：

| 潜能档 | 每次斩击 | 最后一次 | 恐惧 |
| --- | --- | --- | --- |
| pot0（本客户端） | 攻击力 100% 法术伤害 | 攻击力 200% | 4 秒 |
| pot1 | 120% | 240% | 4 秒 |
| pot2 | 140% | 280% | 4 秒 |
| pot3 | 160% | 320% | 4 秒 |
| pot4 | 180% | 360% | 4 秒 |
| pot5 | 200% | 400% | 4 秒 |

  完整文本：部署后对周围一定范围内最近的 1 名敌人发动**总计 6 次无视闪避**的斩击，每次造成相当于攻击力 X% 的法术伤害，最后一次斩击改为造成攻击力 Y% 的法术伤害并使目标**恐惧** 4 秒。
- 主动技能：**无**（`skillRefs` 为空，档案显示「无主动技能」）。
- 潜能：五档全是「天赋效果加强」——即上表的 pot1…pot5，本客户端未接入。

### 3.2 埃癸斯 `char_4218_aigis` → `chess_collab_aigis`

5 星狙击／裂空炮手（`skybreaker`），远程位，5 阶。

| 阶段 | 等级上限 | 范围 | 生命 | 攻击 | 防御 | 法抗 | 费用 | 阻挡 | 攻击间隔 | 再部署 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | 50 | `3-6` | 939 | 573 | 155 | 0 | 20 | 1 | 2.1 | 70 |
| P1 | 70 | `3-1` | 1189 | 740 | 197 | 0 | 22 | 1 | 2.1 | 70 |
| **P2（本客户端）** | **80** | **`3-1`** | **1586** | **882** | **219** | **0** | **22** | **1** | **2.1** | **70** |

- 特性（分支「裂空炮手」，按 revision 427899 更正后的文本）：可对空；**非技能期间默认仅攻击飞行单位与自身阻挡的单位**；未开启技能的情况下，可以且优先攻击自身阻挡的单位（即使目标处于攻击范围外）；**技能期间攻击造成范围伤害，溅射半径 1.1**。
  - 旧的「分支一览」措辞（部署后起飞，起飞后只攻击空中敌人；技能开启时降落且攻击群体物理伤害）保留在 `branch-rules.json` 的 `baseTraitLegacy` 里备查。**起飞／降落的表现仍未实现**（`BRANCH_POLICIES.skybreaker.pending`）。
- 天赋「反暗影特殊压制兵装」（第一格天赋第一档为空，实际生效的是第二格）：

| 阶段 | 潜能 | 造成物理伤害 | 受到物理伤害 |
| --- | --- | --- | --- |
| P1 | pot0 | +5% | −5% |
| P1 | pot4 | +7% | −7% |
| **P2** | **pot0（本客户端）** | **+10%** | **−10%** |
| P2 | pot4 | +12% | −12% |

- S1「启动狂宴模式」（持续 20 秒；未阻挡时随机攻击范围内目标；技能结束后自身晕眩 10 秒）：

| 等级 | 消耗 | 初始 | 攻击力 | 防御 |
| --- | --- | --- | --- | --- |
| 1 | 35 | 10 | +40% | +20% |
| 4 | 30 | 10 | +70% | +30% |
| 7 | 27 | 12 | +100% | +50% |
| **10（本客户端）** | **24** | **15** | **+140%** | **+70%** |

- S2「全弹发射」（瞬发，锁定范围内 1 个目标发射 6 枚导弹，之后飞踢目标及周围敌人）：

| 等级 | 消耗 | 初始 | 每枚导弹 | 飞踢 |
| --- | --- | --- | --- | --- |
| 1 | 35 | 10 | 攻击力 70% 物理 | 攻击力 150% 物理 |
| 4 | 30 | 10 | 100% | 210% |
| 7 | 27 | 12 | 130% | 270% |
| **10（本客户端）** | **24** | **15** | **160%** | **300%** |

- 潜能：部署费用-1／再部署时间-4 秒／攻击力+33／天赋效果增强／部署费用-1（未接入）。

### 3.3 岳羽由加莉 `char_4219_yukari` → `chess_collab_yukari`

5 星辅助／**游击手**（`supportiveranger`），远程位，5 阶。

| 阶段 | 等级上限 | 范围 | 生命 | 攻击 | 防御 | 法抗 | 费用 | 阻挡 | 攻击间隔 | 再部署 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | 50 | `3-1` | 870 | 501 | 134 | 0 | 14 | 1 | 2.1 | 70 |
| P1 | 70 | `3-18` | 1177 | 643 | 176 | 5 | 16 | 1 | 2.1 | 70 |
| **P2（本客户端）** | **80** | **`3-18`** | **1510** | **775** | **200** | **10** | **16** | **1** | **2.1** | **70** |

- 特性（分支「游击手」，revision 427899）：**可以使用触发型效果协助作战**；可对空。
- 天赋「治愈之风」：技能结束后，治疗自身和攻击范围内最多 N 名干员相当于攻击力 X% 的生命值。

| 阶段 | 潜能 | 目标数 | 治疗量 |
| --- | --- | --- | --- |
| P1 | pot0 | 2 | 50% |
| **P2** | **pot0（本客户端）** | **3** | **100%** |

- S1「龙卷箭」（瞬发：三发箭矢→范围法术伤害→浮空）：

| 等级 | 消耗 | 初始 | 每发箭矢 | 追加范围伤害 | 浮空 |
| --- | --- | --- | --- | --- | --- |
| 1 | 35 | 0 | 攻击力 50% 法术 | 攻击力 200% | 1.5 秒 |
| 4 | 32 | 5 | 55% | 250% | 1.5 秒 |
| 7 | 26 | 10 | 65% | 300% | 1.5 秒 |
| **10（本客户端）** | **20** | **10** | **80%** | **400%** | **1.5 秒** |

- S2「明镜止水」（瞬发，为范围内最多 N 名我方干员——优先结城理、术师干员——施加**触发型效果**：该干员施放技能后，自身在 15 秒内获得 X% 术法充盈）：

| 等级 | 消耗 | 初始 | 目标数 | 术法充盈 |
| --- | --- | --- | --- | --- |
| 1 | 48 | 5 | 3 | 10% |
| 3 | 46 | 5 | 3 | 15% |
| 5 | 43 | 10 | 4 | 15% |
| 7 | 39 | 15 | 4 | 20% |
| **10（本客户端）** | **30** | **15** | **4** | **30%** |

- 潜能：部署费用-1／再部署时间-4 秒／攻击力+30／再部署时间-6 秒／部署费用-1（未接入）。

### 3.4 结城理 `char_4217_makoto` → `chess_collab_makoto`

6 星特种／傀儡师（`dollkeeper`），近战位，6 阶。

| 阶段 | 等级上限 | 范围 | 生命 | 攻击 | 防御 | 法抗 | 费用 | 阻挡 | 攻击间隔 | 再部署 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | 50 | `1-1` | 1749 | 488 | 194 | 0 | 14 | 2 | 1.2 | 70 |
| P1 | 80 | `1-1` | 2215 | 643 | 253 | 0 | 14 | 2 | 1.2 | 70 |
| **P2（本客户端）** | **90** | **`1-1`** | **2805** | **785** | **305** | **0** | **16** | **2** | **1.2** | **70** |

- 特性（傀儡师，`trait.candidates[0]`，黑板 `duration = 20`，`rangeId = x-1`）：受到致命伤时不撤退，切换成**替身**作战（替身阻挡数为 0），持续 20 秒后自身再次替换。
- 天赋一「不羁之力」（`atk` / `base_attack_time` / `sluggish` / `max_hp_t1`）：

| 阶段 | 潜能 | 切换时停顿 | 替身攻击力 | 替身生命 | 攻击间隔 |
| --- | --- | --- | --- | --- | --- |
| P0 | pot0 | — | +40% | +35% | +0.4 |
| P1 | pot0 | 5 秒 | +60% | +35% | +0.4 |
| **P2** | **pot0（本客户端）** | **8 秒** | **+80%** | **+35%** | **+0.4** |
| P2 | pot4 | 8 秒 | +85% | +35% | +0.4 |

- 天赋二「S.E.E.S. 总攻击」（替身状态结束后，带领 S.E.E.S. 小队发动总攻击，对小队队员周围一定范围内所有敌人造成攻击力 X% 的**真实伤害**，可叠加）：

| 阶段 | 潜能 | 真实伤害 |
| --- | --- | --- |
| P0 | pot0 | 180% |
| P1 | pot0 | 280% |
| **P2** | **pot0（本客户端）** | **430%** |
| P2 | pot2 | 450% |

- 三个技能都是「被动：替身状态召唤某个**人格面具**；主动：立即切换为替身状态作战」，技能本身**持续 0 秒**（切换即结束，PRTS 备注写「因切换替身会终止技能，故技能开启后会立刻在同一帧内结束」）。人格面具在游戏数据里**不是独立单位**，数值全部挂在这三个技能的 `attack@*` 黑板里，所以客户端按「替身形态换攻击档案」实现，不新增召唤物实体。

**S1「俄耳甫斯的竖琴」**（被动：替身状态召唤俄耳甫斯，攻击造成攻击力 X% 法术伤害；范围内有生命值低于 50% 的友方干员时改为治疗其攻击力 Y% 的生命值。PRTS 备注：**不可对空**）：

| 等级 | 消耗 | 初始 | 攻击伤害 | 治疗量 |
| --- | --- | --- | --- | --- |
| 1 | 20 | 0 | 110% | 30% |
| 4 | 14 | 0 | 150% | 40% |
| 7 | 8 | 4 | 210% | 50% |
| **10（本客户端）** | **7** | **7** | **280%** | **60%** |

**S2「塔纳托斯的囚锁」**（被动：替身状态召唤塔纳托斯，攻击对至多 N 名敌人造成攻击力 X% 法术伤害并有 35% 概率恐惧 1.5 秒；范围内恐惧中的敌人若生命值低于结城理攻击力的 Y% 则立刻倒下。PRTS 备注：普攻**不可对空**，但斩杀光环**可对空**）：

| 等级 | 消耗 | 初始 | 目标数 | 攻击伤害 | 恐惧概率 | 斩杀阈值 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 24 | 0 | 3 | 120% | 35% | 200% |
| 6 | 14 | 5 | 3 | 200% | 35% | 230% |
| 7 | 12 | 6 | 4 | 220% | 35% | 250% |
| **10（本客户端）** | **12** | **7** | **4** | **250%** | **35%** | **280%** |

**S3「开辟明日的剑刃」**（被动：替身状态初始召唤塔纳托斯·改，攻速 +X，攻击对至多 N 名敌人造成攻击力 Y% 的**弱点伤害**；塔纳托斯在场时，开启技能或受到致命伤改为召唤俄耳甫斯·改，阻挡数 +2，使范围内友方干员获得 Z% 物理与法术闪避，并每秒治疗范围内最多 M 名友方干员相当于攻击力 W% 的生命值。PRTS 备注：塔纳托斯·改普攻**可对空**，弱点伤害默认法术伤害）：

| 等级 | 消耗 | 初始 | 攻速 | 目标数 | 弱点伤害 | 闪避 | 每秒治疗 | 治疗目标 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 29 | 0 | +15 | 3 | 140% | 25% | 20% | 3 |
| 4 | 20 | 5 | +30 | 3 | 170% | 30% | 25% | 3 |
| 7 | 15 | 7 | +45 | 4 | 200% | 35% | 30% | 4 |
| **10（本客户端）** | **15** | **10** | **+60** | **4** | **230%** | **40%** | **35%** | **4** |

- 潜能：部署费用-1／第二天赋效果增强／攻击力+34／第一天赋效果增强／部署费用-1（未接入）。

## 4. 接线清单（改了哪些文件）

| 文件 | 改动 |
| --- | --- |
| `data/modes/alliance-lower/collab-operators.json` | 新增：四人登记表（charId／chessId／阶级／档位／口径／来源） |
| `scripts/build-native.mjs` | 构建时把四人的实体／技能／范围并进 `base`，并补 4 条 `isHidden` + 无盟约 + 无卫戍的隐藏档；`groupId`／`teamId` 回落到 rel77 的 `character_table.json` |
| `scripts/sync-collab-assets.mjs` | 新增：从 PRTS 取四张头像（sha1 校验）并登记进 `dist/assets/prts/manifest.json`（376 → 380） |
| `data/prts/branch-rules.json` | 新增游击手记录（`supportiveranger`）；裂空炮手 `baseTrait` 按 revision 427899 更正，补 `runtime.splashDuringSkill = 1.1` |
| `dist/native-branches.js` | `BRANCH_POLICIES` 新增 `supportiveranger`；`skybreaker` 补 `splashDuringSkill`；`branchBehavior` 支持「技能期间改溅射」；`SKILL_ANTIAIR` 新增结城理 S3（PRTS 备注「塔纳托斯·改普通攻击可对空」） |
| `tests/native-collab-operators.test.mjs` | 新增 8 条回归：登记表↔运行时一致、属性／技能／天赋黑板与 rel77 逐项一致、隐藏档不进商店与名册、技能测试场可达、分支数据与策略一一对应、头像在位 |
| `dist/native-collab.js` | 新增：联动干员的钩子派发（`deploy`／`statMods`／`skillStart`／`tick`／`attackModifier`／`damageReduction`／`event` 七个入口），按 charId 取实现 |
| `dist/native-collab-{kormr,aigis,yukari,makoto}.js` | 新增：四名干员各自的技能／天赋实现（依赖方向单向：effects → collab → collab-*，实现文件不得反向 import） |
| `dist/native-effects.js` | 接线三处：`deploy` 分支调 `collabDeploy`、`dispatch` 末尾调 `collabEvent`、`tickLogic` 的单位循环调 `collabTick` |
| `dist/native-operator-effects.js` | 接线四处：`statMods`／`operatorSkillStart`／`attackModifier`／`damageReductionFor` 各加一次钩子调用 |
| `scripts/build-browser.mjs` | 登记五个新模块 |
| `tests/native-air-targeting.test.mjs` | 「本期地面干员」的可见性判定改用 `charShopChessDatas[chessId].isHidden`（原来读 profile 上不存在的 `isHidden`，隐藏档会漏进本期门禁） |
| `tests/alliance-data.test.mjs` | 资源清单数量 376 → 380 |

## 5. 已实现 / 未实现

已完成（本阶段）：四个干员的数据、头像、隐藏档、分支特性、对空表、技能／天赋钩子骨架、测试与门禁。也就是说，**技能测试场里已经能选出这四个人、看到完整属性／技能文案／分支特性**，且他们不会出现在商店、名册或盟约面板里。

技能与天赋的战斗行为按人分文件实现，回归各自独立（这样四个人的实现互不干扰，也不会再把 `native-operator-effects.js` 的逐名分支撑大）：

| 实现文件 | 回归 |
| --- | --- |
| `dist/native-collab-kormr.js` | `tests/native-collab-kormr.test.mjs` |
| `dist/native-collab-aigis.js` | `tests/native-collab-aigis.test.mjs` |
| `dist/native-collab-yukari.js` | `tests/native-collab-yukari.test.mjs` |
| `dist/native-collab-makoto.js` | `tests/native-collab-makoto.test.mjs` |

钩子入口（都在 `dist/native-collab.js`，共享文件里各只加一次调用）：

| 钩子 | 调用点 | 用途 |
| --- | --- | --- |
| `deploy(battle,unit)` | `native-effects` 的 `deploy` 事件 | 虎狼丸的天赋斩击 |
| `statMods(battle,unit,out)` | `native-operator-effects.statMods` | 技能／替身形态的属性加成 |
| `skillStart(battle,unit,ctx)` | `native-operator-effects.operatorSkillStart` | 开技那一帧的伤害链与施加（返回 true 会压制通用兜底） |
| `attackModifier(battle,unit,target,value)` | `native-operator-effects.attackModifier` | 造成的伤害乘算（埃癸斯的物理增伤、人格面具的攻击档案） |
| `damageReduction(battle,unit,type,attacker,reduction)` | `native-operator-effects.damageReductionFor` | 受到的伤害减免（埃癸斯的物理减伤） |
| `tick(battle,unit,ctx)` | `native-effects.tickLogic` 的单位循环 | 逐帧／每秒结算（斩杀复查、每秒治疗） |
| `event(battle,unit,type,payload,ctx)` | `native-effects.dispatch` 末尾 | 监听者视角的事件（技能结束的治疗、友军开技触发的触发型效果、替身结束的总攻击） |

四人的技能与天赋已经实装（逐人回归见下表），下面把「已实现」与「仍未闭环」分开写清楚——**不要因为测试是绿的就把未闭环项当成已实现**。

### 5.1 虎狼丸

已实现（`dist/native-collab-kormr.js`，12 条回归）：部署后对天赋 `rangeId`（`x-1`）范围内**最近 1 名敌人**发动 6 次独立结算的斩击（5 次 `atk_scale`＋第 6 次 `final_atk_scale`，法术伤害，各留一条 damage 记录），最后一次后按黑板 `fear` 施加恐惧；范围内没有敌人、目标中途被击倒、黑板缺倍率等边界都有用例。

未闭环：① 斩击次数 6 写在代码里（PRTS 文案固定值，黑板没有次数键）；② 「最近」用欧氏距离（文案没写度量），同距离取 uid 小；③ 未区分空中／地面（文案没限定）；④ ✅ 「无视闪避」已改用共享层开关 `dealDamage({ignoreDodge:true})`（2026-09-27 补，见 §5.6）；⑤ 表现层没有专门的斩击特效。

### 5.2 埃癸斯

已实现（`dist/native-collab-aigis.js`，8 条回归）：天赋「造成侧」物理伤害 ×`damage_scale`（通用 `attackModifier` 的天赋循环匹配不到她的文案，必须自己补）；S2「全弹发射」——开技帧锁目标、`times` 枚导弹（半径 1.1）＋延后 0.12 秒的飞踢（半径 2.0，PRTS 备注口径），并把通用瞬发兜底压掉；S1 的索敌口径（**被阻挡时优先打阻挡者，未阻挡时在可选目标里随机**）用 `unit.floatTarget` 每帧重选、技能结束撤锁。

通用层已经覆盖、本文件**故意不再实现**（避免乘两遍，已实测）：S1 的攻／防加成（`native-battle.stats` 的通用技能黑板分支）、S1 结束自晕（`native-effects.onSkillEnd`）、天赋「受到侧」物理减伤（`damageReductionFor`）。天赋「受到侧」在钩子里按同一黑板值显式重述一次，作为口径存档。

未闭环：① ✅ S1 期间的伤害半径已按 PRTS 备注变成 2.0（2026-09-27 补的技能级覆盖表 `SKILL_SPLASH`，见 §5.6）；② 「起飞／降落」仍未做（分支自己登记为 `pending`；PRTS 修正后的特性文本口径已由 `airOnlyIdle` 覆盖，剩下的是原作的飞行阻挡表现）；③ 飞踢的溅射集合是开技瞬间按目标位置算的快照，目标被推走会有偏差；④ 普攻类型判闸门用的是 `battle.baseDamageType(unit)`，陈策略／弱点装备会把类型改写成「物理与法术里较大的那个」，这种组合下天赋会少算。

### 5.3 岳羽由加莉

已实现（`dist/native-collab-yukari.js`，7 条回归）：天赋「治愈之风」（技能结束后治疗自身＋范围内生命比例最低的干员，满血的非自身目标不入池，最多 `max_target` 名）；S1「龙卷箭」（3 发 `multi_atk_scale`＋1 次 `final_atk_scale` 范围法术，半径 1.1 的圆判定，按黑板 `levitate` 浮空）；S2「明镜止水」（按 结城理 → 术师 → 部署先后 的顺序给最多 `max_target` 名友军挂触发型效果，友军开技时消费一次，转成 `duration` 秒的术法充盈窗口＋`magicArcane` 状态；施加当帧不自我触发；离场清字段）。两个技能都返回 `true` 压掉通用开技兜底。

口径说明（要记住的两条）：① 她两个技能都是**瞬发**，而客户端只在「持续／弹药技能结束」那一帧派发 `skill-end`，所以「技能结束后」的治疗是 `hooks.tick` 在同一帧补结算的（`tickLogic` 晚于 `activate`），持续技仍走 `skill-end`，两条路共用一份实现且只消费一次；② 术法充盈的增伤由**共享层通道**结算（`native-operator-effects.attackModifier` 读任何伤害来源的 `unit.yukariArcane` 窗口），本文件只写／清窗口——2026-09-27 起友军吃到的术法充盈也会真的进伤害。

未闭环：① ✅ 友军术法充盈的数值已进结算（共享层通道，见 §5.6）；② 「触发型效果」目前只有她这一处实现，分支策略里的 `triggerEffect` 标记还只是个登记。

### 5.4 结城理

已实现（`dist/native-collab-makoto.js`，29 条回归）：天赋一（切换替身时按黑板 `sluggish` 停顿范围内敌人；替身形态生命上限 ×(1+`max_hp_t1`)、攻击间隔 +`base_attack_time` 秒、攻击力按 `atk`）；天赋二（替身结束后对每个 `teamId==='sees'` 队员的 `range_id` 范围内敌人造成攻击力 ×`atk_scale` 真实伤害，可叠加）；三个人格面具的倍率与附带效果（S1 低血友军改为治疗、S2 概率恐惧＋恐惧斩杀、S3 攻速＋物理闪避光环＋每秒治疗）；**S3 的两段替身（塔纳托斯·改 → 俄耳甫斯·改）与人格面具配色见 §5.4.1**。进入替身走的是现有「受到致命伤」管线（`runFatal` 的傀儡师分支 → `enterDoll`），切换**延后一帧**完成，以保住 S3 开技那一帧的对空窗口。

未闭环（逐条，都是引擎通道限制，不是漏接线；第①②⑤⑦条已由 §5.6 的共享通道解决）：① ✅ **攻击伤害类型**已可改（`unit.dollDamageType`：S1／S2 走法术；S3 走弱点伤害，见 §5.6）；② ✅ **`attack@max_target`** 已生效（`unit.attackTargetCountOverride` 覆写普攻目标数）；③ 攻击间隔 +0.4 秒是**换算进攻速通道**的近似（`stats()` 不读 `baseAttackTime` 修正）；④ S3 的 `attack@block_cnt`(2) 只在**俄耳甫斯·改**期间由 `battle.stats` 的返回值覆写生效（塔纳托斯·改仍是 0 阻挡），见 §5.4.1；⑤ ✅ **法术闪避**已有与物理对称的通道（`unit.artsEvadeUntil/artsEvadeProb/artsEvadeOnce`），俄耳甫斯·改的「物理与法术闪避」两半都落进结算；⑥ ✅ S3「塔纳托斯·改在场时开启技能或受到致命伤改为召唤俄耳甫斯·改」**已实现**（battle 实例补丁，见 §5.4.1）；⑦ ✅ **替身形态对空**已可开（`unit.dollAntiAir`，塔纳托斯·改为真）；⑧ 进入替身走真实致死管线，会被护盾／屏障先吃掉一部分，并在战报里留一条 `knockdown`；⑨ 天赋一的 `atk` 与通用通道耦合（通用通道把它当常驻加成，本文件在基础形态用负项抵消——将来通用通道改成按形态判定，这个负项要跟着删）；⑩ S1 的「改为治疗」是近似语义（仍会走一次 0 伤害的普攻动作）。

### 5.4.1 结城理 S3「开辟明日的剑刃」的两段替身与形态配色（用户 2026-09-27 口径，**已实现**）

上表 §5.4 未闭环第⑥条（「塔纳托斯·改在场时开启技能或受到致命伤改为召唤俄耳甫斯·改」做不到）已按用户要求实现，并追加了形态配色。**实现方式与当初设想的「挂在三个已有钩子上」不同**，以实际代码为准：

**已实现**（`dist/native-collab-makoto.js`，新增 6 条回归，合计 29 条）：
- `unit.persona` 生命周期：进入 S3 替身那一帧 → `'thanatos'`；窗口内**一次**切换（再次点按技能键／受到致命伤）→ `'orpheus'`；替身窗口结束、重新部署、离场/未部署 → 清空；S1／S2 与其它傀儡师一律不写（`native-fx` 走通用紫色）。
- 俄耳甫斯·改：不普攻（`attackModifier` 返回 0）、阻挡覆写成 2、每秒对范围内未满血友方挂一批**延迟 0.5 秒**的治疗（剂量＝当前攻击力 × `attack@heal_scale`，`values.heal` 走 `applyHeal`、受禁疗制约）。
- 视觉：`dist/native-fx.js` 新增 `DOLL_PERSONA_STYLE`（塔纳托斯＝半透明黑罩＋深蓝流动，俄耳甫斯＝半透明白罩＋金色流动）＋`tintAlpha`；`drawDollOverlay` 命中 persona 才走新配色，**没有/未知 persona 时整段仍是原来的紫色实现**（`reduceFx` 只留静止罩色）。

**引擎堵点与绕法（重要，别按「应该挂在钩子上」去改回去）**：替身形态下 `native-battle.activate()` 第一行 `if(u.dollForm)return`、`runFatal` 的傀儡师分支要求 `!target.dollForm`、`stats()` 收尾又 `if(u.dollForm)a.blockCnt=0`，三条路都从钩子外部堵死。所以 `dist/native-collab-makoto.js` 在**部署那一刻给这一场 battle 实例**打本地补丁（`patchBattle`，带 `battle.makotoDollPatch` 幂等标记，包装的是实例上的 `activate`／`hurt`／`stats`，原函数照旧调用，不碰原型、不碰上游文件）：`activate` 抢主动切换（用 `unit.makotoSwitchFrame` 记帧，区分玩家按键与引擎同一帧的自动开技复问），`hurt` 抢致命伤那一次（结算前摘 `dollForm` → 引擎按本体挨致命伤走替身分支 → 结算后装回原 `until`、补血、`swapDoll`；只有 >1 血才保护，避免赖场），`stats` 只改返回值给出俄耳甫斯·改的 2 阻挡。

**仍受引擎限制、尚未闭环**：攻击间隔 +0.4 秒仍以攻速通道近似；进入替身沿用真实致死管线，护盾／屏障会先结算且战报保留 `knockdown`；天赋一的 `atk` 与通用常驻加成耦合，基础形态仍用负项抵消；S1「改为治疗」仍会走一次 0 伤害的普攻动作。攻击类型、普攻目标数、法术闪避、塔纳托斯对空与 S3 两段切换已由 §5.4／§5.6 的共享通道实现，不再列为未接线项。

**回归**：`tests/native-collab-makoto.test.mjs` 的 6 条新用例（进入/清空 persona、主动切换、致命伤切换、不普攻＋阻挡 2、延迟治疗、配色），fail-before 实测（还原 dist 后 6 条全挂）。另外 `dist/native-effects.js` 的 `settlePeriodic` 为此多了一条 `fx.values?.heal != null ⇒ applyHeal` 分支——**延迟伤害分支逐字未改**（这条不做就没法表达「延迟治疗」）。

**机制（PRTS 技能备注 revision 425074）**
- 携带 S3 时，因特性／技能进入替身形态 → 先是**塔纳托斯·改**（普攻可对空、弱点伤害默认法术、持【阻回】）。
- 在塔纳托斯·改在场期间，**再次点按技能键可主动切换**为**俄耳甫斯·改**；**受到致命伤时也改为**召唤俄耳甫斯·改（两者都是同一替身窗口内的一次性切换，替身总时长仍取特性黑板的 20 秒）。
- 俄耳甫斯·改：不进行普通攻击、**阻挡不再归零（恢复正常的 2 阻挡数）**、持【阻回】【静默】；切换完毕的瞬间及之后每 1 秒，对攻击范围内生命值不满的若干友方单位施加**延迟治疗**（0.5 秒后生效，治疗量按结城理当前攻击力 × `attack@heal_scale`，属于治疗行为、受禁疗制约）。
- 熄火条件：替身窗口结束（`dollForm` 到期）回到本体；期间本体不吃任何伤害以外的形态残留。

**视觉（用户口径）**
- 塔纳托斯（含塔纳托斯·改）：头像叠加**半透明黑**罩色 ＋ **深蓝色流动特效**。
- 俄耳甫斯（含俄耳甫斯·改）：头像叠加**半透明白**罩色 ＋ **金色流动特效**。
- 沿用现有唯一入口 `native-fx.drawDollOverlay(c,actor,box,{reduceFx,time})`（`native-play.draw()` 里紧跟 `drawConcealOverlay` 之后调用一次）：改成按 `actor.persona`（`'thanatos' | 'orpheus'`，`null` 时保持现在的紫色通用罩色）取配色；`reduceFx` 下只留静止罩色、不画流动。

**接线点（当初的计划，实际实现见上面「引擎堵点与绕法」）**：`unit.persona` 与俄耳甫斯·改的三条效果挂在 `statMods`／`attackModifier`／`tick`；`native-fx.drawDollOverlay` 按 persona 取样式；`native-play` 的绘制入口不用改（仍是一处）。

### 5.5 其他已知缺口

- 潜能与信赖未接入（全客户端统一口径，不是这四人特有）。
- 四个干员没有模组（`modules` 为空），因此不需要模组数据。
- 立绘／动画：只有头像；战斗中的角色绘制沿用通用表现（`dist/assets/prts` 里没有这四人的 spine 资源）。
- 「起飞／降落」（裂空炮手）与「触发型效果」（游击手）已登记在 `BRANCH_POLICIES` 的 `pending` 里。

### 5.6 本次补的共享层通道（2026-09-27，联动四人用到的引擎缺口）

四人受引擎限制的那几条「做不到」，这一轮改成了**共享层的正经通道**（不是给某个干员开洞），每一条都有回归：

| 通道 | 位置 | 谁在用 | 语义 |
| --- | --- | --- | --- |
| `unit.dollDamageType` | `native-battle.behavior()` 的替身分支 | 结城理 S1／S2 → `'arts'` | 替身形态的普攻类型；未设置＝沿用原行为（幽灵鲨那类仍是分支值） |
| `unit.dollAntiAir` | 同上 | 结城理 S3 的塔纳托斯·改 → `true` | 替身形态可否对空（默认 false，与原行为一致） |
| `unit.attackTargetCountOverride` | `native-battle` 普攻决策处的 `count` | 结城理 S2／S3 → `attack@max_target` | 本次普攻的目标数覆写（0／未设置＝按分支与技能黑板算） |
| `unit.artsEvadeUntil`／`artsEvadeProb`／`artsEvadeOnce` | `native-battle.hurt()` 的闪避链 ＋ `deploy()` 重置表 | 结城理 S3 的俄耳甫斯·改光环（友军） | **法术闪避**，与既有的 `physicalEvade*` 完全对称 |
| `unit.weaknessAttacker` | `native-sees.weaknessSource()` → `native-battle.hit()` 的类型路由 | 结城理 S3、虎狼丸（charId 判定保留） | 「造成的伤害是弱点伤害」的统一标记 |
| `dealDamage({ignoreDodge:true})` | `native-effects.dealDamage`（闪避判定的唯一入口）＋ `native-battle.hit()` 转发 opts | 虎狼丸天赋斩击 | 无视闪避；以前靠在结算期间压 0 再写回绕过 |
| `unit.yukariArcane`（窗口） | `native-operator-effects.attackModifier` | 岳羽由加莉 S2 的术法充盈（友军也能吃到） | 「任意干员增伤」的唯一入口，`(1+value)` 乘算 |
| `SKILL_SPLASH` | `native-branches.branchBehavior`（与 `SKILL_ANTIAIR` 同一套写法） | 埃癸斯 S1 → 2.0 | 技能级溅射半径覆盖，依据 PRTS 技能备注 |
| `log()` 的 `type` 冲突 | `native-effects` 的 `evade`／`summon` 记录 | — | payload 里再写 `type` 会把日志类型覆盖掉（`logOf(b,'evade')` 永远查不到），已改名 `damageType`／`summonType` |

回归：`tests/native-collab-makoto.test.mjs`（类型／对空／多目标／法术闪避）、`native-collab-yukari.test.mjs`（友军术法充盈进结算）、`native-collab-kormr.test.mjs`（ignoreDodge 开关 + 对照组）、`native-collab-aigis.test.mjs`（S1 半径 2.0 ＋ PRTS 备注门禁）。

## 6. 联动工作顺带修掉的三个通用层 bug

这些不是联动干员特有的问题，而是他们的回归把既有兜底的错处暴露出来（都在 `dist/native-operator-effects.js`，各有回归）：

| bug | 症状 | 修法 |
| --- | --- | --- |
| 部署触发型天赋被命中兜底重复施加状态 | 虎狼丸的**每一次普通攻击**都附带 4 秒恐惧（天赋本意是只有部署斩击的最后一下） | after-damage 天赋兜底跳过文案写「部署后／部署时／入场时／落地时」的天赋；全表核对只有虎狼丸一条带裸 `fear` 键 |
| 减免兜底不看伤害类型 | 写「受到的物理伤害-X%」的天赋连**法术**伤害一起减（埃癸斯、维娜「诸王的叹息」、濯尘芙蓉「重盈」） | 文案限定类型时只对该类型生效；「物理与法术／所有伤害／伤害降低／来自【X】敌人的伤害」保持类型无关 |
| 浮空兜底读错黑板键 | 通用分支读 `floating ?? duration ?? 2`，而原表键名是 `levitate`，会把 1.5 秒刷成 2 秒 | 改成 `levitate ?? floating ?? duration ?? 2`（岳羽由加莉模块里的同值 clamp 随之成为 no-op） |

三处的 fail-before 都实测过：把对应源码行还原后，「普攻不挂恐惧」与「物理减伤不吃法术」两条回归立刻失败。
