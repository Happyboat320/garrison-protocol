import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root='data/enemy-animations/prts/alliance-lower-final';
const models=[
  {bossId:'boss_1',enemyId:'enemy_9013_acstmk',name:'假想敌：胄',wiki:'假想敌：胄'},
  {bossId:'boss_2',enemyId:'enemy_9017_achunt',name:'假想敌：铳',wiki:'假想敌：铳'},
  {bossId:'boss_3',enemyId:'enemy_9021_acduml',name:'假想敌：管',wiki:'假想敌：管'},
  {bossId:'boss_4',enemyId:'enemy_1521_dslily',name:'盐风主教昆图斯',wiki:'盐风主教昆图斯'},
  {bossId:'boss_5',enemyId:'enemy_2016_csphtm',name:'卢西恩，“猩红血钻”',wiki:'卢西恩，“猩红血钻”'},
  {bossId:'boss_6',enemyId:'enemy_1559_vtlionk',gameEnemyId:'enemy_9032_aclionk',name:'阿利斯泰尔，帝国余晖',wiki:'阿利斯泰尔，帝国余晖'},
  {bossId:'boss_7',enemyId:'enemy_2054_smdeer',gameEnemyId:'enemy_9033_acdeer',name:'“萨米的意志”',wiki:'“萨米的意志”'},
];
const source=JSON.parse(await fs.readFile('data/modes/alliance-lower/source.json','utf8'));
for(const model of models){
  const entry=source.common.bossInfoDict[model.bossId];
  if(entry?.enemyId!==(model.gameEnemyId||model.enemyId)||entry?.handbookEnemyId!==model.enemyId)throw Error('Boss/model mapping changed: '+model.bossId);
}
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function download(url,file){
  const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error(`${response.status} ${url}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,bytes);
  return {url,file:file.replaceAll('\\','/'),bytes:bytes.length,sha256:sha256(bytes)};
}
function atlasPages(text){
  const pages=text.trim().split(/\r?\n\s*\r?\n/).map(block=>block.split(/\r?\n/)[0].trim());
  if(!pages.length||pages.some(page=>!/^[-\w]+\.png$/.test(page)))throw Error('Unsupported atlas page');
  return [...new Set(pages)];
}
const manifest={schemaVersion:1,source:'PRTS enemy /spine pages',retrievedAt:new Date().toISOString(),models:[]};
for(const model of models){
  const prefix=`https://torappu.prts.wiki/assets/enemy_spine/${model.enemyId}/`;
  const folder=path.join(root,model.enemyId),files=[];
  for(const ext of ['atlas','skel']){
    const name=`${model.enemyId}.${ext}`;
    files.push(await download(prefix+name,path.join(folder,name)));
  }
  const atlas=await fs.readFile(path.join(folder,`${model.enemyId}.atlas`),'utf8');
  for(const page of atlasPages(atlas))files.push(await download(prefix+page,path.join(folder,page)));
  manifest.models.push({...model,wikiUrl:`https://prts.wiki/w/${encodeURIComponent(model.wiki)}/spine`,prefix,files});
  console.log(`${model.bossId} ${model.name}: ${files.length} files`);
}
await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
