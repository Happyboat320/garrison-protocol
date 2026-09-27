# 敌人审计修复与 BOSS 入池缺口（2026-09-23）

本轮针对 2026-09-23 的敌人缺口核查做了逐条修复，并把 BOSS／领袖未进随机池的成因查到原始数据层。审计过程与结论见本页「一～四」；BOSS 缺口见「五」。

核查方式：`NATIVE_DATA.enemies` 全表扫描 + `dist/native-*.js` 逐键消费者比对（区分大小写）+ `data/gamedata/allianceLower/enemy_handbook_table.json`／`data/prts/snapshots/2026-09-12-prts/enemies.json` 原始资料对照 + 真实 `step()` 回归。

## 一、普攻伤害类型：唯一来源改为敌人图鉴 `damageType`

**缺口**：`dist/native-battle.js` 的 `spawn` 原来用 `damageType:(raw.description||'').includes('法术')?'arts':'physical'` 猜类型。描述里出现「法术」的**防御/条件分句**会把物理近战整批判成法伤，反向又会把法伤派成物理。

**依据**：`data/gamedata/allianceLower/enemy_handbook_table.json` 的 `enemyData[id].damageType` 是逐条权威字段（`PHYSIC`／`MAGIC`／`NO_DAMAGE`，多类型按原表顺序，第一项是常态）。本期 215 只全部有值：`PHYSIC` 136、`MAGIC` 38、`NO_DAMAGE` 31、`PHYSIC+MAGIC` 10。`data/prts/snapshots/2026-09-12-prts/enemies.json` 的 `damageType` 字段与之互证（例：萨卡兹枯朽前锋 `物理 法术`，天赋「自身受源石污染区/活性源石风暴影响期间，普通攻击造成法术伤害」）。

**改动**：
- `scripts/build-native.mjs` 把 `damageTypes` 烘进每个敌人档案（含 `enemyDependencies`）。
- `dist/native-battle.js` 新增 `enemyBaseDamageType(raw)`：按原表顺序取第一个可映射项（`PHYSIC→physical`、`MAGIC→arts`），缺字段时回落 `physical`；`spawn` 只读它，**禁止再从描述文本推断**。
- 条件型第二类型（枯朽前锋/奇美拉的污染法伤、自行炮与爵士乐手的技能法伤、守墓石像的飞行形态法伤、逐腐兽的 arts 流血）各自由专属实现改写 `e.damageType`，不进普攻默认值。

**修复前后**：描述含「法术」且进池 48 只 —— 只在防御/抗性分句出现 18 只（深池侦察兵等 8、萨卡兹大剑手/刀兵 3、步兵/弧光镜卫两型/莱茵生命防卫科高级成员/强壮囚犯 5、深池暗影术师两型本身是术师）、只在条件/死亡分句出现 5 只（卷心籽、逐腐兽两型、烹泉/沏虹）、不攻击 8 只、普攻法伤 17 只；反向另有 **17 只图鉴为 MAGIC 但描述没写「法术」**（清明、术师快艇、深池逐火战士/护卫、萨卡兹百夫长、独轮车玩具、庞贝、自在、陷落雪祀、"炎佑"、反派阵营角色、骨刺、凋零骑士、守墓石像、"邪魔的利刃" 等）原来被派成物理。

回归：`tests/native-enemy-audit-fixes.test.mjs`（全表门禁：每只敌人必须有图鉴 `damageType` 且取值合法；运行时抽样；源码门禁禁止文本推断）。

## 二、本轮修好的逐名缺口

