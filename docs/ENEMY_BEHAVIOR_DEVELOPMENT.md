# 敌人行为开发目标

本阶段以“可玩性优先、原作视觉时序延后”为验收口径。敌人的移动、索敌、攻击、控制、实体生命周期和波次稳定性必须正确；动画前后摇与技能特效预制体不作为本阶段阻塞项。

2026-09-21 的逐敌人缺口、后续开发批次见 [全敌人特殊行为缺口审计](ENEMY_BEHAVIOR_GAP_AUDIT.md)。下文是公共能力开发路线，不代表所有特殊行为已验收；当前新增的 `native-enemy-*` 模块分别负责技能、攻击、天赋、形态、载客、恐惧与寄生。2026-09-21用户将豁免扩大为卫戍中不存在的特殊地块/场景装置及其专属交互；当前范围以 [重筛记录](ENEMY_SCOPE_FILTER_2026-09-21.md) 和 [剩余清单](ENEMY_BEHAVIOR_REMAINING.md) 为准。本期实际环境和无特殊场地也会生效的本体能力继续保留。

## PRTS 行为模型

敌人运行时不再用单一的“发现目标即停走”判断，而是通过 `movementPolicy` 区分：

- `stop-on-target`：有效目标进入攻击范围后停留。
- `stop-while-attacking`：仅在攻击前摇或结算期间停留。
- `always-move-attack`：移动中持续攻击。
- `burst-then-move`：完成配置的连续攻击次数后恢复移动。
- `scheduled-stop`：按 `stanceInterval` / `stanceDuration` 周期停移。
- `skill-controlled`：由技能或蓄力状态控制停移。

当前默认值按「会不会隔着距离开火」定：**能隔着距离开火的单位（`applyWay: RANGED`，或原表写「近战 远程」的
`applyWay: ALL` 且攻击范围半径 > 1）默认只在攻击动作期间停留**；其余（纯近战、贴脸打的 ALL 单位）默认
`stop-on-target`。文案里有更复杂证据的（不停止移动／周期性停止移动／蓄力／连击）优先于默认值，
逐关卡覆盖仍然最高优先。

> 2026-09-23 修正：默认策略原来只判 `applyWay === 'RANGED'`，于是写「近战 远程」的敌人（萨卡兹枯朽战车 2.2、
> 掠海漂移体 2.6、碎骨、墓碑、杰斯顿等 11 名）落到 `stop-on-target`——只要攻击范围里有个活着的目标就
> 永久站桩开火、再也不前进（用户报的就是这两种）。贴脸打的 ALL 单位（扎罗、巨大的丑东西，半径缺省）
> 与纯近战维持 `stop-on-target`；`tests/native-combat.test.mjs` 有「远程敌人不得落到 stop-on-target」的全表门禁。

复杂敌人通过 `enemyBehavior.randomPoolEligible=false` 排除出随机池，先放入固定波次。

**每一条排除都必须留档（2026-09-23）**：`complexity` 正则自动判定的 complex 只是兜底，不能当作登记 —— 任何 `randomPoolEligible:false` 的敌人都必须在 `enemy-behavior-overrides.json` 里有自己的条目和 `reason`；`tests/native-enemy-audit-fixes.test.mjs` 有全表门禁。放开仍然逐条走「补完专属实现＋定向测试」。本轮把 27 只漏登记的补上（覆盖表 71 → 98 条），详见 [审计修复记录](ENEMY_AUDIT_FIX_2026-09-23.md)。

## 普攻伤害类型（2026-09-23 口径）

敌人普攻的伤害类型**只有一个来源**：`enemy_handbook_table.json` 的 `enemyData[id].damageType`（`PHYSIC`／`MAGIC`／`NO_DAMAGE`，多类型按原表顺序、第一项为常态），由 `scripts/build-native.mjs` 烘成 `raw.damageTypes`，运行时唯一入口是 `dist/native-battle.js` 的 `enemyBaseDamageType(raw)`。

**禁止再从描述文本推断**（原实现判 `description.includes('法术')`）：那会把「法术抗性较高」「位于源石污染区内时，攻击造成法术伤害」这类防御/条件文案的物理近战整批判成法伤，也会把描述没写「法术」的真法伤派成物理。条件型的第二类型（污染、技能、形态）由各自专属实现显式改写 `e.damageType`，不进普攻默认值。

## 占用阻挡数（2026-09-23 口径）

PRTS 的「占用 N 个阻挡数」通过覆盖表的 `blockCost` 登记（本期：萨卡兹悖谬暴虐兵长 3、越长尘 4），由 `enemyBehaviorProfile` 透出、`spawn` 写入实例；`resolveBlocks` 用 `used+need<=cap` 判定，所以「占用 3」天然等价于「剩余阻挡数小于 3 的单位挡不住」。不要在运输/形态模块里再写死阻挡占用。

## 敌人技能的施法窗口与前摇（2026-09-23 口径）

