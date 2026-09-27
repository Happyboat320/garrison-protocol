// 结城理 char_4217_makoto（chess_collab_makoto）天赋与三个人格面具技能的定向回归。
//
// 口径：data/modes/alliance-lower/collab-operators.json ＋ PRTS（人格面具的攻击档案挂在三个技能的 `attack@*` 黑板上）。
// 天赋一「不羁之力」：切换为替身状态时停顿范围内敌人 `sluggish` 秒；替身状态下攻击力 +`atk`、生命值 +`max_hp_t1`、
//   攻击间隔 +`base_attack_time`（加算秒数）。
// 天赋二「S.E.E.S. 队长」：替身状态结束后，对每名 S.E.E.S. 队员（`teamId==='sees'`）周围 `range_id` 范围内的
//   所有敌人造成结城理攻击力 × `atk_scale` 的真实伤害（可叠加）。
// S1 俄耳甫斯／S2 塔纳托斯／S3 塔纳托斯·改：`attack@atk_scale`、`attack@heal_scale`、`attack@max_target`、
//   `attack@prob`、`attack@fear`、`attack@kill_atk_scale`、`attack@kill_damage`、`talent@attack_speed`、
//   `attack@interval`、`attack@max_target_heal`。
//
// 命中的都是真实入口：battle.activate → dispatch('skill-start') → collabSkillStart；
// battle.hit → attackModifier → collabAttackModifier；battle.step → tickLogic → collabTick。
// 每个数值都用 `patchProfile` 换掉 profile 上的黑板后复测，证明不是写死的常量。
//
// S3「开辟明日的剑刃」的两段替身（用户 2026-09-27 口径，PRTS 技能备注 revision 425074）：
//   替身窗口内先戴塔纳托斯·改（`unit.persona==='thanatos'`），**再次点按技能键**或**受到致命伤**时切换成
//   俄耳甫斯·改（`'orpheus'`），替身结束清空。俄耳甫斯·改：不普攻、阻挡数回到 2（同一黑板 `attack@block_cnt`）、
//   切换瞬间及之后每 1 秒给范围内未满血友方挂一批**延迟 0.5 秒**的治疗（剂量＝当前攻击力 × `attack@heal_scale`，
//   走治疗管线、受禁疗制约）。视觉按 `actor.persona` 取配色（native-fx 的 DOLL_PERSONA_STYLE）。
//
// 把 dist/native-collab-makoto.js 改回空实现（五个钩子都空）时，除「接线门禁」外**每一条用例都会失败**。

import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,byId,enemy,steps,logOf} from './effects-harness.mjs';
import {COLLAB_HOOKS,collabFor} from '../dist/native-collab.js';
import {attackModifier as operatorAttackModifier} from '../dist/native-operator-effects.js';
import {skillAntiAir} from '../dist/native-branches.js';
import {drawDollOverlay,DOLL_PERSONA_STYLE} from '../dist/native-fx.js';

const CHESS='chess_collab_makoto',CHAR='char_4217_makoto';
const ALLY_CHESS='chess_char_1_02_b',ALLY_CHAR='char_199_yak';
const ALLY2_CHESS='chess_char_1_20_b',ALLY2_CHAR='char_107_liskam';
const YUKARI_CHESS='chess_collab_yukari',YUKARI_CHAR='char_4219_yukari';
const FRONT=[[1,0],[0,1],[-1,0],[0,-1]];

function near(actual,expected,message){
 assert.ok(Math.abs(actual-expected)<1e-6,`${message}：期望 ${expected}，实际 ${actual}`);
}
// 一场只带结城理（可再加友军）的干净战斗。波次敌人在 openBattle 里已经清空，这里只留下它放的训练木桩
// （hidden／invulnerable／untargetable，落在棋盘外的 -8,-8，永远不会进任何范围判定）——没有敌人时
// 战斗会在第一帧就判成 finished，后续 step() 全是空转，那就什么都测不到了。
function scene(skillIndex=0,extra=[]){
 const {b}=openBattle([{chessId:CHESS,skillIndex},...extra]);
 const u=byId(b,CHAR);
 assert.ok(u,'结城理应当在场上');
 assert.ok(b.s.enemies.length>0,'训练木桩要在场，否则战斗会立刻结束');
 return {b,u};
}
const front=(u,dist=1)=>FRONT[u.dir||0].map((v,i)=>i===0?u.x+v*dist:u.y+v*dist);
function put(b,charId,x,y,hpRatio=1){
 const actor=byId(b,charId);
 assert.ok(actor,`${charId} 应当在场上`);
 actor.x=x;actor.y=y;
 actor.hp=Math.max(1,Math.round(actor.maxHp*hpRatio));
 return actor;
}
// 友军挪到结城理身前（替身形态范围 x-1 内）／身后 4 格（范围外），并按需压血。
const allyInFront=(b,charId,hpRatio=1)=>{const u=byId(b,CHAR),[x,y]=front(u,1);return put(b,charId,x,y,hpRatio);};
const allyOutside=(b,charId,hpRatio=1)=>{const u=byId(b,CHAR),[x,y]=front(u,-4);return put(b,charId,x,y,hpRatio);};
// 把 profile 上某个天赋／技能黑板键换成新值（键必须存在），之后 read 到的都是替换后的 profile。
function patchProfile(b,u,{talentKey,talentValue,skillKey,skillValue}={}){
 const real=b.profile,base=real.call(b,u),patched={...base};
 if(talentKey!=null){
  if(!(base.activeTalents||[]).some(t=>(t.blackboard||[]).some(r=>r.key===talentKey)))throw Error('天赋黑板里没有 '+talentKey);
  patched.activeTalents=(base.activeTalents||[]).map(talent=>{
   const board=talent.blackboard||[];
   if(!board.some(row=>row.key===talentKey))return talent;
   return {...talent,blackboard:board.map(row=>row.key===talentKey?{...row,value:talentValue,valueStr:null}:row)};
  });
 }
 if(skillKey!=null){
  const board=base.skill?.blackboard||[];
  if(!board.some(row=>row.key===skillKey))throw Error('技能黑板里没有 '+skillKey);
  patched.skill={...base.skill,blackboard:board.map(row=>row.key===skillKey?{...row,value:skillValue,valueStr:null}:row)};
 }
 b.profile=function(v){return v===u?patched:real.call(this,v);};
 return patched;
}
const talentValue=(b,u,key)=>(b.profile(u).activeTalents||[]).map(t=>(t.blackboard||[]).find(r=>r.key===key)).find(Boolean).value;
const skillValue=(b,u,key)=>(b.profile(u).skill?.blackboard||[]).find(r=>r.key===key)?.value;
// 开技（主动＝立即切换为替身状态作战）。切换本身延后到下一帧，所以这里走一帧。
function enterDoll(b,u){
 pressSkillWhenReady(b,u);
 assert.equal(u.skillLeft,0,'三个技能的持续都是 0 秒，切换即结束');
 assert.equal(u.dollForm,null,'切换延后到下一帧，保住开技那一帧的技能级对空窗口');
 steps(b,1);
 assert.ok(u.dollForm,'下一帧应当进入替身状态');
}
// 让替身状态自然结束（tickDoll 到期后清掉 dollForm）。
function endDoll(b,u){
 assert.ok(u.dollForm);
 u.dollForm.until=b.s.time;
 steps(b,2);
 assert.equal(u.dollForm,null,'替身状态应当已经结束');
}
// 让替身窗口内的**再次点按技能键**能走到引擎的 activate：enterDoll 已经把技力扣空了，先补满。
function pressSkillWhenReady(b,u){
 u.sp=Math.max(u.sp,b.spCost(u));
 b.activate(u);
}
// 按模拟时间推进到**刚好还没到** `at` 的那一帧（帧长 1/30 秒，与 combat.js 的 FPS 一致），
// 这样「延迟 N 秒后生效」可以按阈值精确断言，不用数帧数。
function stepsUntil(b,at){
 let guard=0;
 while(b.s.time<at-1e-9&&guard++<600)b.step();
 return b.s.time;
}
// 只有结城理本人的「无来源/天赋」伤害才带 cause='talent'，用它把总攻击／斩杀从普攻里分出来。
const talentDamage=(b,u)=>logOf(b,'damage').filter(row=>row.sourceUid===u.uid&&row.cause==='talent');
const talentDamageTo=(b,u,target)=>talentDamage(b,u).filter(row=>row.targetUid===target.uid);
// 斩杀是**无来源**真实伤害（sourceUid 为 null），所以按目标筛。
const executeRows=(b,target)=>logOf(b,'damage').filter(row=>row.cause==='talent'&&row.targetUid===target.uid);
const anyTalentDamage=b=>logOf(b,'damage').filter(row=>row.cause==='talent');
const healsTo=(b,u,target)=>logOf(b,'heal').filter(row=>row.sourceUid===u.uid&&row.targetUid===target.uid);
const allHeals=(b,u)=>logOf(b,'heal').filter(row=>row.sourceUid===u.uid);

