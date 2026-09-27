# 本地战绩档案与存档导出／导入（2026-09-27）

用户需求：本地存档里记录**最近十场对局**的结果（词条、地图、存活波数、是否通关、最终轮输出、最终轮盟约情况、最终轮场上具体阵容）、**战前准备的技能选择**、**特殊标记开关【S.E.E.S.】（默认 false）**；主界面加「导出存档」，导出 JSON 且能被现有「导入存档」读回。

## 1. 存档键与结构

| 键 | 内容 | 写入时机 |
| --- | --- | --- |
| `garrison-native-manual-v1`（原有） | 当前这一局的对局存档（`NativeSession.snapshot()`） | 原来的 `save()`／`saveCheckpoint()`，未改 |
| **`garrison-archive-v1`（新增）** | 战绩档案：`{version:1, runs:[…最多 10 条…], prepSkills:{charId:档位}, flags:{sees:false,egg325:false,cat:false}}` | 一局结束、切换【S.E.E.S.】、导入存档时 |
| `garrison-prep-default-skill-v1` | 战前准备页实际使用的默认技能覆盖表；导出时复制进 `archive.prepSkills`，导入时写回此键 | 保存战前技能、导入存档时 |

档案**不放在对局存档里**：它是跨局的，换局／读档都不会丢；导出存档时把它一并写进 JSON，导入时并回本地。默认技能配置仍以独立的 `garrison-prep-default-skill-v1` 为运行时来源，档案里的 `prepSkills` 是便于携带的副本；导入合并后会校验并写回独立键。

实现：`dist/native-archive.js`（纯函数 + 注入 storage，无 DOM，便于单测）；样式 `dist/native-archive.css` 由 `native-play` 启动时挂一次 `<link>`。

## 2. 单场记录的字段

| 字段 | 含义 | 来源 |
| --- | --- | --- |
| `types[]` | 开局抽中的三种特训词条（id + 名字） | `s.waveRoster.types` + `trainingType()` |
| `mapId` | 作战阵地（stageId） | `s.mapId` |
| `waves` | **存活波数**＝打完且生命还在的普通波次数（死在最后一波时那一波不算） | `s.history` + `s.hp` |
| `battles` | 总共打了几场（对账用） | `s.history` |
| `round` / `hp` / `maxHp` | 停在第几回合、剩余生命 | `s.round`／`s.hp` |
| `cleared` | 是否通关＝打到最终轮且生命 > 0 | `s.history` 里有 `training-dummy`（或 `round>=14`）且 `hp>0` |
| `finalRound` / `finalKind` | 最终轮是不是木桩轮 | 最后一条结算的 `kind` |
| `finalDamage` / `finalElapsed` / `finalDps` / `finalKills` / `finalLeaks` | **最终轮输出**与其它结算数 | `s.runResult`（没有就用 `history.at(-1)`） |
| `finalBonds[]` | **最终轮盟约情况**：`{id,name,count,rawCount,active}`，按层数降序 | `game.bonds()` → `protocol.activeBonds` |
| `bannedBonds[]` | 本局缺席（被禁）的盟约 | `s.bondBan.bonds` + 原表名字 |
| `finalLineup[]` | **最终轮场上具体阵容**：`{chessId,charId,name,isGolden,rank,level,x,y,dir,skillIndex,skillName,damage,equipment[]}`，按输出降序 | `s.units.filter(u=>u.position)`；`damage` 按 uid 对上最终轮结算 |
| `id` / `at` / `atText` | 去重键与时间戳（`s.runRecordId` 懒生成，随存档走） | — |

口径备注：
- 只记**场上**干员（`position != null`），整备区不算；装备记 id + 名字。
- 盟约层数用 `activeBonds` 的 `count`（含调和加成）与 `rawCount`（自然层数）两个都留档，`active` 是最终轮是否激活。
- 超过 10 场时丢最旧的；同 `id` 覆盖不新增（同一局重复结算只留一条）。

## 3. 导出 / 导入

**导出**（大厅动作行与对局顶栏共用一个 `data-act="export"`）：

```jsonc
{
  "format": "garrison-protocol-save",
  "archiveVersion": 1,
  "exportedAt": 1750000000000,
  // …下面是原来的对局存档字段（version/s/savedAt/expiresAt/battle），有对局时才写…
  "archive": { "version": 1, "runs": [ /* 最多 10 条 */ ], "prepSkills": {…}, "flags": {"sees": false, "egg325": false, "cat": false} }
}
```

文件名 `garrison-save-<时间戳>.json`。`NativeSession.restore` 只读 `version/s/battle/savedAt/expiresAt`，**多出来的 `format`／`archive` 等字段会被忽略**，所以带档案的导出文件仍然是合法的对局存档（`tests/native-archive.test.mjs` 里直接跑 `NativeSession.restore` 验证）。

**导入**（原有 `data-act="import"`，已扩展）：
- 文件里有对局存档 → 照旧 `NativeSession.restore` 恢复对局；
- 文件里有 `archive` → 与本地档案**按 id 合并**（同 id 用导入的版本，其余按时间合并，仍只留 10 场），`prepSkills`／`flags` 一并并入；
- 合并后的 `prepSkills` 会校验并写回 `garrison-prep-default-skill-v1`，成为战前准备和新局实际读取的技能配置；
- 只有档案（大厅里没有进行中的对局时导出的文件）→ 只导入档案并提示，不会伪造一个对局；
- 两者都没有 → 报「这个 JSON 既不是对局存档，也没有战绩档案」。

