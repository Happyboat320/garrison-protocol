// 埃癸斯 char_4218_aigis（5 星狙击／裂空炮手，联动隐藏档 chess_collab_aigis）
//
// 本文件只补**通用层没有覆盖**的部分。下面每一条都是先跑空实现实测出来的口径（2026-09-23），
// 不是照抄 PRTS 文案推断的「应该已实现」——见 tests/native-collab-aigis.test.mjs 的逐条回归。
//
// 天赋「反暗影特殊压制兵装」（数值从 battle.profile/activeTalentsOf 的黑板读，无潜能 PHASE_2：
//   damage_scale=1.1、damage_resistance=.1；PRTS 天赋备注「※分别于每次自身输出伤害时与受到伤害时触发，
//   提升/降低本次伤害的伤害倍率」——所以是**每一次伤害实例**的倍率，不只是普攻）：
//   · 造成侧：通用 attackModifier 的天赋循环只在文案出现「未被阻挡／被阻挡／空中目标／沉睡／重量小于等于／
//     生命值低于」时才乘系数，她的天赋一条都不沾 → 通用层不生效，必须在这里补（实测：普攻打 1000 → 1000）。
//     伤害类型不在钩子签名里（collabAttackModifier(battle,unit,target,value) 没有 type），所以按
//     `battle.baseDamageType(unit)` 判「这一击是不是物理」；陈策略带／弱点装备会在 hit() 结算前把类型改成
//     物理与法术里较大的那个，这一种情况属于已知近似（见交接报告）。
//   · 受到侧：通用伤害减免光环（native-operator-effects.damageReductionFor 的 `受到的物理伤害` 文案匹配，
//     target===source 时无条件生效）**已经覆盖**这一半（空实现下物理伤害也是 -10%）。这里按同一个黑板值
//     显式重述一遍，免得以后收窄通用文案匹配时天赋静默失效；返回值是「取最高」，不叠加。
//     已知共享层近似：那条光环不过滤伤害类型，所以法术伤害也会被 -10%（实测 1000 → 900）；真实伤害不受影响。
//
// S1「启动狂宴模式」（持续 20 秒；黑板 atk=1.4／def=0.7 是**加成比例**、stun=10）：
//   · 攻／防：`native-battle.stats` 的通用技能黑板分支（`ratio('atk', b.atk ?? cfg.bb.atk ?? 0, '技能')`）
//     已经按 +140%／+70% 生效（实测 atk 882→2116.8、def 219→372.3），**本文件不得再乘一次**（会变成 ×3.8）。
//   · 结束自晕：`native-effects.onSkillEnd` 的通用「技能结束后…晕眩 + 黑板 stun」分支已经覆盖
//     （实测 skill-end 后拿到 stun/10），也不再实现。
//   · 索敌（PRTS 技能备注：「※技能期间优先攻击自身阻挡的敌人，仅在未阻挡敌人的情况下进行随机攻击」）：
//     通用层把「随机攻击范围内的目标」实现成 `targets()` 里按 uid 哈希定序（`cfg.targetRule==='random'`），
//     既不是随机（同一批敌人永远同一个顺序）、也不优先被阻挡的敌人。这里在 tick 里借客户端已有的
//     「锁定单一目标」槽位 `unit.floatTarget` 每帧重选：阻挡时锁阻挡者，否则按 `battle.economy.random()`
//     在 `battle.targets(unit)` 里抽一个；技能结束时撤锁（不撤会留到技能外，破坏「非技能期只打空中与自身
//     阻挡的单位」的分支特性）。埃癸斯没有浮空（floatUnits）来源，这个槽位不会被别的机制争用。
// S2「全弹发射」（瞬时；黑板 times=6／atk_scale=1.6／kick_atk_scale=3）：
//   · 实测原来是**什么都没发生**：技能 duration=-1 → `skillKind()` 判成 'duration'，`skillTimeLeft()` 又是 0，
//     所以通用的「瞬发伤害」分支根本不走；而且裂空炮手 idle 时只打空中与自身阻挡，地面目标在 `targets()` 里恒为空。
//   · 这里在 skillStart 一次性结算：锁定 `targets()` 的第一个目标（瞬时技没有生效期，取目标那一帧临时把
//     `unit.skillLeft` 抬过 0 让分支的 airOnlyIdle 门打开，取完立刻还原），发射 `times` 枚导弹——每枚造成
//     攻击力 `atk_scale` 的物理伤害、伤害半径 1.1；随后一次飞踢，对目标及目标周围敌人造成攻击力
//     `kick_atk_scale` 的物理伤害、伤害半径 2.0，按 PRTS 备注「飞踢为一个独立的弹道，固定 0.12 秒后命中」
//     用 `ctx.queueDelayedDamage` 延后 0.12 秒结算（半径与延迟都只来自 PRTS 备注，黑板没有这两个字段）。
//   · 技能伤害走 `ctx.dealDamage`，不经过普攻通道的 attackModifier，所以天赋的 damage_scale 在这里显式乘一次。
//   · 返回 true 压制通用开技兜底（瞬时技的通用分支现在本来也不走，压制是为了以后通用层改动时不重复结算）。
// 返回 false 表示「不压制」：S1 的攻／防与结束自晕都由通用层负责，压制反而会把它们一起关掉。
//
// 分支「裂空炮手」已由 BRANCH_POLICIES.skybreaker 实现（可对空、非技能期只打空中与自身阻挡、技能期间溅射 1.1）；
// 两处**没做**、按分支登记仍是 pending 或需要动共享代码的，见交接报告：
//   · 「起飞／降落」（技能期间改成地面阻挡、可被地面敌人选中）——分支自己登记为 pending。
//   · S1 的伤害半径 PRTS 备注写 2.0，而现在技能期间统一吃分支的 1.1；要改得动 native-branches.js 的
//     `splashDuringSkill`（分支只按 (profile, skillActive) 取值，没有技能级覆盖的入口），不在本文件范围内。
//
// 回归：tests/native-collab-aigis.test.mjs（新文件；5 条新增行为的用例都验证过「改回空实现会失败」，
// 另有数据门禁与 2 条「通用层已覆盖、本文件不得重复实现」的用例）
import {blackboard} from './protocol.js';
import {permissions} from './status.js';
// 【塔尔塔罗斯】层数增幅（S.E.E.S. 策略专属；数值取 data.sees.numbers.aigisPerLayer）。
import {aigisLayerScale,seesRun,TARTARUS_BOND_ID} from './native-sees.js';

