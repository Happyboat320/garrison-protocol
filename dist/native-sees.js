// S.E.E.S. 联动玩法的运行时层（用户 2026-09-27 口径；数值全部来自 data.sees.numbers，不写死）。
//
// 三条边界：
//  1. **数据总是烘进运行时**（策略／两条盟约／四名干员／臂章），这样带 S.E.E.S. 存档的老局能读回来；
//  2. **可见性**看本地存档的特殊标记 flags.sees：策略列表、战前准备里的四人与臂章都按它开关；
//  3. **卡池资格**看本局策略是不是 band_sees：只有选了【S.E.E.S.】，四人与臂章才进商店池／装备池。
//
// 依赖方向：session／battle／play → native-sees。本模块**不** import 那三个（避免成环），只依赖 data 与传入的会话/单位。
export const SEES_BAND_ID = 'band_sees';
export const SEES_BOND_ID = 'seesShip';
export const TARTARUS_BOND_ID = 'tartarusShip';

export function seesNumbers(data) { return data?.sees?.numbers || {}; }
export function seesUnlocked(archive) { return !!(archive?.flags?.sees); }
export function bandIdOf(value) { return typeof value === 'string' ? value : value?.bandId ?? value?.s?.bandId ?? null; }
export function isSeesBand(value) { return bandIdOf(value) === SEES_BAND_ID; }
// 这一局是不是「选了 S.E.E.S. 策略」——卡池放行、层数结算都以它为准（不是存档标记）。
export function seesRun(sessionLike) { return isSeesBand(sessionLike?.s ?? sessionLike); }

// 策略列表（大厅 → 策略选择）：没解锁时把 band_sees 摘掉。数据仍在 runtime 里，读档不受影响。
export function visibleBands(data, archive) {
  const bands = Object.values(data.season.bandDataListDict);
  return seesUnlocked(archive) ? bands : bands.filter(b => b.bandId !== SEES_BAND_ID);
}
// 商店干员池：SEES 四条记录平时 isHidden，只有 band_sees 局才放行（与 NativeSession.eligible 同一口径）。
export function operatorAllowed(data, record, sessionLike) {
  if (!record?.charId) return false;
  if (!record.sees) return !record.isHidden;
  return seesRun(sessionLike) && !!(data.profiles?.[record.chessId] || data.season.charChessDataDict?.[record.chessId]);
}
export function itemAllowed(item, sessionLike) {
  if (!item?.sees) return !item.hidden;
  return seesRun(sessionLike);
}
// 战前准备：解锁后才把这四人（与臂章）算进名册。做法是把 SEES 记录的 isHidden 临时摘掉，
// 直接复用 native-bond-ban.bondRoster 与 native-prep 原有的映射，不另写一套行结构。
export function dataForPrep(data, archive) {
  if (!seesUnlocked(archive)) return data;
  const shop = { ...data.season.charShopChessDatas };
  for (const id of Object.keys(shop)) if (shop[id]?.sees) shop[id] = { ...shop[id], isHidden: false };
  const items = (data.items || []).map(i => (i.sees ? { ...i, hidden: false } : i));
  return { ...data, season: { ...data.season, charShopChessDatas: shop }, items };
}
// ──【塔尔塔罗斯】层数 ────────────────────────────────────────────────────────
// 层数存 s.bondLayers.tartarusShip（与盟约「叠层」同一账本），面板与效果都读这里。
export function tartarusLayers(sessionLike) {
  const s = sessionLike?.s ?? sessionLike;
  return Number(s?.bondLayers?.[TARTARUS_BOND_ID]) || 0;
}
export function addTartarusLayers(sessionLike, count, data = null) {
  const session = sessionLike?.s ? sessionLike : null;
  const s = session?.s ?? sessionLike;
  if (!s || !Number.isFinite(Number(count)) || Number(count) === 0) return tartarusLayers(s);
  const cap = tartarusCap(data);
  s.bondLayers ??= {};
  const current = Number(s.bondLayers[TARTARUS_BOND_ID]) || 0;
  // 用户 2026-09-27 口径：层数上限 264，满了不再增长（多的部分直接丢掉，不记欠账）。
  s.bondLayers[TARTARUS_BOND_ID] = Math.max(0, Math.min(cap, current + Number(count)));
  return s.bondLayers[TARTARUS_BOND_ID];
}
// 上限：直接从 numbers 读（没烘进数据时退回 264），避免代码与数据两份常量。
export function tartarusCap(data = null) {
  const numbers = data ? seesNumbers(data) : null;
  return Number(numbers?.tartarusLayerCap) || 264;
}
// 核心盟约的真实伤害比例：0 层 5% → 264 层 40% 线性，超过上限按上限算。
export function coreTrueDamagePercent(data, layers) {
  const numbers = seesNumbers(data);
  const base = Number(numbers.coreTrueDamagePercentBase ?? 0.05);
  const max = Number(numbers.coreTrueDamagePercentMax ?? 0.4);
  const cap = tartarusCap(data);
  const ratio = Math.max(0, Math.min(1, (Number(layers) || 0) / cap));
  return base + (max - base) * ratio;
}
// 核心盟约冷却：层数 >= 264 时 1 秒，否则 20 秒（用户 2026-09-27 口径：条件是 >=，不是 >）。
export function coreCooldown(data, layers) {
  const numbers = seesNumbers(data);
  const fast = Number(numbers.coreFastThreshold ?? 264);
  return (Number(layers) || 0) >= fast
    ? Number(numbers.coreFastCooldownSeconds ?? 1)
    : Number(numbers.coreCooldownSeconds ?? 20);
}
// 面板显示用：塔尔塔罗斯没有「干员成员」概念，层数就是它的层。
export function bondPanelCount(data, sessionLike, bondId, fallback) {
  return bandIdOf(bondId) === TARTARUS_BOND_ID ? tartarusLayers(sessionLike) : fallback;
}
// 每资金层数：基础 5；场上有岳羽由加莉时，按她的形态（初始 +2／精锐 +4）再叠一层加成。
export function layersPerFund(data, sessionLike, units = null) {
  const numbers = seesNumbers(data), base = Number(numbers.tartarusPerFund) || 0;
  const list = units || sessionLike?.s?.units || [];
  let bonus = 0;
  for (const u of list) {
    if (!u || u.position == null) continue;
    if (u.charId !== 'char_4219_yukari') continue;
    const golden = !!(u.isGolden || data.profiles?.[u.chessId]?.isGolden || data.season.charChessDataDict?.[u.chessId]?.isGolden);
    const row = numbers.uikariPerFund || {};
    bonus += Number(golden ? row.elite : row.initial) || 0;
  }
  return base + bonus;
}

