import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveChess } from '../dist/protocol.js';
import { NATIVE_DATA } from '../dist/runtime-data.js';
import { openBattle, byId } from './effects-harness.mjs';

const source = JSON.parse(fs.readFileSync('data/modes/alliance-lower/source.json', 'utf8'));
const base = JSON.parse(fs.readFileSync('data/normalized/allianceLower.json', 'utf8'));
const maxBonus = { atk: 0.1, def: 0.1, maxHp: 0.1 };

test('112 名可见干员的初始与精锐养成档位符合设计表', () => {
  const rows = Object.values(source.season.charShopChessDatas).filter(row => row.charId && !row.isHidden);
  assert.equal(rows.length, 112);
  for (const row of rows) {
    const initial = source.season.charChessDataDict[row.chessId].status;
    const elite = source.season.charChessDataDict[row.goldenChessId].status;
    const initialPhase = row.chessLevel <= 2 ? 'PHASE_1' : 'PHASE_2';
    const initialLevel = row.chessLevel === 1 ? 55 : row.chessLevel === 2 ? 60 : 1;
    const eliteLevel = row.chessLevel === 1 ? 50 : row.chessLevel === 2 ? 55 : 60;
    const eliteModule = row.chessLevel === 6 ? 3 : 1;
    assert.deepEqual(initial, { evolvePhase: initialPhase, charLevel: initialLevel, skillLevel: 4, favorPoint: 0, equipLevel: 0 }, `${row.chessId} 初始状态`);
    assert.deepEqual(elite, { evolvePhase: 'PHASE_2', charLevel: eliteLevel, skillLevel: 7, favorPoint: 0, equipLevel: eliteModule }, `${row.goldenChessId} 精锐状态`);
  }
});

test('所有可见干员档案保留原始属性，最高养成加成由全局战斗配置提供', () => {
  assert.deepEqual(NATIVE_DATA.cultivationBonus, maxBonus);
  const rows = Object.values(NATIVE_DATA.season.charShopChessDatas).filter(row => row.charId && !row.isHidden);
  for (const row of rows) {
    for (const chessId of [row.chessId, row.goldenChessId]) {
      const profile = NATIVE_DATA.profiles[chessId];
      assert.ok(profile, `${chessId} 存在运行时档案`);
      assert.deepEqual(profile.attributes, resolveChess(NATIVE_DATA, base, chessId).attributes, `${chessId} 保留原始档案属性`);
      for (let index = 0; index < profile.skillChoices.length; index++) {
        assert.deepEqual(profile.skillChoices[index].attributes, resolveChess(NATIVE_DATA, base, chessId, { skillIndex: index }).attributes, `${chessId} 技能 ${index + 1} 档保留原始属性`);
      }
    }
  }
});

test('战斗属性实际应用攻击、防御和生命上限各 +10%', () => {
  const id = 'chess_char_1_01_a';
  const unboosted = openBattle(id, { data: { ...NATIVE_DATA, cultivationBonus: null } }).b;
  const boosted = openBattle(id).b;
  const charId = NATIVE_DATA.season.charShopChessDatas[id].charId;
  const before = unboosted.stats(byId(unboosted, charId));
  const after = boosted.stats(byId(boosted, charId));
  for (const stat of ['atk', 'def', 'maxHp']) assert.ok(Math.abs(after[stat] - before[stat] * 1.1) < 1e-8, `${stat} 应提升 10%`);
});
