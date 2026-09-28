import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {buildPhasePlan} from '../dist/protocol.js';
import {dealDamage} from '../dist/native-effects.js';
import {AVAILABLE_FINAL_BOSS_IDS,finalBossConfig,rollFinalBoss} from '../dist/native-final-boss.js';

function finalRound(g){g.s.round=buildPhasePlan(NATIVE_DATA,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1).round;}
function game({mapId=NATIVE_DATA.maps[0].stageId,operator=false,seed=42}={}){
 const g=new NativeSession(NATIVE_DATA,{modeId:'mode_single_normal',bandId:'band_amiya',mapId,seed,bondBan:{bonds:[]},finalBossId:'boss_5'});
 g.s.rewardPending=null;g.s.rewardQueue=[];
 if(operator){g.s.funds=9999;const shop=Object.values(NATIVE_DATA.season.charShopChessDatas).find(x=>x.charId&&!x.isHidden);const u=g.gain(shop.chessId);assert.ok(u);let placed=false;for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);assert.ok(placed);}
 finalRound(g);assert.ok(g.startBattle(),g.lastError||'Boss battle failed to start');return g;
}

test('only implemented final bosses enter the weighted run roll and boss_5 hp follows the selected difficulty',()=>{
 assert.deepEqual(AVAILABLE_FINAL_BOSS_IDS,['boss_5']);
 assert.equal(rollFinalBoss(NATIVE_DATA,'mode_single_normal',123),'boss_5');
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_5','mode_single_normal').hp,390000);
 assert.equal(finalBossConfig(NATIVE_DATA,'boss_5','mode_single_hard').hp,780000);
});

test('every arena has two tile_start routes, a tile_end target, and a closed walkable boss patrol loop',()=>{
 for(const map of NATIVE_DATA.maps){
  assert.equal(map.bossDoorRoutes.length,2,map.stageId);
  const doors=map.bossDoorRoutes.map(r=>({x:r.startPosition.col-map.origin.col,y:map.origin.row-r.startPosition.row}));assert.notDeepEqual(doors[0],doors[1],map.stageId+' red doors must differ');
  assert.deepEqual(new Set(doors.map(p=>map.grid[p.y]?.[p.x]?.tileKey)),new Set(['tile_start']),map.stageId);
  const end=map.bossDoorRoutes[0].endPosition,exit={x:end.col-map.origin.col,y:map.origin.row-end.row};
  assert.equal(map.grid[exit.y]?.[exit.x]?.tileKey,'tile_end',map.stageId);
  const route=map.bossPatrolRoute;assert.ok(route.length>=8,map.stageId);
  assert.deepEqual([route[0].x,route[0].y],[route.at(-1).x,route.at(-1).y],map.stageId);
  for(const p of route)assert.ok(map.grid[p.y]?.[p.x]&&map.grid[p.y][p.x].passableMask!=='NONE'&&map.grid[p.y][p.x].passableMask!=='FLY_ONLY',map.stageId+' patrol '+p.x+','+p.y);
 }
});

test('final battle has one looping boss and 30 tag-pool reinforcements scheduled every three seconds',()=>{
 const g=game(),b=g.battle,boss=b.s.enemies.find(e=>e.finalBoss);
 assert.equal(boss.id,'enemy_2016_csphtm');assert.equal(boss.hp,390000);
 assert.equal(b.s.limit,100+g.s.hp);assert.equal(b.s.total,31);assert.equal(b.s.queue.length,30);
 assert.deepEqual(b.s.queue.map(q=>q.at),Array.from({length:30},(_,i)=>(i+1)*3));
 assert.ok(b.s.queue.every(q=>(q.route===0||q.route===1)&&NATIVE_DATA.enemies[q.id]));
 const tagPools=g.s.waveRoster.types.map(type=>new Set(NATIVE_DATA.season.enemyInfoDict[type]||[]));assert.ok(b.s.queue.every(q=>tagPools.some(pool=>pool.has(q.id))));
 assert.ok(boss.route.length>=8);assert.equal(boss.route[0].x,boss.route.at(-1).x);assert.equal(boss.route[0].y,boss.route.at(-1).y);
});

