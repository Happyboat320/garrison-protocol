// 虎狼丸 char_4220_kormr（chess_collab_kormr）天赋「黑色猎犬」的定向回归。
//
// 口径：data/modes/alliance-lower/collab-operators.json ＋ PRTS revisionId 424872。
// 天赋：部署后对**周围一定范围内最近的 1 名敌人**发动**总计 6 次无视闪避**的斩击，每次造成相当于
// 攻击力 `atk_scale` 的法术伤害，**最后一次**改为 `final_atk_scale` 的法术伤害并使目标**恐惧** `fear` 秒。
// 无潜能档黑板只有 {atk_scale:1, final_atk_scale:2, fear:4}，范围的权威来源是天赋自带的
// `rangeId`（`x-1`＝以自身为中心、曼哈顿距离 2 的 13 格）；数值一律从黑板读，缺 atk_scale／
// final_atk_scale 就不给这个能力。
//
// 全部用例都走**真实部署事件**（battle.deploy → native-effects dispatch('deploy') → collabDeploy →
// native-collab-kormr 的 deploy 钩子），命中的是真实入口（battle.hit → native-effects.dealDamage →
// combat.damage）与真实状态／范围表。
//
// 两条本次排查出来的外部问题：
// ★1 派发层取键（**已修**）：`collabFor(unit)` 原来只读 `unit.charId`，而 NativeBattle 建出来的战斗单位
//    只有 `id`（＝charId，native-battle.js:47），七个联动钩子对战场上的四人全部静默失效
//    （接线门禁传的是 `{charId:…}` 假对象，所以当时还是绿的）。native-collab.js 现在三种形态都认，
//    第一条用例给这条修复加门禁。
// ★2 通用天赋文案兜底（**已修**，在 dist/native-operator-effects.js 的 after-damage 分支）：它原来把
//    「黑板里有 `fear` 键」直接当成「每次命中施加恐惧」，而虎狼丸天赋文案里必然含「造成…伤害」⇒
//    **普攻也会挂 4 秒恐惧**（那不是天赋本意，天赋只在部署斩击的最后一下发一次）。现在「部署后／部署时／
//    入场时／落地时」触发的天赋不再走这条兜底。本文件的恐惧用例仍保留 `isolateGenericFallback()`
//    （把触发它的文案换掉）以防它回退时把断言验成假绿，另有一条独立门禁用例「普攻不该挂恐惧」盯这条修复。
//
// 改回空实现（`deploy(battle,unit){}`）时，除第一条接线门禁外的全部用例都会失败。

import test from 'node:test';
import assert from 'node:assert/strict';
import {openBattle,enemy,byId,logOf,blackboard} from './effects-harness.mjs';
import {COLLAB_HOOKS,collabFor} from '../dist/native-collab.js';

const CHESS='chess_collab_kormr',CHAR='char_4220_kormr';
// 不带「攻击／命中／伤害／附带」关键词的等价文案（只用于挡掉 ★2 那条通用兜底，本模块不读文案）。
const NEUTRAL_TEXT='部署后对周围一定范围内最近的1名敌人发动总计6次无视闪避的斩击，最后一次斩击并使目标恐惧';

function near(actual,expected,message){
 assert.ok(Math.abs(actual-expected)<1e-6,`${message}：期望 ${expected}，实际 ${actual}`);
}
// 战斗单位＋一片干净的敌人战场（openBattle 已按开战流程布好干员并 start）。
function setup(){
 const {b}=openBattle({chessId:CHESS});
 const u=byId(b,CHAR);
 assert.ok(u,'虎狼丸应当在场上');
 b.s.enemies=[]; // 只留用例自己放的敌人，避免波次敌人影响「最近的一名人」
 return {b,u};
}
// 真实部署事件（重新落位，既有测试惯用写法）：天赋斩击就在这条链路的末尾结算。
const deploy=(b,u)=>b.deploy(u);
function blackboardOf(b,u){
 const talent=(b.profile(u).activeTalents||[]).find(t=>/黑色猎犬/.test(t.name||''));
 assert.ok(talent,'要取到「黑色猎犬」天赋');
 return {talent,values:blackboard(talent.blackboard)};
}
// 把虎狼丸 profile 上的「黑色猎犬」天赋替换成给定黑板／文案。
function patchTalent(b,u,{board,description}={}){
 const real=b.profile,base=real.call(b,u);
 const patched={...base,activeTalents:(base.activeTalents||[]).map(t=>/黑色猎犬/.test(t.name||'')
  ?{...t,...(board?{blackboard:board}:{}),...(description!=null?{description}:{})}:t)};
 b.profile=function(v){return v===u?patched:real.call(this,v);};
}
// 挡掉 ★2 的通用兜底：本模块只读黑板，所以换掉文案不影响它的结算。
const isolateGenericFallback=(b,u)=>patchTalent(b,u,{description:NEUTRAL_TEXT});
function damageLogs(b,e){return logOf(b,'damage').filter(row=>row.targetUid===e.uid);}
// 伤害日志里的 `hp` 是**本次结算实际打掉的生命值**，所以它逐条就是每一次斩击的伤害。
const slashDamages=(b,e)=>damageLogs(b,e).map(row=>row.hp);