// PRTS 技能备注「全弹发射」：※技能的六发导弹弹道飞行速度均为10，伤害半径均为1.1
// ※技能的飞踢为一个独立的弹道，固定0.12秒后命中，伤害半径2.0。
const MISSILE_RADIUS=1.1,KICK_RADIUS=2,KICK_DELAY=.12;

const skillIndexOf=(battle,unit)=>battle.profile(unit)?.skillIndex??unit.source?.skillIndex??0;
// 天赋数值只从激活天赋的黑板取；用「黑板里有 damage_scale/damage_resistance」来定位，
// 不按天赋名硬匹配（改名不该让天赋失效），也不抄常量。
function talentBoard(battle,unit){
 const rows=battle.activeTalentsOf?battle.activeTalentsOf(unit):(battle.profile(unit)?.activeTalents||[]);
 for(const row of rows||[]){
  const values={...blackboard(row.blackboard||[]),...(row.values||{})};
  if(Number.isFinite(Number(values.damage_scale))||Number.isFinite(Number(values.damage_resistance)))return values;
 }
 return {};
}
const damageScaleOf=(battle,unit)=>{const value=Number(talentBoard(battle,unit).damage_scale);return Number.isFinite(value)&&value>0?value:1;};
const missileRadiusTargets=(battle,target,radius)=>battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.invulnerable&&!e.untargetable&&!permissions(e).sleeping&&Math.hypot(e.x-target.x,e.y-target.y)<=radius+1e-9);
function lockTarget(unit,uid){unit.floatTarget=uid;unit.aigisTargetLock=true;}
function clearTargetLock(unit){if(!unit.aigisTargetLock)return;unit.floatTarget=null;unit.aigisTargetLock=false;}
// S2 的锁定目标：优先用客户端常态索敌的第一个；瞬时技没有生效期（skillLeft=0）导致 airOnlyIdle 把地面目标全部挡在
// 候选之外时，临时让 skillActive 成立一次再取（取完立刻还原，字段最终值不变）。
function lockedTarget(battle,unit){
 const listed=battle.targets(unit)||[];
 if(listed.length)return listed[0];
 const held=unit.skillLeft;
 unit.skillLeft=Math.max(Number(held)||0,1);
 try{return (battle.targets(unit)||[])[0]||null;}
 finally{unit.skillLeft=held;}
}

