import fs from 'node:fs/promises';

const sourcePath = 'data/modes/alliance-lower/default-wave-table.json';
const outputPath = 'dist/native-wave-defaults.js';
const table = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const activities = JSON.parse(await fs.readFile('data/prts/enemy-activities.json', 'utf8'));
const {themes} = JSON.parse(await fs.readFile('data/modes/alliance-lower/wave-theme-rules.json', 'utf8'));
const {NATIVE_DATA} = await import('../dist/runtime-data.js');
const groups = Object.fromEntries(NATIVE_DATA.enemyIndex.map(e=>{
  const entry=activities.entries[e.id];
  if(entry?.activities?.length!==1)throw new Error(`敌人活动归属须逐条核定: ${e.id}`);
  return [e.id,{activity:entry.activities[0],url:entry.url,eligible:e.enemyBehavior.randomPoolEligible===true}];
}));

// 悬赏池的权威来源：原始 source 的 `effectBuffInfoDataDict` 里带 `add_enemy_kill_gain_coin` 黑板的条目，
// 每条给出「额外出现的敌人 + 击杀奖金 coin（0–6）+ 数量」。其中 `enemyeffect_b_1`～`enemyeffect_b_24`
// 是领袖赏金表（23 名 levelType=BOSS ＋ 澪）—— 领袖不在 enemyInfoDict 词条池里，所以这是它们唯一的入口。
// 同一敌人可能在不同词条组里登记成不同 coin（例如山海众头目 1/2、重弩突袭者 1/2）：本期客户端只按敌人去重，
// 取其中最小的 coin（不凭空抬高奖金），其余变体留在 variants 里备查。
const enemyKillCoins={};
for(const [effectId,list] of Object.entries(NATIVE_DATA.season.effectBuffInfoDataDict||{})){
  const row=(list||[]).find(r=>r.key==='add_enemy_kill_gain_coin');
  if(!row)continue;
  const bb=Object.fromEntries((row.blackboard||[]).map(r=>[r.key,r.valueStr??r.value]));
  const id=String(bb.enemy_id||'');
  if(!NATIVE_DATA.enemies[id])continue;
  const coin=Math.max(0,Math.min(9,Math.floor(Number(bb.coin)||0))),count=Math.max(1,Math.floor(Number(bb.count)||1));
  const current=enemyKillCoins[id];
  if(!current)enemyKillCoins[id]={coin,count,effectId,variants:[{effectId,coin,count}]};
  else{current.variants.push({effectId,coin,count});if(coin<current.coin){current.coin=coin;current.effectId=effectId;}}
}
const leaderBounties=Object.entries(enemyKillCoins).filter(([id])=>NATIVE_DATA.enemies[id].levelType==='BOSS');
if(leaderBounties.length!==23)throw new Error(`领袖赏金表覆盖数异常: ${leaderBounties.length}`);
if(!enemyKillCoins.enemy_10118_ymgprc)throw new Error('领袖赏金表缺少澪（enemyeffect_b_19）');
if(Object.keys(enemyKillCoins).length<100)throw new Error(`击杀奖金表条目过少: ${Object.keys(enemyKillCoins).length}`);

if (!table || typeof table !== 'object' || !table.types || typeof table.types !== 'object') {
  throw new Error(`${sourcePath} 不是有效的波次表导出文件`);
}

for(const [type,tiers] of Object.entries(table.types))for(const [tier,pack] of Object.entries(tiers))for(const slot of pack.templates){
  const theme=themes.find(t=>t.id===slot.theme&&t.type===type);
  if(!theme||!slot.pool.length||slot.pool.some(id=>!groups[id]?.eligible||!theme.activities.includes(groups[id].activity)||!NATIVE_DATA.season.enemyInfoDict[type].includes(id)))throw new Error(`默认模板含未准入或主题不匹配敌人: ${slot.name}`);
  if(Number(tier)>=2&&(new Set(slot.pool).size<4||(slot.minKinds||0)<4))throw new Error(`中高压默认模板不足4种: ${slot.name}`);
}
const output=`// Generated from ${sourcePath} and data/prts/enemy-activities.json.\nexport const ENEMY_ACTIVITY_GROUPS = ${JSON.stringify(groups,null,2)};\nexport const ENEMY_KILL_COINS = ${JSON.stringify(enemyKillCoins,null,2)};\nexport const DEFAULT_WAVE_TABLE = ${JSON.stringify(table, null, 2)};\n`;
// 与 build-browser 相同：Windows 上连续构建时短暂文件占用可重试。
for(let attempt=0;;attempt++){
  try{await fs.writeFile(outputPath,output);break;}
  catch(error){if(attempt>=3||!['EBUSY','EPERM','UNKNOWN'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));}
}
console.log(`Built ${outputPath} from ${sourcePath}`);
