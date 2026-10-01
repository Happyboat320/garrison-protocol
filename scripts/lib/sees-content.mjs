// S.E.E.S. 联动内容的数据注入（构建期共用）：把 data/modes/alliance-lower/sees-content.json 里的
// 策略／盟约／干员分层与卫戍说明／装备并进 `source`，好让 build-protocol（名册、装备、盟约）与 build-native（运行时）
// 看到同一份数据。**不改历史快照文件**：注入只发生在内存里，与 build-native 里的 chess_virtual_*／
// collab-operators 是同一套做法。
//
// 口径见 docs/SEES_CONTENT.md：
// * 数据总是烘进运行时（有存档的旧局也能读回来），可见性由本地存档的 flags.sees 决定，
//   卡池资格由「本局策略是不是 band_sees」决定。
// * 四名干员的 shop 记录保持 `isHidden:true`（所以不进 112 名册与旧商店池），另加 `sees:true` 标记；
//   只有 band_sees 局里 `eligible()` 才会放行，装备同理。
import fs from 'node:fs';

export const SEES_CONTENT_PATH = 'data/modes/alliance-lower/sees-content.json';
export const SEES_BAND_ID = 'band_sees';
export const SEES_BOND_ID = 'seesShip';
export const TARTARUS_BOND_ID = 'tartarusShip';

export function loadSeesContent() {
  return JSON.parse(fs.readFileSync(SEES_CONTENT_PATH, 'utf8'));
}

// 装备的 effectBuffInfoDataDict：臂章的数值行（弱点伤害／真实伤害比例，按初始/精锐两档写在黑板里）。
function armbandRows(content) {
  const weakness = content.numbers.armband.weakness;
  const trueScale = content.numbers.armband['true'];
  const row = (w, t) => ({
    key: 'sees_armband_damage',
    blackboard: [
      { key: 'key', value: 0, valueStr: 'act1autochess_equip_sees_armband_global_buff' },
      { key: 'weakness_scale', value: w, valueStr: null },
      { key: 'true_scale', value: t, valueStr: null }
    ],
    countType: 'COUNTING'
  });
  return { normal: row(weakness.initial, trueScale.initial), elite: row(weakness.elite, trueScale.elite) };
}

function operatorGarrisonDesc(op, numbers, elite = false) {
  const percent = value => Number(Number(value).toFixed(1)).toString();
  const form = elite ? 'elite' : 'initial';
  const values = {
    uikariPerFund: numbers.uikariPerFund[form],
    aigisPerLayerPercent: percent(numbers.aigisPerLayer * 100),
    aigisAtCapPercent: percent(numbers.aigisPerLayer * numbers.tartarusLayerCap * 100),
    tartarusLayerCap: numbers.tartarusLayerCap,
    makotoKillLayers: numbers.makotoKillLayers[form]
  };
  const desc = String(op.garrisonDesc || '').replace(/\{([A-Za-z0-9]+)\}/g, (token, key) => {
    if (!Object.hasOwn(values, key)) throw Error('Unknown S.E.E.S. garrison text value: ' + key);
    return values[key];
  });
  if (/\{[^}]+\}/.test(desc)) throw Error('Unresolved S.E.E.S. garrison text value for ' + op.charId);
  return desc;
}

