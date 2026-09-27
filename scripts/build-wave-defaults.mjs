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
// 每条给出「额外出现的敌人 + 击杀奖金 coin（0–6）+ 数量」。条目自身的词条写在 `effectInfoDataDict[id].effectName`
// 里（`悬赏·飞行II`、`悬赏·损伤III`……），据此归组：
//   * 词条组（`悬赏·<词条><I|II|III>`）：奖金只到 3 档，供对应词条的回合抽取；
//   * 具名组（`<敌人>·悬赏`／`多轮悬赏 · <敌人>`）：领袖（`enemyeffect_b_1`～`b_24`，23 名 levelType=BOSS ＋ 澪）、
//     鸭爵一族、假想敌、山海众头目等，奖金 0–6，4 档及以上只出现在这一组。
// 领袖不在 enemyInfoDict 词条池里，悬赏是它们唯一的入池入口。
// 同一敌人可能在不同词条组里登记成不同 coin（例如山海众头目 1/2、重弩突袭者 1/2、法术大师A2 1/2）：
// 本期客户端只按敌人去重，取其中最小的 coin（不凭空抬高奖金），所有词条归属与变体留在 groups／variants 里备查。
const BOUNTY_TAGS=[['损伤','ELEMENT'],['飞行','FLY'],['频次','TIMES'],['持续','DOT'],['隐匿','INVISIBLE'],['折射','REFLECTION'],['特异','SPECIAL']];
const effectInfo=NATIVE_DATA.season.effectInfoDataDict||{};
const bountyGroupOf=effectId=>{
  const name=String(effectInfo[effectId]?.effectName||'');
  if(!name.includes('悬赏·'))return null;
  const hit=BOUNTY_TAGS.find(([word])=>name.includes(word));
  return hit?hit[1]:null;
};
const enemyKillCoins={};
for(const [effectId,list] of Object.entries(NATIVE_DATA.season.effectBuffInfoDataDict||{})){
  const row=(list||[]).find(r=>r.key==='add_enemy_kill_gain_coin');
  if(!row)continue;
  const bb=Object.fromEntries((row.blackboard||[]).map(r=>[r.key,r.valueStr??r.value]));
  const id=String(bb.enemy_id||'');
  if(!NATIVE_DATA.enemies[id])continue;
  const coin=Math.max(0,Math.min(9,Math.floor(Number(bb.coin)||0))),count=Math.max(1,Math.floor(Number(bb.count)||1));
  const group=bountyGroupOf(effectId);
  const variant={effectId,coin,count,group};
  const current=enemyKillCoins[id];
  if(!current){enemyKillCoins[id]={coin,count,effectId,group,groups:group?[group]:[],variants:[variant]};continue;}
  current.variants.push(variant);
  if(group&&!current.groups.includes(group))current.groups.push(group);
  if(coin<current.coin){current.coin=coin;current.count=count;current.effectId=effectId;current.group=group;}
}
const leaderBounties=Object.entries(enemyKillCoins).filter(([id])=>NATIVE_DATA.enemies[id].levelType==='BOSS');
if(leaderBounties.length!==23)throw new Error(`领袖赏金表覆盖数异常: ${leaderBounties.length}`);
if(!enemyKillCoins.enemy_10118_ymgprc)throw new Error('领袖赏金表缺少澪（enemyeffect_b_19）');
if(Object.keys(enemyKillCoins).length<100)throw new Error(`击杀奖金表条目过少: ${Object.keys(enemyKillCoins).length}`);
const validGroups=new Set(BOUNTY_TAGS.map(([,id])=>id));
for(const [id,entry] of Object.entries(enemyKillCoins)){
  for(const g of entry.groups)if(!validGroups.has(g))throw new Error(`未知悬赏词条组: ${id}/${g}`);
  // 词条组的奖金只到 3 档；带 4 档以上的必须是具名（领袖/假想敌等）条目。
  if(entry.groups.length&&entry.coin>3&&!entry.variants.some(v=>!v.group))throw new Error(`词条组奖金超过 3 档: ${id}`);
}
if(!Object.values(enemyKillCoins).some(e=>!e.groups.length))throw new Error('缺少具名悬赏组');


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
