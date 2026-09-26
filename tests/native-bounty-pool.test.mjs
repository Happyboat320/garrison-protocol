import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {bountyOffers,bountyOption,BOUNTY_SLUG} from '../dist/native-bounty.js';
import {ENEMY_KILL_COINS,DEFAULT_WAVE_TABLE} from '../dist/native-wave-defaults.js';
import {enemyCost,defaultWaveTable} from '../dist/native-wave-fill.js';

// 成本依据留在源文件里（normalizeWaveTable 不保留它，避免影响「敌人池是否改动」的判等）。
const rawTable=()=>JSON.parse(fs.readFileSync(new URL('../data/modes/alliance-lower/default-wave-table.json',import.meta.url),'utf8'));

const leaders=Object.entries(data.enemies).filter(([,e])=>e.levelType==='BOSS').map(([id])=>id);

test('悬赏池来自原表 add_enemy_kill_gain_coin：23 名领袖逐条在册，币值取原表',()=>{
 assert.equal(Object.keys(ENEMY_KILL_COINS).length,104,'本期原表击杀奖金表覆盖数');
 for(const id of leaders){
  assert.ok(ENEMY_KILL_COINS[id],id+' 缺少领袖赏金登记'); // 依 PRTS 图鉴编号 enemyInitial/b 组
  assert.match(ENEMY_KILL_COINS[id].effectId,/^enemyeffect_b_\d+$/,'领袖赏金来自 enemyeffect_b_* 组');
  assert.ok(ENEMY_KILL_COINS[id].coin>=1&&ENEMY_KILL_COINS[id].coin<=6,'原表领袖奖金档 1–6');
  assert.equal(ENEMY_KILL_COINS[id].count,1);
 }
 assert.equal(ENEMY_KILL_COINS[BOUNTY_SLUG].coin,0,'源石虫是 0 档');
 // 同一敌人多组登记时取最小 coin，其余变体留档
 const multi=Object.entries(ENEMY_KILL_COINS).filter(([,v])=>v.variants.length>1);
 assert.ok(multi.length>0,'原表存在同敌人多组登记');
 for(const [id,v] of multi)assert.equal(v.coin,Math.min(...v.variants.map(x=>x.coin)),id+' 取最小 coin');
});

test('四选一始终含 1 与 4 奖金档，全部来自原表且不重复',()=>{
 let leadersOffered=new Set();
 for(let seed=0;seed<400;seed++){
  const ids=bountyOffers(data,seed),offers=ids.map(id=>bountyOption(data,id));
  assert.equal(ids.length,4);assert.equal(new Set(ids).size,4);
  assert.deepEqual(bountyOffers(data,seed),ids,'同种子可复现');
  assert.ok(offers.some(o=>o.coin===1));assert.ok(offers.some(o=>o.coin===4));
  for(const o of offers){
   assert.equal(o.source,'kill-coin',o.id+' 应来自原表悬赏池');
   assert.ok(o.coin>=0&&o.coin<=6);
   assert.equal(data.enemies[o.enemyId].enemyBehavior.randomPoolEligible,true);
   if(data.enemies[o.enemyId].levelType==='BOSS')leadersOffered.add(o.enemyId);
  }
 }
 assert.ok(leadersOffered.size>=8,'领袖应当能出现在悬赏里，实际 '+leadersOffered.size);
});

test('旧存档兼容：按波次表成本推导的旧悬赏仍可读回，新悬赏不再用它',()=>{
 const legacy=Object.keys(DEFAULT_WAVE_TABLE.costs).find(id=>!ENEMY_KILL_COINS[id]&&data.enemies[id]?.enemyBehavior?.randomPoolEligible===true);
 assert.ok(legacy,'应存在「有波次成本但原表没有奖金登记」的敌人');
 const option=bountyOption(data,legacy);
 assert.ok(option);assert.equal(option.source,'legacy-cost');assert.ok(option.coin<=4);
 // 原表有登记的敌人即使也有波次成本，也一律用原表币值
 const both=Object.keys(ENEMY_KILL_COINS).find(id=>Number.isFinite(DEFAULT_WAVE_TABLE.costs[id])&&data.enemies[id].enemyBehavior.randomPoolEligible===true);
 assert.equal(bountyOption(data,both).source,'kill-coin');
});

test('编制台：领袖有成本来源，不再回落到 defaultCost=1',()=>{
 const table=defaultWaveTable();
 assert.equal(table.defaultCost,1);
 for(const id of leaders){
  const cost=enemyCost(table,id);
  assert.ok(cost>1,data.enemies[id].name+' 成本不应是默认值');
  assert.ok(cost>=9&&cost<=14,'领袖成本映射到 1–14 区间的高位: '+cost);
  assert.equal(cost,8+ENEMY_KILL_COINS[id].coin);
 }
 assert.match(String(defaultWaveTable().costSources?.enemy_1500_skulsr||rawTable().costSources?.enemy_1500_skulsr||''),/领袖赏金表/,'成本依据要留档');
});

test('新悬赏记录能通过存档校验',()=>{
 const g=new NativeSession(data,{seed:42});
 g.s.round=2;g.s.lastPrepRound=null;g.s.rewardPending=null;
 const row=g.ensureRoundBounty();
 assert.ok(row);assert.equal(row.offers.length,4);
 assert.ok(row.offers.every(id=>bountyOption(data,id)));
 const restored=NativeSession.restore(data,JSON.parse(JSON.stringify(g.snapshot())));
 assert.ok(restored);assert.deepEqual(restored.s.roundBounty,row);
});
