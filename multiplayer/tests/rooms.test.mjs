import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {RoomManager} from '../server/rooms.js';
import {PROTOCOL_VERSION, decisionOffers} from '../shared/rules.js';
import {RECONNECT_WINDOW_MS} from '../shared/protocol.js';
import {finalBossConfig} from '../../dist/native-final-boss.js';

function socket() {return {messages:[],send(text){this.messages.push(JSON.parse(text));},close(){}};}
async function setup(count=4, confirm=true) {
  let now=100000;
  const manager=new RoomManager(data,'test-hash',{now:()=>now});
  const sockets=Array.from({length:count},socket);
  const hello={type:'hello',protocol:PROTOCOL_VERSION,rulesHash:'test-hash',profile:{name:'玩家',avatar:'🫡'}};
  await manager.handle(sockets[0],{...hello,create:true});
  const room=[...manager.rooms.values()][0];
  for(let i=1;i<count;i++)await manager.handle(sockets[i],{...hello,roomId:room.id});
  await manager.handle(sockets[0],{type:'start',config:{modeId:'mode_single_normal'}});
  if(!confirm)return {manager,room,sockets,setTime:value=>now=value};
  assert.equal(room.phase,'briefing');
  await assert.rejects(manager.handle(sockets[0],{type:'strategy',bandId:'band_bldsk'}));
  for(let i=0;i<count;i++){await manager.handle(sockets[i],{type:'briefing-ready'});assert.equal(room.phase,i===count-1?'strategy':'briefing');}
  const bands=['band_bldsk','band_kalts','band_chen','band_excu'];
  const actual=Object.keys(data.season.bandDataListDict).filter(id=>id!=='band_sees');
  for(let i=0;i<count;i++)await manager.handle(sockets[i],{type:'strategy',bandId:actual[i]});
  return {manager,room,sockets,setTime:value=>now=value};
}
function enemy(room, source, key, bounty=3) {
  return {id:'enemy_1007_slime',key,sourcePlayerId:room.players[source].id,rootKey:null,
    leak:Number(data.enemies.enemy_1007_slime.lifePointReduce??1),bountyReward:bounty,derived:false,scale:{atk:1,hp:1,moveSpeed:1}};
}
async function begin(fixture){for(const s of fixture.sockets)await fixture.manager.handle(s,{type:'ready',ready:true});}
async function report(fixture,seat,remaining=[],elapsed=30,killedBounties=[]){
  await fixture.manager.handle(fixture.sockets[seat],{type:'result',taskId:fixture.room.task.id,remaining,elapsed,killedBounties,perfect:!remaining.length});
}

