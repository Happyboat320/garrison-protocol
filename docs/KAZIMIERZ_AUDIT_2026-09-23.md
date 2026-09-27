# 卡西米尔盟约与相关干员核查（2026-09-23）

核查范围：`kazimierzShip` 盟约本体、10 名盟约成员、与之联动的装备与卫戍效果。结论：**盟约本体没有缺口**，**相关干员有 5 处缺口**，本轮全部修好并配了会在改前失败的回归（`tests/native-kazimierz-gaps.test.mjs`，6 条用例）。

## 一、盟约本体：逐项核对通过

成员 10 名（`charShopChessDatas` 与干员 `bonds` 一致，共 20 个 chessId）：野鬃、砾、灰毫、瑕光、流星、焰尾、远牙、玛恩纳、耀骑士临光、锏（锏同时属谢拉格，两个盟约各自计数一次）。

| 项 | 实现位置 | 核对结果 |
| --- | --- | --- |
| 3 人激活（`activeCount:3`／`BOARD`） | `protocol.activeBonds` | ✓ |
| 每次有干员部署，卡西米尔干员攻击力 +20%，上限 `base_max_atk_when_born + max_atk_when_born_per_stack × 层` | `native-effects.bondDeploy` | ✓ 实测 30 层 7 次部署后 `deploymentBuff=0.80`（＝0.5+0.01×30） |
| 6 名不同卡西米尔：阻挡时每 2 秒 120% 攻击力真实伤害 + 0.1 秒晕眩，半径取 `range_radius` | `native-effects.bondPeriodic` | ✓ 周期伤害按 1.2×攻击力结算 |
| 6 名不同卡西米尔：未阻挡时攻击附带 30% 攻击力真实伤害 | `native-battle.hit` | ✓ 实测一次 100 物理攻击共掉 496＝100+0.3×1320 |
| 「6 名**不同**」按干员去重（精锐／初始算同一名） | `activeBonds` 用 `new Set(members.map(u=>u.charId))` | ✓ |
| 9 个黑板键登记与消费 | `native-bond-keys.js` 的 `kazimierzShip` 块全为 `formula` | ✓ 无 pending |
| 面板「上限受层数影响」数据驱动 | `protocol.bondScaledParams` | ✓ 30 层显示「+80%／0.5 + 0.01 × 30层」 |
| 「持续至战斗结束」不跨回合残留 | `NativeBattle` 每场重建单位对象（`native-battle.js:47`） | ✓ |

口径待定（本轮未改，原文没写）：周期晕眩用 `resistible:false`；未阻挡的 30% 真伤走 `hit()`，**技能伤害也会触发**，且多段／多目标会逐段逐目标各附一次（叙拉古那条同类效果明确排除了技能，卡西米尔没有排除）。

## 二、本轮修好的 5 处相关干员缺口

### 1. 耀骑士临光「不畏苦暗」范围错（最明显）

- **问题**：`native-effects.onOperatorDeploy` 用 `chebyshev(e,u)<=4`（含斜角的 9×9＝81 格），而原表天赋自带 `rangeId: "x-5"`，`x-5` 是**自身＋上下左右四格**（5 格）。实测距离 2 与 4 的敌人都吃满 80% 真伤＋3 秒晕眩。
- **数据管道**：`protocol.resolveActiveTalents` 解析天赋时只保留 `slot/name/description/blackboard/prefabKey`，**把 `rangeId` 丢了**，`activeTalents` 里根本拿不到范围。已补：候选与模组覆盖两条路径都带 `rangeId`，模组覆盖时沿用原天赋的 `rangeId`。
- **改法**：用 `battle.cellsForRangeId(u,t.rangeId)` 取格 + `containsTarget` 判定；没有 `rangeId` 时才退回「周围四格」（`chebyshev<=1`）。**不许再用包围半径近似**（与 `docs/SKILL_RANGE_AUDIT_2026-09-22.md` 的范围口径一致）。
- **注意**：`rangeId` 是**编译期烘进 `runtime-data.js`** 的，改完必须 `npm run build` 才会出现在 `profiles[].activeTalents` 里。

### 2. 耀骑士临光「上一名部署干员势力为【卡西米尔】时额外造成一次伤害」未实现

