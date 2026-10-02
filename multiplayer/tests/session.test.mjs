import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {MultiplayerSession} from '../client/session.js';
import {RoomManager} from '../server/rooms.js';
import {dealDamage, commitExit} from '../../dist/native-effects.js';
import {buildPhasePlan} from '../../dist/protocol.js';
const manager = new RoomManager(data, 'test');
function game(id = 'A', bandId = 'band_bldsk', count = 4) {
  const config = manager.makeConfig({}, count); config.bondBan.bonds = [];
  return new MultiplayerSession(data, config, {id, seat:1, bandId});
}
function start(g, kind = 'main') {assert.equal(g.prepareOnlineReady(),true);assert.equal(g.startOnlineBattle({id:'task1',kind,bossMaxHp:g.online.config.bossMaxHp}),true);}
function run(g) {for(let i=0;i<20000&&!g.battle.s.finished;i++)g.tick();assert.equal(g.battle.s.finished,true);return g.online.report;}

test('低生命玩家不会在可以被联防救回之前被单机提前结束/扣血', () => {
  const g=game();g.s.hp=1;start(g);
  const expected=g.battle.s.queue.length,report=run(g);
  assert.equal(report.remaining.length,expected);assert.equal(g.s.hp,1);assert.ok(g.battle.s.time>20);
  assert.equal(report.perfect,false);
});
test('串行联防刷新敵方完整状态，保留干员HP/SP/召唤物和原时间', () => {
  const g=game('C');const unit=g.gain('chess_char_1_01_a');g.s.units.find(u=>u.uid===unit.uid).position={x:1,y:1};start(g);
  const b=g.battle;b.s.queue=[];b.s.enemies=[];b.finish('complete');
  const u=b.s.units[0];u.hp=123;u.sp=7;u.down=11;b.s.cost=17;
  const currentTime=b.s.time;
  const id='enemy_1007_slime',raw=data.enemies[id];
  const row={id,key:'original-A1',sourcePlayerId:'A',rootKey:null,leak:Number(raw.lifePointReduce??1),bountyReward:3,derived:false,scale:{atk:1,hp:1,moveSpeed:1}};
  g.startSupport({id:'support1',input:[row]});
  assert.equal(b.s.units[0],u);assert.equal(u.hp,123);assert.equal(u.sp,7);assert.equal(u.down,11);assert.equal(b.s.cost,17);assert.equal(b.s.time,currentTime);
  b.spawn(b.s.queue.shift());const e=b.s.enemies[0];
  assert.equal(e.hp,raw.attributes.maxHp);assert.equal(e.onlineEnemy.sourcePlayerId,'A');
  commitExit(b,{target:e,reason:'leak'});b.s.enemies=[];run(g);
  assert.equal(g.online.report.remaining[0].sourcePlayerId,'A');assert.equal(g.online.report.remaining[0].key,'original-A1');
  assert.equal(g.online.report.remaining[0].bountyReward,3);
});
test('联防击倒奖金从原事件路由撤回，由房间统一发放；联防冻结盟约', () => {
  const g=game('C');start(g);g.battle.s.queue=[];g.battle.finish('complete');
  const raw=data.enemies.enemy_1007_slime;
  g.startSupport({id:'support',input:[{key:'A1',sourcePlayerId:'A',id:'enemy_1007_slime',rootKey:null,
    leak:raw.lifePointReduce??1,bountyReward:3,scale:{atk:1,hp:1,moveSpeed:1}}]});
  const before=g.s.nextRoundBonus;
  const original=g.battle.step.bind(g.battle);
  g.battle.step=()=>{
    if(!g.battle.s.enemies.length){g.battle.spawn(g.battle.s.queue.shift());dealDamage(g.battle,{target:g.battle.s.enemies[0],amount:999999,type:'true'});}
    original();
  };
  g.tick();assert.equal(g.s.nextRoundBonus,before);
  assert.equal(Object.values(g.online.killedBounties)[0].sourcePlayerId,'A');
  const layers={...g.s.bondLayers};g.addLayers('yanShip',100,false);assert.deepEqual(g.s.bondLayers,layers);
});
test('超时活怪及未出场怪都进入交接账本', () => {
  const g=game();start(g);const original=g.battle.s.queue.length;
  g.battle.s.limit=.01;g.tick();assert.equal(g.online.report.remaining.length,original);assert.equal(g.online.report.perfect,false);
});
test('Boss 只累计实际HP损失，广播校准不再次计伤，不能本地提前判胜', () => {
  const g=game('A','band_bldsk',2);g.s.round=buildPhasePlan(data,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1).round;
  start(g,'boss');const e=g.battle.s.enemies.find(e=>e.finalBoss),max=e.maxHp;
  e.hp-=100;assert.equal(g.online.damage,100);
  g.updateBoss({maxHp:max,hp:max-300,contributions:{A:{damage:100,healing:0}}});
  assert.equal(e.hp,max-300);assert.equal(g.online.damage,100);
  e.hp=0;assert.ok(e.hp>0);assert.equal(g.battle.s.finished,false);
  const saved=JSON.parse(JSON.stringify(g.checkpoint()));const restored=MultiplayerSession.restoreOnline(data,saved);
  assert.ok(restored);assert.equal(restored.online.damage,g.online.damage);
});
test('六候选决策与联防恢复点独立于单机三候选存档限制', () => {
  const g=game();g.s.phase='decision';g.s.roundDecisions=Array.from({length:6},(_,i)=>({id:String(i)}));
  const saved=JSON.parse(JSON.stringify(g.checkpoint()));const restored=MultiplayerSession.restoreOnline(data,saved);
  assert.ok(restored);assert.equal(restored.s.roundDecisions.length,6);assert.equal(restored.s.phase,'decision');
});