| 敌人 | 缺口 | 依据 | 实现 |
| --- | --- | --- | --- |
| 心虚设计师 `enemy_10097_crshd`（进池） | 正面物理/法术减伤整个失效 | PRTS 天赋「受到来自正面的物理/法术伤害-80%」 | `enemyFacingDamageMultiplier` 不再绑死圆仔，且两种大小写（`Weakness.`／`weakness.`）都认；`initEnemyTraits` 给带该天赋的敌人定初始朝向 |
| 心虚设计师 | 阻挡者神经损伤未接 | PRTS「被阻挡时，使阻挡自身的单位每秒受到心虚设计师攻击力15%的神经损伤（同名效果不叠加）」 | 新增 `tickDesignerDebuff`，由 `tickEnemyTraits` 按 `block.ep_damage_ratio` 每秒结算，脱离阻挡即停 |
| 临时收音师 `enemy_10094_crstf`（进池） | 普攻神经损伤未接 | PRTS「位于摄影区域范围外时，攻击附加20%攻击力的神经损伤」（本期无摄影区＝恒生效，M27） | 元素倍率键补 `ep.ep_damage_ratio` |
| 主角阵营角色 `enemy_10098_crhro` | 不重生、普攻无神经损伤、不对空未接 | PRTS 天赋「攻击附加攻击力15%的神经损伤…首次被击倒后持续 3s 重生，恢复 100% 生命值」「初始模式普通攻击不会攻击飞行单位」 | 新增 `crhro` 形态：初始模式禁空；`enemyFormFatal` 首次致命伤进入 3 秒重生（回满血、`reborn.invincible` 0 秒无敌），第二次致命伤退场；元素键补 `inside.attack@ep_damage_ratio` |
| 反派阵营角色 `enemy_10099_crvln` | 普攻无神经损伤、不对空未接 | PRTS「攻击附加攻击力15%的神经损伤，不会攻击飞行单位」 | 同上（摄影区演出模式的二连击/互攻优先按 M27 豁免） |
| “灵幛” `enemy_1427_lrnazg`（进池） | 群攻未实现 | PRTS 天赋「可同时攻击自身攻击范围内的所有我方单位」 | 覆盖表登记 `attackProfile.allInRange`，`enemyAttackTargetCount` 返回 `Infinity`（污染期无视射程分支按 M30 豁免） |
| 萨卡兹悖谬暴虐兵长 `enemy_1320_wdrrl_2`（进池） | 「占用 3 个阻挡数，无法被剩余阻挡数小于 3 的单位阻挡」未实现 | PRTS 天赋 | 覆盖表登记 `blockCost:3`，`enemyBehaviorProfile` 透出、`spawn` 写入；`resolveBlocks` 原有的 `used+need<=cap` 判定自动产生「剩余阻挡数不足 3 挡不住」 |
| 高准度伦蒂尼姆城防自行炮 `enemy_1273_stmgun_2` | 施法期失衡免疫缺失 | PRTS 技能「轰炸」：「技能动画期间持有：失衡免疫、晕眩/冻结/浮空/沉睡免疫」 | `beginEnemySkill` 支持 `extra.shiftImmune`（含原值快照与 `endEnemySkill` 还原），轰炸非爵士分支开启 |
| 越长尘 `enemy_1302_ymtro_2` 等载客单位 | 失衡期间仍继续装人 | `native-enemy-transport` 读的 `carrier.unbalanced` 是全仓库从未赋值的死字段 | 门禁改读真实位移状态 `carrier.shift` |
| 越长尘 | 阻挡占用硬编码在运输模块 | PRTS「占用4个阻挡数」 | 登记到覆盖表 `blockCost:4`，运输模块不再写死 |

## 三、随机池门禁登记

`randomPoolEligible:false` 的敌人必须逐条留档，这条口径以前只有 13 条登记，实测被排除 38 只 —— 差额由 `dist/native-combat.js` 的 `complexity` 正则静默排除，**没有 reason**。

本轮把 27 只补登记（覆盖表 71 → 98 条，`randomPoolEligible:false` 40 条，全部带 reason）。**一律先按「未放开」登记真实剩余项**，没有借这次登记批量放开；其中实现已基本闭环、只差时序/表现或已豁免分支的候选（堕罪/渎罪奇美拉两型、主角/反派阵营角色、自行炮、守墓石像两型、异质裂兽·α）留给后续逐条复核后单独放开。

另外补上重弩突袭者 `enemy_1404_msnip` 缺失的 reason。`enemy_9023_acdums`（"余音"）与 `enemy_3010_mcreep`（矿工游击队）虽然不在 215 目录里，但分别出现在 4 张关卡的 `enemyProfiles` 与 `enemyDependencies`，开关是有效的，不是死条目。

## 四、仍未闭环（本轮未做，需要外部依据或更大改动）

