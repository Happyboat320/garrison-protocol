import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';
import {blackboard} from '../dist/protocol.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {attackModifier} from '../dist/native-operator-effects.js';
import {damage} from '../dist/combat.js';
import {dispatch} from '../dist/native-effects.js';

// 埃癸斯 char_4218_aigis（联动隐藏档 chess_collab_aigis）的逐条回归。
// 期望值全部由运行时烘出来的黑板算（不抄常量）：天赋 damage_scale／damage_resistance、技能 times／atk_scale／kick_atk_scale。
// 每条用例都在「把 dist/native-collab-aigis.js 改回空实现」之后单独跑过，结果记在用例名后的括号里；
// 标「通用层已覆盖」的用例在空实现下也通过——它们守的是**重复实现／重复乘算**，不是本次新增的行为。
const CHESS='chess_collab_aigis',CHAR='char_4218_aigis';
const profile=NATIVE_DATA.profiles[CHESS];
const boardOf=list=>blackboard(list||[]);
const talentBB=boardOf((profile.activeTalents||[]).find(t=>Object.prototype.hasOwnProperty.call(boardOf(t.blackboard),'damage_scale'))?.blackboard);
const skillBB=index=>boardOf(profile.skillChoices[index]?.skill?.blackboard);
const fight=skillIndex=>{const {b}=openBattle({chessId:CHESS,skillIndex});deployNow(b);return {b,u:byId(b,CHAR)};};
// 通用随机索敌（cfg.targetRule==='random'）的定序键：用来断言「被阻挡的敌人优先」不是靠它撞上的。
const HASH=uid=>(Math.abs(uid)*1103515245)%2147483647;
const near=(actual,expected,message='')=>assert.ok(Math.abs(actual-expected)<=1e-6,`${actual} 应等于 ${expected}${message?'（'+message+'）':''}`);
const stunOf=u=>(u.statuses||[]).find(s=>s.kind==='stun')||null;

test('数据门禁：天赋与两个技能的黑板字段都在（下面所有期望值都由它们算）',()=>{
 assert.equal(profile.charId,CHAR);
 assert.equal(profile.branch,'skybreaker');
 assert.equal(typeof talentBB.damage_scale,'number','天赋「反暗影特殊压制兵装」要有 damage_scale');
 assert.equal(typeof talentBB.damage_resistance,'number','天赋要有 damage_resistance');
 for(const [index,keys] of [[0,['atk','def','stun']],[1,['times','atk_scale','kick_atk_scale']]])
  for(const key of keys)assert.equal(typeof skillBB(index)[key],'number',`技能${index+1} 黑板缺 ${key}`);
 assert.notEqual(talentBB.damage_scale,1,'不然下面的倍率断言没意义');
});

test('天赋造成侧：物理伤害 ×damage_scale；伤害类型不是物理时不加成（空实现下失败）',()=>{
 const {b,u}=fight(0);
 const target=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0,flying:true});
 const before=target.hp;b.hit(u,target,1000,'physical');
 near(before-target.hp,1000*talentBB.damage_scale);
 // 钩子签名（hooks.attackModifier(battle,unit,target,value)）不带伤害类型，实现按 battle.baseDamageType 判闸门。
 const keep=b.baseDamageType;
 b.baseDamageType=()=>'arts';
 assert.equal(attackModifier(b,u,target,1000),1000,'伤害类型不是物理时不该乘 damage_scale');
 const artsBefore=target.hp;b.hit(u,target,1000,'physical');
 near(artsBefore-target.hp,1000,'闸门为 arts 时整条 hit 通道也不加成');
 b.baseDamageType=keep;
 assert.equal(attackModifier(b,u,target,1000),1000*talentBB.damage_scale);
});

test('天赋受到侧：物理伤害按 1-damage_resistance 结算，真实伤害不受影响（通用层已覆盖）',()=>{
 const {b,u}=fight(0);
 u.hp=u.maxHp=1e6;
 const foe=enemy(b,{atk:1000,damageType:'physical'});
 const expected=damage({amount:1000,type:'physical',defense:b.stats(u).def})*(1-talentBB.damage_resistance);
 let before=u.hp;b.hurt(u,foe);
 near(before-u.hp,expected);
 before=u.hp;b.hurt(u,{...foe,damageType:'true'});
 near(before-u.hp,1000,'真实伤害不吃物理减伤');
});

