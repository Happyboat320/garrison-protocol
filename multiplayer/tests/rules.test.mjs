import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {decisionOffers, lossesBySource, rotateOrder, BOSS_MULTIPLIERS} from '../shared/rules.js';
import {profileOf} from '../shared/protocol.js';

test('公共六选候选去重，悬赏全部使用已准入精英及原表奖金', () => {
  for (const type of ['bounty', 'equipment', 'tactical']) {
    const offers = decisionOffers(data, type, 4, () => .36);
    assert.equal(offers.length, 6); assert.equal(new Set(offers.map(o => o.id)).size, 6);
    if (type === 'bounty') for (const o of offers) {
      assert.equal(data.enemies[o.enemyId].levelType, 'ELITE');
      assert.equal(data.enemies[o.enemyId].enemyBehavior.randomPoolEligible, true);
    }
  }
});
test('最终按原来源和敌人扣血值结算，单轮各自最多10点', () => {
  const players = [{id: 'A'}, {id: 'B'}, {id: 'C'}, {id: 'D'}];
  assert.deepEqual(lossesBySource(players, [{sourcePlayerId:'A',leak:3}, {sourcePlayerId:'A',leak:9},
    {sourcePlayerId:'B',leak:2}]), {A:10,B:2,C:0,D:0});
  assert.throws(() => lossesBySource(players, [{sourcePlayerId:'missing',leak:1}]));
});
test('轮选轮换与开局人数倍率', () => {
  assert.deepEqual(rotateOrder(['A','B','C'],2), ['B','C','A']);
  assert.deepEqual(BOSS_MULTIPLIERS, {2:3,3:5,4:7});
});
test('头像支持 raster 上传，拒绝 SVG/远程引用', () => {
  assert.equal(profileOf({name:'玩家',avatar:'data:image/png;base64,YQ=='}).name,'玩家');
  assert.throws(() => profileOf({name:'玩家',avatar:'data:image/svg+xml;base64,YQ=='}));
  assert.throws(() => profileOf({name:'玩家',avatar:'https://example.com/a.png'}));
});
