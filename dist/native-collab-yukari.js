// 岳羽由加莉 char_4219_yukari（5 星辅助／游击手，联动隐藏档 chess_collab_yukari）
//
// 天赋「治愈之风」（数值从 profile.activeTalents 黑板读，无潜能档 max_target=3、heal_scale=1）：
//   技能结束后，治疗**自身**和攻击范围内最多 `max_target` 名干员相当于攻击力 `heal_scale` 的生命值。
//   选取口径：候选＝（攻击范围内的我方干员 ∪ 自身），满血的**非自身**目标不入选，自身永远可选；
//   按生命比例升序取前 `max_target` 名（`max_target` 是含自身的**总目标数**上限），治疗量恒为
//   攻击力 × `heal_scale`（满血的自身会被选中但治疗量为 0）。
// 分支「游击手」（supportiveranger，PRTS 分支特性：可以使用触发型效果协助作战；可对空）——「可对空」
//   由 native-branches 的分支表负责；本客户端的第一个触发型效果就是她的 S2，钩子挂在 hooks.event 的
//   'skill-start' 上（监听友军开技）。
//
// S1「龙卷箭」（瞬发；专三 multi_atk_scale=0.8、final_atk_scale=4、levitate=1.5）：
//   立即发射三发箭矢，每发对目标造成 `multi_atk_scale` 攻击力的**法术**伤害，
//   随后追加一次 `final_atk_scale` 攻击力的**范围**法术伤害，并**浮空**所有被这次范围伤害打到的目标
//   `levitate` 秒。溅射半径 1.1 来自 PRTS 干员页技能备注「※浮空法术伤害半径1.1（碰撞判定）」，
//   所以按「敌方单位与主目标的中心距离」做圆判定（Math.hypot），不是方格半径。
// S2「明镜止水」（瞬发；专三 max_target=4、duration=15、damage_up=0.3）：
//   为范围内最多 `max_target` 名我方干员（**优先结城理、其次术师干员**）施加触发型效果：
//   该干员施放技能后，自身在 `duration` 秒内获得 `damage_up` 的**术法充盈**。
//   选取次序：① `char_4217_makoto`（结城理）→ ② `profession==='CASTER'` → ③ 其余按部署先后
//   （`deployAt` 升序，同一帧按 uid 升序）。触发型效果存在接收者自己的 `unit.yukariTriggers`
//   （同来源去重、覆盖刷新），开技时消费一次并转成 `unit.yukariArcane={until,value,sourceUid}`
//   ＋一条 `magicArcane` 状态（时长交给状态表逐帧走）。
//   **2026-09-27 更新**：共享层补了「任意干员增伤」通道——`native-operator-effects.attackModifier` 会读
//   任何伤害来源的 `unit.yukariArcane` 窗口并按 (1+damage_up) 乘算，所以友军吃到的术法充盈现在真的进结算
//   （以前只有由加莉自己作为伤害来源时才算）；本文件只负责写／清窗口。
//
// 回归：tests/native-collab-yukari.test.mjs
import {blackboard} from './protocol.js';

const MAKOTO_CHAR='char_4217_makoto';
// 术法充盈在客户端里的状态名（原表术语 ba.magicarcane）与触发型效果的登记名。
const ARCANE_STATUS='magicArcane';
const TRIGGER_ID='yukari-magicarcane';
// PRTS 干员页 S1 备注：浮空法术伤害半径 1.1（碰撞判定）。
const S1_SPLASH_RADIUS=1.1;

function skillRows(battle,unit){return blackboard(battle.profile(unit)?.skill?.blackboard);}
function talentRows(battle,unit){
 const talent=(battle.profile(unit)?.activeTalents||[]).find(t=>t.name==='治愈之风');
 return talent?blackboard(talent.blackboard):null;
}
function skillIndex(battle,unit){return battle.profile(unit)?.skillIndex??unit.source?.skillIndex??0;}
function attackOf(battle,unit){return Number(battle.stats(unit).atk)||0;}
function isOperator(v){return !!v&&v.kind!=='summon'&&!v.neutral&&v.deployed&&v.hp>0;}