test('接线门禁：战斗单位上的联动钩子按 id（＝charId）也能取到',()=>{
 const {b,u}=setup();
 assert.equal(u.charId,undefined,'战斗单位上没有 charId 字段（只有 id＝charId 与 source）');
 assert.ok(collabFor(u),'collabFor 必须认战斗单位的 id，否则七个联动钩子会一起静默失效');
 assert.equal(collabFor(u),COLLAB_HOOKS[CHAR]);
});

test('部署后对范围内最近的敌人发动 6 次斩击：前 5 次 atk_scale、最后一次 final_atk_scale',()=>{
 const {b,u}=setup();
 const atk=b.stats(u).atk,{values}=blackboardOf(b,u);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 deploy(b,u);
 const rows=damageLogs(b,e);
 assert.equal(rows.length,6,'总计 6 次，必须真的分 6 次结算');
 const perSlash=slashDamages(b,e);
 perSlash.forEach((value,index)=>near(value,atk*(index===5?values.final_atk_scale:values.atk_scale),`第 ${index+1} 次斩击`));
 near(100000-e.hp,atk*(5*values.atk_scale+values.final_atk_scale),'总掉血＝5×atk_scale＋1×final_atk_scale（法术、无抗性）');
 assert.ok(rows.every(row=>row.cause==='skill'),'斩击按技能伤害结算（不该被当成普攻去触发叙拉古那类附加）');
 assert.ok(rows.every(row=>!row.blocked));
});

test('最后一次斩击使目标恐惧：时长＝黑板 fear、来源＝虎狼丸',()=>{
 const {b,u}=setup();
 const {values}=blackboardOf(b,u);
 isolateGenericFallback(b,u); // 见文件头 ★2：不挡掉的话这条断言验不出是本模块发的
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 deploy(b,u);
 const fear=(e.statuses||[]).find(s=>s.kind==='fear');
 assert.ok(fear,'最后一次斩击后目标应当恐惧');
 near(fear.remaining,values.fear,'恐惧时长应等于黑板 fear');
 assert.equal(fear.remaining,4,'无潜能档的黑板 fear 是 4 秒');
 assert.equal(fear.source,u.uid,'恐惧来源应当是虎狼丸');
});

test('黑板里没有 fear 键就不发恐惧（不是写死的 4 秒）',()=>{
 const {b,u}=setup();
 const atk=b.stats(u).atk;
 patchTalent(b,u,{board:[{key:'atk_scale',value:1},{key:'final_atk_scale',value:2}],description:NEUTRAL_TEXT});
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 deploy(b,u);
 near(100000-e.hp,atk*7,'斩击照旧（5×1＋2）');
 assert.deepEqual((e.statuses||[]).filter(s=>s.kind==='fear'),[],'黑板没有 fear 键就不该挂恐惧');
});

test('普攻不该挂恐惧：恐惧只来自部署斩击的最后一下（★2 的门禁）',()=>{
 const {b,u}=setup();
 const atk=b.stats(u).atk;
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 b.hit(u,e,atk,'arts'); // 普攻口径：native-battle 的普通攻击就走这里
 near(100000-e.hp,atk,'普攻照常结算');
 assert.deepEqual((e.statuses||[]).filter(s=>s.kind==='fear'),[],'天赋里的 fear 键不该被当成「每次命中施加恐惧」');
});

test('范围内没有敌人时什么都不做，也不抛错',()=>{
 const {b,u}=setup();
 const far=enemy(b,{x:u.x+3,y:u.y,hp:100000}); // 曼哈顿距离 3：在天赋范围（x-1，距离 2）之外
 assert.doesNotThrow(()=>deploy(b,u));
 assert.equal(far.hp,100000,'范围外的敌人不该掉血');
 assert.equal(damageLogs(b,far).length,0,'不该有任何结算');
 assert.deepEqual(far.statuses,[],'也不该挂恐惧');
});

test('范围内有多名敌人时只打最近的那一名',()=>{
 const {b,u}=setup();
 const nearest=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 const farther=enemy(b,{x:u.x+2,y:u.y,hp:100000}); // 同在 x-1 内（曼哈顿距离 2），但更远
 deploy(b,u);
 assert.ok(nearest.hp<100000,'最近的敌人应当挨打');
 assert.equal(farther.hp,100000,'同样在范围内、但更远的那名不该挨打');
 assert.equal(damageLogs(b,farther).length,0);
 assert.deepEqual(farther.statuses,[],'更远的敌人也不该被恐惧');
});

