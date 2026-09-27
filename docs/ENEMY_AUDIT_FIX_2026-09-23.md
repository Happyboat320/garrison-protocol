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

## 六、13 名未放开的领袖：逐条剩余内容

23 名领袖里 10 名已放开（碎骨、萨卡兹百夫长、"遗弃者"、喷气人、W、"庞贝"、大鲍勃、"墓碑"、迷路的巨像、"邪魔的利刃"，均已能出现在悬赏里），其余 13 名按下面的剩余项暂不放开。**「需要什么」一列就是放开前要补的东西。**

| 领袖（赏金 coin / 成本） | 已实现 | 仍缺 | 放开需要 |
| --- | --- | --- | --- |
| 弑君者 `enemy_1502_crowns`（1 / 9） | 闪现 `tryCrownBlink`、接回路线 `rejoinCrownRoute`、跳过已跨过的展开点、checkpoint 存档 | 普通路径**检查点边缘跨越的几何**（复杂折线/地块边缘可能多走或少走一格） | 边缘「跨过」的对照依据（PRTS 或实测），或确认公差可接受 |
| 泥岩 `enemy_1511_mdrock`（4 / 12） | 法术屏障刷新、屏障在场生命+50%/攻速+50、攻击叠攻（最多 6 层，当次生效）、沉睡免疫、初始护盾转 arts | ①「刷新屏障」**没有施法/免疫窗口**（`beginEnemySkill` 后同帧 `endEnemySkill`，等于无前摇且不可打断；PRTS 写明技能期间持有失衡免疫、晕眩免疫）；②破盾溢出与同帧结算顺序 | 施法窗口（含失衡/晕眩免疫的开与还原）＋破盾溢出顺序。技能1「占据 L-44 留声机」按豁免移出 |
| 腐败骑士 `enemy_1513_dekght`（3 / 11） | 蓄力锤 300% 物伤、十字溅射、另一骑士死亡/漏怪触发狂暴（攻+80%、攻速+100、移速+150%）、关闭错误死亡爆炸 | 爆炸箭**前摇/飞行**（没有 `s.enemyProjectiles` 条目，无逐帧弹道）、目标提前离场的细节 | 弩箭/爆炸箭的弹道队列；「目标离场后是否仍结算」依据 |
| 凋零骑士 `enemy_1513_dekght_2`（3 / 11） | 爆炸箭 2.5s 延迟结算（`snapshot.damage`＋`targetDeployGen` 防误伤）、最多 3 目标、普攻双目标、法伤 | 前摇/飞行；目标提前离场的细节口径 | 同上 |
| 杰斯顿·威廉姆斯 `enemy_1516_jakill`（4 / 12） | 双形态（狱警→杀手）、4s 重生回满、杀手形态清 SP 并解放全场囚犯、形态属性替换、钢铁风暴（2 目标＋3s 晕眩）、装甲穿刺（2 段＋无视 60% 防御） | 装甲穿刺的**二连击间隔**（现用 `TENTATIVE_HIT_GAP=2/FPS` 估计）、重生期的控制窗口口径 | 逐敌连击间隔依据；重生期间能否被控制/沉默的原文或实测 |
| 鼠王 `enemy_1509_mousek`（2 / 10） | 唱沙 `DriftSand`、法术屏障在场增防（`defup.def` 不是友军光环）、低血全伤害强化、沉睡免疫、十字伤害、初始护盾转 arts | **沙狱跟随/离场规则**（区域固定在施放格，目标走开不跟随）、倍率留档细节、精确施法时间 | PRTS 的沙狱跟随/持续时间口径；施法时间 |
| “自在” `enemy_1517_xi`（4 / 12） | 双形态（5s 重生回满→第二形态反转明晦＋10s 无敌）、破桎而出（蓄力 14.33s→半径 3.0×600% 法术溅射）、纬地经天（十字 x-6）、标记（第二形态最近/最远）、明晦同异属性倍率、普攻不对空、第二形态连续重复 2 次优先不同目标 | 十字的**弹道/重复段时序**；「其他初始形态配置」（PRTS 写"按关卡配置可改为晦或不获得属性"，50 份关卡未检出 `yinyang` 配置） | 时序依据；「其他初始形态配置」具体指哪份关卡/哪种形态。退场强制击杀夕(敌方) 因本期没有该实体属豁免边界 |
| 锏 `enemy_1525_blkswb`（5 / 13） | 双形态（5s 重生回满＋10s 无敌）、血线压制清 SP（已损失生命达 25% 整数倍）、抵抗、无视防御 20%/40%、肆虐风雪（1.5 半径 100% 物理，第二形态额外一次）、速杀瞬移 1.5 格 | **回血后再跨同一血线**是否再次触发；精确技能/连击时序（现在双段同帧） | 血线判定的原文或实测；连击间隔。降雪加成已接，通用降雪/封冻控制器按豁免 |
| 扎罗，“狼之主” `enemy_1535_wlfmster`（5 / 13） | 形态/重生、远古威慑（范围与攻速取 PRTS 415307）、溶血骇惧 `FearCage`（线性递增流失＋7 秒技能封锁）、怒嗥 `WildCalling`、自动 SP、两阶段技能 | **精确启动/相位时序**（`duration_s` 对应的起手动作） | 逐帧相位依据。血债账簿/清算/召唤及脉冲相位按豁免移出 |
| “巨大的丑东西” `enemy_1512_mcmstr`（5 / 13） | 机械/大祭司转场、两形态攻击（远程 2.5 半径 8 格溅射可溅射飞行、近战 300%）、重生开始 2.17s 后自爆（150% 物伤＋16s 晕眩）、持续自伤、被阻挡时不可阻挡 | 只有**形态美术**尾项（砍伐巨蕈/木桩按豁免移出） | 形态美术；机制侧已闭环，是本表里最接近放开的一个 |
| “复仇者” `enemy_1539_reid`（6 / 14） | 冲锋 `tryReidRush`（3.0 半径、下个检查点前最近目标）、半血攻+180%、一次复活（5s 重生恢复 50%、无敌 0s） | **冲锋免晕窗口**（未设 `immunities.stun`）、范围差异结论、普通折线路径（现在是单目标点近似） | 免晕窗口依据＋折线路径。**注意它独占原表 6 档**：不放开时悬赏第 6 档永远没有候选（现按缺档跳过处理） |
| 陷落雪祀 `enemy_2050_smsha`（3 / 11） | 三目标跳跃（半径 1.6、每跳递减 15%、附带 4.5s 寒冷）、馈赠链（攻速+100/移速+100% 10s、可对敌人施法）、法伤 | **逐跳飞行/施法时序**（现在同一逻辑帧 for 循环结算完）、**多来源馈赠叠加**（固定 source `'snow-priest-gift'`，同名刷新而非按来源叠加） | 逐跳时序；多来源叠加口径 |
| 纠缠藤蔓 `enemy_2052_smgia`（3 / 11） | 攻击回复眩晕、抵抗、环境伤害后脆弱（`native-enemy-traits.js` 消费 `opts.environmental`，活性源石对敌伤害带该标记） | 「地块→敌人→脆弱」缺**端到端回归**（现有测试是合成调用） | 补一条真实 `step()` 回归即可放开；原关卡专属伤害装置按豁免移出 |

另：`enemy_10118_ymgprc` 澪在领袖赏金表里（`enemyeffect_b_19`，coin 3、成本 11），但它是 `levelType=ELITE` 且已放开，不在这 13 名里；剩余项只有连击时间轴与缺席关卡物体交互（后者豁免）。

## 六、回归与验证

- `node --test tests/native-enemy-audit-fixes.test.mjs`（12 条用例；每条都用「把对应源文件 `git checkout` 回 HEAD 再跑」验证过改前会失败）。
- `npm test`：全套通过（1256 条）。
- `npm run build` 重建 `dist/runtime-data.js` / `dist/native-wave-defaults.js` / `data/modes/alliance-lower/catalog.json` 等产物；`dist/index.html` 版本号更新为 `enemy-audit-20260923`。
