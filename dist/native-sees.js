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
export function prepSeesIds(data) {
  return {
    chars: new Set((data.sees?.roster || []).map(r => r.charId)),
    chessIds: new Set((data.sees?.roster || []).map(r => r.id)),
    items: new Set((data.sees?.items || []).map(i => i.id))
  };
}

// ──【塔尔塔罗斯】层数 ────────────────────────────────────────────────────────
// 层数存 s.bondLayers.tartarusShip（与盟约「叠层」同一账本），面板与效果都读这里。
export function tartarusLayers(sessionLike) {
  const s = sessionLike?.s ?? sessionLike;
  return Number(s?.bondLayers?.[TARTARUS_BOND_ID]) || 0;
}
export function addTartarusLayers(sessionLike, count) {
  const session = sessionLike?.s ? sessionLike : null;
  const s = session?.s ?? sessionLike;
  if (!s || !Number.isFinite(Number(count)) || Number(count) === 0) return tartarusLayers(s);
  const cap = tartarusCap();
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
// 【塔尔塔罗斯】激活判定：0/0，本局选了 S.E.E.S. 策略就一直算激活。
export function tartarusActive(sessionLike) { return seesRun(sessionLike); }

// 每资金层数：基础 5；场上有岳羽由加莉时，按她的形态（初始 +2／精锐 +4）再叠一层加成。
export function layersPerFund(data, sessionLike, units = null) {
  const numbers = seesNumbers(data), base = Number(numbers.tartarusPerFund) || 0;
  const list = units || sessionLike?.s?.units || [];
  let bonus = 0;
  for (const u of list) {
    if (!u || u.position == null) continue;
    if (u.charId !== 'char_4219_yukari') continue;
    const golden = !!(data.profiles?.[u.chessId]?.isGolden || data.season.charChessDataDict?.[u.chessId]?.isGolden);
    const row = numbers.uikariPerFund || {};
    bonus += Number(golden ? row.elite : row.initial) || 0;
  }
  return base + bonus;
}