- **问题**：全 `dist/native-*.js` 没有任何「上一名部署」跟踪，这条天赋从未生效。
- **改法**：在 `native-effects` 的 `deploy` 事件里，**先跑部署天赋、再记录本次部署者**，写进战斗状态 `battle.s.lastDeployedKazimierz`（召唤物不是干员，既不计数也不覆盖记录）；天赋读这个旧值决定真伤／晕眩结算 1 次还是 2 次。字段在 `ensureBattleShape` 里有默认值，旧存档照常读。
- 实测：部署卡西米尔干员后记录为真、部署非卡西米尔后为假；`lastDeployedKazimierz=true` 时伤害正好是 `false` 时的两倍。

### 3. 焰尾「红松骑士团团长」不是物理限定，且闪避率写死

- **问题**：`native-battle.hurt` 里条件是 `e.damageType!=='true'` → **法术伤害也被闪避**（实测随机数固定时 1000 点法术打成 0 掉血）；原文是「22% 的**物理**闪避」。闪避率还写死 `.22`，没读天赋黑板 `prob`。
- **改法**：条件收窄成 `e.damageType==='physical'`，闪避率读光环持有者天赋黑板的 `prob`（缺字段才回落 0.22；`prob=0` 不能再被当成缺字段）。
- **同源检查**：「前锋剑术」的触发是齐的（光环闪避与技能闪避都会置 `flamFollowUp`，闪避后追加攻击所有阻挡目标）✓。

### 4. 玛恩纳「无动于衷」的嘲讽没生效

- **问题**：天赋黑板 `taunt_level:1`，实测 `stats.tauntLevel=0`。通用天赋属性映射要求文案含「更容易受到**敌人**攻击」，而本条原文是「在场时，**自身更容易受到攻击**」→ 匹配不到。
- **改法**：嘲讽类天赋单独判定 `tauntTalentActive(text,battle,u)` —— 原文有三种写法（「更容易受到攻击」「不容易受到敌人攻击」「不容易成为敌人的目标」），并按分句里的「技能开启时／技能未开启时」决定是否条件式生效。
- 顺带修好同源的两条：远牙「屏息」（技能开启时才 −1）、薄绿「地质学者」（同上）。回归里用 `statMods()` 单独锁定天赋这条通道，避免和技能自身的嘲讽混在一起。

### 5. 玛恩纳「无动于衷」的反弹被错误地绑在技能上

- **问题**：`native-operator-effects` 的 after-damage 处理器要求 `battle.skillActive(v) && skillIndex===2`（他的「未照耀的荣光」）。原文「在场时…所有卡西米尔干员被攻击时反弹相当于玛恩纳攻击力 15% 的真实伤害」**没有技能条件**，实测技能未激活时完全不反弹。
- **改法**：去掉技能门，只看「玛恩纳在场且带该天赋」＋「被打的是卡西米尔干员」。反弹数值仍读天赋黑板 `atk_scale`（15%／精锐 18%），`type:'true'`、无来源、`cause:'extra'`。

## 三、确认无问题的相关干员内容

- 焰尾「前锋剑术」触发与追加攻击 ✓；玛恩纳「游侠」读黑板 `atk_scale_base/atk_scale_up/cnt/damage_resistance` ✓；耀骑士临光「破晓」读 `def_penetrate` ✓（初始 0.2／精锐 0.28 是本期精锐数值）。
- 卡西米尔相关装备（骑士戒律、卡西米尔竞技旗、变形同构体的盟约复制）已有测试覆盖；相关卫戍叠层（每场至多 12 层）在 `tests/native-garrison-effects.test.mjs` 有回归。
- 但书（`char_4032_provs`，天赋「卡西米尔法律专精」）**不在本期 112 人**，不在范围内。

## 四、回归

`node --test tests/native-kazimierz-gaps.test.mjs`（6 条）：范围（`x-5` 与 `activeTalents.rangeId`）、上一名部署记录与额外一次伤害、焰尾物理限定＋读黑板、玛恩纳常驻嘲讽＋反弹不依赖技能、条件式嘲讽（远牙）。每条都用「把对应源文件 `git checkout` 回 HEAD 再跑」验证过**改前会失败**。

相关文档：[盟约层数公式审计](BOND_LAYER_FORMULA_AUDIT_2026-09-22.md)、[技能范围审计](SKILL_RANGE_AUDIT_2026-09-22.md)、[装备效果审计](../EQUIPMENT_EFFECT_AUDIT.md)。
