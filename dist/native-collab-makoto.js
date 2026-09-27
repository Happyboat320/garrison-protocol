// 结城理 char_4217_makoto（6 星特种／傀儡师，联动隐藏档 chess_collab_makoto）
//
// 傀儡师的替身机制在本客户端已有实现：native-effects 的 tickDoll／enterDoll 维护 `actor.dollForm={until,nextAt}`（20 秒，
// 来自特性黑板 duration），native-fx 的 drawDollOverlay 只画表现。结城理要在此之上加**人格面具**：
// 游戏数据里人格面具不是独立单位，攻击档案全挂在三个技能的黑板 `attack@*` 上。
//
// 天赋一「不羁之力」（profile.activeTalents 里带 sluggish 的那条；无潜能 PHASE_2：atk=.8、base_attack_time=.4（加算）、
//   sluggish=8、max_hp_t1=.35）：
//   ① 切换为替身状态时，停顿周围一定范围内敌人 sluggish 秒；
//   ② 替身状态下攻击力 +atk、生命值 +max_hp_t1、攻击间隔 +base_attack_time（乘算/加算口径按黑板 key 字面：
//      atk／max_hp_t1 是比例，base_attack_time 是**加算的秒数**）。
// 天赋二「S.E.E.S. 总攻击」（带 atk_scale 的那条；无潜能 PHASE_2 atk_scale=4.3）：
//   替身状态结束后，带领 S.E.E.S. 小队发动总攻击，对小队队员（teamId==='sees'）周围一定范围内所有敌人
//   造成结城理攻击力 × atk_scale 的**真实伤害**（可叠加）。
//
// 三个技能都是「被动：替身状态召唤某个人格面具；主动：立即切换为替身状态作战」（持续 0 秒，切换即结束）：
//   S1 俄耳甫斯        ：攻击造成 attack@atk_scale 法术伤害；范围内有生命 <50% 的友方干员时改为治疗其 attack@heal_scale。
//                        专三：atk_scale=2.8、heal_scale=0.6。PRTS 备注：**不可对空**。
//   S2 塔纳托斯        ：攻击对至多 attack@max_target 名敌人造成 attack@atk_scale 法术伤害并有 attack@prob 概率恐惧
//                        attack@fear 秒；范围内**恐惧中**的敌人若生命值低于结城理攻击力 × attack@kill_atk_scale
//                        则立刻倒下（attack@kill_damage=9999999 无来源真实伤害；斩杀光环**可对空**）。
//                        专三：max_target=4、atk_scale=2.5、prob=.35、fear=1.5、kill_atk_scale=2.8。
//   S3 塔纳托斯·改     ：替身状态初始召唤塔纳托斯·改，攻速 +talent@attack_speed，攻击对至多 attack@max_target 名敌人
//                        造成 attack@atk_scale 的**弱点伤害**；在场时开启技能或受到致命伤改为召唤俄耳甫斯·改，
//                        阻挡数 +attack@block_cnt(=2)，使范围内友方干员获得 attack@prob 物理与法术闪避，
//                        并每秒治疗范围内最多 attack@max_target_heal 名友方干员 attack@heal_scale 的生命值，
//                        直到替身状态结束。专三：attack_speed=60、atk_scale=2.3、heal_scale=.35、prob=.4、
//                        max_target=4、max_target_heal=4。PRTS 备注：塔纳托斯·改**普通攻击可对空**（已登记在 SKILL_ANTIAIR）。
//
// 回归：tests/native-collab-makoto.test.mjs（新文件，必须验证「改回本文件前会失败」）
//
// ── 接线口径（钩子只有这些，能落地的与落不了地的都写在这里） ────────────────────────────────────────
// 只能依赖纯模块（protocol／status／targeting）。native-effects／native-operator-effects／native-battle 都是本模块的
// 上游，反向 import 会成环（native-collab.js 顶部说明）；需要「结算」的动作一律用钩子收到的 ctx
// （dealDamage／applyHeal），状态用 status.js 的纯函数 applyStatus。
//
//  · hooks.statMods ← native-operator-effects.statMods（每次 battle.stats() 逐帧调用）
//      - 替身形态：攻击力 ×(1+atk)、生命上限 ×(1+max_hp_t1)、攻击间隔 +base_attack_time、S3 的攻速 +talent@attack_speed。
//      - ⚠ 通用天赋通道（native-operator-effects.statMods 的 `direct(text,'攻击力')`）会把不羁之力的 `atk` 当成
//        **常驻**加成（文案是「，攻击力+80%」，被 `direct` 匹配上），也就是基础形态也吃 +80%。本文件在**非替身形态**
//        用一个负项把它抵消掉，回到「只有替身形态才 +80%」的原口径；这条耦合写在未闭环清单里。
//      - 攻击间隔的加算没有独立通道（stats() 的 `baseAttackTime` 不读 extra），只能换算到 `attackSpeed` 通道：
//        目标间隔 (base+add)、引擎算 base*100/as，所以 as 增量 = (as+bonus)·(base/(base+add)−1)。
//      - `attack@block_cnt` 加了也没有用：stats() 在 `if(u.dollForm)` 分支最后把 blockCnt 强制归 0。
//  · hooks.attackModifier ← native-operator-effects.attackModifier（在 native-battle.hit() 里，逐目标逐次命中）
//      - 人格面具的攻击倍率 attack@atk_scale；S2 的恐惧概率；S1「改为治疗」时把这次伤害压到 0（治疗在 tick 里结算）。
//      - 伤害**类型**改不了：命中类型由 native-battle.baseDamageType()/behavior() 决定，替身形态固定走分支的物理，
//        本钩子只能改数值（未闭环）。
//  · hooks.skillStart ← native-operator-effects.operatorSkillStart（dispatch('skill-start')）
//      - 技能的主动部分是「立即切换为替身状态作战」：真正进入替身形态走 native-effects.runFatal 的傀儡师分支
//        （`branch==='dollkeeper'&&!dollForm → enterDoll`），用 `ctx.dealDamage` 对自身造成致死真实伤害触发；
//        enterDoll 是模块私有函数、也没进 ctx，这是唯一不改上游的进入路径。
//      - 切换**延后到下一帧的 tick**：activate() 在本钩子返回之后才写技能级的对空窗口 `u.skillAir`，而替身形态的
//        behavior() 无条件 antiAir:false；同一帧切换会把那一帧的对空窗口打掉（tests/native-air-targeting.test.mjs 的两条门禁）。
//      - 返回 true ⇒ suppressDefault，压掉通用「瞬时技能按 atk_scale 打伤害」的兜底（否则 S1 会对 999 个目标白打一发 2.8×）。
//  · hooks.tick ← native-effects.tickLogic 的 collabTick（每帧、每个单位）
//      - 替身形态的进入/结束都**没有**派发事件（enterDoll 直接调 onOperatorExit，不经 dispatch；tickDoll 直接
//        `u.dollForm=null` 并把 'selfdead' 发给卫戍的 battle.event），所以只能在本钩子里比对 dollForm 的
//        未生效→生效 / 生效→未生效跳变来识别：前者挂天赋一的停顿并同步血上限，后者触发天赋二的总攻击。
//      - S1 的治疗、S2 的斩杀复查、S3 的闪避光环与每秒治疗都在这里按各自间隔结算。
//  · hooks.event ← native-effects.dispatch → collabEvent
//      - 目前只用于「重新部署时清掉本干员的替身运行态」（dispatch('deploy')）。
//
// ── 未闭环（数据/引擎能力所限，别当成已实现） ────────────────────────────────────────────────────
//  1. 人格面具的**伤害类型**（S1/S2 法术、S3 弱点伤害）无法从本文件切换，命中仍按替身形态的物理属性结算
//     （baseDamageType → behavior().damageType，替身分支固定 `u.id==='char_4016_kazema'?'arts':base.damageType`）。
//     倍率（attack@atk_scale）本身是生效的。
//  2. `attack@max_target`／`attack@max_target_heal` 里的**攻击目标数**：进攻目标数是 native-battle.targets() 里
//     按分支/天赋文案算的，没有联动钩子；引擎的替身形态 style 仍是 single，一次只打 1 名敌人。
//     S3 的 max_target_heal（治疗目标数）已按黑板生效。
//  3. 攻击间隔 +base_attack_time 是**换算到攻速通道**的近似（帧取整 + 其他攻速来源会带来偏差），不是引擎级的
//     间隔加算；S3 同时 +60 攻速时数值与「(1.2+0.4)×100/160」有出入。
//  4. S3 的 `attack@block_cnt`：替身形态阻挡数被 stats() 强制为 0，加了也不生效。
//  5. S3 的「物理**与法术**闪避」只落地了物理那一半：injured 管线（native-battle.hurt）里只有
//     `u.physicalEvadeUntil/physicalEvadeProb`（物理）与需要 skillActive 的 `u.skillEvasionProb`；
//     0 秒技能 skillActive 永远为假，法术闪避没有通道。
//  6. S3 的「塔纳托斯·改在场时，开启技能或受到致命伤改为召唤俄耳甫斯·改」：替身形态下 native-battle.activate()
//     开头就 `if(u.dollForm)return`，runFatal 的傀儡师分支也要求 `!target.dollForm`，两条路都被引擎堵死。
//  7. 替身形态**对空**：behavior() 在替身分支固定 `antiAir:false`，SKILL_ANTIAIR 的 `u.skillAir` 只在技能持续期内
//     生效（本干员三个技能 duration 都是 0），所以 S2 斩杀光环的「可对空」和 S3 普攻的「可对空」都没落地。
//  8. 「进入替身」走的是真实致死管线，所以会被护盾/屏障先吃掉一部分伤害（本文件按 hp+shield+1 的倍数给量，
//     一般够用），也会在战报里留一条 knockdown 记录。
//  9. 天赋一的 `atk` 与**通用天赋通道**耦合：`direct(text,'攻击力')` 会把「，攻击力+80%」当成常驻加成，本文件
//     只能在非替身形态用负项抵消（数据包里结城理只有 `chess_collab_makoto` 一个 phase 2 形态，已核对
//     `direct` 判定为真）。将来通用通道改成按形态判定，这里的负项就会变成重复扣减。
import {blackboard} from './protocol.js';
import {applyStatus} from './status.js';