test('接线门禁：战斗单位上按 id（＝charId）也能取到结城理的五个钩子',()=>{
 const {b,u}=scene(0);
 assert.equal(u.charId,undefined,'战斗单位上没有 charId 字段（只有 id＝charId 与 source）');
 assert.equal(collabFor(u),COLLAB_HOOKS[CHAR],'派发层必须按 id 取到结城理的钩子');
 assert.deepEqual(Object.keys(COLLAB_HOOKS[CHAR]).sort(),['attackModifier','event','skillStart','statMods','tick']);
 assert.equal(b.profile(u).branch,'dollkeeper','结城理的分支是傀儡师');
 assert.equal(b.profile(u).teamId,'sees','结城理属于 S.E.E.S.');
 assert.equal((b.profile(u).skillChoices||[]).length,3,'三个技能对应三个人格面具');
});

test('天赋一①：切换为替身状态时停顿范围内敌人 sluggish 秒，范围外不停顿',()=>{
 const {b,u}=scene(0);
 const [ix,iy]=front(u,1),[ox,oy]=front(u,-4);
 const inside=enemy(b,{x:ix,y:iy,hp:100000});
 const outside=enemy(b,{x:ox,y:oy,hp:100000});
 const seconds=talentValue(b,u,'sluggish');
 assert.equal(seconds,8,'无潜能档的 sluggish 是 8 秒');
 enterDoll(b,u);
 const slowed=inside.statuses.find(s=>s.kind==='sluggish');
 assert.ok(slowed,'范围内的敌人应当被停顿');
 assert.ok(slowed.remaining<=seconds&&slowed.remaining>seconds-2/30,`停顿时长应当≈黑板 sluggish（${seconds}），实际 ${slowed.remaining}`);
 assert.equal(slowed.source,u.uid,'停顿来源应当是结城理');
 assert.deepEqual(outside.statuses,[],'范围外的敌人不该被停顿');
 const before=slowed.remaining;
 steps(b,1);
 const after=inside.statuses.find(s=>s.kind==='sluggish').remaining;
 assert.ok(after<before,`停顿是按时长倒计的真实状态（${before} → ${after}）`);
});

test('天赋一①：停顿时长跟着黑板走（改成 3 秒就停 3 秒）',()=>{
 const {b,u}=scene(0);
 patchProfile(b,u,{talentKey:'sluggish',talentValue:3});
 const [x,y]=front(u,1);
 const target=enemy(b,{x,y,hp:100000});
 enterDoll(b,u);
 const slowed=target.statuses.find(s=>s.kind==='sluggish');
 assert.ok(slowed.remaining<=3&&slowed.remaining>3-2/30,`停顿时长应当来自黑板（3 秒），实际 ${slowed.remaining}`);
});

test('天赋一②：非替身形态不吃不羁之力的 +atk（通用通道那份常驻加成被抵消）',()=>{
 const {b,u}=scene(0);
 const base=Number(b.profile(u).attributes.atk);
 near(b.stats(u).atk,base,`基础形态攻击力应当就是面板值 ${base}`);
 assert.equal(talentValue(b,u,'atk'),.8,'无潜能档的 atk 是 0.8');
});

test('天赋一②：替身形态 攻击力×(1+atk)、生命上限×(1+max_hp_t1)',()=>{
 const {b,u}=scene(0);
 const base=Number(b.profile(u).attributes.atk),maxHp=Number(b.profile(u).attributes.maxHp);
 const atkRatio=talentValue(b,u,'atk'),hpRatio=talentValue(b,u,'max_hp_t1');
 assert.equal(atkRatio,.8);assert.equal(hpRatio,.35);
 enterDoll(b,u);
 near(b.stats(u).atk,base*(1+atkRatio),'替身形态攻击力');
 near(b.stats(u).maxHp,maxHp*(1+hpRatio),'替身形态生命上限');
 near(u.maxHp,b.stats(u).maxHp,'进入替身时应当把生命上限同步成替身形态的值');
 near(u.hp,u.maxHp,'傀儡师进入替身形态时回满生命');
});

test('天赋一②：替身形态的攻击力／生命上限跟着黑板走',()=>{
 const {b,u}=scene(0);
 const base=Number(b.profile(u).attributes.atk),maxHp=Number(b.profile(u).attributes.maxHp);
 patchProfile(b,u,{talentKey:'atk',talentValue:.2});
 patchProfile(b,u,{talentKey:'max_hp_t1',talentValue:1});
 enterDoll(b,u);
 near(b.stats(u).atk,base*1.2,'atk 改成 0.2 就只 +20%');
 near(b.stats(u).maxHp,maxHp*2,'max_hp_t1 改成 1 就 +100%');
});

