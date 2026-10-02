/** 联机规则保持在独立目录。共享的只有纯函数和协议常量，不引入 DOM 或服务器状态。 */
import {buildPhasePlan, singleDecisionRounds} from '../../dist/protocol.js';
import {bountyOption} from '../../dist/native-bounty.js';
import {ENEMY_KILL_COINS} from '../../dist/native-wave-defaults.js';
import {waveRng} from '../../dist/native-wave-random.js';

import {EMOTE_IDS} from './emotes.js';
export const EMOTES = EMOTE_IDS;
export const PROTOCOL_VERSION = 1;
export const PROFILE_AVATARS = Object.freeze(['👍', '🎉', '❤️', '😅', '😭', '😮', '🔥', '💪', '👀', '🙏', '🫡', '🐱']);
export const BOSS_MULTIPLIERS = Object.freeze({2: 3, 3: 5, 4: 7});
export const MAX_PLAYERS = 4;
export const MAX_ROUND_LOSS = 10;
export const MODES = Object.freeze(['mode_single_funny', 'mode_single_normal', 'mode_single_hard', 'mode_single_abyss']);

export function roundPlan(data, modeId) {
  // 隐秘核心尚未闭环：联机沿用当前开放的最终 Boss 范围，不能擅自解锁条件回合。
  return buildPhasePlan(data, modeId).filter(turn => !turn.isConditional);
}
export function rotateOrder(ids, round) {
  if (!ids.length) return [];
  const offset = (round - 1) % ids.length;
  return [...ids.slice(offset), ...ids.slice(0, offset)];
}
export function distinct(random, rows, count) {
  const pool = rows.slice(), result = [];
  while (pool.length && result.length < count) result.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return result;
}
export function decisionForRound(data, modeId, round, seed) {
  if (!(singleDecisionRounds(data.season.modeDataDict[modeId]) || []).includes(round - 1)) return null;
  const random = waveRng((seed ^ (round * 0x9e3779b9)) >>> 0);
  const type = ['bounty', 'equipment', 'tactical'][Math.floor(random() * 3)];
  return {type, offers: decisionOffers(data, type, round, random)};
}
export function decisionOffers(data, type, round, random) {
  let pool;
  if (type === 'bounty') {
    // 用户明确六项均为精英；不沿用单机的“1精英+2普通 / 2领袖+虫”。
    // 奖金和准入仍来自原表及已验收敌人池，不能因为联机而放开待实现敌人。
    pool = Object.keys(ENEMY_KILL_COINS).map(id => bountyOption(data, id))
      .filter(row => row && row.source === 'kill-coin' && data.enemies[row.enemyId]?.levelType === 'ELITE')
      .map(row => ({id: `bounty:${row.enemyId}`, kind: type, enemyId: row.enemyId, count: row.count, coin: row.coin, name: row.name}));
  } else if (type === 'equipment') {
    const tiers = round <= 6 ? [1, 2, 3] : [5, 6];
    // 专属策略道具不进入公共候选；保留普通道具和策略卡池的边界。
    pool = data.items.filter(row => !row.hidden && !row.sees && tiers.includes(row.rank))
      .map(row => ({id: `equipment:${row.id}`, kind: type, itemId: row.id, name: row.name}));
  } else {
    const allowed = new Set(['global_special_choice_gain_coin', 'global_special_choice_refresh_free',
      'global_special_choice_bond_addlayer', 'enemy_attribute_add', 'enemy_attribute_mul', 'char_attribute_mul']);
    pool = Object.values(data.season.effectInfoDataDict)
      .filter(row => row.effectType === 'BUFF_GAIN' && data.season.effectBuffInfoDataDict[row.effectId]?.length &&
        data.season.effectBuffInfoDataDict[row.effectId].every(effect => allowed.has(effect.key)))
      .map(row => ({id: `tactical:${row.effectId}`, kind: 'tactical', effectId: row.effectId, name: row.effectName}));
  }
  // effectInfoDataDict 可以用不同外键引用同一 effectId，先按实际选择 ID 去重。
  const offers = distinct(random, [...new Map(pool.map(row => [row.id, row])).values()], 6);
  if (offers.length !== 6) throw Error(`联机 ${type} 候选不足六项`);
  return offers;
}
export function lossesBySource(players, remaining) {
  const totals = Object.fromEntries(players.map(player => [player.id, 0]));
  for (const enemy of remaining) {
    if (!(enemy.sourcePlayerId in totals)) throw Error('漏怪原始来源不属于本局');
    totals[enemy.sourcePlayerId] += enemy.leak;
  }
  return Object.fromEntries(Object.entries(totals).map(([id, loss]) => [id, Math.min(MAX_ROUND_LOSS, loss)]));
}