test('2/3/4人房间共用配置，按开局人数固定3/5/7倍默认Boss血量',async()=>{
  for(const count of [2,3,4]) {
    const f=await setup(count);assert.equal(f.room.phase,'prep');
    assert.equal(new Set(f.room.players.map(p=>p.bandId)).size,count);
    assert.equal(f.room.config.bossMaxHp,finalBossConfig(data,f.room.config.bossId,f.room.config.modeId,.75).hp*({2:3,3:5,4:7})[count]);
  }
});
test('策略和公共六选由服务端按顺序占用，拒绝抢选/重复',async()=>{
  const f=await setup(3),{manager,room,sockets}=f;
  room.phase='decision';room.choice={offers:decisionOffers(data,'tactical',3,()=>.4),order:room.players.map(p=>p.id),type:'tactical'};room.picked={};
  await assert.rejects(manager.handle(sockets[1],{type:'choice',id:room.choice.offers[0].id}));
  await manager.handle(sockets[0],{type:'choice',id:room.choice.offers[0].id});
  await assert.rejects(manager.handle(sockets[1],{type:'choice',id:room.choice.offers[0].id}));
  await manager.handle(sockets[1],{type:'choice',id:room.choice.offers[1].id});
  await manager.handle(sockets[2],{type:'choice',id:room.choice.offers[2].id});
  assert.equal(room.phase,'prep');assert.equal(Object.keys(room.picked).length,3);
});
test('两名最快完美玩家串行联防，最终按原来源扣血，奖金归实际击倒者',async()=>{
  const f=await setup(),{room,manager,sockets}=f;await begin(f);
  const a1=enemy(room,0,'A1'),a2=enemy(room,0,'A2'),b1=enemy(room,1,'B1');
  await report(f,0,[a1,a2],40);await report(f,1,[b1],38);await report(f,2,[],20);await report(f,3,[],25);
  assert.equal(room.phase,'support');assert.equal(room.task.playerId,room.players[2].id);
  const hp=room.players.map(p=>p.hp);assert.deepEqual(room.players.map(p=>p.hp),hp);
  const firstTask=room.task.id;
  await report(f,2,[a2],10,[a1,b1]);
  assert.equal(room.task.playerId,room.players[3].id);assert.deepEqual(room.task.input,[a2]);
  await assert.rejects(manager.handle(sockets[3],{type:'result',taskId:room.task.id,elapsed:5,remaining:[{...a2,sourcePlayerId:room.players[2].id}]}));
  await report(f,3,[a2],10);
  assert.equal(room.phase,'settlement');assert.equal(room.players[0].hp,hp[0]-a2.leak);assert.equal(room.players[1].hp,hp[1]);
  assert.equal(room.rewards[room.players[2].id],6);assert.equal(room.rewards[room.players[3].id],0);
  // 重发第一段报告不会再领奖金或重新启动联防。
  await manager.handle(sockets[2],{type:'result',taskId:firstTask,remaining:[a2],elapsed:10,killedBounties:[a1,b1]});
  assert.equal(room.rewards[room.players[2].id],6);assert.equal(room.phase,'settlement');
});
test('两人均漏没有联防，各自扣血；一人完美才接队友漏怪',async()=>{
  const first=await setup(2);await begin(first);
  await report(first,0,[enemy(first.room,0,'A')]);await report(first,1,[enemy(first.room,1,'B')]);assert.equal(first.room.phase,'settlement');
  const second=await setup(2);await begin(second);
  await report(second,0,[enemy(second.room,0,'A')]);await report(second,1,[],20);
  assert.equal(second.room.phase,'support');assert.equal(second.room.task.playerId,second.room.players[1].id);
  await report(second,1,[],4,[enemy(second.room,0,'A')]);assert.equal(second.room.phase,'settlement');
  assert.equal(second.room.losses[second.room.players[0].id],0);
});
test('共同Boss累计报告重发不重复扣血，回血与击破统一广播',async()=>{
  const f=await setup(2);f.room.round=14; // 险境最终轮由实际计划取得
  const {roundPlan}=await import('../shared/rules.js');f.room.round=roundPlan(data,f.room.config.modeId).at(-1).round;
  await begin(f);assert.equal(f.room.phase,'boss');const max=f.room.boss.maxHp;
  const message={type:'boss-progress',taskId:f.room.task.id,damage:100,healing:0};
  await f.manager.handle(f.sockets[0],message);await f.manager.handle(f.sockets[0],message);assert.equal(f.room.boss.hp,max-100);
  await f.manager.handle(f.sockets[1],{...message,damage:50,healing:20});assert.equal(f.room.boss.hp,max-130);
  await f.manager.handle(f.sockets[0],{...message,damage:max});assert.equal(f.room.phase,'finished');assert.equal(f.room.success,true);
});
test('重连仅凭本人token恢复，规则不一致拒绝进入',async()=>{
  const f=await setup(2),p=f.room.players[0];f.manager.disconnect(f.sockets[0]);
  const reconnected=socket();await f.manager.handle(reconnected,{type:'hello',protocol:PROTOCOL_VERSION,rulesHash:'test-hash',roomId:f.room.id,resumeToken:p.resumeToken});
  assert.equal(reconnected.playerId,p.id);assert.equal(f.room.players.length,2);
  await assert.rejects(f.manager.handle(socket(),{type:'hello',protocol:PROTOCOL_VERSION,rulesHash:'wrong',roomId:f.room.id}));
  await assert.rejects(f.manager.handle(socket(),{type:'hello',protocol:PROTOCOL_VERSION,rulesHash:'test-hash',roomId:f.room.id,resumeToken:'wrong'}));
});
test('联防者断线超时后，原漏怪继续交给下一名；没有后续则按原来源结算',async()=>{
  const f=await setup();await begin(f);await report(f,0,[enemy(f.room,0,'A')]);await report(f,1,[enemy(f.room,1,'B')]);
  await report(f,2,[],15);await report(f,3,[],20);
  f.manager.disconnect(f.sockets[2]);f.setTime(100000+RECONNECT_WINDOW_MS+1);f.manager.sweep();
  assert.equal(f.room.players[2].eliminated,true);assert.equal(f.room.task.playerId,f.room.players[3].id);
  await report(f,3,[]);assert.equal(f.room.phase,'settlement');assert.equal(f.room.losses[f.room.players[0].id],0);
});


test('禁用预览冻结配置，确认重发与短期重连不会重抽禁用或卡住流程',async()=>{
  const f=await setup(2,false),{manager,room,sockets}=f;
  const frozen=JSON.stringify(room.config.bondBan);
  await manager.handle(sockets[0],{type:'briefing-ready'});
  await manager.handle(sockets[0],{type:'briefing-ready'});
  assert.equal(room.phase,'briefing');
  assert.equal(manager.publicRoom(room).players[0].briefingSeen,true);
  manager.disconnect(sockets[0]);
  await manager.handle(sockets[1],{type:'briefing-ready'});
  assert.equal(room.phase,'strategy');
  const returning=socket();
  await manager.handle(returning,{type:'hello',protocol:PROTOCOL_VERSION,rulesHash:'test-hash',roomId:room.id,resumeToken:room.players[0].resumeToken});
  assert.equal(manager.publicRoom(room).players[0].briefingSeen,true);
  assert.equal(JSON.stringify(room.config.bondBan),frozen);
});

test('玩家在禁用预览主动退出时结束房间，避免永久等待确认',async()=>{
  const f=await setup(2,false);
  await f.manager.handle(f.sockets[0],{type:'leave'});
  assert.equal(f.room.phase,'finished');
});
