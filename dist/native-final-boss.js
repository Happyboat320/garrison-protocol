// 逐名开放最终 Boss；未完成机制与路线验收的 Boss 不进入本局抽取池。
export const AVAILABLE_FINAL_BOSS_IDS=Object.freeze(['boss_5']);

const HP_FIELD={FUNNY:'bloodPoint',NORMAL:'bloodPointNormal',HARD:'bloodPointHard',ABYSS:'bloodPointAbyss'};
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
 const hp=Number(settings[HP_FIELD[difficulty]]??settings.bloodPoint);
 if(!(hp>0))throw Error('最终 Boss 血量无效：'+bossId);
 return {...boss,enemyProfile:profile,bossId,hp,weight:settings.weight,difficulty};
}