export const aigisHooks={
 // S.E.E.S. 策略的【塔尔塔罗斯】层数增幅：攻击力与生命上限每层 +0.2%（264 层 → +52.8%）。
 // 走 ratio 通道（与其它百分比加成加算），只在 band_sees 局生效。
 statMods(battle,unit,out){
  if(!seesRun(battle.economy))return;
  const bonus=aigisLayerScale(battle.data,battle.layers?.[TARTARUS_BOND_ID])-1;
  if(!(bonus>0))return;
  out.ratio.atk+=bonus;out.ratio.maxHp+=bonus;
  out.parts.push({stat:'atk',layer:'ratio',v:bonus,src:'塔尔塔罗斯层数'});
  out.parts.push({stat:'maxHp',layer:'ratio',v:bonus,src:'塔尔塔罗斯层数'});
 },
 // 天赋「造成」侧：只在物理伤害上乘 damage_scale。
 attackModifier(battle,unit,target,value){
  const scale=Number(talentBoard(battle,unit).damage_scale);
  if(!Number.isFinite(scale)||scale<=0||scale===1)return value;
  const type=battle.baseDamageType?.(unit);
  if(type!=null&&type!=='physical')return value;
  return value*scale;
 },
 // 天赋「受到」侧：只在物理伤害上把减免抬到 damage_resistance（取最高，不加算）。
 damageReduction(battle,unit,type,attacker,reduction){
  const current=Number(reduction)||0;
  if(type!=='physical')return current;
  const value=Number(talentBoard(battle,unit).damage_resistance);
  if(!Number.isFinite(value)||value<=0)return current;
  return Math.max(current,Math.min(1,value));
 },
 // 开技那一帧：只有 S2 需要在这里结算（S1 走通用层）。
 skillStart(battle,unit,ctx){
  if(skillIndexOf(battle,unit)!==1)return false;
  const board=blackboard(battle.profile(unit)?.skill?.blackboard||[]);
  const times=Math.max(0,Math.round(Number(board.times)||0));
  const missileScale=Number(board.atk_scale),kickScale=Number(board.kick_atk_scale);
  const target=lockedTarget(battle,unit);
  if(!target)return true;
  const atk=battle.stats(unit).atk*damageScaleOf(battle,unit);
  if(times>0&&Number.isFinite(missileScale)&&missileScale>0)
   for(let shot=0;shot<times;shot++)for(const e of missileRadiusTargets(battle,target,MISSILE_RADIUS))
    ctx.dealDamage(battle,{source:unit,target:e,amount:atk*missileScale,type:'physical',cause:'skill',effectId:'aigis-s2-missile:'+unit.uid+':'+shot+':'+e.uid});
  if(Number.isFinite(kickScale)&&kickScale>0)
   for(const e of missileRadiusTargets(battle,target,KICK_RADIUS))
    ctx.queueDelayedDamage(battle,{source:unit,target:e,amount:atk*kickScale,type:'physical',delay:KICK_DELAY,talentOrSkillId:'aigis-s2-kick:'+unit.uid+':'+e.uid});
  return true;
 },
 // S1 期间的索敌：优先自身阻挡的敌人，未阻挡时在攻击范围内随机；技能结束时撤锁。
 // 取候选前必须先把上一帧的锁撤掉：`targets()` 见到 floatTarget 会把结果收窄成那一个目标，
 // 留着锁就等于每帧都在「只有一个候选」的列表里抽，锁会粘死（实测过）。
 tick(battle,unit,ctx){
  if(skillIndexOf(battle,unit)!==0||battle.skillActive?.(unit)!==true){clearTargetLock(unit);return;}
  if(unit.aigisTargetLock)unit.floatTarget=null;   // 只撤自己那把锁，不动别的机制写进这个槽位的值
  unit.aigisTargetLock=false;
  const blocking=(battle.s.enemies||[]).find(e=>e.hp>0&&e.block===unit.uid);
  if(blocking){lockTarget(unit,blocking.uid);return;}
  const candidates=battle.targets(unit)||[];
  if(!candidates.length)return;
  const roll=Number(battle.economy?.random?.())||0;
  lockTarget(unit,candidates[Math.min(candidates.length-1,Math.floor(roll*candidates.length))].uid);
 },
 event(battle,unit,type,payload,ctx){
  if(type==='skill-end'&&payload?.target===unit)clearTargetLock(unit);
 }
};