- **施法窗口照 PRTS 的「技能期间持有…」写**：泥岩「刷新屏障」是技能不是即时效果 —— 先走前摇（`windupSeconds(interval)`），前摇期间原地不动、失衡免疫（`beginEnemySkill` 的 `extra.shiftImmune`，结束自动还原）与晕眩免疫（`extra.immunities` 快照），前摇结束才真正刷盾。参考实现见 `native-enemy-skills.js` 的 `cast?.refreshShield`。
- **腐败/凋零骑士的技能前摇是项目口径（用户 2026-09-23）**：发动前 1 秒本体紫色发光闪烁，同伴离场触发强化后缩到 0.5 秒，值在 `native-enemy-skills.js` 的 `KNIGHT_WINDUP_SECONDS`／`KNIGHT_WINDUP_SECONDS_RAGED`。前摇留档在 `enemyCast.windupUntil`，表现只在 `native-fx.drawEnemyPhase` 里读它画（`reduceFx` 时退化为静态紫光），不进逻辑。
- 敌人专属技能块之前有一条 `if(enemy.hidden||enemy.enemyCast||!control.skill||!control.attack)return;`：**被缴械的敌人不会放技能**（写测试时不要给敌人上 `disarm` 来挡普攻）。
- 纯表现（弹道飞行、逐帧动画、连击间隔）按本页开头「可玩性优先」的口径不阻塞；但**机制上能确定的要补**，比如复仇者 PRTS 技能备注「※重生后：此技能释放的动画动作期间免疫晕眩」已接（冲刺结束还原）。

逐关卡覆盖写在 `data/modes/alliance-lower/enemy-behavior-overrides.json`，可单独指定移动策略、连射次数、停移时长和随机池资格，构建时同时写入协议目录与战斗运行时。

## 已接入的公共能力

以下是实现历史，不代表相关原活动装置需要继续引入卫戍；其中已豁免场景的生命周期、碰撞标定不再是本阶段完成前提。

- 远程索敌与移动解耦，支持移动中攻击和攻击期间停留。
- 目标失效后恢复路线；非预期移动停滞会触发恢复事件。
- 攻击次数触发晕眩、攻击附加元素损伤、死亡爆炸和敌方范围防御光环。
- 首次溅射、攻击次数后强化、直线攻击条件、隐匿攻击后显形，以及可被沉默阻断的敌方技能触发。
- 深池伙友卫队与伙友影刃的邻近协同光环：按实际距离分别影响我方攻击速度和影刃攻击间隔。
- 萨卡兹王庭军精锐术师的 DeathEye 锁定持续伤害与终结凋亡爆发。
- 萨卡兹枯朽战车的攻击计数、近战强化和污染秽蚀持续区域。
- 敌方持续伤害区域（第一批，DOT 词条）：射击落点燃烧区、跟随自身的常驻光环、死亡污染区，以及逐腐兽的「治疗可解除」流血。数值一律取自原表 blackboard，推导结果随构建写入 `enemyBehavior`，结算走 `logicEffects` 的 `kind:'field'` 并由 `drawZones` 绘制。分批计划与验收口径见 `ENEMY_EFFECTS_PLAN.md`。
- 解压缩与再生（第三批，TIMES 词条）：`DeadSpawn.*` 形成碎片、`Revive[Trigger].*` 进入第二形态，碎片依赖的「特殊生命值机制」（血条数值 = 需要击倒的伤害次数，类型限定按图鉴文案）落在 `applyDamage`。死亡类能力统一由 `commitExit` 的 `battle.onEnemyDeath` 触发，覆盖全部死因；数值、位置、时序与遗留问题见 `DECOMPRESS_ENEMY_PLAN.md`。
- 敌方隐匿技能（第四批，INVISIBLE 词条）：`InvisibleCombat` 攻击显形、停手 6 秒后重新隐匿；清明 `InvisibleShield` 是独立计时的自施法技能（`tickEnemyInvisibleShield`，`initCooldown` 首放、之后按 `cooldown` 循环，给半径内其他敌人限时隐匿），不挂在攻击路径上，否则行进途中不开火就会漏触发。口径与验收见 `INVISIBILITY_PLAN.md`。
- 周期停移、连射冷却和技能控制停移的数据字段。
- 复杂行为按运行时元数据过滤随机敌人池，保持手工波次表不被修改。
- 未接入的敌方技能预制体（如地图、召唤、重生、全局效果和复杂蓄力）自动标记为 `complex`，通过固定波次等待专属实现。

- 矿工交战：规则状态保存在 `s.minerEngagements`，按0.3秒检测，使用 `BlockMcreep.*` 的半径/人数。交战只施加双方束缚，不可写进普通 `e.block` 或占用干员阻挡；解除只清理该绑定来源的状态，保存UID与部署代际。`NativeBattle.spawn` 的矿工分支已接真实中立实体（`native-miner.js`），矿道已接自动集结/出击生产者及档案按钮（`native-miner.js` / `perform(mineCommand)`），仅在显式配置时生成；动态碰撞与半径标定仍待补。中立矿工与普通友方召唤物分开：`alliedActors` 排除中立、`enemyOpponents` 包含中立；不要让通用召唤攻击与NPC调度重复运行，也不要让普通友方治疗/盟约减伤覆盖中立。

## 后续逐类接入

1. 为已收录敌人补齐逐关卡行为覆盖，优先处理普通近战、普通远程、飞行和常见控制敌人。
2. 按固定种子验证连射、周期停移、召唤、变身、传送、复活和地图实体交互。
3. 仅在无卡怪、索敌稳定、死亡事件单次结算后，将敌人从固定波次提升到随机池。
4. 动画释放时间轴、精确前后摇和完整视觉预制体另列为后续表现优化。

## 验收要求

- 远程敌人不能因目标在范围外、目标失效或开火状态结束而永久停滞。
- 非等待、受控、隐匿或技能状态下，敌人必须持续产生路线进展或明确进入攻击状态。
- 固定种子下目标选择、攻击次数、状态和死亡事件可重复。
- 复杂敌人未通过固定波次测试前，不得进入随机池。