test('天赋一②：替身形态攻击间隔 +base_attack_time（加算秒数）',()=>{
 const {b,u}=scene(0);
 const attrs=b.profile(u).attributes,add=Number(talentValue(b,u,'base_attack_time'));
 assert.equal(attrs.baseAttackTime,1.2);assert.equal(add,.4);
 const interval=()=>b.stats(u).baseAttackTime*100/b.stats(u).attackSpeed;
 near(interval(),1.2,'基础形态攻击间隔就是面板值 1.2 秒');
 enterDoll(b,u);
 near(interval(),1.2+add,'进入替身后攻击间隔应当变成 1.6 秒');
 const speedInDoll=b.stats(u).attackSpeed;
 patchProfile(b,u,{talentKey:'base_attack_time',talentValue:.8});
 near(interval(),2,'加算值改成 0.8 就变成 2 秒');
 assert.ok(b.stats(u).attackSpeed<speedInDoll,'间隔变大＝攻速通道的等价值变小');
});

test('人格面具的攻击档案：三个技能的 attack@atk_scale 都在替身形态生效、非替身形态不生效',()=>{
 for(const index of [0,1,2]){
  const {b,u}=scene(index);
  const scale=skillValue(b,u,'attack@atk_scale');
  assert.ok(scale>0,`技能 ${index} 有 attack@atk_scale`);
  near(operatorAttackModifier(b,u,null,1000),1000,`技能 ${index} 非替身形态不套人格面具倍率`);
  enterDoll(b,u);
  near(operatorAttackModifier(b,u,null,1000),1000*scale,`技能 ${index} 替身形态按黑板倍率放大`);
  patchProfile(b,u,{skillKey:'attack@atk_scale',skillValue:9});
  near(operatorAttackModifier(b,u,null,1000),9000,`技能 ${index} 倍率跟着黑板走`);
 }
});

test('人格面具的攻击档案：走真实命中入口（battle.hit）也吃倍率',()=>{
 const {b,u}=scene(0);
 enterDoll(b,u);
 const [x,y]=front(u,1);
 const target=enemy(b,{x,y,hp:100000,def:0,res:0});
 const atk=b.stats(u).atk,scale=skillValue(b,u,'attack@atk_scale'),hp0=target.hp;
 b.hit(u,target,atk,'physical');
 near(hp0-target.hp,atk*scale,'真实命中要按 攻击力×attack@atk_scale 结算（敌人防御 0）');
});

test('S2：攻击按 attack@prob 概率恐惧 attack@fear 秒',()=>{
 const {b,u}=scene(1);
 enterDoll(b,u);
 const [x,y]=front(u,1);
 const target=enemy(b,{x,y,hp:100000,def:0,res:0});
 b.hit(u,target,b.stats(u).atk,'physical');
 assert.equal((target.statuses||[]).filter(s=>s.kind==='fear').length,0,'未改概率时这条用例不赌运气，只看下面的确定性分支');
 patchProfile(b,u,{skillKey:'attack@prob',skillValue:1});
 b.hit(u,target,b.stats(u).atk,'physical');
 const fear=(target.statuses||[]).find(s=>s.kind==='fear');
 assert.ok(fear,'attack@prob=1 时必定恐惧');
 near(fear.remaining,skillValue(b,u,'attack@fear'),'恐惧时长＝黑板 attack@fear');
 assert.equal(fear.remaining,1.5,'无潜能档的 attack@fear 是 1.5 秒');
 assert.equal(fear.source,u.uid,'恐惧来源应当是结城理');
});

test('S2：attack@prob=0 不恐惧（概率不是写死的 .35）',()=>{
 const {b,u}=scene(1);
 enterDoll(b,u);
 patchProfile(b,u,{skillKey:'attack@prob',skillValue:0});
 const [x,y]=front(u,1);
 const target=enemy(b,{x,y,hp:100000,def:0,res:0});
 b.hit(u,target,b.stats(u).atk,'physical');
 assert.deepEqual((target.statuses||[]).filter(s=>s.kind==='fear'),[],'概率为 0 就不该挂恐惧');
});

test('S2：范围内恐惧中且生命低于 攻击力×kill_atk_scale 的敌人立刻倒下',()=>{
 const {b,u}=scene(1);
 enterDoll(b,u);
 const threshold=b.stats(u).atk*skillValue(b,u,'attack@kill_atk_scale');
 const kill=skillValue(b,u,'attack@kill_damage');
 assert.equal(kill,9999999,'无潜能档的 kill_damage');
 const [x,y]=front(u,1);
 const target=enemy(b,{x,y,hp:Math.floor(threshold*.5),def:0,res:0});
 target.statuses.push({kind:'fear',remaining:5,source:u.uid,value:1});
 steps(b,1);
 assert.ok(target.hp<=0,'恐惧中且低于阈值应当被斩杀');
 const rows=executeRows(b,target);
 assert.equal(rows.length,1,'斩杀只结算一次');
 near(rows[0].hp,Math.floor(threshold*.5),'斩杀把目标生命一次打光');
 assert.equal(rows[0].sourceUid??null,null,'斩杀是无来源真实伤害');
});

test('S2：斩杀伤害取黑板 attack@kill_damage（改成 100 就打不死）',()=>{
 const {b,u}=scene(1);
 enterDoll(b,u);
 const threshold=b.stats(u).atk*skillValue(b,u,'attack@kill_atk_scale');
 patchProfile(b,u,{skillKey:'attack@kill_damage',skillValue:100});
 const [x,y]=front(u,1);
 const hp=Math.floor(threshold*.5);
 const target=enemy(b,{x,y,hp,def:0,res:0});
 target.statuses.push({kind:'fear',remaining:5,source:u.uid,value:1});
 steps(b,1);
 const rows=executeRows(b,target);
 assert.equal(rows.length,1,'斩杀照旧触发');
 near(rows[0].hp,100,'伤害＝黑板 attack@kill_damage，所以这个目标不会倒下');
 near(target.hp,hp-100,'目标只是掉 100 血');
});

