// 本地战绩档案：最近 N 场对局的结果、战前准备的技能选择、特殊标记开关。
//
// 口径（用户 2026-09-27 需求）：
// - 每条对局记录包含：词条（开局抽中的三种特训）、地图、存活波数、是否通关、最终轮输出、
//   最终轮盟约情况（各盟约层数与是否激活、以及本局缺席的盟约）、最终轮场上具体阵容。
// - 档案存在**自己的** localStorage 键里（不是塞进某一局的对局存档），所以换局／读档都不会丢；
//   导出存档时把它一并写进 JSON，导入时并回本地。
// - 这一层只做「取数 + 规范化 + 读写」，不做 DOM，也不改任何战斗状态；storage 由调用方注入（便于单测）。
import {activeBonds} from './protocol.js';
import {trainingType} from './native-wave-random.js';

export const ARCHIVE_KEY='garrison-archive-v1';
export const ARCHIVE_LIMIT=10;
export const ARCHIVE_VERSION=1;
export const ARCHIVE_FORMAT='garrison-protocol-save';
// 特殊标记的默认值：这三个都是**隐藏内容**，默认关（用户 2026-09-27 口径）。
// S.E.E.S.＝联动内容标记；egg325／cat＝「325 模式」「海猫模式」的解锁标记——没解锁时这两个模式
// 连选项都不出现在大厅的「行动难度」里（见 native-play 的 gateLockedModes）。
export const ARCHIVE_FLAG_DEFAULTS=Object.freeze({sees:false,egg325:false,cat:false});

export function emptyArchive(){return {version:ARCHIVE_VERSION,runs:[],prepSkills:{},flags:{...ARCHIVE_FLAG_DEFAULTS}};}

const isPlainObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);