test('S1 攻/防由通用技能黑板分支结算，本文件不得再乘一次；结束自晕同样由通用层负责（通用层已覆盖）',()=>{
 const {b,u}=fight(0);
 const base=b.stats(u),bb=skillBB(0);
 near(b.stats(u).atk,base.atk);
 u.sp=b.spCost(u);b.activate(u);
 assert.ok(u.skillLeft>0,'S1 应当是持续技');
 near(b.stats(u).atk,base.atk*(1+bb.atk));
 near(b.stats(u).def,base.def*(1+bb.def));
 assert.ok(b.stats(u).atk<base.atk*(1+2*bb.atk),'攻/防只能在通用层乘一次（钩子里重复加会变成 1+2×黑板）');
 u.skillLeft=0;dispatch(b,'skill-end',{target:u});
 const stun=stunOf(u);
 assert.ok(stun,'技能结束要自身晕眩');
 near(stun.remaining,bb.stun);
 near(b.stats(u).atk,base.atk,'技能结束后加成要撤掉');
});

test('S1 索敌：未阻挡时在攻击范围内随机（每帧重选），技能结束时撤锁（空实现下失败）',()=>{
 const {b,u}=fight(0);
 const crowd=[enemy(b,{x:u.x+1,y:u.y,hp:1e6,def:0}),enemy(b,{x:u.x+2,y:u.y-1,hp:1e6,def:0}),enemy(b,{x:u.x+2,y:u.y+1,hp:1e6,def:0})];
 u.sp=b.spCost(u);b.activate(u);
 assert.equal(b.targets(u).length,crowd.length,'三个目标都应在攻击范围内');
 const samples=new Set();
 for(let i=0;i<150;i++){
  b.step();
  if(u.floatTarget!=null)samples.add(u.floatTarget);
  if(samples.size>1&&b.targets(u).length===1)assert.ok(crowd.some(e=>e.uid===b.targets(u)[0].uid),'锁定的目标必须仍是范围内的敌人');
 }
 assert.ok(samples.size>1,`锁定目标应当在候选之间变化（实际 ${[...samples]}）`);
 for(const uid of samples)assert.ok(crowd.some(e=>e.uid===uid),'锁定的目标必须在候选集合里');
 assert.equal(b.targets(u).length,1,'锁生效时索敌结果收窄成一个目标');
 dispatch(b,'skill-end',{target:u});
 assert.equal(u.floatTarget,null,'技能结束要撤锁，否则锁会留到技能外');
 assert.ok(!u.aigisTargetLock);
});

test('S1 索敌：阻挡时优先自身阻挡的敌人，而不是通用「随机」定序（空实现下失败）',()=>{
 const {b,u}=fight(0);
 const other=enemy(b,{x:u.x+2,y:u.y,hp:1e6,def:0});
 const blocker=enemy(b,{x:u.x,y:u.y,hp:1e6,def:0,speed:0});
 // 让「被阻挡的敌人」拿到更大的定序键：不实现时 targets()[0] 一定是另一个。
 if(HASH(blocker.uid)<HASH(other.uid)){const swap=other.uid;other.uid=blocker.uid;blocker.uid=swap;}
 other.x=u.x+2;other.y=u.y;blocker.x=u.x;blocker.y=u.y;
 b.step();
 assert.equal(blocker.block,u.uid,'同格的地面敌人应当被埃癸斯阻挡');
 u.sp=b.spCost(u);b.activate(u);
 // 先撤锁，只看通用「随机」定序本身会不会先选被阻挡的敌人（前提断言）。
 u.floatTarget=null;u.aigisTargetLock=false;
 const generic=b.targets(u).map(e=>e.uid);
 assert.equal(generic.length,2,'技能期间两个候选都应当进索敌');
 assert.equal(generic[0],other.uid,'前提：通用随机定序先选的是没被阻挡的那个');
 b.step();
 assert.equal(u.floatTarget,blocker.uid);
 assert.equal(b.targets(u)[0].uid,blocker.uid);
 for(let i=0;i<120;i++){b.step();if(blocker.block===u.uid)assert.equal(u.floatTarget,blocker.uid,'只要还在阻挡就一直优先它');}
});