test('S2：未恐惧／高于阈值／范围外的敌人都不被斩杀',()=>{
 const {b,u}=scene(1);
 enterDoll(b,u);
 const threshold=b.stats(u).atk*skillValue(b,u,'attack@kill_atk_scale');
 const [ix,iy]=front(u,1),[ox,oy]=front(u,-4);
 const notFeared=enemy(b,{x:ix,y:iy,hp:Math.floor(threshold*.5),def:0,res:0});
 const tooTough=enemy(b,{x:ix,y:iy,hp:Math.ceil(threshold*2),def:0,res:0});
 tooTough.statuses.push({kind:'fear',remaining:5,source:u.uid,value:1});
 const outside=enemy(b,{x:ox,y:oy,hp:Math.floor(threshold*.5),def:0,res:0});
 outside.statuses.push({kind:'fear',remaining:5,source:u.uid,value:1});
 steps(b,1);
 assert.ok(notFeared.hp>0,'没恐惧不该倒下');
 assert.ok(tooTough.hp>0,'高于 攻击力×kill_atk_scale 不该倒下');
 assert.ok(outside.hp>0,'范围外不该倒下');
 assert.equal(anyTalentDamage(b).length,0,'不该有任何斩杀结算');
});

test('S2：斩杀阈值跟着 attack@kill_atk_scale 走',()=>{
 const {b,u}=scene(1);
 enterDoll(b,u);
 patchProfile(b,u,{skillKey:'attack@kill_atk_scale',skillValue:.00001});
 const [x,y]=front(u,1);
 const tough=enemy(b,{x,y,hp:1000,def:0,res:0});
 tough.statuses.push({kind:'fear',remaining:5,source:u.uid,value:1});
 steps(b,1);
 assert.ok(tough.hp>0,'阈值缩到万分之一后，1000 生命不该再被斩杀');
 const {b:b2,u:u2}=scene(1);
 enterDoll(b2,u2);
 patchProfile(b2,u2,{skillKey:'attack@kill_atk_scale',skillValue:99});
 const [x2,y2]=front(u2,1);
 const weak=enemy(b2,{x:x2,y:y2,hp:1000,def:0,res:0});
 weak.statuses.push({kind:'fear',remaining:5,source:u2.uid,value:1});
 steps(b2,1);
 assert.ok(weak.hp<=0,'阈值改成 99×攻击力就一定能斩杀');
});

test('S1：范围内有生命低于阈值的友方干员时改为治疗（治疗量＝攻击力×heal_scale）',()=>{
 const {b,u}=scene(0,[{chessId:ALLY_CHESS}]);
 const ally=allyInFront(b,ALLY_CHAR,.4);
 const scale=skillValue(b,u,'attack@heal_scale');
 assert.equal(scale,.6);
 near(operatorAttackModifier(b,u,null,1000),1000,'进入替身前不套面具倍率');
 enterDoll(b,u);
 const atk=b.stats(u).atk;
 const rows=healsTo(b,u,ally);
 assert.equal(rows.length,1,'替身形态第一帧按攻击间隔治疗一次');
 near(rows[0].amount,atk*scale,'治疗量＝替身形态攻击力×attack@heal_scale');
 // 再压回阈值以下：这时「这一次攻击」应当被治疗取代
 ally.hp=Math.round(ally.maxHp*.4);
 near(operatorAttackModifier(b,u,null,1000),0,'有治疗目标时这一次攻击不结算伤害');
 // 治疗目标消失后就照常打面具伤害
 ally.hp=ally.maxHp;
 near(operatorAttackModifier(b,u,null,1000),1000*skillValue(b,u,'attack@atk_scale'),'没有治疗目标时照常按面具倍率结算');
});

test('S1：治疗阈值（生命值低于 50%）与治疗量都从数据来',()=>{
 const {b,u}=scene(0,[{chessId:ALLY_CHESS}]);
 const healthy=allyInFront(b,ALLY_CHAR,.6);
 enterDoll(b,u);
 assert.equal(allHeals(b,u).length,0,'高于阈值不治疗');
 assert.ok(operatorAttackModifier(b,u,null,1000)>0,'生命 60% 的友军不该抢走这次攻击');
 healthy.hp=Math.floor(healthy.maxHp*.4);
 steps(b,31);
 assert.equal(allHeals(b,u).length,1,'掉到阈值以下就该改为治疗');
 const {b:b2,u:u2}=scene(0,[{chessId:ALLY_CHESS}]);
 patchProfile(b2,u2,{skillKey:'attack@heal_scale',skillValue:1.5});
 const ally2=allyInFront(b2,ALLY_CHAR,.2);
 enterDoll(b2,u2);
 const atk2=b2.stats(u2).atk;
 near(healsTo(b2,u2,ally2)[0].amount,atk2*1.5,'heal_scale 改成 1.5 就按 1.5 治');
});

test('S3：替身形态攻速 +talent@attack_speed',()=>{
 const {b,u}=scene(2);
 const bonus=skillValue(b,u,'talent@attack_speed'),add=Number(talentValue(b,u,'base_attack_time'));
 assert.equal(bonus,60);
 const base=b.profile(u).attributes.baseAttackTime,speed=b.profile(u).attributes.attackSpeed;
 enterDoll(b,u);
 near(b.stats(u).attackSpeed,speed+bonus+(speed+bonus)*(base/(base+add)-1),'攻速＝基础+60，再叠加攻击间隔加算的等价值');
 const {b:b2,u:u2}=scene(2);
 patchProfile(b2,u2,{skillKey:'talent@attack_speed',skillValue:0});
 enterDoll(b2,u2);
 near(b2.stats(u2).attackSpeed,speed+speed*(base/(base+add)-1),'talent@attack_speed 改成 0 就只剩间隔加算');
});

test('S3：范围内友方干员获得 attack@prob 的物理闪避（范围外不给），逐帧续期',()=>{
 const {b,u}=scene(2,[{chessId:ALLY_CHESS},{chessId:ALLY2_CHESS}]);
 const ally=allyInFront(b,ALLY_CHAR);
 const far=allyOutside(b,ALLY2_CHAR);
 const prob=skillValue(b,u,'attack@prob');
 assert.equal(prob,.4);
 enterDoll(b,u);
 assert.equal(ally.physicalEvadeProb,prob,'范围内友军应当拿到黑板概率的物理闪避');
 assert.ok(ally.physicalEvadeUntil>b.s.time,'闪避应当处于生效期内（物理闪避走 native-battle.hurt 的 physicalEvadeUntil 通道）');
 assert.equal(far.physicalEvadeProb,0,'范围外不给闪避');
 assert.ok(!(far.physicalEvadeUntil>b.s.time),'范围外友军的闪避不生效');
 const until=ally.physicalEvadeUntil;
 steps(b,2);
 assert.ok(ally.physicalEvadeUntil>until,'替身期间闪避逐帧续期');
 patchProfile(b,u,{skillKey:'attack@prob',skillValue:.9});
 steps(b,1);
 assert.equal(ally.physicalEvadeProb,.9,'闪避概率跟着黑板走');
});

