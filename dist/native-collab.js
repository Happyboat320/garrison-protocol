// 联动干员（S.E.E.S. 四人组）的专属实现入口。
// 口径见 docs/PERSONA3_COLLAB_OPERATORS.md：四人只作隐藏档进技能测试场，不给盟约与卫戍。
// 逻辑按人分文件（native-collab-<name>.js），这里只做「按 charId 取钩子」的派发，
// 避免继续把逐名分支堆进 native-operator-effects.js 的大函数里。
//
// 依赖方向是单向的：native-effects／native-operator-effects → native-collab → native-collab-*。
// 四个实现文件**不得**反向 import 这三个模块（会形成循环）；需要的能力用 battle／unit／ctx 参数，
// 或 protocol.js／status.js／targeting.js 里的纯函数。
import {hooks as kormr} from './native-collab-kormr.js';
import {hooks as aigis} from './native-collab-aigis.js';
import {hooks as yukari} from './native-collab-yukari.js';
import {hooks as makoto} from './native-collab-makoto.js';
export const COLLAB_HOOKS={
 char_4220_kormr:kormr,
 char_4218_aigis:aigis,
 char_4219_yukari:yukari,
 char_4217_makoto:makoto
};
export function collabFor(unit){return unit?.charId?COLLAB_HOOKS[unit.charId]||null:null;}
// 部署瞬间（native-effects 的 deploy 分支）：虎狼丸的天赋斩击挂在这里。
export function collabDeploy(battle,unit){collabFor(unit)?.deploy?.(battle,unit);}
// 属性修正（native-operator-effects.statMods）：把结果并进 out（add／ratio／attackSpeed／parts）。
export function collabStatMods(battle,unit,out){collabFor(unit)?.statMods?.(battle,unit,out);}
// 开技那一帧（native-operator-effects.operatorSkillStart）：返回 true 表示要压制通用开技兜底。
export function collabSkillStart(battle,unit,ctx){return collabFor(unit)?.skillStart?.(battle,unit,ctx)===true;}
// 逐帧（native-effects.tickLogic 的 periodicMods 旁边）：与 unit 自己绑定的周期逻辑。
export function collabTick(battle,unit,ctx){collabFor(unit)?.tick?.(battle,unit,ctx);}
// 伤害修正（native-operator-effects.attackModifier）：返回新的伤害值。
export function collabAttackModifier(battle,unit,target,value){const next=collabFor(unit)?.attackModifier?.(battle,unit,target,value);return Number.isFinite(next)?next:value;}
// 受伤减免（native-operator-effects.damageReductionFor）：返回新的减免比例。
export function collabDamageReduction(battle,unit,type,attacker,reduction){const next=collabFor(unit)?.damageReduction?.(battle,unit,type,attacker,reduction);return Number.isFinite(next)?next:reduction;}
// 事件派发：把事件发给**场上每一个**有钩子的联动干员（监听者视角，例如岳羽由加莉要听友军开技）。
export function collabEvent(battle,type,payload,ctx){
 for(const unit of battle.s?.units||[]){
  const hook=collabFor(unit);
  if(!hook?.event||!unit.deployed||unit.hp<=0)continue;
  hook.event(battle,unit,type,payload,ctx);
 }
}