test('S2：times 枚导弹（atk_scale 攻击力、半径 1.1）随后一次飞踢（kick_atk_scale、半径 2.0、延后 0.12 秒）（空实现下失败）',()=>{
 const {b,u}=fight(1);
 const scale=talentBB.damage_scale,bb=skillBB(1);
 const target=enemy(b,{x:u.x+3,y:u.y,hp:1e7,def:0,flying:true});
 const splash=enemy(b,{x:u.x+3,y:u.y+1,hp:1e7,def:0});      // 距目标 1 格：导弹(1.1)与飞踢(2.0)都该溅到，但不在埃癸斯攻击范围内
 const far=enemy(b,{x:u.x+6,y:u.y,hp:1e7,def:0});           // 半径外
 const atk=b.stats(u).atk;
 assert.equal(b.targets(u).length,1,'只有目标在攻击范围内，锁定它是确定的');
 u.sp=b.spCost(u);b.activate(u);
 const missiles=atk*scale*bb.times*bb.atk_scale;
 near(target.maxHp-target.hp,missiles);
 near(splash.maxHp-splash.hp,missiles);
 assert.equal(far.hp,far.maxHp);
 assert.equal(b.s.logicLog.filter(row=>row.type==='damage'&&row.sourceUid===u.uid&&row.targetUid===target.uid).length,bb.times,'每个目标要挨 times 次导弹伤害');
 assert.ok(b.s.logicEffects.some(fx=>String(fx.talentOrSkillId||'').includes('aigis-s2-kick')),'飞踢要先排进延迟结算队列');
 for(let i=0;i<6;i++)b.step();
 const total=atk*scale*(bb.times*bb.atk_scale+bb.kick_atk_scale);
 near(target.maxHp-target.hp,total);
 near(splash.maxHp-splash.hp,total);
 assert.equal(far.hp,far.maxHp,'半径外的敌人不该受伤');
 assert.equal(b.s.logicEffects.some(fx=>String(fx.talentOrSkillId||'').includes('aigis-s2-kick')),false,'延迟的飞踢应当已经结算');
});

test('S2：地面目标也能锁定（瞬时技没有生效期，裂空炮手 idle 时地面目标进不了常态索敌）（空实现下失败）',()=>{
 const {b,u}=fight(1);
 const scale=talentBB.damage_scale,bb=skillBB(1);
 const target=enemy(b,{x:u.x+2,y:u.y,hp:1e7,def:0});
 assert.equal(b.targets(u).length,0,'前提：非技能期只打空中与自身阻挡，地面目标不在常态索敌里');
 const atk=b.stats(u).atk;
 u.sp=b.spCost(u);b.activate(u);
 near(target.maxHp-target.hp,atk*scale*bb.times*bb.atk_scale);
 for(let i=0;i<6;i++)b.step();
 near(target.maxHp-target.hp,atk*scale*(bb.times*bb.atk_scale+bb.kick_atk_scale));
});

// ── S1 技能期间的溅射半径（2026-09-27 补的引擎通道）─────────────────────────────
// PRTS 技能备注（本地快照 data/prts/snapshots/2026-09-12-prts/operators.json）写：
//   ※技能期间，攻击弹道的伤害半径变为2.0。
// 分支「裂空炮手」只登记了 `splashDuringSkill:1.1`，以前没有技能级覆盖入口，所以 S1 一直吃 1.1。
// 现在通道在 native-branches 的 SKILL_SPLASH／branchBehavior（与 SKILL_ANTIAIR 同一套写法）。
test('S1：技能期间伤害半径按 PRTS 备注变成 2.0（不是分支的 1.1）（空实现下失败）',()=>{
 const {b,u}=fight(0);
 assert.equal(b.behavior(u).radius,undefined,'非技能期取分支 radius（裂空炮手没登记，即 undefined）');
 u.sp=b.spCost(u);b.activate(u);
 assert.equal(b.skillActive(u),true,'S1 有 20 秒生效期');
 assert.equal(b.behavior(u).style,'splash','技能期间是范围攻击');
 assert.equal(b.behavior(u).radius,2,'PRTS：技能期间伤害半径 2.0');
 // 覆盖只认这一名干员的这一档技能：换到 S2（瞬时技）不生效。
 const other=fight(1);
 other.u.sp=other.b.spCost(other.u);other.b.activate(other.u);
 assert.notEqual(other.b.behavior(other.u).radius,2,'S2 不在溅射覆盖表里');
});

test('技能级溅射半径覆盖有 PRTS 备注逐条支撑（登记表门禁）',()=>{
 const snap=JSON.parse(fs.readFileSync('data/prts/snapshots/2026-09-12-prts/operators.json','utf8'));
 const list=Array.isArray(snap)?snap:(snap.operators||Object.values(snap));
 const op=list.find(o=>o.id===`prts:operator:${CHAR}`||o.gameId===CHAR||o.name==='埃癸斯');
 assert.ok(op,'PRTS 快照里要有埃癸斯');
 const note=String(op.skills[0].sourceTemplate?.fields?.备注||'');
 assert.match(note,/伤害半径变为2\.0/,'S1 备注必须写「伤害半径变为2.0」，否则不该进 SKILL_SPLASH');
});