test('S3：每 attack@interval 秒治疗范围内最多 attack@max_target_heal 名友方干员 attack@heal_scale',()=>{
 const {b,u}=scene(2,[{chessId:ALLY_CHESS},{chessId:ALLY2_CHESS}]);
 const first=allyInFront(b,ALLY_CHAR,.3);
 const [x,y]=front(u,1);
 const second=put(b,ALLY2_CHAR,x,y,.5);
 const scale=skillValue(b,u,'attack@heal_scale');
 assert.equal(skillValue(b,u,'attack@interval'),1);
 const first0=first.hp,second0=second.hp;
 enterDoll(b,u);
 const atk=b.stats(u).atk;
 near(first.hp-first0,atk*scale,'进入替身第一帧就按 攻击力×attack@heal_scale 治一次（第一名）');
 near(second.hp-second0,atk*scale,'第二名友军同样被治疗（max_target_heal=4）');
 const healed=first.hp+second.hp;
 steps(b,15);
 near(first.hp+second.hp,healed,'不到 attack@interval 不该再治疗一次');
 steps(b,16);
 assert.ok(first.hp+second.hp>healed,'过了 attack@interval 秒再治疗一次');
 const {b:b2,u:u2}=scene(2,[{chessId:ALLY_CHESS},{chessId:ALLY2_CHESS}]);
 patchProfile(b2,u2,{skillKey:'attack@max_target_heal',skillValue:1});
 const low=allyInFront(b2,ALLY_CHAR,.2);
 const [x2,y2]=front(u2,1);
 const high=put(b2,ALLY2_CHAR,x2,y2,.6);
 const low0=low.hp,high0=high.hp;
 enterDoll(b2,u2);
 assert.ok(low.hp>low0,'生命比例最低的那名友军被治疗');
 near(high.hp,high0,'max_target_heal=1 时第二个人不该被治疗');
});

test('天赋二：替身结束后对每名 S.E.E.S. 队员周围敌人造成 攻击力×atk_scale 真实伤害（可叠加）',()=>{
 const {b,u}=scene(0,[{chessId:YUKARI_CHESS}]);
 const yukari=byId(b,YUKARI_CHAR);
 const [x,y]=front(u,1);
 const shared=enemy(b,{x,y,hp:1000000,def:1000,res:50});
 const [x2,y2]=front(u,-1);
 const solo=enemy(b,{x:x2,y:y2,hp:1000000,def:1000,res:50});
 yukari.x=x+1;yukari.y=y; // 由加莉站在这个敌人旁边：它的 x-1 覆盖同一格
 enterDoll(b,u);
 endDoll(b,u);
 const atk=b.stats(u).atk,scale=talentValue(b,u,'atk_scale');
 assert.equal(scale,4.3,'无潜能档的 atk_scale 是 4.3');
 const sharedRows=talentDamageTo(b,u,shared);
 assert.equal(sharedRows.length,2,'落在两名队员范围内的敌人吃两发（可叠加）');
 sharedRows.forEach(row=>near(row.hp,atk*scale,'总攻击伤害＝结城理攻击力×atk_scale，且无视 1000 防御／50 法抗（真实伤害）'));
 const soloRows=talentDamageTo(b,u,solo);
 assert.equal(soloRows.length,1,'只在结城理范围内的敌人吃一发');
 near(soloRows[0].hp,atk*scale,'单发伤害同样是 攻击力×atk_scale');
});

test('天赋二：伤害倍率跟着 atk_scale 走、非 S.E.E.S. 队员周围不算',()=>{
 const {b,u}=scene(0,[{chessId:YUKARI_CHESS},{chessId:ALLY_CHESS}]);
 const yukari=byId(b,YUKARI_CHAR);
 const [x,y]=front(u,1);
 const target=enemy(b,{x,y,hp:1000000});
 yukari.x=x+1;yukari.y=y;
 // 非队员（普通干员）站在一个只属于它自己的位置上，旁边放个敌人：不该被总攻击打到
 const outsider=put(b,ALLY_CHAR,x+6,y,1);
 const outsideTarget=enemy(b,{x:x+7,y,hp:1000000});
 patchProfile(b,u,{talentKey:'atk_scale',talentValue:1});
 enterDoll(b,u);
 endDoll(b,u);
 const atk=b.stats(u).atk;
 const rows=talentDamageTo(b,u,target);
 assert.equal(rows.length,2,'两名队员都在范围内，仍然两发');
 rows.forEach(row=>near(row.hp,atk,'atk_scale 改成 1 就按 1 倍结算'));
 assert.equal(talentDamageTo(b,u,outsideTarget).length,0,'非 S.E.E.S. 队员周围不发总攻击');
 assert.ok(outsider,'占位：非队员干员在场');
});

test('塔纳托斯·改的对空与多目标已经打通（原「未闭环存证」用例，2026-09-27 转正）',()=>{
 const {b,u}=scene(2);
 assert.equal(skillAntiAir(CHAR,2),true,'SKILL_ANTIAIR 里登记了塔纳托斯·改可对空');
 enterDoll(b,u);
 assert.equal(b.behavior(u).antiAir,true,'替身形态现在按 unit.dollAntiAir 取值，塔纳托斯·改为真');
 assert.equal(u.attackTargetCountOverride,4,'attack@max_target 现在覆写普攻目标数（原表 lv10＝4）');
 assert.equal(b.behavior(u).style,'single','表现风格仍是单体（目标数走 chosen 切片，不是 style）');
});

// ── S3 两段替身（用户 2026-09-27 口径） ───────────────────────────────────────────────────────
// 俄耳甫斯·改延迟治疗的 0.5 秒是文案里写的（黑板没有这个键），这里作为断言常量存档。
const ORPHEUS_HEAL_DELAY=.5;
// 待结算的延迟治疗（native-effects 的 kind:'delayed' 效果，0.5 秒后由 settlePeriodic 走 applyHeal）。
const pendingHeals=(b,u)=>(b.s.logicEffects||[]).filter(fx=>fx.kind==='delayed'&&fx.talentOrSkillId==='makoto-orpheus-heal'&&fx.sourceUid===u.uid);
// 假 canvas ctx：只记录绘制调用与画笔状态，够 drawDollOverlay 走完一遍。
// 渐变也记下来（通用紫色走的是三档紫色渐变罩色，回归 native-summon-lifecycle 就是按那个判的）。
function fakeCtx(){
 const calls=[],fills=[],strokes=[],gradients=[];
 const state={pattern:'',fillStyle:'',strokeStyle:'',lineWidth:0,alpha:1};
 const record=kind=>()=>calls.push({kind,fillStyle:state.fillStyle,strokeStyle:state.strokeStyle});
 return {
  calls,fills,strokes,gradients,
  save(){},restore(){},
  fillRect(){calls.push({kind:'fillRect',fillStyle:state.fillStyle});fills.push(state.fillStyle);},
  strokeRect:record('strokeRect'),
  beginPath(){},closePath(){},
  arc:record('arc'),ellipse:record('ellipse'),moveTo(){},lineTo(){},fill(){},
  stroke(){calls.push({kind:'stroke',strokeStyle:state.strokeStyle});strokes.push(state.strokeStyle);},
  createLinearGradient(){
   const stops=[];
   gradients.push(stops);
   return {addColorStop(at,color){stops.push(color);}};
  },
  get fillStyle(){return state.fillStyle;},
  set fillStyle(value){state.fillStyle=typeof value==='string'?value:state.pattern;},
  get strokeStyle(){return state.strokeStyle;},
  set strokeStyle(value){state.strokeStyle=value;},
  set globalCompositeOperation(value){},set lineWidth(value){state.lineWidth=value;},
 };
}