test('Lucian skills get the final attack-cooldown frame and the blocked blink spawns its phantom',()=>{
 const setup=()=>{
  const g=game({operator:true}),b=g.battle,boss=b.s.enemies.find(e=>e.finalBoss),blocker=b.s.units[0],point=boss.route[2];
  blocker.x=point.x;blocker.y=point.y;boss.x=point.x;boss.y=point.y;boss.cmd=3;boss.block=blocker.uid;boss.action=null;boss.attackCooldown=1;
  boss.enemySkills.find(s=>s.prefab==='aoe').nextAt=1000;boss.enemySkills.find(s=>s.prefab==='blink').nextAt=0;
  return {b,boss,blocker};
 };
 let {b,boss,blocker}=setup();b.step();assert.ok(boss.crownBlink);assert.equal(boss.block,null);
 for(let i=0;i<20;i++)b.step();assert.equal(b.s.enemies.filter(e=>e.id==='enemy_2017_csphts').length,1);
 const phantom=b.s.enemies.find(e=>e.id==='enemy_2017_csphts');assert.equal(phantom.x,8);assert.equal(phantom.y,0);assert.ok(blocker.hp>0);
 ({b,boss}=setup());boss.enemySkills.find(s=>s.prefab==='aoe').nextAt=0;boss.enemySkills.find(s=>s.prefab==='blink').nextAt=1000;b.step();assert.equal(boss.enemyCast?.phantomAoe,true);
});

test('timeout fails the run; the saved remaining time reaches zero on the last frame',()=>{
 const g=game(),b=g.battle;b.s.frame=Math.ceil(b.s.limit*30)-1;b.s.time=b.s.frame/30;g.tick();
 assert.equal(g.s.phase,'finished');assert.equal(g.s.hp,0);assert.equal(g.s.runResult.kind,'final-boss');assert.equal(g.s.runResult.reason,'timeout');assert.equal(g.s.runResult.success,false);
});

test('a red-door escape costs one second; killing the boss ends immediately and preserves per-operator DPS samples',()=>{
 let g=game({operator:true}),b=g.battle,boss=b.s.enemies.find(e=>e.finalBoss),q=b.s.queue.shift();b.spawn(q);const add=b.s.enemies.at(-1),blue=g.map.grid.flatMap((row,y)=>row.map((tile,x)=>tile.tileKey==='tile_end'?{x,y}:null).filter(Boolean))[0];
 add.x=blue.x;add.y=blue.y;add.route=[{kind:'move',x:add.x,y:add.y},{kind:'move',x:add.x,y:add.y}];add.cmd=1;
 const before=b.s.limit;b.step();assert.equal(b.s.timePenalty,1);assert.equal(b.s.limit,before-1);
 const actor=b.s.units[0];dealDamage(b,{source:actor,target:boss,amount:100,type:'true'});assert.equal(b.s.damageTimeline[actor.uid][0],100);
 g=NativeSession.restore(NATIVE_DATA,g.snapshot());assert.ok(g);b=g.battle;boss=b.s.enemies.find(e=>e.finalBoss);assert.equal(g.s.finalBossId,'boss_5');assert.equal(b.s.damageTimeline[b.s.units[0].uid][0],100);
 const restoredActor=b.s.units[0];
 dealDamage(b,{source:restoredActor,target:boss,amount:boss.hp+1000,type:'true'});g.tick();
 assert.equal(g.s.phase,'finished');assert.equal(g.s.hp>0,true);assert.equal(g.s.runResult.kind,'final-boss');assert.equal(g.s.runResult.reason,'boss-killed');assert.equal(g.s.runResult.success,true);
 assert.ok(g.s.runResult.units.find(u=>u.uid===restoredActor.uid).dpsSamples[0]>0);
 assert.ok(!g.s.history.some(r=>r.kind==='training-dummy'));
});