test('Boss战斗刷新恢复后仍使用联机总HP，不能误按单机基准截断', () => {
  const g=game('A','band_bldsk',4);g.s.round=buildPhasePlan(data,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1).round;
  start(g,'boss');const max=g.online.config.bossMaxHp;
  const restored=MultiplayerSession.restoreOnline(data,JSON.parse(JSON.stringify(g.checkpoint())));
  assert.ok(restored);restored.updateBoss({maxHp:max,hp:max-400,contributions:{A:{damage:0,healing:0}}});
  const e=restored.battle.s.enemies.find(e=>e.finalBoss);assert.equal(e.hp,max-400);
  e.hp-=100;assert.equal(e.hp,max-500);assert.equal(restored.online.damage,100);
});
test('联防产生的衍生敌人经过路径复制/替换仍继承原漏怪者', () => {
  const g=game('C');start(g);g.battle.s.queue=[];g.battle.finish('complete');
  g.startSupport({id:'support',input:[{id:'enemy_1007_slime',key:'B1',rootKey:null,sourcePlayerId:'B',leak:1,bountyReward:null,scale:{atk:1,hp:1,moveSpeed:1}}]});
  const b=g.battle;b.spawn(b.s.queue.shift());const parent=b.s.enemies[0];
  parent.route=[...parent.route];
  b.queueEnemySpawn({id:'enemy_1007_slime',derived:true},{x:parent.x,y:parent.y,route:structuredClone(parent.route),cmd:0});
  b.flushEnemySpawns();const child=b.s.enemies.at(-1);
  assert.equal(child.onlineEnemy.sourcePlayerId,'B');assert.equal(child.onlineEnemy.rootKey,'B1');
  commitExit(b,{target:child,reason:'leak'});assert.equal(Object.values(g.online.remaining)[0].sourcePlayerId,'B');
});
test('联防结束后的下一轮道中耗时重新从零计，不携带上一场support起点', () => {
  const g=game();g.online.supportStartTime=80;start(g);assert.equal(g.online.supportStartTime,0);run(g);assert.ok(g.online.report.elapsed>=0);
});

test('恢复点落后于服务器已确认Boss累计量时向前补齐，重发不倒退', () => {
  const g=game('A');g.s.round=buildPhasePlan(data,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1).round;
  start(g,'boss');const max=g.online.config.bossMaxHp;
  g.online.damage=100;
  g.updateBoss({maxHp:max,hp:max-300,contributions:{A:{damage:300,healing:0}}});
  assert.equal(g.online.damage,300);assert.equal(g.battle.s.enemies.find(e=>e.finalBoss).hp,max-300);
});