// 天赋「治愈之风」：技能结束后治疗自身与攻击范围内生命比例最低的至多 max_target 名干员。
function windOfHealing(battle,unit,ctx){
 const rows=talentRows(battle,unit);
 if(!rows)return [];
 const maxTarget=Math.max(0,Math.trunc(Number(rows.max_target)||0)),scale=Number(rows.heal_scale)||0;
 if(!maxTarget||!(scale>0))return [];
 const power=attackOf(battle,unit)*scale;
 const pool=battle.s.units.filter(v=>isOperator(v)&&battle.canHeal(v,unit)&&battle.inside(unit,v,false)&&(v.uid===unit.uid||v.hp<v.maxHp-1e-9))
  .sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.uid-b.uid)
  .slice(0,maxTarget);
 for(const v of pool)ctx.applyHeal(battle,{source:unit,target:v,amount:power});
 ctx.log?.(battle,'yukari-talent-heal',{uid:unit.uid,maxTarget,scale,amount:power,targets:pool.map(v=>v.uid)});
 return pool;
}

// S1「龙卷箭」：3 发单体的 multi_atk_scale 法术伤害 + 1 次 final_atk_scale 的范围法术伤害（半径 1.1）＋浮空。
function tornadoArrow(battle,unit,ctx,rows){
 const multi=Number(rows.multi_atk_scale)||0,final=Number(rows.final_atk_scale)||0,levitate=Number(rows.levitate)||0;
 const power=attackOf(battle,unit),primary=battle.targets(unit)[0];
 if(!primary)return [];
 for(let n=0;n<3;n++)battle.hit(unit,primary,power*multi,'arts',{skill:true});
 const splash=battle.s.enemies.filter(v=>v.hp>0&&!v.hidden&&!v.untargetable&&Math.hypot((v.x??0)-primary.x,(v.y??0)-primary.y)<=S1_SPLASH_RADIUS+1e-9);
 for(const v of splash)battle.hit(unit,v,power*final,'arts',{skill:true});
 if(levitate>0)for(const v of splash){
  const resistance=Math.min(1,Math.max(0,Number(v.statusResistance)||0)),effective=levitate*(1-resistance);
  if(!(effective>0))continue;
  ctx.applyStatus(v,'levitate',levitate,{source:unit.uid});
  // 共享兜底（native-operator-effects 的 after-damage 分支：技能文案含「浮空」就按
  // `bb.floating ?? bb.duration ?? 2` 挂浮空，见该文件 653 行）在她身上读不到键、会按 2 秒刷新
  // 同来源的浮空，比原表的 levitate 值长；本文件只把这一条压回原表时长（共享文件的兜底读键错误
  // 属于本轮改动范围之外，已在交接报告里列成未闭环项）。
  const row=(v.statuses||[]).find(t=>t.kind==='levitate'&&t.source===unit.uid);
  if(row)row.remaining=Math.min(row.remaining,effective);
 }
 ctx.log?.(battle,'yukari-tornado-arrow',{uid:unit.uid,primaryUid:primary.uid,splashUids:splash.map(v=>v.uid),multi,final,levitate});
 return splash;
}

// S2「明镜止水」：给范围内最多 max_target 名我方干员挂上「施放技能后获得术法充盈」的触发型效果。
function mirrorCalm(battle,unit,ctx,rows){
 const maxTarget=Math.max(0,Math.trunc(Number(rows.max_target)||0)),duration=Number(rows.duration)||0,damageUp=Number(rows.damage_up)||0;
 if(!maxTarget||!(duration>0))return [];
 const rank=v=>v.id===MAKOTO_CHAR?0:(battle.profile(v)?.profession==='CASTER'?1:2);
 const chosen=battle.s.units.filter(v=>isOperator(v)&&battle.inside(unit,v,true))
  .sort((a,b)=>rank(a)-rank(b)||(a.deployAt??0)-(b.deployAt??0)||a.uid-b.uid)
  .slice(0,maxTarget);
 for(const v of chosen){
  const kept=(v.yukariTriggers||[]).filter(t=>t.sourceUid!==unit.uid);
  // atSkillCount＝施加瞬间接收者的开技次数：接收者**下一次**开技时 skillCount 已经自增，
  // 所以「同一帧里施法者自己」不会立刻消费掉刚挂上的效果。
  kept.push({id:TRIGGER_ID,sourceUid:unit.uid,damageUp,duration,atSkillCount:v.skillCount??0});
  v.yukariTriggers=kept;
 }
 ctx.log?.(battle,'yukari-mirror-calm',{uid:unit.uid,maxTarget,duration,damageUp,targets:chosen.map(v=>v.uid)});
 return chosen;
}