- 公共物理尾项：`hitRadius`（碰撞半径）与 `shiftDrag`（阻尼/冰面）全仓库仍无赋值来源 —— 本期 11 张图的 `tileKey` 没有冰面类地块，需要 Unity 刚体参数或标定数据才能定值；敌人-敌人刚体互碰同样缺参数。
- 捕网／歌蕾蒂娅 S3 等旧推拉入口仍未迁移到带 `forceLevel` 的 `moveActor`。
- 领袖的精确弹道/连击/施法时序（自在十字、锏、杰斯顿二连击、腐败/凋零箭矢、鼠王施法、迷路巨像投石、澪连击、自行炮时间轴）：需要原作逐帧或 PRTS 明确时序，按 `ENEMY_BEHAVIOR_DEVELOPMENT.md` 不阻塞。
- 碎骨「闪避时是否仍附加减防」、悖谬首击溅射形状/半径、自在「其他初始形态配置」、圆仔同一竖线的正/背边界：需要 PRTS 明文或实测确认，代码行为已固定并留档。

## 五、BOSS／领袖未进池的缺口分析

### 5.1 事实

- 本期 215 目录里 `levelType==='BOSS'` 的敌人 **23 只**，其中 `randomPoolEligible:true` 10 只、`false` 13 只。
- **23 只没有一只在 `default-wave-table.json` 的 `costs` 里，也没有一只在 `season.enemyInfoDict` 的任一类型里。**
- 因此编制台默认模板、默认道中波次、以及**回合悬赏池**都抽不到领袖。

### 5.2 成因链（4 道闸门，前 3 道是数据/流程造成，第 4 道是设计边界）

1. **词条闸门**：`scripts/build-wave-defaults.mjs:21` 要求模板池成员必须同时满足 `randomPoolEligible===true`、主题活动匹配、且 `NATIVE_DATA.season.enemyInfoDict[type].includes(id)`。`enemyInfoDict` 只有 7 个词条（FLY/TIMES/ELEMENT/DOT/INVISIBLE/REFLECTION/SPECIAL，共 116 条），**原始 `source.json` 里也没有任何领袖** —— 领袖本来就不走词条池。
2. **成本闸门**：`DEFAULT_WAVE_TABLE.costs` 由默认模板池推导，领袖不在任何模板里 → 没有成本条目 → `native-bounty.js` 的 `bountyOption` 要求 `Number.isFinite(DEFAULT_WAVE_TABLE.costs[id])`，于是领袖也进不了回合悬赏池。
3. **悬赏池来源错了**：原表的悬赏配置是 `season.effectBuffInfoDataDict` 里 key 为 `add_enemy_kill_gain_coin` 的条目（共 109 条，覆盖 104 名本期敌人），其中 **`enemyeffect_b_1`～`enemyeffect_b_24` 正是领袖赏金表**（23 名 BOSS ＋ 澪，`coin` 1–6、`count` 1，逐条带 `enemy_id`）。客户端从来没有读这个 key：悬赏池取的是 `Object.keys(DEFAULT_WAVE_TABLE.costs)`，币值用「波次难度成本」自己映射（≤3→1、≤6→2、≤10→3、否则 4）。
   - 后果一：原表 104 名悬赏敌人里有 **74 名**（含全部 23 名领袖）在客户端永远抽不到。
   - 后果二：能抽到的那批里，**92/104 的币值与原表 `coin` 不一致**（只有 12 条恰好相同）。
4. **资格闸门**：13 名领袖是 `randomPoolEligible:false`（complexity 或显式登记）。即使打通第 3 条，也只有那 10 名（碎骨、萨卡兹百夫长、"遗弃者"、喷气人、W、"庞贝"、大鲍勃、"墓碑"、迷路的巨像、"邪魔的利刃"）可以进池。

### 5.3 已按 A 实施（2026-09-23，用户选定）

用户选定 **A（悬赏池改读原表）** 与「给领袖一个成本来源」：

1. `scripts/build-wave-defaults.mjs` 把 `add_enemy_kill_gain_coin` 表烘成 `ENEMY_KILL_COINS`（104 名敌人、109 条登记，逐条带 `effectId`；同敌人多组登记时取最小 `coin` 并把变体留在 `variants`），并断言 23 名领袖全部在册、澪（`enemyeffect_b_19`）在册、条目数 ≥100。
2. `dist/native-bounty.js` 的候选池改为 `ENEMY_KILL_COINS ∩ randomPoolEligible`，币值直接用原表 `coin`（0–6）；`bountyOption` 保留旧存档兼容分支（`source:'legacy-cost'`／`'item'`）。
3. 四选一结构保留（项目口径：至少含 1 与 4 奖金档），但**缺档跳过**并从还有候选的档位补 —— 原表 6 档只有「复仇者」且它未放开，旧的「任一档为空就整轮不出悬赏」会让接上领袖表之后整个悬赏系统消失。
4. 编制台成本：`enemyeffect_b_*` 的 24 名领袖按 `8 + coin` 写进 `default-wave-table.json` 的 `costs`（9–14），依据写进新增的 `costSources` 字段；`normalizeWaveTable` 不保留 `costSources`，所以不影响「敌人池是否改动」的判等。
5. UI 文案改为「奖金取原表 0–6 档 · 每次至少包含 1 与 4 奖金档 · 源石虫为 0」。