test('无视闪避：目标有 100% 未被阻挡闪避时 6 次斩击仍全额命中，且闪避值全程不动',()=>{
 const {b,u}=setup();
 const atk=b.stats(u).atk,{values}=blackboardOf(b,u);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000,enemyUnblockedDodge:1,block:null}); // 幻影／虚影那类敌人
 b.economy.random=()=>0; // 只要闪避还参与判定，这一掷必定闪避
 // 走的是共享层的正式开关（`dealDamage({ignoreDodge:true})`）：以前靠在 6 次斩击期间把目标闪避压 0
 // 再写回来绕过，现在整段闪避判定直接跳过——所以「值原样」是**全程没被改过**，不是写回的功劳。
 deploy(b,u);
 assert.equal(logOf(b,'evade').length,0,'不该出现任何闪避记录');
 assert.equal(slashDamages(b,e).length,6,'6 次都要真的打出去（闪避不该吃掉任何一次）');
 near(100000-e.hp,atk*(5*values.atk_scale+values.final_atk_scale),'应当全额命中');
 assert.equal(e.enemyUnblockedDodge,1,'目标自己的闪避值全程没被动过');
 // 对照组：同一发伤害不走这个开关时会被 100% 闪避吃掉。
 const plain=enemy(b,{x:u.x+2,y:u.y,hp:100000,enemyUnblockedDodge:1,block:null});
 b.hit(u,plain,1000,'arts',{skill:true});
 assert.equal(plain.hp,100000,'没有 ignoreDodge 的命中会被闪避');
 assert.ok(logOf(b,'evade').length>=1);
});

test('数值只从 activeTalents 黑板读：改黑板后伤害与恐惧时长同步变化',()=>{
 const {b,u}=setup();
 patchTalent(b,u,{board:[{key:'atk_scale',value:.5},{key:'final_atk_scale',value:3},{key:'fear',value:7}],description:NEUTRAL_TEXT});
 const atk=b.stats(u).atk,e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 deploy(b,u);
 near(100000-e.hp,atk*(5*.5+3),'总伤害应跟着黑板走（不是写死的 1／2）');
 assert.deepEqual(slashDamages(b,e),[atk*.5,atk*.5,atk*.5,atk*.5,atk*.5,atk*3],'逐次伤害也按新黑板走');
 const fear=(e.statuses||[]).find(s=>s.kind==='fear');
 near((fear||{}).remaining,7,'恐惧时长应跟着黑板走（不是写死的 4）');
});

test('黑板缺 atk_scale／final_atk_scale 时不给这个能力',()=>{
 const {b,u}=setup();
 patchTalent(b,u,{board:[{key:'fear',value:4}],description:NEUTRAL_TEXT});
 const e=enemy(b,{x:u.x+1,y:u.y,hp:100000});
 deploy(b,u);
 assert.equal(e.hp,100000,'缺伤害倍率就不该斩击');
 assert.deepEqual(e.statuses,[],'更不该发恐惧');
});

test('范围取天赋自己的 rangeId（x-1＝曼哈顿距离 2 的 13 格），不是包围半径／基础攻击范围',()=>{
 const {b,u}=setup();
 const {talent}=blackboardOf(b,u);
 assert.equal(talent.rangeId,'x-1','天赋自带的 rangeId 要一起用');
 assert.equal((b.cellsForRangeId(u,'x-1')||[]).length,13,'x-1 是 13 格');
 assert.ok((b.range(u).cells||[]).length<13,'基础攻击范围只有自身格＋身前一格，与天赋范围不是一回事');
 const diagonal=enemy(b,{x:u.x+1,y:u.y+1,hp:100000}); // 斜角，曼哈顿距离 2
 deploy(b,u);
 assert.ok(diagonal.hp<100000,'范围内的斜角敌人照样会挨打');
});

test('目标在斩击途中被击倒时不再继续结算，也不给尸体挂恐惧',()=>{
 const {b,u}=setup();
 const atk=b.stats(u).atk;
 isolateGenericFallback(b,u);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:atk+10}); // 只够吃一次斩击
 deploy(b,u);
 assert.ok(e.hp<=0,'目标应被击倒');
 assert.equal(damageLogs(b,e).length,2,'第一次把它打倒，第二次结算完就停手');
 assert.deepEqual(slashDamages(b,e),[atk,10],'第二次只结算剩余生命');
 assert.deepEqual((e.statuses||[]).filter(s=>s.kind==='fear'),[],'已阵亡的目标不该挂恐惧');
});