## 4. 界面

- **主界面（大厅）**：`战绩与解锁` 是独立入口，点击后在大厅上方打开浮窗，集中展示最近十场和已解锁内容；`导出存档` 与原有 `导入存档` 仍在动作行。
- **战绩与解锁浮窗**：最多十场记录，每条折叠展示词条／地图／存活波数（含总场数、停留回合和剩余生命）／通关状态／最终轮输出／盟约情况／缺席盟约／最终阵容。解锁列表只显示已解锁的内容；未解锁的隐藏彩蛋不泄露名称。已解锁的 S.E.E.S. 可在浮窗内关闭。
- **战前准备页**：只浏览干员和装备资料、设置新局默认技能。干员与装备按横向卡片带滚动；点击干员卡上的 S1／S2 等按钮立即保存该技能为默认，底部筛选栏固定在视口下方；「全体恢复档案默认」一次清除全部技能覆盖。
- **作战报告**：加一行「已记入本地战绩：最近 N 场…」，说明去哪看、导出会带走。

用户原话里的「最终轮盟约清空」经确认为笔误，实际是**最终轮盟约情况**（已按上表实现）。

### 4.1 输入密码（2026-09-27 口径）

「资料与工具 → 输入密码」的数字键盘确认后走 `dist/native-passcode.js` 的密码表：

| 输入 | 结果 |
| --- | --- |
| `20100305` | 弹窗 **「策略：S.E.E.S.已解锁」**，并把本地档案的特殊标记 `flags.sees` 写成 `true`（写回 `garrison-archive-v1`，导出存档时一起带走） |
| `325` | 弹窗「325模式已解锁」，`flags.egg325 = true` —— 解锁后大厅「行动难度」里才会出现「325 模式」 |
| `20190501` | 弹窗「海猫模式已解锁」，`flags.cat = true` —— 解锁后才会出现「海猫模式」 |
| 其它任意数字 | **什么都不做**，只提示「什么都没有发生」（档案一个字节都不改） |

**325 模式与海猫模式默认不在选项里出现**（用户 2026-09-27 口径）：大厅渲染后由 `native-play.gateLockedModes()` 按 `flags.egg325`／`flags.cat` 把「行动难度」里对应的 `<option>` 摘掉；解锁后（密码）再渲染就带上了。门控只动 `<option>`，不动 `native-lobby` 的模板，旧存档里已经在跑的模式也不会被打断。

特殊标记（战绩与解锁浮窗里的【S.E.E.S.】开关）按用户口径是**隐藏彩蛋**：`flags.sees=false` 时不显示该项名称与开关。

密码表 `PASSCODES` 是纯数据：以后新增密码加一条 `{code,flag,name,title}` 即可，`flag` 必须在 `native-archive` 的 `ARCHIVE_FLAG_DEFAULTS` 里有默认值（有门禁用例守着）。`sees` 控制 S.E.E.S. 内容可见性；`egg325` 与 `cat` 控制两个隐藏模式在行动难度下拉框中的可见性。

导入合并只用文件里**明确保存的布尔标记**覆盖本地同名标记。较早的档案没有 `egg325`／`cat` 字段，导入时保留本地后来解锁的状态；文件明确写入 `false` 时仍按导入值关闭。

## 5. 接线清单

| 文件 | 改动 |
| --- | --- |
| `dist/native-archive.js` | 新增：档案结构、规范化、读写、`runRecord` 取数、`exportRecord`／`archiveFromRecord`、合并与去重 |
| `dist/native-passcode.js` | 新增：密码表 `PASSCODES` 与纯函数 `matchPasscode`／`applyPasscode`（命中→置位标记） |
| `dist/native-archive.css` | 新增：主菜单档案浮窗样式 |
| `dist/native-play.js` | 档案 helper 与 `recordRunIfOver`、导出／导入分支、大厅「战绩与解锁」浮窗入口、浮窗开关动作、战报提示 |
| `dist/native-prep.js` | `renderArchiveWindow()` 战绩与解锁浮窗；`renderPreparePage(...,{archive})` 横向资料卡与即时默认技能按钮 |
| `scripts/build-browser.mjs` | 打包清单登记 `native-archive.js` |
| `tests/native-archive.test.mjs` | 9 条回归（字段取数、只留 10 场、坏数据丢弃、storage 读写、导出→导入往返、合并、页面字段、接线门禁） |

## 6. 验证与未闭环

- `node --test tests/native-archive.test.mjs` 9/9 通过；**回归会咬人**：把 `exportRecord` 的 `archive` 置空、把档案区渲染短路后，对应的两条用例立刻失败（已实测并还原）。
- 导出文件的可读性由真实 `NativeSession.restore` 断言（不是只测 JSON 结构）。
- 未闭环：
  1. 战绩列表只读，没有「删除单场／清空记录」的界面（用户没要求）；
  2. 档案里不含音量／动效等本地偏好（它们仍在各自的 preference 键），也不含禁用方案配置（仍在 `native-bond-ban` 的配置键）；
  3. 只记「打完的局」：中途开始新一局或直接回大厅不会入档；
  4. `finalLineup` 的 `damage` 依赖最终轮结算里的 `units` 明细，若某条结算没有明细则该员记 0。
