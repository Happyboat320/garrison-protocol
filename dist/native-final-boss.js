// 逐名开放最终 Boss；未完成机制与路线验收的 Boss 不进入本局抽取池。
export const AVAILABLE_FINAL_BOSS_IDS=Object.freeze(['boss_4','boss_5','boss_7']);

// 逐名战斗机制登记（数值来源：docs/FINAL_BOSS_4_5_7_PLAN_2026-09-28.md 与 PRTS 敌人页）。
// hitRect＝本期巨型受击矩形（长4.95 × 宽2.95、向上偏移1，PRTS「巨型单位」口径，通常图鉴的 2.95×2.95 不覆盖本期）；
// static＝自缚站桩（formHold，不沿环线移动）；unblockable＝不可阻挡；shiftImmune＝失衡免疫；
// range 补齐档案缺省的攻击半径（两位 Boss 的攻击都是全场范围，PRTS 攻击半径 99）。
// spriteScale 只管画布表现。
export const FINAL_BOSS_MECHANICS={
 'enemy_1521_dslily':{hitRect:{length:4.95,width:2.95,offsetY:1},spriteScale:3,static:true,unblockable:true,range:99},
 'enemy_2016_csphtm':{spriteScale:2.2},
 'enemy_9033_acdeer':{hitRect:{length:4.95,width:2.95,offsetY:1},spriteScale:3,static:true,unblockable:true,shiftImmune:true,range:99},
};
export function finalBossMechanics(enemyId){return FINAL_BOSS_MECHANICS[enemyId]||null;}
export function finalBossSpawnPoint(map,route,occupants=[]){
 const roads=route.filter(p=>map.grid[p.y]?.[p.x]?.tileKey==='tile_road');
 const candidates=roads.length?roads:route.filter(p=>!['tile_start','tile_end','tile_deepsea'].includes(map.grid[p.y]?.[p.x]?.tileKey));
 const free=candidates.filter(p=>!occupants.some(u=>u.hp>0&&u.deployed!==false&&Math.round(u.x)===p.x&&Math.round(u.y)===p.y));
 const pool=free.length?free:candidates,cx=(map.cols-1)/2,cy=(map.rows-1)/2;
 return pool.reduce((best,p)=>!best||(p.x-cx)**2+(p.y-cy)**2<(best.x-cx)**2+(best.y-cy)**2?p:best,null)||route[0];
}

const HP_FIELD={FUNNY:'bloodPoint',NORMAL:'bloodPointNormal',HARD:'bloodPointHard',ABYSS:'bloodPointAbyss'};
const FINAL_BOSS_HP_MULTIPLIER=0.25;
function roll(seed){let x=(Number(seed)||1)>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;}

export function rollFinalBoss(data,modeId,seed){
 const mode=data.season.modeDataDict[modeId],rows=AVAILABLE_FINAL_BOSS_IDS.map(id=>({id,config:data.season.bossInfoDict[id],enemy:data.common.bossInfoDict[id]})).filter(x=>x.config?.weight>0&&x.enemy?.enemyId&&data.finalBosses?.[x.id]);
 if(!rows.length)throw Error('没有已接入的最终 Boss');
 const total=rows.reduce((n,x)=>n+x.config.weight,0);let pick=roll((Number(seed)^0xb0555eed)>>>0)*total;
 return (rows.find(x=>(pick-=x.config.weight)<0)||rows.at(-1)).id;
}

export function finalBossConfig(data,bossId,modeId){
 const source=data.common.bossInfoDict[bossId],settings=data.season.bossInfoDict[bossId],boss=data.finalBosses[bossId],difficulty=data.season.modeDataDict[modeId]?.modeDifficulty,profile=boss?.profiles?.[modeId]||boss?.profiles?.[difficulty==='TRAINING'?'mode_single_funny':null];
 if(!source||!settings||!profile)throw Error('最终 Boss 资料不完整：'+bossId);
 // 原表最终 Boss 生命按四人联机数据配置；本地模拟使用原值的 25%。
 const hp=Number(settings[HP_FIELD[difficulty]]??settings.bloodPoint)*FINAL_BOSS_HP_MULTIPLIER;
 if(!(hp>0))throw Error('最终 Boss 血量无效：'+bossId);
 return {...boss,enemyProfile:profile,bossId,hp,weight:settings.weight,difficulty};
}