// 只认布尔值；缺字段按默认值补齐。将来加新标记时只要往 ARCHIVE_FLAG_DEFAULTS 里加一项。
export function normalizeFlags(raw){
 const source=isPlainObject(raw)?raw:{},out={};
 for(const [key,fallback] of Object.entries(ARCHIVE_FLAG_DEFAULTS))out[key]=typeof source[key]==='boolean'?source[key]:fallback;
 return out;
}
// 记录里可以缺字段（旧档案／手改过的 JSON），但类型不对的条目直接丢掉，避免把坏数据渲染到界面。
export function normalizeRun(raw){
 if(!isPlainObject(raw))return null;
 const id=typeof raw.id==='string'&&raw.id?raw.id:null,at=finite(raw.at)?raw.at:null,mapId=typeof raw.mapId==='string'?raw.mapId:null;
 if(!id||at==null||!mapId)return null;
 const types=(Array.isArray(raw.types)?raw.types:[]).filter(t=>isPlainObject(t)&&typeof t.id==='string').map(t=>({id:t.id,name:typeof t.name==='string'?t.name:t.id}));
 const bonds=(Array.isArray(raw.finalBonds)?raw.finalBonds:[]).filter(b=>isPlainObject(b)&&typeof b.id==='string').map(b=>({id:b.id,name:typeof b.name==='string'?b.name:b.id,count:finite(b.count)?b.count:0,rawCount:finite(b.rawCount)?b.rawCount:finite(b.count)?b.count:0,active:!!b.active}));
 const banned=(Array.isArray(raw.bannedBonds)?raw.bannedBonds:[]).filter(b=>isPlainObject(b)&&typeof b.id==='string').map(b=>({id:b.id,name:typeof b.name==='string'?b.name:b.id}));
 const lineup=(Array.isArray(raw.finalLineup)?raw.finalLineup:[]).filter(u=>isPlainObject(u)&&typeof u.chessId==='string').map(u=>({uid:finite(u.uid)?u.uid:null,chessId:u.chessId,charId:typeof u.charId==='string'?u.charId:null,name:typeof u.name==='string'?u.name:u.chessId,isGolden:!!u.isGolden,rank:finite(u.rank)?u.rank:null,level:finite(u.level)?u.level:null,x:finite(u.x)?u.x:null,y:finite(u.y)?u.y:null,dir:finite(u.dir)?u.dir:0,skillIndex:finite(u.skillIndex)?u.skillIndex:null,skillName:typeof u.skillName==='string'?u.skillName:null,damage:finite(u.damage)?u.damage:0,equipment:(Array.isArray(u.equipment)?u.equipment:[]).filter(e=>isPlainObject(e)&&typeof e.chessId==='string').map(e=>({chessId:e.chessId,name:typeof e.name==='string'?e.name:e.chessId}))}));
 return {
  id,at,
  atText:typeof raw.atText==='string'?raw.atText:new Date(at).toLocaleString('zh-CN',{hour12:false}),
  modeId:typeof raw.modeId==='string'?raw.modeId:null,
  bandId:typeof raw.bandId==='string'?raw.bandId:null,
  mapId,
  types,
  round:finite(raw.round)?raw.round:0,
  waves:finite(raw.waves)?raw.waves:0,
  battles:finite(raw.battles)?raw.battles:finite(raw.waves)?raw.waves:0,
  cleared:!!raw.cleared,
  hp:finite(raw.hp)?raw.hp:0,
  maxHp:finite(raw.maxHp)?raw.maxHp:0,
  finalRound:!!raw.finalRound,
  finalKind:typeof raw.finalKind==='string'?raw.finalKind:null,
  finalDamage:finite(raw.finalDamage)?raw.finalDamage:0,
  finalElapsed:finite(raw.finalElapsed)?raw.finalElapsed:0,
  finalDps:finite(raw.finalDps)?raw.finalDps:0,
  finalKills:finite(raw.finalKills)?raw.finalKills:0,
  finalLeaks:finite(raw.finalLeaks)?raw.finalLeaks:0,
  finalBonds:bonds,
  bannedBonds:banned,
  finalLineup:lineup
 };
}
export function normalizeArchive(raw){
 const source=isPlainObject(raw)?raw:{},runs=(Array.isArray(source.runs)?source.runs:[]).map(normalizeRun).filter(Boolean);
 runs.sort((a,b)=>b.at-a.at);
 const prepSkills={};if(isPlainObject(source.prepSkills))for(const [charId,value] of Object.entries(source.prepSkills))if(finite(value))prepSkills[charId]=value;
 return {version:ARCHIVE_VERSION,runs:runs.slice(0,ARCHIVE_LIMIT),prepSkills,flags:normalizeFlags(source.flags)};
}
export function loadArchive(storage){
 try{const text=storage?.getItem?.(ARCHIVE_KEY);return normalizeArchive(text?JSON.parse(text):null);}catch{return emptyArchive();}
}
export function saveArchive(storage,archive){
 const next=normalizeArchive(archive);
 try{storage?.setItem?.(ARCHIVE_KEY,JSON.stringify(next));}catch{}
 return next;
}
// 新记录插到最前，同 id 覆盖（同一局重复记录只会留一条），只保留最近 ARCHIVE_LIMIT 场。
export function appendRun(archive,run){
 const base=normalizeArchive(archive),row=normalizeRun(run);
 if(!row)return base;
 const runs=[row,...base.runs.filter(r=>r.id!==row.id)];
 return normalizeArchive({...base,runs});
}
// 导入时的合并：以导入的为准覆盖同 id 记录，其余按时间合并，仍然只留最近 10 场。
export function mergeArchives(local,incoming){
 const a=normalizeArchive(local),b=normalizeArchive(incoming);
 const byId=new Map();for(const run of [...a.runs,...b.runs])byId.set(run.id,run);
 // Old exports predate newer flags. Only let an incoming value override local state when
 // that key was explicitly present; normalizeArchive fills absent keys with false.
 const flags={...a.flags},incomingFlags=isPlainObject(incoming?.flags)?incoming.flags:{};
 for(const key of Object.keys(ARCHIVE_FLAG_DEFAULTS))if(typeof incomingFlags[key]==='boolean')flags[key]=incomingFlags[key];
 return normalizeArchive({
  version:ARCHIVE_VERSION,
  runs:[...byId.values()].sort((x,y)=>y.at-x.at).slice(0,ARCHIVE_LIMIT),
  prepSkills:{...a.prepSkills,...b.prepSkills},
  flags
 });
}
// 一局结束时的取数：词条/地图/存活波数/是否通关/最终轮输出/最终轮盟约情况/最终轮阵容。
// 只读 game.s 与 data，不改任何状态；runRecordId 是懒生成的稳定去重键（会随 snapshot 一起存档）。
export function runRecord(game,data,{at=Date.now()}={}){
 const s=game?.s;if(!s)return null;
 s.runRecordId??='run-'+at.toString(36)+'-'+Math.floor(Math.random()*0xffffff).toString(36);
 const roster=s.waveRoster||{};
 const types=(roster.types||[]).map(id=>{const t=trainingType(id);return {id,name:t?.name||id};});
 const bondRows=game.bonds?game.bonds():activeBonds(data,s.units,s.modeId,s.bandId);
 const finalBonds=Object.entries(bondRows||{})
  .filter(([,row])=>Number(row?.count)>0||Number(row?.rawCount)>0)
  .map(([id,row])=>({id,name:data.season.bondInfoDict[id]?.name||id,count:Number(row.count)||0,rawCount:Number(row.rawCount??row.count)||0,active:!!row.active}))
  .sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));
 const bannedBonds=(s.bondBan?.bonds||[]).map(id=>({id,name:data.season.bondInfoDict[id]?.name||id}));
 const result=s.runResult||(s.history||[]).at(-1)||null;
 const damageByUid=new Map((result?.units||[]).map(u=>[u.uid,Number(u.damage)||0]));
 const finalLineup=s.units.filter(u=>u.position).map(u=>{
  const p=data.profiles[u.chessId]||{},index=u.skillIndex??p.skillIndex??0;
  return {
   uid:u.uid,chessId:u.chessId,charId:u.charId,name:p.name||u.charId,isGolden:!!p.isGolden,
   rank:finite(p.rank)?p.rank:null,level:finite(p.level)?p.level:null,
   x:u.position.x,y:u.position.y,dir:u.dir,
   skillIndex:index,skillName:p.skillChoices?.[index]?.skill?.name||null,
   damage:damageByUid.get(u.uid)||0,
   equipment:(u.equipment||[]).map(i=>({chessId:i.chessId,name:itemName(data,i.chessId)}))
  };
 }).sort((a,b)=>b.damage-a.damage||a.name.localeCompare(b.name));
 const history=s.history||[],boss=history.some(r=>r?.kind==='final-boss'&&r.success===true)||history.some(r=>r?.kind==='training-dummy')||s.round>=14;
 // 存活波数＝**打完且生命还在**的普通波次数：死在最后一波时那一波不算「存活」（用户口径里的存活波数）。
 // 总共打了多少场单独记在 battles 里，方便对着战报核对。
 const battles=history.filter(r=>r?.kind!=='training-dummy').length;
 return normalizeRun({
  id:s.runRecordId,at,atText:new Date(at).toLocaleString('zh-CN',{hour12:false}),
  modeId:s.modeId,bandId:s.bandId,mapId:s.mapId,
  types,round:s.round,
  waves:Math.max(0,battles-(s.hp>0?0:1)),
  battles,
  cleared:boss&&s.hp>0,
  hp:s.hp,maxHp:s.maxHp,
  finalRound:!!result&&(result.kind==='final-boss'||result.kind==='training-dummy'||s.round>=14),
  finalKind:result?.kind||null,
  finalDamage:Number(result?.totalDamage)||0,
  finalElapsed:Number(result?.elapsed)||0,
  finalDps:Number(result?.dps)||0,
  finalKills:Number(result?.kills)||0,
  finalLeaks:Number(result?.leaks)||0,
  finalBonds,bannedBonds,finalLineup
 });
}
function itemName(data,chessId){
 return data.season.trapChessDataDict?.[chessId]?.name||data.items?.find(i=>i.id===chessId||i.elite?.chessId===chessId)?.name||chessId;
}
// 导出用的完整 JSON：有对局时就是**原来的对局存档**（NativeSession.restore 只读 s/version/battle/savedAt，
// 多出来的字段会被忽略），再加一份档案；没有对局时只导出档案（导入端会识别成「只有战绩」）。
export function exportRecord(game,archive,{expiresAt=null,savedAt=Date.now()}={}){
 const body=game?{...game.snapshot(),savedAt,...(expiresAt!=null?{expiresAt}:{})}:{savedAt};
 return {format:ARCHIVE_FORMAT,archiveVersion:ARCHIVE_VERSION,exportedAt:savedAt,...body,archive:normalizeArchive(archive)};
}
// 导入端用：从任意形态的 JSON 里取出档案部分（没有就返回 null）。
export function archiveFromRecord(record){return isPlainObject(record?.archive)?normalizeArchive(record.archive):null;}
// 对局进程中的「这一局是否已经记录过」标记：记录后写回 s.runRecordId，避免同一局重复入档。
export function alreadyRecorded(archive,runId){return !!runId&&normalizeArchive(archive).runs.some(r=>r.id===runId);}