const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
const bbOf=entries=>blackboard(entries);
// 天赋按**黑板 key 特征**定位，不按名字，也不按槽位：改原表数值／改名都不需要动本文件。
function talentBB(battle,unit,keys){
 for(const talent of battle.profile(unit)?.activeTalents||[]){
  const bb=bbOf(talent.blackboard);
  if(keys.every(key=>bb[key]!=null))return bb;
 }
 return null;
}
// 天赋一「不羁之力」：sluggish（停顿秒数）＋ base_attack_time（攻击间隔加算秒数）＋ atk／max_hp_t1。
const unboundedTalent=(battle,unit)=>talentBB(battle,unit,['sluggish','base_attack_time']);
// 天赋二「S.E.E.S. 总攻击」：atk_scale（真实伤害倍率）＋ range_id（队员周围的范围）。
const seesTalent=(battle,unit)=>talentBB(battle,unit,['atk_scale','range_id']);
// 当前人格面具＝当前选中技能的黑板（三个技能的档案都挂在技能黑板上）。
const personaBB=(battle,unit)=>bbOf(battle.profile(unit)?.skill?.blackboard);
// 人格面具按 key 特征区分（不按技能下标）：恐惧/斩杀 → 塔纳托斯；攻速/阻挡/治疗上限 → 塔纳托斯·改；其余 → 俄耳甫斯。
function personaKind(bb){
 if(bb['attack@kill_damage']!=null||bb['attack@kill_atk_scale']!=null||bb['attack@fear']!=null)return 's2';
 if(bb['talent@attack_speed']!=null||bb['attack@block_cnt']!=null||bb['attack@max_target_heal']!=null)return 's3';
 return 's1';
}
const inRange=(battle,unit,target)=>battle.inside(unit,target,true);
// 「友方干员」不含召唤物。
const operatorAllies=battle=>battle.s.units.filter(v=>v.deployed&&v.hp>0&&v.kind!=='summon');
const hasStatus=(target,kind)=>(target.statuses||[]).some(s=>s.kind===kind);
// 替身形态的攻击间隔（秒）：技能黑板给了 attack@interval 就用它，否则按 (基础间隔+加算)×100/攻速 还原。
function personaInterval(battle,unit,bb){
 const explicit=num(bb['attack@interval']);
 if(explicit>0)return explicit;
 const attrs=battle.profile(unit).attributes||{},base=num(attrs.baseAttackTime),speed=num(attrs.attackSpeed)||100;
 const t1=unboundedTalent(battle,unit),add=t1?num(t1.base_attack_time):0;
 const bonus=num(bb['talent@attack_speed']);
 return base>0?Math.max(.05,(base+add)*100/(speed+bonus)):1;
}
// enterDoll 里的 `u.hp=u.maxHp=battle.stats(u).maxHp` 是在 hp<=0 时算的，而 statMods 在 hp<=0 时直接返回
// （native-operator-effects.statMods 的开头守卫），所以替身形态的生命上限加成拿不到——这里按同一比例补一次。
function syncDollHp(battle,unit){
 const max=num(battle.stats(unit).maxHp);
 if(!(max>0))return;
 const before=num(unit.maxHp),ratio=before>0?Math.min(1,Math.max(0,num(unit.hp)/before)):1;
 unit.maxHp=max;unit.hp=Math.max(1,Math.min(max,Math.round(max*ratio)));
}
// S1「范围内有生命值低于 N% 的友方干员时改为治疗」：N 写在技能文案里（`生命值低于<@ba.vup>50%</>`），
// 从文案里取，取不到才退回 50%。
function s1HealRatio(battle,unit){
 const text=String(battle.profile(unit)?.skill?.description||'');
 const match=text.match(/生命值低于[^\d%]*(\d+(?:\.\d+)?)\s*%/);
 return Math.min(1,Math.max(0,(match?Number(match[1]):50)/100));
}
function lowestWoundedAlly(battle,unit,ratio){
 let best=null;
 for(const ally of operatorAllies(battle)){
  if(ally.hp>=ally.maxHp)continue;
  if(ally.maxHp>0&&ally.hp/ally.maxHp>=ratio)continue;
  if(!inRange(battle,unit,ally))continue;
  if(!best||ally.hp/ally.maxHp<best.hp/best.maxHp||(ally.hp/ally.maxHp===best.hp/best.maxHp&&ally.uid<best.uid))best=ally;
 }
 return best;
}
// 天赋二：替身状态结束后，每个 S.E.E.S. 队员（teamId==='sees'）周围 range_id 范围内的所有敌人各吃一发
// 结城理攻击力 × atk_scale 的真实伤害（可叠加：敌人落在两名队员的范围内就吃两发）。
function seesTotalAttack(battle,unit,ctx){
 const talent=seesTalent(battle,unit);
 if(!talent)return;
 const scale=num(talent.atk_scale);
 if(!(scale>0))return;
 const rangeId=String(talent.range_id||'');
 const atk=num(battle.stats(unit).atk);
 if(!(atk>0))return;
 const inZone=(member,enemy)=>rangeId&&battle.garrisonInRange?battle.garrisonInRange(member,rangeId,enemy):inRange(battle,member,enemy);
 const members=battle.s.units.filter(v=>v.deployed&&v.hp>0&&battle.profile(v)?.teamId==='sees');
 for(const member of members)for(const enemy of battle.s.enemies){
  if(enemy.hp<=0||enemy.hidden||enemy.invulnerable||enemy.untargetable)continue;
  if(!inZone(member,enemy))continue;
  ctx.dealDamage(battle,{source:unit,target:enemy,amount:atk*scale,type:'true',cause:'talent'});
 }
}
// S1：按替身形态的攻击间隔，治疗范围内生命最低且低于阈值的那名友方干员。
function tickOrpheus(battle,unit,bb,ctx){
 const target=lowestWoundedAlly(battle,unit,s1HealRatio(battle,unit));
 if(!target)return;
 const now=battle.s.time;
 if(num(unit.makotoNextHealAt)>now)return;
 unit.makotoNextHealAt=now+personaInterval(battle,unit,bb);
 const amount=num(battle.stats(unit).atk)*num(bb['attack@heal_scale']);
 if(amount>0)ctx.applyHeal(battle,{source:unit,target,amount});
}
// S2：斩杀复查——范围内处于恐惧中、生命值低于 攻击力×kill_atk_scale 的敌人立刻倒下（无来源真实伤害）。
function tickThanatos(battle,unit,bb,ctx){
 const threshold=num(battle.stats(unit).atk)*num(bb['attack@kill_atk_scale']);
 const damage=num(bb['attack@kill_damage']);
 if(!(threshold>0)||!(damage>0))return;
 for(const enemy of battle.s.enemies){
  if(enemy.hp<=0||enemy.hidden||enemy.invulnerable||enemy.untargetable)continue;
  if(!(enemy.hp<threshold))continue;
  if(!hasStatus(enemy,'fear'))continue;
  if(!inRange(battle,unit,enemy))continue;
  ctx.dealDamage(battle,{source:null,target:enemy,amount:damage,type:'true',cause:'talent'});
 }
}
// S3：范围内友方干员的物理闪避光环（逐帧续期，替身结束自然过期）＋ 每 attack@interval 秒治疗最多
// attack@max_target_heal 名友方干员。
function tickThanatos2(battle,unit,bb,ctx){
 const prob=num(bb['attack@prob']);
 if(prob>0)for(const ally of operatorAllies(battle)){
  if(!inRange(battle,unit,ally))continue;
  ally.physicalEvadeUntil=Math.max(num(ally.physicalEvadeUntil),battle.s.time+.5);
  ally.physicalEvadeProb=prob;
 }
 const scale=num(bb['attack@heal_scale']);
 const cap=Math.max(0,Math.trunc(num(bb['attack@max_target_heal'])));
 if(!(scale>0)||!cap)return;
 const now=battle.s.time;
 if(num(unit.makotoNextHealAt)>now)return;
 unit.makotoNextHealAt=now+personaInterval(battle,unit,bb);
 const amount=num(battle.stats(unit).atk)*scale;
 if(!(amount>0))return;
 const picks=operatorAllies(battle).filter(ally=>inRange(battle,unit,ally)&&ally.hp<ally.maxHp)
  .sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.uid-b.uid).slice(0,cap);
 for(const ally of picks)ctx.applyHeal(battle,{source:unit,target:ally,amount});
}

