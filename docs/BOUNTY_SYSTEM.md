# 回合悬赏与机变决策

2026-09-21 实装，2026-09-22 改为**每两回合一次**，2026-09-23 把候选池改回原表。出现节奏：从第 2 回合开始每隔一个回合（第 2、4、6… 回合）生成四个不重复候选，第 1 回合与最终无限生命木桩都没有回合悬赏。候选固定包含 1 奖金和 4 奖金档，另外两档从 0、2、3、5、6 里还有候选的档位中随机选择，0 档固定为源石虫。节奏常量在 `dist/native-bounty.js` 的 `BOUNTY_FIRST_ROUND` / `BOUNTY_INTERVAL` 与 `bountyRoundActive(round)`，判定入口是 `NativeSession.ensureRoundBounty()`（道具悬赏走 `chooseBounty`，不受这个节奏限制）。

## 候选与奖金（2026-09-23 改回原表）

候选池的**唯一来源**是原表 `season.effectBuffInfoDataDict` 里带 `add_enemy_kill_gain_coin` 黑板的条目：每条给出「额外出现的敌人 ＋ 击杀奖金 `coin`（0–6）＋ 数量」。`scripts/build-wave-defaults.mjs` 把它烘成 `dist/native-wave-defaults.js` 的 `ENEMY_KILL_COINS`（本期 104 名敌人、109 条登记），`native-bounty.js` 直接用原表 `coin`，**不再按内置编制成本推导奖金**。

- 原表按「词条组」登记，领袖是其中的 `enemyeffect_b_1`～`enemyeffect_b_24`（23 名 `levelType=BOSS` ＋ 澪，币值 1–6）。领袖不在 `enemyInfoDict` 词条池里，**悬赏是它们唯一的入池入口**。
- 同一敌人可能在不同词条组里登记成不同 `coin`（山海众头目 1/2、重弩突袭者 1/2、法术大师A2 1/2）：本期客户端按敌人去重，取其中**最小** `coin`（不凭空抬高奖金），其余变体留在 `variants` 里备查。原表按词条组抽候选这一点尚未实现。
- `randomPoolEligible:false` 的敌人仍然不进候选池；所以某个奖金档可能一个准入候选都没有（当前 6 档只有 `enemy_1539_reid`"复仇者"、且它未放开）。**缺档要跳过并从还有候选的档位补**，不能像旧实现那样「任一档为空就整轮不出悬赏」。

旧存档兼容：`bountyOption` 仍接受「有波次表成本」的旧候选（`source:'legacy-cost'`，币值按旧映射 1–3→1、4–6→2、7–10→3、≥11→4）与旧道具悬赏效果 ID（`source:'item'`），只是新生成的悬赏不再从这两条路径取。

历史（2026-09-21～09-23）：候选来自 `Object.keys(DEFAULT_WAVE_TABLE.costs)`，奖金由内置编制成本映射 —— 结果是原表 104 名悬赏敌人里 74 名（含全部领袖）抽不到，能抽到的 104 名里 92 名币值与原表不一致。

## 领袖的编制台成本

编制台手动把领袖加入自定义模板时，`enemyCost` 过去因为没有成本条目回落到 `defaultCost=1`（等于免费刷 BOSS）。2026-09-23 给 `enemyeffect_b_*` 的 24 名领袖按 **`8 + coin`** 补上成本（coin 1→9 … coin 6→14），依据写在 `default-wave-table.json` 的 `costSources` 里。成本是项目口径（预算难度），不是原作数值；映射单调且落在既有 1–14 区间内。

每个新悬赏加入 1 只对应敌人，保留飞行/地面路线，统一纳入本轮 2–40 秒排程。击倒时走 `commitExit → enemy-death` 记入 `nextRoundBonus`，下轮休整经 `addFunds` 入账；漏失不领奖，同次退场不重复领奖。源石虫的 0 不回退成 1，海猫资金仍保持 ALL。结算横幅显示本轮已获得的悬赏奖金。

## 流程与存档

- `roundBounty` 保存回合、四个候选和选择；采用波次种子的独立随机流，不消耗商店随机流。
- **悬赏回合**（第 2、4、6… 回合）进入整备后展示悬赏，可以暂缓以继续布阵；桌面客户端点击开战前会再次要求选择。非悬赏回合不生成、也不改写上一轮的记录（`roundBounty.round` 与当前回合不一致时，战斗不会把它编进波次）。底层模拟器允许不接悬赏运行，供独立战斗测试使用。
- 同一次悬赏只能接一次，不能通过关闭、重开或读档重抽。接取后同时保存普通存档和安全存档；悬赏回合里丢掉记录的旧存档会在读档时补齐候选。
- 机变决策优先，完成三选一后再展示本轮悬赏。晋升奖励和特殊奖励队列独立保留。
- 杜宾教鞭的追加悬赏也采用四个候选；可与本轮悬赏同时加入队列。旧存档中的原效果 ID 仍可读取。
- 敌情面板（桌面右侧「本波敌情」）会写明本轮悬赏状态或「悬赏每 2 回合一次（第 2、4、6… 回合）」，免得玩家以为漏弹了一次。

## 表现

悬赏与「机变决策」（盟约加层、免费刷新等三选一）使用 `native-choices.js`，复用回合结束的暗屏、横幅展开、网格背景和扫光，候选卡分次出现。支持减动效、键盘焦点约束、小屏滚动。晋升、装备等其他奖励界面不改。

验证：`node --test tests/native-bounty.test.mjs tests/native-bounty-pool.test.mjs`、`node scripts/regression-browser.mjs bounty-decisions`。截图和浏览器报告保存在 `artifacts/bounty-decisions/`。