效果（实测）：400 个种子下四选一恒含 1 与 4 档、全部来自原表、可复现；覆盖到 74 名候选，其中 10 名已准入领袖（碎骨、萨卡兹百夫长、"遗弃者"、喷气人、W、"庞贝"、大鲍勃、"墓碑"、迷路的巨像、"邪魔的利刃"）都会出现；领袖编制台成本 9–14（不再是 1）。

仍未做：无（按词条组抽候选已于同日补齐，见下）。13 名未放开的领袖要按各自的剩余项逐条复核后才能进悬赏，逐条清单见第六节。

### 5.4 按词条组抽候选（2026-09-23 同日补齐）

原表把悬赏登记在**词条组**里：条目自己的 `effectInfoDataDict[id].effectName` 写着词条（`悬赏·飞行II`、`悬赏·损伤III`……）。据此把 109 条分成两组烘进 `ENEMY_KILL_COINS[id].groups`：

- **词条组 ×7**（飞行 6、频次 6、损伤/元素 11、持续 6、隐匿 5、折射 6、特异 26 条，奖金只到 1–3 档）；
- **具名组**（38 条：`enemyeffect_b_1`～`b_24` 的 23 名领袖 ＋ 澪、鸭爵一族、假想敌、山海众头目等，奖金 0–6 档）。

`ensureRoundBounty()` 现在把本回合的特训词条（`waveRoster.rounds[round].type`）交给 `bountyOffers(data,seed,{type})`，同一奖金档「词条组优先、具名组兜底」；4 档锚点只能来自具名/领袖组。实测 7 个词条组各 300 个种子：四选一、含 1 与 4 档、4 档来自具名组、每组全部准入候选都出现过，同词条候选平均 1.5–2.0 张/轮。门禁在 `tests/native-bounty-pool.test.mjs`。

## 六、领袖的补齐与搁置（2026-09-23 第二轮，按用户逐条口径）

23 名领袖里 **16 名已放开**（碎骨、萨卡兹百夫长、弑君者、泥岩、腐败骑士、凋零骑士、"遗弃者"、喷气人、W、"庞贝"、大鲍勃、"墓碑"、迷路的巨像、"复仇者"、"邪魔的利刃"、纠缠藤蔓），未进池的敌人从 38 降到 32。本轮新放开的 6 名与仍搁置的 7 名如下。

### 6.1 本轮新放开（依据充分或用户给定口径）

| 领袖（coin/成本） | 本轮做了什么 |
| --- | --- |
| 弑君者（1/9） | 用户口径：**沿路径位移不会跑过头**，检查点边缘几何不再是缺口。闪现前进 1.5 格＋接回路线已接，直接放开。回归断言闪现后不会越过后续检查点。 |
| 泥岩（4/12） | 按 PRTS「重置自身法术屏障 ※技能期间持有失衡免疫、晕眩免疫」把刷新屏障从**同帧结算改成真正的技能**：先走施法前摇（`windupSeconds(interval)`），前摇期间失衡免疫（复用 `beginEnemySkill` 的 `extra.shiftImmune` 开关）＋晕眩免疫（`extra.immunities` 快照还原）、原地不动（`formHold`），前摇结束才刷盾。破盾溢出与生命结算本来就同帧（`applyDamage` 先扣 `shieldLayers` 的 leftover 再落到生命），补了断言。 |
| 腐败骑士（3/11） | 按用户口径加**技能前摇**：发动前 1 秒本体紫色发光闪烁（`enemyCast.windupUntil`，表现画在单位身上），前摇期间不出手；同伴离场强化后前摇缩到 0.5 秒。蓄力锤本体仍是原表的 `duration`。 |
| 凋零骑士（3/11） | 同上：前摇结束才发射爆炸箭（前摇期间被打断会 `cancelEnemyCast`，不产生弹道），命中后仍按原表延迟 2.5 秒爆炸。 |
| "复仇者"（6/14） | 按 PRTS 技能备注「※重生后：此技能释放的动画动作期间免疫晕眩」补齐：**只有复活后**的冲刺动画期间给 `immunities.stun`，冲刺结束（`reidRushUntil` 到期）按原值还原；第一形态冲刺不免晕。它独占 6 档，放开后 7 个奖金档都有候选。 |
| 纠缠藤蔓（3/11） | 机制早已接线（活性源石对敌伤害带 `environmental:true` → 藤蔓获得脆弱），本轮补上**真实 `step()` 的「地块→敌人→脆弱」端到端回归**并放开。 |