// 触发型效果：接收者开技 → 消费一次 → duration 秒的术法充盈（状态 + 窗口）。
function consumeTriggers(battle,caster,ctx){
 const list=caster.yukariTriggers;
 if(!Array.isArray(list)||!list.length)return [];
 const count=caster.skillCount??0,fired=list.filter(t=>t.atSkillCount!==count);
 if(!fired.length)return [];
 caster.yukariTriggers=list.filter(t=>t.atSkillCount===count);
 for(const eff of fired){
  const duration=Number(eff.duration)||0,value=Number(eff.damageUp)||0;
  if(!(duration>0))continue;
  const until=battle.s.time+duration;
  caster.yukariArcane={until,value,sourceUid:eff.sourceUid};
  ctx.applyStatus(caster,ARCANE_STATUS,duration,{source:eff.sourceUid,value,resistible:false});
  ctx.log?.(battle,'yukari-magicarcane',{uid:caster.uid,fromUid:eff.sourceUid,until,value,duration});
 }
 return fired;
}

export const yukariHooks={
 statMods(battle,unit,out){/* 治愈之风与两个技能都不改面板（术法充盈是伤害倍率，见 attackModifier），故空实现 */ },
 // skillStart(battle,unit,ctx)：开技那一帧。S1 的伤害链、S2 的施加都在这里落地，并压制通用开技兜底
 // （兜底会把 multi_atk_scale／final_atk_scale 里的 `atk_scale` 当唯一倍率打一发，S2 更会按 max_target 白打四下）。
 skillStart(battle,unit,ctx){
  const index=skillIndex(battle,unit),rows=skillRows(battle,unit);
  if(index===0)tornadoArrow(battle,unit,ctx,rows);
  else if(index===1)mirrorCalm(battle,unit,ctx,rows);
  else return false;
  // 「技能结束后」的治疗：她的两个技能都是瞬发（duration=-1、skillLeft 恒为 0），
  // 客户端只在「持续/弹药技能结束」那一帧派发 skill-end，所以瞬发走逐帧钩子的下一帧，
  // 持续型技能才等真正的 skill-end 事件。
  if(battle.skillActive?.(unit))unit.yukariTalentPending=true;
  else unit.yukariHealAt=battle.s.time;
  return true;
 },
 // event(battle,unit,type,payload,ctx)：监听者视角（unit 是持有钩子的岳羽由加莉，payload.target 才是当事人）。
 event(battle,unit,type,payload,ctx){
  if(type==='skill-start'&&payload?.target)consumeTriggers(battle,payload.target,ctx);
  else if(type==='skill-end'&&payload?.target===unit&&unit.yukariTalentPending){
   unit.yukariTalentPending=false;
   windOfHealing(battle,unit,ctx);
  }
  // 离场（commitExit 的 'exit'）要把挂在她身上的触发型效果与窗口一起丢掉，
  // 否则再部署回来还会带着上一世的术法充盈（deploy() 的本名重置表动不了，只能在这里清）。
  else if(type==='exit'&&payload?.target){
   const t=payload.target;
   if(t.yukariTriggers)t.yukariTriggers=[];
   t.yukariArcane=null;t.yukariHealAt=null;t.yukariTalentPending=false;
  }
 },
 // tick(battle,unit,ctx)：瞬发技能的「技能结束后」在这里补结算（下一帧，此时伤害链已走完），
 // 并清掉过期的术法充盈窗口字段（状态表的计时是权威，这里只做字段卫生）。
 tick(battle,unit,ctx){
  if(unit.yukariHealAt!=null&&battle.s.time>=unit.yukariHealAt-1e-9){
   unit.yukariHealAt=null;
   windOfHealing(battle,unit,ctx);
  }
  if(unit.yukariArcane&&battle.s.time>=unit.yukariArcane.until)unit.yukariArcane=null;
 },
 // 术法充盈的增伤**不在这里算**（2026-09-27 起共享层有了通用通道）：`native-operator-effects.attackModifier`
 // 会读**任何伤害来源**的 `unit.yukariArcane` 窗口，所以友军吃到的术法充盈也会真的进伤害。
 // 本文件只负责写窗口、清窗口（consumeTriggers／tick／exit），乘算留给那一条通道，避免同一份加成算两遍。
};
