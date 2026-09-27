// 虎狼丸 char_4220_kormr（1 星近卫／剑豪，联动隐藏档 chess_collab_kormr）
//
// 天赋「黑色猎犬」（PRTS revisionId 424872；数值只从 profile.activeTalents 的黑板读，无潜能档）：
//   部署后对周围一定范围内**最近的 1 名敌人**发动**总计 6 次无视闪避**的斩击，每次造成相当于攻击力
//   `atk_scale` 的法术伤害，**最后一次**斩击改为造成攻击力 `final_atk_scale` 的法术伤害并使目标
//   **恐惧** `fear` 秒。无潜能档：atk_scale=1、final_atk_scale=2、fear=4（满潜 2／4／4）。
// 没有主动技能（skillRefs 为空）。特性「普通攻击连续造成两次伤害」由 BRANCH_POLICIES.sword 提供。
//
// 回归：tests/native-collab-kormr.test.mjs（新文件，必须验证「改回本文件前会失败」）
import {blackboard} from './protocol.js';
import {applyStatus,permissions} from './status.js';
import {containsTarget} from './targeting.js';

// 「总计 6 次」只写在天赋文案里：PRTS 黑板只有 atk_scale／final_atk_scale／fear，没有次数键，
// 所以次数按文案定死（**数值**一律读黑板，缺字段就不给能力）。
const SLASH_COUNT=6;
const TALENT=/黑色猎犬/;

// 「周围一定范围」＝天赋自带的 rangeId（无潜能档为 `x-1`：以自身为中心、曼哈顿距离 2 的 13 格），
// 走权威范围表 battle.cellsForRangeId（方向旋转在 native-battle.cellsForGrids 里），不手写包围半径。
// 天赋没带 rangeId／范围表缺这条时才退回干员当前攻击范围（同样是 range_table 的数据）。
function talentCells(battle,unit,talent){
 const cells=talent.rangeId?battle.cellsForRangeId?.(unit,talent.rangeId):null;
 return cells?.length?cells:(battle.range(unit).cells||[]);
}
// 范围内「最近的 1 名敌人」：距离按棋盘欧氏距离，同距离取 uid 小的（结算稳定）。
// 可选中条件与 targeting.selectEnemies 一致（隐匿／不可选中／无敌／沉睡不选）；天赋文案没有
// 「仅地面／可对空」的限定，所以这里不另设对空门禁。
function nearestEnemy(battle,unit,cells){
 const pairs=cells.map(c=>[c.x,c.y]);
 const rows=battle.s.enemies.filter(e=>e.hp>0&&!e.hidden&&!e.untargetable&&!e.invulnerable
  &&(!e.invisible||e.block!=null)&&!permissions(e).sleeping&&containsTarget(pairs,e));
 rows.sort((a,b)=>Math.hypot(a.x-unit.x,a.y-unit.y)-Math.hypot(b.x-unit.x,b.y-unit.y)||a.uid-b.uid);
 return rows[0]||null;
}
export const kormrHooks={
 // deploy(battle,unit)：在 native-effects 的 deploy 分支（dispatch 'deploy'）里调用，此时 unit 已经落位、
 // hp 已按 stats 重置，所以这里能安全读 battle.stats(unit).atk。
 deploy(battle,unit){
  if(!battle||!unit)return;
  const talent=(battle.profile(unit).activeTalents||[]).find(t=>TALENT.test(t.name||''));
  if(!talent)return;
  const values=blackboard(talent.blackboard);
  const scale=Number(values.atk_scale),finalScale=Number(values.final_atk_scale),fear=Number(values.fear);
  if(!Number.isFinite(scale)||!Number.isFinite(finalScale))return; // 黑板缺字段：不给这个能力
  const target=nearestEnemy(battle,unit,talentCells(battle,unit,talent));
  if(!target)return;
  const atk=battle.stats(unit).atk;
  // 「无视闪避」（天赋文案）：走共享层的正式开关 `dealDamage({ignoreDodge:true})`——
  // 2026-09-27 之前伤害管线没有这个开关，这里是靠在 6 次斩击期间把 `target.enemyUnblockedDodge`
  // 压成 0 再写回来绕过的（同时说明斩击是法术伤害、天然不吃酒类物理闪避）。
  for(let i=0;i<SLASH_COUNT;i++){
   if(target.hp<=0)break;
   const last=i===SLASH_COUNT-1;
   battle.hit(unit,target,atk*(last?finalScale:scale),'arts',{skill:true,ignoreDodge:true});
  }
  // 最后一次斩击「并使目标恐惧」：resistible:false 与叙拉古／妮芙那两处干员施加恐惧的口径一致。
  if(Number.isFinite(fear)&&fear>0)applyStatus(target,'fear',fear,{source:unit.uid,resistible:false});
 }
};