test('S3 两段替身：进入替身 persona=thanatos，替身结束清空，S1／S2 不设置 persona',()=>{
 const {b,u}=scene(2);
 assert.equal(u.persona,undefined,'进入替身前没有形态标记');
 enterDoll(b,u);
 assert.equal(u.persona,'thanatos','S3 的替身初始形态是塔纳托斯·改');
 endDoll(b,u);
 assert.equal(u.persona,undefined,'替身窗口结束要清空 persona');
 for(const index of [0,1]){
  const {b:b2,u:u2}=scene(index);
  enterDoll(b2,u2);
  assert.equal(u2.persona,undefined,`技能 ${index} 不属于两段替身，不该写 persona（表现层保持通用紫色罩色）`);
 }
});

test('S3 两段替身①：再次点按技能键把塔纳托斯·改换成俄耳甫斯·改',()=>{
 const {b,u}=scene(2);
 enterDoll(b,u);
 const until=u.dollForm.until,bb=()=>b.profile(u).skill.blackboard;
 const block=Number(bb().find(r=>r.key==='attack@block_cnt').value);
 assert.equal(block,2,'无潜能档的 attack@block_cnt 是 2');
 // 「坦克」塔纳托斯·改：替身形态默认归 0 阻挡（傀儡师特性）。
 near(b.stats(u).blockCnt,0,'塔纳托斯·改按替身形态归 0 阻挡');
 pressSkillWhenReady(b,u);
 assert.equal(u.persona,'orpheus','再次点按技能键应当切换成俄耳甫斯·改');
 assert.equal(u.dollForm.until,until,'切换不改替身总时长（仍是特性黑板的 20 秒）');
 assert.ok(u.skillLeft<=0,'切换不会开出技能生效期');
 assert.equal(u.sp,b.spCost(u),'俄耳甫斯·改持【静默】：这次请求不扣技力、也不走开技结算');
 steps(b,1);
 near(b.stats(u).blockCnt,block,'俄耳甫斯·改恢复阻挡数（黑板 attack@block_cnt）');
 near(u.makotoBlockCnt,block,'阻挡覆写走 statMods 的 blockCnt 通道');
 // 真实阻挡结算：贴到同一格（resolveBlocks 的判定距离是 0.72 格）验证容量真的是 2。
 // 塔纳托斯·改那一段的容量是 0，所以先把同一格的敌人放上去、切换后它才会被算成被阻挡。
 const blocker=enemy(b,{x:u.x,y:u.y,hp:100000,speed:0});
 steps(b,1);
 assert.equal(blocker.block,u.uid,'俄耳甫斯·改要真的能阻挡（替身默认 0 阻挡，这里是覆写后的 2）');
 // 切换后再点一次：静默，形态不变。
 b.activate(u);
 assert.equal(u.persona,'orpheus','同一个替身窗口内只切换一次');
 assert.ok(u.dollForm,'（静默）不会把替身提前结束');
});

test('S3 两段替身②：塔纳托斯·改在场时受到致命伤改为俄耳甫斯·改并保住这一次',()=>{
 const {b,u}=scene(2);
 enterDoll(b,u);
 assert.equal(u.persona,'thanatos');
 const hp0=u.maxHp;
 assert.ok(hp0>3);
 // 用**法术**致命伤：物理命中会先被 S3 自己的物理闪避光环吃掉（`attack@prob` 那条会把闪避挂在结城理自己身上），
 // 那样就走不到致死管线，测不到「受到致命伤改为召唤俄耳甫斯·改」。
 b.hurt(u,{atk:hp0*10,damageType:'arts'},{sourceLess:true});
 assert.equal(u.persona,'orpheus','受到致命伤应当切换成俄耳甫斯·改');
 // 引擎「重新进替身」时按本体属性重设上限（那一下 statMods 被 hp<=0 的守卫挡住），本文件会按进伤前的
 // 替身形态上限补回来，所以这里按「顶到替身形态的上限（含 +35%）」判，且远高于 1 血。
 near(u.hp,b.stats(u).maxHp,'这一下致命伤被兜住：切换进替身形态并把生命顶回替身形态的上限');
 assert.ok(u.hp>1,'不是「留 1 血」，是真的被替身吃掉了');
 assert.ok(u.dollForm,'替身窗口不因此结束');
 assert.equal(u.exitLife,null,'没有退场');
 assert.ok(b.s.units.includes(u),'人还在场上');
 assert.ok(!u.downed,'没有进入倒地保护');
 near(b.stats(u).blockCnt,2,'切换后同样恢复阻挡 2');
 // 已经兜到 1 血之后不再二次保护：下一次致命伤照常结算（不会赖场）。
 b.hurt(u,{atk:u.maxHp*10,damageType:'arts'},{sourceLess:true});
 assert.ok(!b.s.units.includes(u)||u.exitLife!=null,'站在 1 血上再挨一下就该真的倒下（替身分支已用掉）');
});

test('S3 两段替身③：俄耳甫斯·改不普攻、阻挡 2、攻击间隔不变（同一份面具档案）',()=>{
 const {b,u}=scene(2);
 enterDoll(b,u);
 const interval=st=>st.baseAttackTime*100/st.attackSpeed;
 const before=interval(b.stats(u));
 assert.ok(operatorAttackModifier(b,u,null,1000)>0,'塔纳托斯·改照常按 attack@atk_scale 打伤害');
 pressSkillWhenReady(b,u);
 steps(b,1);
 near(operatorAttackModifier(b,u,null,1000),0,'俄耳甫斯·改不进行普通攻击（命中前的攻击修正压到 0）');
 near(interval(b.stats(u)),before,'切换不改攻击间隔');
 // 真实命中入口也打不出伤害。
 const [x,y]=front(u,1);
 const target=enemy(b,{x,y,hp:100000,def:0,res:0});
 const hp0=target.hp;
 b.hit(u,target,b.stats(u).atk,'physical');
 near(target.hp,hp0,'真实命中（battle.hit → attackModifier）也不掉血');
});

