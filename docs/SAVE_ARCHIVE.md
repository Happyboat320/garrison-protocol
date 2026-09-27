# 本地战绩档案与存档导出／导入（2026-09-27）

用户需求：本地存档里记录**最近十场对局**的结果（词条、地图、存活波数、是否通关、最终轮输出、最终轮盟约情况、最终轮场上具体阵容）、**战前准备的技能选择**、**特殊标记开关【S.E.E.S.】（默认 false）**；主界面加「导出存档」，导出 JSON 且能被现有「导入存档」读回。

## 1. 存档键与结构

| 键 | 内容 | 写入时机 |
| --- | --- | --- |
| `garrison-native-manual-v1`（原有） | 当前这一局的对局存档（`NativeSession.snapshot()`） | 原来的 `save()`／`saveCheckpoint()`，未改 |
| **`garrison-archive-v1`（新增）** | 战绩档案：`{version:1, runs:[…最多 10 条…], prepSkills:{charId:档位}, flags:{sees:false}}` | 一局结束、切换【S.E.E.S.】、导入存档时 |

档案**不放在对局存档里**：它是跨局的，换局／读档都不会丢；导出存档时把它一并写进 JSON，导入时并回本地。

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
  "archive": { "version": 1, "runs": [ /* 最多 10 条 */ ], "prepSkills": {…}, "flags": {"sees": false} }
}
```

文件名 `garrison-save-<时间戳>.json`。`NativeSession.restore` 只读 `version/s/battle/savedAt/expiresAt`，**多出来的 `format`／`archive` 等字段会被忽略**，所以带档案的导出文件仍然是合法的对局存档（`tests/native-archive.test.mjs` 里直接跑 `NativeSession.restore` 验证）。

**导入**（原有 `data-act="import"`，已扩展）：
- 文件里有对局存档 → 照旧 `NativeSession.restore` 恢复对局；
- 文件里有 `archive` → 与本地档案**按 id 合并**（同 id 用导入的版本，其余按时间合并，仍只留 10 场），`prepSkills`／`flags` 一并并入；
- 只有档案（大厅里没有进行中的对局时导出的文件）→ 只导入档案并提示，不会伪造一个对局；
- 两者都没有 → 报「这个 JSON 既不是对局存档，也没有战绩档案」。

## 4. 界面

- **主界面（大厅）**：动作行末尾新增 `导出存档`（由 `native-play` 注入到 `.native-loadout-actions`，和已有的 `导入存档` 成对）。
- **战前准备页**：顶部新增档案区
  - `特殊标记`：`【S.E.E.S.】开／关` 按钮（`data-act="prep-flags-sees"`），**默认关**。按用户口径，它只是本地存档里的布尔标记，**不影响抽取、商店与战斗**（四人仍是隐藏档，只在技能测试场可选）。
  - `最近对局`：最多 10 条，只读，每条折叠一个 `<details>`，字段全列：词条／地图／存活波数（含总共打了几场、停在第几回合、剩余生命）／是否通关／最终轮输出（含秒数、DPS、击倒、漏失）／最终轮盟约情况／本局缺席盟约／最终轮场上阵容（干员名＋棋子 id＋坐标＋朝向＋技能＋该员输出＋装备）。
- **作战报告**：加一行「已记入本地战绩：最近 N 场…」，说明去哪看、导出会带走。

用户原话里的「最终轮盟约清空」经确认为笔误，实际是**最终轮盟约情况**（已按上表实现）。

### 4.1 输入密码（2026-09-27 口径）

「资料与工具 → 输入密码」的数字键盘确认后走 `dist/native-passcode.js` 的密码表：

| 输入 | 结果 |
| --- | --- |
| `20100305` | 弹窗 **「策略：S.E.E.S.已解锁」**，并把本地档案的特殊标记 `flags.sees` 写成 `true`（写回 `garrison-archive-v1`，导出存档时一起带走） |
| 其它任意数字 | **什么都不做**，只提示「什么都没有发生」（档案一个字节都不改） |

密码表 `PASSCODES` 是纯数据：以后新增密码加一条 `{code,flag,name,title}` 即可，`flag` 必须在 `native-archive` 的 `ARCHIVE_FLAG_DEFAULTS` 里有默认值（有门禁用例守着）。按用户口径，`sees` 目前**只是存档标记**：不等于把四人放进商店池或名册，他们仍然只是技能测试场里的隐藏档。

## 5. 接线清单

| 文件 | 改动 |
| --- | --- |
| `dist/native-archive.js` | 新增：档案结构、规范化、读写、`runRecord` 取数、`exportRecord`／`archiveFromRecord`、合并与去重 |
| `dist/native-passcode.js` | 新增：密码表 `PASSCODES` 与纯函数 `matchPasscode`／`applyPasscode`（命中→置位标记） |
| `dist/native-archive.css` | 新增：档案区样式 |
| `dist/native-play.js` | 档案 helper 与 `recordRunIfOver`、档案区样式 `<link>`、导出／导入分支、大厅 `导出存档` 按钮注入、`prep-flags-sees` 动作、战前准备页传 `archive`、战报提示 |
| `dist/native-prep.js` | `renderPreparePage(...,{archive})`：特殊标记开关 + 最近对局列表 |
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