// ── 四名干员的分层效果（数值全部来自 data.sees.numbers，代码不写死）───────────────
// 身份按 charId 判（精锐与初始算同一名），与盟约禁用／名册同一套口径。
// 名册优先用 data.sees.roster（构建期从注入后的数据反推），拿不到才退回内置 charId 常量。
export const SEES_CHAR_IDS = Object.freeze({ kormr: 'char_4220_kormr', yukari: 'char_4219_yukari', aigis: 'char_4218_aigis', makoto: 'char_4217_makoto' });
function charIdOf(unit) { return unit?.charId || unit?.id || unit?.source?.charId || null; }
export function isSeesOperator(data, unit) {
  const charId = charIdOf(unit);
  if (!charId) return false;
  const roster = data?.sees?.roster;
  if (Array.isArray(roster) && roster.length) return roster.some(row => row.charId === charId);
  return Object.values(SEES_CHAR_IDS).includes(charId);
}
// 虎狼丸：造成的伤害变为**弱点伤害**（命中类型按敌方防御／法抗取更有效的那一种，与「陈」策略同一口径）。
// `unit.weaknessAttacker` 是给干员模块留的同一条通道（结城理 S3 的塔纳托斯·改＝弱点伤害）。
export function weaknessSource(unit) { return charIdOf(unit) === SEES_CHAR_IDS.kormr || unit?.weaknessAttacker === true; }
// 虎狼丸：不占用部署位——不参与 s.capacity 的「N/M 部署」上限判定与计数。
export function freeDeploy(data, unit) { return weaknessSource(unit); }
// 结城理：每次击倒（击倒敌人／自身被击倒）+初始／精锐两档层数。只对结城理本人返回非 0，
// 所以调用方可以无脑遍历场上的 S.E.E.S. 干员求和。
export function makotoKillLayers(data, unit) {
  if (charIdOf(unit) !== SEES_CHAR_IDS.makoto) return 0;
  const row = seesNumbers(data).makotoKillLayers || {};
  const golden = !!(unit?.isGolden || data?.profiles?.[unit?.chessId]?.isGolden || data?.season?.charChessDataDict?.[unit?.chessId]?.isGolden);
  return Number(golden ? row.elite : row.initial) || 0;
}
// 埃癸斯：攻击／生命随【塔尔塔罗斯】层数的增幅倍率（1 + 每层 0.2% × 层数）。
export function aigisLayerScale(data, layers) {
  const per = Number(seesNumbers(data).aigisPerLayer) || 0;
  return 1 + per * Math.max(0, Number(layers) || 0);
}
// 每 N 层发一名 S.E.E.S. 干员（节奏取自数据，不在代码里写 25）。
export function grantEveryLayers(data) { return Number(seesNumbers(data).grantEveryLayers) || 25; }
export function grantCountForLayers(data, layers) { return Math.floor((Math.max(0, Number(layers) || 0)) / grantEveryLayers(data)); }
// 回合结束结算：消耗**全部剩余资金**换【塔尔塔罗斯】层数（每资金 perFund 层，封顶 264），
// 返回本次实际增加的层数（封顶后多出来的直接丢掉，不记欠账）。
export function settleFundsToLayers(data, sessionLike, units = null) {
  const s = sessionLike?.s ?? sessionLike;
  if (!s) return 0;
  const per = layersPerFund(data, sessionLike, units);
  const funds = Math.max(0, Number(s.funds) || 0);
  const before = tartarusLayers(s);
  addTartarusLayers(s, per * funds, data);
  return tartarusLayers(s) - before;
}
// 发放候选：阶级不高于当前商店等级；「尽可能不与场上已有的重复」＝先在不重复的那批里抽，
// 一个都不剩（四名都在场）才退回全集。没有候选（等级不够）时返回空数组，调用方跳过发放。
export function seesGrantCandidates(data, sessionLike, { exclude = [] } = {}) {
  const s = sessionLike?.s ?? sessionLike;
  const level = Number(s?.level) || 0;
  const owned = new Set(exclude);
  const pool = (data?.sees?.roster || []).filter(row => row?.id && Number(row.rank) <= level);
  return { pool, fresh: pool.filter(row => !owned.has(row.charId)) };
}