test('S3 两段替身④：俄耳甫斯·改每秒延迟治疗（0.5 秒后生效、剂量＝攻击力×attack@heal_scale、禁疗不给）',()=>{
 const {b,u}=scene(2,[{chessId:ALLY_CHESS}]);
 const ally=allyInFront(b,ALLY_CHAR,.1);
 enterDoll(b,u);
 pressSkillWhenReady(b,u);
 assert.equal(u.persona,'orpheus');
 // 「切换完毕的瞬间」那一批由紧随其后的 tick 挂出（activate 那一帧还没有 tick）。
 assert.equal(pendingHeals(b,u).length,0,'切换当帧还没轮到 tick，不该凭空造治疗');
 const atk=b.stats(u).atk,scale=Number(b.profile(u).skill.blackboard.find(r=>r.key==='attack@heal_scale').value);
 assert.equal(scale,.35);
 // 第一批：施加时刻 t0，0.5 秒后才结算（塔纳托斯·改那一段的每秒即时治疗不算在这一批里）。
 let batch=null;
 for(let i=0;i<3&&!batch;i++){
  steps(b,1);
  batch=pendingHeals(b,u)[0]||null;
 }
 assert.ok(batch,'切换后的第一次 tick 就挂上一批延迟治疗（每个未满血友方一条）');
 near(batch.values.heal,atk*scale,'剂量＝结城理当前攻击力 × attack@heal_scale');
 assert.deepEqual(batch.snapshot,{heal:atk*scale},'剂量在施加这一帧就按当前攻击力定格（快照）');
 near(batch.nextAt-batch.startedAt,ORPHEUS_HEAL_DELAY,'0.5 秒后生效');
 // 逐帧推到「这一批结算掉」的那一刻，按**日志时间戳**验证生效时刻与剂量：
 // 治疗要落在 [nextAt, nextAt+帧长) 这个窗口里，施加与生效之间不许有任何治疗。
 const before=healsTo(b,u,ally).length;
 const dueAt=batch.nextAt;   // 引擎结算时会把 fx.nextAt 清成 null，先把排定时刻记下来
 let settledAt=null;
 while(settledAt==null&&b.s.time<dueAt+1){
  steps(b,1);
  if(!pendingHeals(b,u).some(fx=>fx.id===batch.id))settledAt=b.s.time;
 }
 assert.ok(settledAt!=null,'第一批应当在自己的结算点被消费');
 const rows=healsTo(b,u,ally);
 if(rows.length!==before+1)assert.fail(`第一批应当只结算一次（before=${before}，实际 ${JSON.stringify(rows)}）`);
 const stamp=rows.at(-1).t;
 if(!(stamp>0))assert.fail(`治疗日志缺少时间戳（rows=${JSON.stringify(rows)}，nextAt=${dueAt}）`);
 assert.ok(stamp>=dueAt-1e-9,`治疗要等 0.5 秒后才生效（期望 ≥${dueAt.toFixed(4)}，实际 ${stamp.toFixed(4)}）`);
 assert.ok(stamp<dueAt+1/30,`生效时刻就在第一批排定的那一帧（实际 ${stamp.toFixed(4)}）`);
 assert.ok(stamp>batch.startedAt,'施加与生效不是同一帧');
 near(rows.at(-1).amount,atk*scale,'结算量＝施加这一帧快照的 攻击力×attack@heal_scale');
 // 下一批的施加/生效时刻各推后 1 秒（attack@interval）。
 let second=null;
 for(let i=0;i<40&&!second;i++){
  steps(b,1);
  second=pendingHeals(b,u).find(fx=>fx.id!==batch.id)||null;
 }
 assert.ok(second,'第一批结算后应当挂上第二批');
 // 施加间隔＝attack@interval（1 秒）。批次是按模拟时间排的，帧推进取整会让相邻两批差一帧左右，
 // 所以这里按「不超过两帧」判间隔，并另断言它确实落在 1 秒附近（不是每帧都在挂新批）。
 const gap=second.startedAt-batch.startedAt;
 assert.ok(gap>=1-2/30&&gap<=1+2/30,`两批施加间隔应当≈attack@interval（1 秒），实际 ${gap.toFixed(4)}`);
 assert.ok(Math.abs(second.nextAt-dueAt-1)<=2/30,`两批生效间隔应当≈1 秒，实际 ${(second.nextAt-dueAt).toFixed(4)}`);
 assert.equal(pendingHeals(b,u).length,1,'同一时刻只留一批待结算的延迟治疗');
 assert.equal(healsTo(b,u,ally).length,before+1,'第二批生效前不该再治疗');
 // 禁疗：延迟治疗走治疗管线，受 healingBlocked 制约。
 const {b:b2,u:u2}=scene(2,[{chessId:ALLY_CHESS}]);
 const blocked=allyInFront(b2,ALLY_CHAR,.3);
 blocked.statuses.push({kind:'healingBlocked',remaining:600,source:'probe',value:1});
 enterDoll(b2,u2);
 pressSkillWhenReady(b2,u2);
 assert.equal(u2.persona,'orpheus');
 const hp1=blocked.hp;
 steps(b2,90);
 near(blocked.hp,hp1,'禁疗时延迟治疗不给（applyHeal → canHeal 的 healingBlocked 门禁）');
 assert.equal(healsTo(b2,u2,blocked).length,0,'受禁疗的目标不该留下治疗记录');
});