export const makotoHooks={
 // 天赋一的替身形态属性 + S3 的攻速。加成全部从 activeTalents／当前技能黑板里读。
 statMods(battle,unit,out){
  const talent=unboundedTalent(battle,unit);
  if(!talent)return;
  const atk=num(talent.atk);
  if(!unit.dollForm){
   // 抵消通用天赋通道把 `atk` 当常驻加成的那一份（见文件头的接线口径）。
   // 替身形态下不抵消也不重复加：通用通道那一份就是原口径的 +atk。
   if(atk)out.ratio.atk-=atk;
   return;
  }
  const maxHp=num(talent.max_hp_t1);
  if(maxHp)out.ratio.maxHp+=maxHp;
  const bb=personaBB(battle,unit),bonus=num(bb['talent@attack_speed']);
  if(bonus)out.attackSpeed+=bonus;
  // base_attack_time 是加算秒数，没有独立通道 → 换算成攻速通道的等价值。
  const attrs=battle.profile(unit).attributes||{},base=num(attrs.baseAttackTime),speed=num(attrs.attackSpeed)||100,add=num(talent.base_attack_time);
  if(base>0&&add>0)out.attackSpeed+=(speed+bonus)*(base/(base+add)-1);
 },
 // 人格面具的攻击档案：倍率一定生效；S2 附带恐惧；S1 在「该改为治疗」时把这次伤害压到 0。
 attackModifier(battle,unit,target,value){
  if(!unit.dollForm)return value;
  const bb=personaBB(battle,unit),kind=personaKind(bb);
  const scale=num(bb['attack@atk_scale']);
  let out=scale>0?value*scale:value;
  if(kind==='s1'&&lowestWoundedAlly(battle,unit,s1HealRatio(battle,unit)))out=0;
  if(kind==='s2'&&target){
   const prob=num(bb['attack@prob']),fear=num(bb['attack@fear']);
   if(prob>0&&fear>0&&battle.economy.random()<prob)applyStatus(target,'fear',fear,{source:unit.uid});
  }
  return out;
 },
 // 主动：「立即切换为替身状态作战」。用真实的致死管线触发傀儡师的替身分支，并压掉通用瞬时技能兜底。
 // ⚠ 切换**延后到下一帧的 tick**：activate() 在 dispatch('skill-start') 之前写了 `u.skillAir`（S3 登记过
 // 「普攻可对空」），而替身形态的 behavior() 无条件 `antiAir:false`；在同一帧切换会把那一帧的对空窗口弄没
 // （tests/native-air-targeting.test.mjs 的两条门禁就是这么红的）。延后一帧对玩法没有影响。
 skillStart(battle,unit,ctx){
  if(!unit.deployed||unit.hp<=0||unit.dollForm)return false;
  unit.makotoPersona=personaKind(personaBB(battle,unit));
  unit.makotoPendingDoll=true;
  return true;
 },
 // 重新部署时清掉替身运行态（替身形态不会跨部署保留，但运行态标记会）。
 event(battle,unit,type,payload){
  if(type==='deploy'&&payload?.target===unit){unit.makotoDoll=false;unit.makotoPendingDoll=false;unit.makotoNextHealAt=0;}
 },
 // 逐帧：替身形态的进入/结束跳变 + 各人格面具的周期结算。
 tick(battle,unit,ctx){
  if(!unit.deployed||unit.hp<=0){unit.makotoDoll=false;unit.makotoPendingDoll=false;return;}
  if(unit.makotoPendingDoll&&!unit.dollForm){
   unit.makotoPendingDoll=false;
   const lethal=(num(unit.hp)+num(unit.shield)+1)*4+1;
   ctx.dealDamage(battle,{source:unit,target:unit,amount:lethal,type:'true',cause:'skill',skill:true});
   if(unit.dollForm)syncDollHp(battle,unit);
  }
  const doll=!!unit.dollForm;
  if(doll&&!unit.makotoDoll){
   unit.makotoDoll=true;
   unit.makotoPersona=personaKind(personaBB(battle,unit));
   unit.makotoNextHealAt=0;
   // 天赋一①：切换为替身状态时停顿周围敌人 sluggish 秒。
   const talent=unboundedTalent(battle,unit),seconds=talent?num(talent.sluggish):0;
   if(seconds>0)for(const enemy of battle.s.enemies){
    if(enemy.hp<=0||enemy.hidden||enemy.invulnerable||enemy.untargetable)continue;
    if(!inRange(battle,unit,enemy))continue;
    applyStatus(enemy,'sluggish',seconds,{source:unit.uid,resistible:false});
   }
   syncDollHp(battle,unit);
  }
  if(!doll){
   if(unit.makotoDoll){unit.makotoDoll=false;seesTotalAttack(battle,unit,ctx);}
   return;
  }
  const bb=personaBB(battle,unit),kind=personaKind(bb);
  if(kind==='s2')tickThanatos(battle,unit,bb,ctx);
  else if(kind==='s3')tickThanatos2(battle,unit,bb,ctx);
  else tickOrpheus(battle,unit,bb,ctx);
 }
};