export function applySeesContent(source, content = loadSeesContent()) {
  const season = source.season;
  const { band, bonds, operators, equipment, numbers } = content;

  // ① 策略（bandDataListDict 是「这一局选哪个策略」，bandDataDict 是策略名/图标）
  season.bandDataListDict[band.bandId] = {
    bandId: band.bandId,
    sortId: band.sortId,
    modeTypeList: band.modeTypeList.slice(),
    bandDesc: band.bandDesc,
    totalHp: band.totalHp,
    effectId: band.effectId,
    victorCount: band.victorCount,
    bandRewardModulus: band.bandRewardModulus,
    updateTime: 1773475200
  };
  source.common.bandDataDict[band.bandId] = {
    bandId: band.bandId,
    bandName: band.bandName,
    bandIconId: band.bandIconId,
    unlockDesc: null
  };
  season.bandDataListDict[band.bandId].bandName = band.bandName;

  // ①b 策略效果行：strategyCoverage（）会读每个策略的 effectBuffInfoDataDict，缺了会直接抛。
  //     「回合结束把资金换成层数」的实现在 dist/native-sees.js（不走策略事件解释器），这里只登记符文与参数。
  season.effectBuffInfoDataDict[band.effectId] = [{
    key: 'sees_round_end_fund_to_layers',
    blackboard: [
      { key: 'per_fund_layers', value: numbers.tartarusPerFund, valueStr: null },
      { key: 'grant_every_layers', value: numbers.grantEveryLayers, valueStr: null }
    ],
    countType: 'COUNTING'
  }];

  // ② 盟约：bondInfoDict（面板/判定）＋ common.bondInfoDict（isPower 等静态信息）
  const chessIdList = operators.map(o => o.chessId);
  for (const bond of bonds) {
    season.bondInfoDict[bond.bondId] = {
      bondId: bond.bondId,
      name: bond.name,
      desc: bond.desc,
      iconId: `icon_${bond.bondId}`,
      activeCount: bond.activeCount,
      activeCondition: 'BOARD',
      activeConditionTemplate: 'count_threshold_upward',
      activeParamList: bond.activeParamList.slice(),
      effectId: bond.effectId,
      activeType: 'BATTLE',
      identifier: bond.identifier,
      weight: bond.weight,
      isActiveInDeck: false,
      maxInactiveBondCount: -1,
      descParamBaseList: [],
      descParamPerStackList: [],
      noStack: bond.noStack,
      chessIdList: bond.bondId === SEES_BOND_ID ? chessIdList.slice() : []
    };
    source.common.bondInfoDict[bond.bondId] = {
      bondId: bond.bondId,
      bondType: 'SEASON',
      powerIdList: [],
      name: bond.name,
      icon: `icon_${bond.bondId}`,
      isPower: bond.isPower,
      bondOrder: bond.identifier,
      isHiddenCharList: false
    };
  }

  // ③ 四名干员：阶级按用户口径（1/2/3/6），挂上核心盟约，并标记为「只在 S.E.E.S. 策略里可抽」。
  // build-protocol 先于 build-native 跑，那时联动干员的商店/档位记录还没建（在 build-native 里才建），
  // 所以这里**缺什么补什么**：build-protocol 拿到一份能进 catalog 的最小记录，build-native 复用真正的记录。
  for (const op of operators) {
    if (!op.goldenChessId) throw Error('S.E.E.S. operator is missing its golden chess id: ' + op.charId);
    const shop = season.charShopChessDatas[op.chessId] ??= {
      chessId: op.chessId, goldenChessId: op.goldenChessId, chessLevel: op.chessLevel, shopLevelSortId: op.chessLevel,
      chessType: 'NORMAL', charId: op.charId, tmplId: null, defaultSkillIndex: 0, isHidden: true
    };
    shop.goldenChessId = op.goldenChessId;
    shop.chessLevel = op.chessLevel;
    shop.shopLevelSortId = op.chessLevel;
    if (Number.isInteger(op.defaultSkillIndex)) shop.defaultSkillIndex = op.defaultSkillIndex;
    shop.sees = true;
    const chess = season.charChessDataDict[op.chessId] ??= {
      chessId: op.chessId, identifier: 0, isGolden: false, upgradeChessId: op.goldenChessId, upgradeNum: 3,
      charId: op.charId, bondIds: [], garrisonIds: [],
      status: { evolvePhase: 'PHASE_2', charLevel: 1, skillLevel: 1, favorPoint: 0, equipLevel: 0 }
    };
    chess.upgradeChessId = op.goldenChessId;
    chess.upgradeNum = 3;
    chess.bondIds = [SEES_BOND_ID];
    // The dossier stores the previously specified per-operator SEES effect as a garrison
    // descriptor. Runtime behavior stays in native-sees/native-collab; this custom event
    // type keeps the generic garrison interpreter from applying the same effect twice.
    if (!op.garrisonId || !op.garrisonDesc) throw Error('S.E.E.S. operator is missing its garrison descriptor: ' + op.charId);
    const garrisonDesc = operatorGarrisonDesc(op, numbers);
    const eliteGarrisonId = `${op.garrisonId}_elite`;
    const eliteGarrisonDesc = operatorGarrisonDesc(op, numbers, true);
    season.garrisonDataDict ??= {};
    const garrisonRecord = description => ({
      garrisonDesc: description,
      eventType: 'SEES_NATIVE',
      eventTypeDesc: 'S.E.E.S. 专属',
      eventTypeIcon: 'icon_battle',
      eventTypeSmallIcon: 's_icon_battle',
      effectType: 'NATIVE_SEES',
      charLevel: 0,
      battleRuneKey: null,
      blackboard: [],
      description
    });
    season.garrisonDataDict[op.garrisonId] = garrisonRecord(garrisonDesc);
    season.garrisonDataDict[eliteGarrisonId] = garrisonRecord(eliteGarrisonDesc);
    chess.garrisonIds = [...new Set([...(chess.garrisonIds || []), op.garrisonId])];

    season.charChessDataDict[op.goldenChessId] = {
      ...structuredClone(chess),
      chessId: op.goldenChessId,
      isGolden: true,
      upgradeChessId: null,
      upgradeNum: 0,
      garrisonIds: [eliteGarrisonId]
    };
    season.charShopChessDatas[op.goldenChessId] = {
      chessId: op.goldenChessId,
      goldenChessId: null,
      chessLevel: op.chessLevel,
      shopLevelSortId: 999,
      chessType: 'NORMAL',
      charId: op.charId,
      tmplId: null,
      defaultSkillIndex: shop.defaultSkillIndex || 0,
      isHidden: true
    };
    season.chessNormalIdLookupDict ??= {};
    season.chessNormalIdLookupDict[op.goldenChessId] = op.chessId;
  }

  // ④ 装备「S.E.E.S.臂章」：普通/精锐两条记录 ＋ 效果表 ＋ 商店记录。
  //    giveBondId = seesShip：它自己的盟约归属是 S.E.E.S.，所以和「形变同构体」一起装备时，
  //    refreshEquipmentBonds 会把 seesShip 发给携带者（转职口径，不用另写判定）。
  for (const item of equipment) {
    season.trapShopChessDatas[item.itemId] = {
      itemId: item.itemId,
      goldenItemId: item.goldenItemId,
      name: item.name,
      // hideInShop 是「不在默认可见集合里」：`catalog.items[].hidden` 就是它，战前准备按它过滤。
      // 臂章只在解锁（flags.sees）且本局选了 band_sees 时才该出现，所以默认隐藏在数据层，
      // 由 native-sees.dataForPrep 在解锁时摘掉、由 native-sees.itemAllowed 在本局放行进装备池。
      hideInShop: true,
      sees: true,
      itemLevel: item.itemLevel,
      iconLevel: 0,
      shopLevelSortId: item.shopLevelSortId,
      itemType: 'EQUIP',
      trapId: item.trapId
    };
    season.trapChessDataDict[item.itemId] = {
      chessId: item.itemId,
      identifier: 9101,
      charId: item.trapId,
      isGolden: false,
      purchasePrice: item.purchasePrice,
      status: { evolvePhase: 'PHASE_0', trapLevel: 1, skillIndex: 0, skillLevel: 1 },
      upgradeChessId: item.goldenItemId,
      upgradeNum: 2,
      trapDuration: -1,
      effectId: item.effectId,
      giveBondId: item.giveBondId,
      givePowerId: null,
      canGiveBond: false,
      itemType: 'EQUIP'
    };
    season.trapChessDataDict[item.goldenItemId] = {
      ...season.trapChessDataDict[item.itemId],
      chessId: item.goldenItemId,
      identifier: 9102,
      isGolden: true,
      purchasePrice: item.purchasePrice + 2,
      status: { evolvePhase: 'PHASE_0', trapLevel: 1, skillIndex: 1, skillLevel: 1 },
      upgradeChessId: null,
      upgradeNum: 0,
      trapDuration: 0,
      effectId: item.eliteEffectId
    };
    const rows = armbandRows(content);
    for (const [effectId, desc, row] of [
      [item.effectId, item.desc, rows.normal],
      [item.eliteEffectId, item.desc, rows.elite]
    ]) {
      season.effectInfoDataDict[effectId] = {
        effectId,
        effectType: 'EQUIP',
        effectCounterType: 'NONE',
        continuedRound: -1,
        effectName: item.name,
        effectDesc: desc,
        effectDecoIconId: null,
        enemyPrice: 0
      };
      season.effectBuffInfoDataDict[effectId] = [row];
    }
  }
  season.seesNumbers = { ...numbers };
  season.seesBandId = band.bandId;
  return source;
}