test('S3 两段替身的视觉：按 actor.persona 取配色（两种形态不同、reduceFx 只画静止罩色）',()=>{
 assert.deepEqual(DOLL_PERSONA_STYLE,{thanatos:{tint:'rgba(0,0,0,.45)',flow:'#1b3fd8'},orpheus:{tint:'rgba(255,255,255,.45)',flow:'#e8c46a'}});
 const box={x:0,y:0,w:40,h:40},draw=actor=>{const c=fakeCtx();drawDollOverlay(c,actor,box,{time:.4});return c;};
 const thanatos=draw({dollForm:{until:99,nextAt:1},persona:'thanatos'});
 const orpheus=draw({dollForm:{until:99,nextAt:1},persona:'orpheus'});
 const generic=draw({dollForm:{until:99,nextAt:1}});
 assert.equal(thanatos.fills[0],DOLL_PERSONA_STYLE.thanatos.tint,'塔纳托斯＝半透明黑罩色');
 assert.equal(orpheus.fills[0],DOLL_PERSONA_STYLE.orpheus.tint,'俄耳甫斯＝半透明白罩色');
 assert.ok(thanatos.fills[0]!==orpheus.fills[0],'两种 persona 的罩色必须不同');
 assert.ok(thanatos.strokes.some(color=>color.includes('27,63,216')),'塔纳托斯的流动特效是深蓝色');
 assert.ok(orpheus.strokes.some(color=>color.includes('232,196,106')),'俄耳甫斯的流动特效是金色');
 assert.ok(!thanatos.strokes.some(color=>orpheus.strokes.includes(color)),'两种 persona 的流动色必须不同');
 // 未设置 persona（归溟幽灵鲨等其它傀儡师）必须保持原来的通用紫色罩色：走的是三档紫色渐变。
 assert.deepEqual(generic.gradients.length>=1,true,'通用形态仍然用紫色渐变罩色');
 assert.ok(generic.gradients[0].some(color=>/rgba\(158,\s*96,\s*226/.test(color)),'通用紫色罩色没变：'+generic.gradients[0].join(' '));
 assert.ok(generic.strokes.some(color=>color.includes('200,156,255')),'通用紫色弧环没变');
 assert.ok(generic.calls.some(call=>call.kind==='arc'),'通用形态照旧画弧环');
 // 未知 persona 值也退回通用紫色（不做特殊配色）。
 const unknown=draw({dollForm:{until:99,nextAt:1},persona:'unknown'});
 assert.ok(unknown.gradients.length>=1,'未知 persona 退回通用紫色');
 const reduced=fakeCtx();
 assert.equal(drawDollOverlay(reduced,{dollForm:{until:99,nextAt:1},persona:'thanatos'},box,{reduceFx:true,time:.4}),true);
 assert.equal(reduced.fills.length,1,'reduceFx 下只留一层静止罩色');
 assert.equal(reduced.strokes.length,0,'reduceFx 下不画流动');
 assert.equal(drawDollOverlay(fakeCtx(),{persona:'orpheus'},box,{}),false,'没有替身形态就不画');
});

// ── 替身形态的引擎通道（2026-09-27 补）────────────────────────────────────────
// 这几条原本登记在「未闭环」里（§5.4 ①／②／⑤／⑦）：伤害类型改不了、`attack@max_target` 不生效、
// 法术闪避没有通道、替身形态对空没落地。现在 native-battle 打开了三个按单位生效的通道
// （`dollDamageType`／`dollAntiAir`／`attackTargetCountOverride`，`hurt()` 里补了与物理对称的
// `artsEvade*`），native-sees 的 `weaknessSource` 也认 `unit.weaknessAttacker`，本文件按形态写这些字段。
test('替身形态的通道：S1／S2 普攻转法术，S3 转弱点，退出替身清空',()=>{
 for(const [skillIndex,persona,type] of [[0,'s1','arts'],[1,'s2','arts'],[2,'s3',undefined]]){
  const {b,u}=scene(skillIndex);
  enterDoll(b,u);
  assert.equal(b.behavior(u).damageType,type??b.behavior(u).damageType,`技能${skillIndex} 的普攻类型`);
  if(skillIndex<2)assert.equal(b.behavior(u).damageType,'arts',`技能${skillIndex} 的替身普攻是法术`);
  else assert.equal(u.weaknessAttacker,true,'S3 的替身普攻是弱点伤害（交给命中类型路由）');
  assert.equal(u.attackTargetCountOverride,Math.max(0,Math.trunc(skillValue(b,u,'attack@max_target')||0)),`技能${skillIndex} 按 attack@max_target 覆写目标数`);
  endDoll(b,u);
  assert.equal(u.dollDamageType,undefined,'退出替身清掉类型覆写');
  assert.equal(u.weaknessAttacker,false,'退出替身清掉弱点标记');
  assert.equal(u.attackTargetCountOverride,0,'退出替身清掉目标数覆写');
 }
});

test('替身形态的对空：只有 S3 的塔纳托斯·改能选中空中单位，换俄耳甫斯·改后不能',()=>{
 const {b,u}=scene(2);
 enterDoll(b,u);
 assert.equal(b.behavior(u).antiAir,true,'塔纳托斯·改普攻可对空（PRTS 备注）');
 const air=enemy(b,{hp:50000,atk:0,x:u.x,y:u.y+1,flying:true,def:0,res:0});
 assert.ok(b.targets(u).includes(air),'空中单位要能进索敌表');
 pressSkillWhenReady(b,u);steps(b,1);
 assert.equal(u.persona,'orpheus');
 assert.equal(b.behavior(u).antiAir,false,'俄耳甫斯·改回归不可对空');
 assert.ok(!b.targets(u).includes(air),'换形态后空中单位出表');
 // 对照：S1 的替身同样不可对空（只有 S3 开这个通道）。
 const other=scene(0);
 enterDoll(other.b,other.u);
 assert.equal(other.b.behavior(other.u).antiAir,false);
});

test('替身形态的多目标：S2 一次普攻打到范围内的多名敌人，S1 只打一名',()=>{
 const hitsPerAttack=(skillIndex)=>{
  const {b,u}=scene(skillIndex);
  enterDoll(b,u);
  const spots=[[1,0],[0,1],[0,-1]].map(([dx,dy])=>[u.x+(dx||0),u.y+(dy||0)]);
  for(const [x,y] of spots)enemy(b,{hp:99999,atk:0,x,y,def:0,res:0});
  b.s.enemies=b.s.enemies.filter(e=>e.trainingDummy||spots.some(([x,y])=>e.x===x&&e.y===y));
  let best=0;
  for(const e of b.s.enemies)e.lastAttackId=null;
  for(let i=0;i<40;i++){
   steps(b,1);
   const byAttack=new Map();
   for(const row of logOf(b,'damage')){if(row.attackId==null)continue;byAttack.set(row.attackId,(byAttack.get(row.attackId)||0)+1);}
   for(const n of byAttack.values())best=Math.max(best,n);
  }
  return best;
 };
 assert.ok(hitsPerAttack(1)>=2,'S2 的 attack@max_target 要真的让一次普攻打到多名敌人');
 assert.equal(hitsPerAttack(0),1,'S1 不覆写目标数，仍只打一名');
});

test('替身形态的法术闪避：与物理那套对称，闪避窗口内不吃法术伤害',()=>{
 const {b,u}=scene(2);
 assert.equal(u.artsEvadeUntil,0,'部署时清空');
 enterDoll(b,u);
 u.artsEvadeUntil=b.s.time+2;u.artsEvadeProb=1;
 const before=u.hp,attacker=enemy(b,{hp:1000,atk:0,x:u.x+3,y:u.y,def:0,res:0});
 attacker.damageType='arts';
 b.hurt(u,attacker,{damageAmount:500,cause:'attack'});
 assert.equal(u.hp,before,'必中窗口内不吃法术伤害');
 u.artsEvadeUntil=0;
 b.hurt(u,attacker,{damageAmount:500,cause:'attack'});
 assert.ok(u.hp<before,'窗口过期后照常受伤');
});
