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
// 把 dist/native-collab-makoto.js 改回空实现（五个钩子都空）时，除「接线门禁」外**每一条用例都会失败**。

import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,byId,enemy,steps,logOf} from './effects-harness.mjs';
import {COLLAB_HOOKS,collabFor} from '../dist/native-collab.js';
import {attackModifier as operatorAttackModifier} from '../dist/native-operator-effects.js';
import {skillAntiAir} from '../dist/native-branches.js';

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
 u.sp=Math.max(u.sp,b.spCost(u));
 b.activate(u);
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

test('未闭环存证：替身形态“塔纳托斯·改普通攻击可对空”被引擎的 behavior() 固定为 false',()=>{
 const {b,u}=scene(2);
 assert.equal(skillAntiAir(CHAR,2),true,'SKILL_ANTIAIR 里登记了塔纳托斯·改可对空');
 enterDoll(b,u);
 assert.equal(b.behavior(u).antiAir,false,'替身形态的 behavior() 无条件 antiAir:false，技能级窗口只在开技那一帧');
 assert.equal(b.behavior(u).style,'single','替身形态仍是单体风格：attack@max_target 目前改不了索敌目标数');
});
