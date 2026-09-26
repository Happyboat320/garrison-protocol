import {DEFAULT_WAVE_TABLE,ENEMY_KILL_COINS} from './native-wave-defaults.js';
import {waveRng} from './native-wave-random.js';
import {blackboard} from './protocol.js';

export const BOUNTY_SLUG='enemy_1007_slime';
// 悬赏池的唯一来源是原表 `add_enemy_kill_gain_coin` 表（编译期由 scripts/build-wave-defaults.mjs
// 烘成 ENEMY_KILL_COINS，币值直接用原表 coin 0–6）。原表按「词条组」登记，领袖是其中的
// `enemyeffect_b_*` 组（23 名 levelType=BOSS ＋ 澪）；旧实现改成按波次表成本推导币值，
// 结果 104 名原表悬赏敌人里 74 名（含全部领袖）永远抽不到、92 条币值与原表不一致。
// 波次表成本推导只保留给旧存档兼容，不再是新悬赏的来源。
export function bountyOption(data,id){
 const raw=data.enemies?.[id],table=ENEMY_KILL_COINS[id];
 if(raw&&raw.enemyBehavior?.randomPoolEligible===true&&table)
  return {id,enemyId:id,name:raw.name,coin:table.coin,count:table.count,difficulty:table.coin,cost:Number(DEFAULT_WAVE_TABLE.costs[id])||0,effectId:table.effectId,source:'kill-coin'};
 // 兼容旧存档：旧悬赏是「有波次表成本就能被抽到」并按成本映射币值，这些 id 仍要能被读回来。
 const cost=DEFAULT_WAVE_TABLE.costs[id];
 if(raw&&raw.enemyBehavior?.randomPoolEligible===true&&(Number.isFinite(cost)||id===BOUNTY_SLUG)){
  const coin=id===BOUNTY_SLUG?0:cost<=3?1:cost<=6?2:cost<=10?3:4;
  return {id,enemyId:id,name:raw.name,coin,count:1,difficulty:coin,cost:cost||0,source:'legacy-cost'};
 }
 // 兼容旧存档中的道具悬赏效果 ID。
 const effect=data.season.effectBuffInfoDataDict[id]?.find(e=>['add_enemy_selfbattle_win_gain_coin','next_battle_add_enemy_win_gain_coin'].includes(e.key));
 if(!effect)return null;
 const p=blackboard(effect.blackboard),enemyId=String(p.enemy_id||'');if(!data.enemies?.[enemyId])return null;
 const coin=enemyId===BOUNTY_SLUG?0:Number(p.coin)||1;
 return {id,enemyId,name:data.enemies[enemyId].name,coin,count:Number(p.count)||1,difficulty:coin,source:'item'};
}

export function bountyOffers(data,seed){
 const pool=Object.keys(ENEMY_KILL_COINS).map(id=>bountyOption(data,id)).filter(Boolean);
 const rng=waveRng((seed^0x7b0a17)>>>0),pick=items=>items[Math.floor(rng()*items.length)];
 const bins=Array.from({length:7},(_,coin)=>pool.filter(o=>o.coin===coin));
 // 项目口径：四选一，且每次至少包含 1 奖金与 4 奖金档（0 档是源石虫）。
 // 原表 coin 上限是 6，高档位可能没有任何准入候选；缺档要跳过并从还有候选的档位补，
 // 不能像旧实现那样「任一档为空就整轮不出悬赏」—— 否则接上领袖赏金表后第 6 档为空会让整个悬赏消失。
 const anchor=[1,4].filter(coin=>bins[coin].length);
 if(anchor.length<2)return [];
 const offers=anchor.map(coin=>pick(bins[coin]).id);
 const spare=[0,2,3,5,6].filter(coin=>bins[coin].length);
 while(offers.length<4&&spare.length){
  const [coin]=spare.splice(Math.floor(rng()*spare.length),1);
  offers.push(pick(bins[coin]).id);
 }
 const unique=[...new Set(offers)];
 if(unique.length<4)return [];
 for(let i=unique.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[unique[i],unique[j]]=[unique[j],unique[i]];}
 return unique;
}

// 回合悬赏的出现节奏（用户 2026-09-22 口径）：从第 2 回合开始每隔一个回合出现一次（2 / 4 / 6 …），
// 不是每回合都弹。第 1 回合与最终木桩阶段没有回合悬赏；道具悬赏（教鞭／神秘顾客的 pendingBounty）
// 是另一条路径，不受这个节奏限制。
export const BOUNTY_FIRST_ROUND=2;
export const BOUNTY_INTERVAL=2;
export function bountyRoundActive(round){
 const n=Number(round);
 return Number.isInteger(n)&&n>=BOUNTY_FIRST_ROUND&&(n-BOUNTY_FIRST_ROUND)%BOUNTY_INTERVAL===0;
}