### 6.2 仍搁置（缺依据，逐条写明缺什么）

| 领袖（coin/成本） | 仍缺什么 | 缺的依据 |
| --- | --- | --- |
| 杰斯顿·威廉姆斯（4/12） | 装甲穿刺的二连击间隔（现用 `TENTATIVE_HIT_GAP`）、重生期的控制窗口 | PRTS 只写「对目标造成 2 次…」，没有间隔；也没写重生期间能否被控制 |
| 鼠王（2/10） | 沙狱不跟随（圈建在施放瞬间「生命上限最低目标」格上）、倍率留档、精确施法时间 | PRTS 只写「释放持续 15s 的沙狱弹道」，没有跟随/离场口径 |
| “自在”（4/12） | 十字弹道/重复段时序；「其他初始形态配置」 | 原文无时序；50 份关卡里查不到 `yinyang` 配置，无法确定指的是哪种形态 |
| 锏（5/13） | 回血再跨同一血线是否再触发 | 原文只写「已损失生命值达到最大生命值 25% 的整数倍时」，没写回血后重跨的行为；现按字面取「每个整数倍只触发一次」的单调累计 |
| 扎罗（5/13） | 精确启动/相位时序 | 原文无逐帧相位 |
| “巨大的丑东西”（5/13） | 形态美术 | 机制已闭环（砍伐巨蕈/木桩按豁免移出），只差第二形态的表现 —— 是本表里最接近放开的一个 |
| 陷落雪祀（3/11） | 逐跳飞行/施法时序；「多来源馈赠叠加」 | 原文无逐跳时序，也没写多来源叠加（现按同名刷新） |

另：`enemy_10118_ymgprc` 澪在领袖赏金表里（`enemyeffect_b_19`，coin 3、成本 11），但它是 `levelType=ELITE` 且已放开，不在这两类里。

### 6.3 实现口径（本轮新增，别改回去）

- **骑士的技能前摇是项目口径**：`KNIGHT_WINDUP_SECONDS=1`、`KNIGHT_WINDUP_SECONDS_RAGED=0.5`（`native-enemy-skills.js` 导出），值取 `knightWindupSeconds(enemy)`（按 `enemy.knightRage`）。前摇在 `enemyCast.windupUntil` 上留档，`native-fx.drawEnemyPhase` 只读它画紫色发光闪烁（`reduceFx` 时改成静态紫光），**不写任何逻辑字段**。战斗里没有 DOM 头像，所以发光画在单位身上。
- **泥岩的技能窗口**照 PRTS 的「技能期间持有失衡免疫、晕眩免疫」：失衡免疫走 `extra.shiftImmune`（`beginEnemySkill` 记原值、`endEnemySkill` 还原），晕眩免疫走 `extra.immunities` 快照 + 手动置位。
- 前置门禁：`native-enemy-skills.js` 里敌人专属技能块之前有一条 `if(enemy.hidden||enemy.enemyCast||!control.skill||!control.attack)return;` —— **被缴械的敌人不会放技能**。测试里想验证技能时不要给敌人上 `disarm`（要挡普攻就改用 `block`/`action` 控制）。

## 六、回归与验证

- `node --test tests/native-enemy-audit-fixes.test.mjs`（12 条用例；每条都用「把对应源文件 `git checkout` 回 HEAD 再跑」验证过改前会失败）。
- `npm test`：全套通过（1256 条）。
- `npm run build` 重建 `dist/runtime-data.js` / `dist/native-wave-defaults.js` / `data/modes/alliance-lower/catalog.json` 等产物；`dist/index.html` 版本号更新为 `enemy-audit-20260923`。
