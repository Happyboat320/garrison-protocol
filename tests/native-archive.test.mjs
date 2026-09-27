import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {renderPreparePage} from '../dist/native-prep.js';
import {ARCHIVE_KEY,ARCHIVE_LIMIT,appendRun,archiveFromRecord,emptyArchive,exportRecord,loadArchive,mergeArchives,normalizeArchive,runRecord,saveArchive} from '../dist/native-archive.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// 本地战绩档案（用户 2026-09-27 需求）：最近 10 场对局结果 + 战前准备技能 + 特殊标记开关【S.E.E.S.】（默认 false）。
// 记录字段：词条、地图、存活波数、是否通关、最终轮输出、最终轮盟约情况、最终轮场上具体阵容。
function fakeStorage(initial={}){
 const map=new Map(Object.entries(initial));
 return {getItem:key=>(map.has(key)?map.get(key):null),setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),dump:()=>Object.fromEntries(map)};
}
// 一局打完的会话：真实 NativeSession，只把「战斗结果」按引擎的形状塞进去（历史/结算对象都是普通数据）。
function finishedRun({round=14,hp=12,waves=13,kind='training-dummy',at=1700000000000}={}){
 const g=new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed:7,mapId:'act1autochess_m03'});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 for(const chessId of ['chess_char_6_07_a','chess_char_1_01_a']){
  const u=g.gain(chessId);g.s.rewardPending=null;g.s.rewardQueue=[];
  assert.ok(u,'应当能拿到 '+chessId);
  u.position={x:3,y:3};u.dir=2;u.skillIndex=1;
  if(chessId==='chess_char_6_07_a')u.equipment=[{uid:9001,chessId:Object.keys(NATIVE_DATA.season.trapChessDataDict)[0]}];
 }
 g.s.round=round;g.s.hp=hp;
 g.s.history=[];
 for(let i=1;i<=waves;i++)g.s.history.push({kind:'normal',totalDamage:100+i,elapsed:20,dps:5,kills:i,leaks:0,units:[]});
 if(kind==='training-dummy')g.s.history.push({kind:'training-dummy',totalDamage:987654,elapsed:150,dps:6584.36,kills:0,leaks:0,units:[{uid:1,damage:900000,id:'char_1019_siege2'},{uid:2,damage:87654,id:'char_498_inside'}]});
 else g.s.history.push({kind:'normal',totalDamage:4321,elapsed:30,dps:144.03,kills:3,leaks:2,units:[{uid:1,damage:4321,id:'char_1019_siege2'}]});
 g.s.runResult=g.s.history.at(-1);
 // 盟约读取走真实入口；这里用假的 bonds() 让映射关系可断言（页面标签→原表名字）。
 g.bonds=()=>({kazimierzShip:{count:3,rawCount:2,active:true},lateranoShip:{count:1,rawCount:1,active:false}});
 g.s.bondBan={bonds:['soloShip'],always:[],never:[]};
 return {g,at};
}

test('runRecord 记录词条／地图／存活波数／是否通关／最终轮输出／盟约情况／场上阵容',()=>{
 const {g,at}=finishedRun();
 const run=runRecord(g,NATIVE_DATA,{at});
 assert.equal(run.mapId,'act1autochess_m03');
 assert.equal(run.round,14);
 assert.equal(run.waves,13,'存活波数＝已完成的普通波次（不含木桩轮）');
 assert.equal(run.cleared,true,'打到最终轮且生命>0＝通关');
 assert.equal(run.finalRound,true);
 assert.equal(run.finalKind,'training-dummy');
 assert.equal(run.finalDamage,987654);
 assert.equal(run.finalDps,6584.36);
 assert.equal(run.hp,12);
 assert.equal(run.types.length,3,'开局抽三种特训词条');
 for(const t of run.types)assert.ok(t.name&&t.name!==t.id,'词条要带原表名字');
 assert.deepEqual(run.finalBonds.map(b=>b.id),['kazimierzShip','lateranoShip']);
 assert.equal(run.finalBonds[0].name,NATIVE_DATA.season.bondInfoDict.kazimierzShip.name);
 assert.equal(run.finalBonds[0].count,3);
 assert.equal(run.finalBonds[0].rawCount,2);
 assert.equal(run.finalBonds[0].active,true);
 assert.equal(run.finalBonds[1].active,false);
 assert.deepEqual(run.bannedBonds.map(b=>b.id),['soloShip']);
 assert.equal(run.bannedBonds[0].name,NATIVE_DATA.season.bondInfoDict.soloShip.name);
 const lineup=run.finalLineup;
 assert.equal(lineup.length,2,'只记场上的干员（整备区不算）');
 const siege=lineup.find(u=>u.charId==='char_1019_siege2');
 assert.ok(siege,'阵容里要有维娜');
 assert.equal(siege.name,'维娜·维多利亚');
 assert.equal(siege.x,3);assert.equal(siege.y,3);assert.equal(siege.dir,2);
 assert.equal(siege.skillIndex,1);
 assert.ok(siege.skillName,'要记下携带的技能名');
 assert.equal(siege.damage,900000,'按 uid 把最终轮输出摊到具体干员');
 assert.deepEqual(siege.equipment.map(e=>e.chessId),[Object.keys(NATIVE_DATA.season.trapChessDataDict)[0]]);
 assert.ok(siege.equipment[0].name,'装备要带名字');
 const insider=lineup.find(u=>u.charId==='char_498_inside');
 assert.equal(insider.equipment.length,0);
 assert.ok(insider.damage===0||insider.damage===87654);
});

test('没打到最终轮（生命归零）的记录：未通关、存活波数不含丢掉的那一波',()=>{
 const {g,at}=finishedRun({round:4,hp:0,waves:3,kind:'normal'});
 const run=runRecord(g,NATIVE_DATA,{at});
 assert.equal(run.cleared,false);
 assert.equal(run.finalRound,false);
 assert.equal(run.finalKind,'normal');
 assert.equal(run.battles,4,'总共打了 4 场（第 4 场把生命打空）');
 assert.equal(run.waves,3,'存活波数不含丢掉的那一波');
 assert.equal(run.finalDamage,4321);
});

test('档案只留最近 10 场，同 id 覆盖不重复',()=>{
 let archive=emptyArchive();
 for(let i=1;i<=12;i++)archive=appendRun(archive,{id:'run-'+i,at:1000+i,mapId:'m',types:[]});
 assert.equal(archive.runs.length,ARCHIVE_LIMIT);
 assert.deepEqual(archive.runs.map(r=>r.id),['run-12','run-11','run-10','run-9','run-8','run-7','run-6','run-5','run-4','run-3']);
 archive=appendRun(archive,{id:'run-5',at:9999,mapId:'m2',types:[]});
 assert.equal(archive.runs.length,ARCHIVE_LIMIT,'覆盖同 id 不新增条目');
 assert.equal(archive.runs[0].id,'run-5');
 assert.equal(archive.runs[0].mapId,'m2');
 const kept=archive.runs.filter(r=>r.id==='run-5');
 assert.equal(kept.length,1);
});

test('坏数据不会进档案，特殊标记默认 false 且只认布尔值',()=>{
 const archive=normalizeArchive({runs:[{id:'ok',at:1,mapId:'m'},{id:'no-at',mapId:'m'},{at:2,mapId:'m'},null,'x',{id:'bad-lineup',at:3,mapId:'m',finalLineup:[{x:1},{chessId:'chess_char_1_01_a',name:'隐现'}],types:'nope'}],flags:{sees:'yes',unknown:true},prepSkills:{char_1019_siege2:2,bogus:'x'}});
 assert.deepEqual(archive.runs.map(r=>r.id).sort(),['bad-lineup','ok']);
 assert.equal(archive.flags.sees,false,'非布尔值的标记回落到默认 false');
 assert.deepEqual(Object.keys(archive.flags),['sees','egg325','cat'],'未知标记不入档，三个已知标记各就各位');
 assert.deepEqual(archive.prepSkills,{char_1019_siege2:2});
 const run=archive.runs.find(r=>r.id==='bad-lineup');
 assert.equal(run.types.length,0);
 assert.equal(run.finalLineup.length,1,'缺 chessId 的阵容条目丢掉');
 assert.equal(run.finalLineup[0].name,'隐现');
 assert.equal(emptyArchive().flags.sees,false);
});

test('读写走注入的 storage，读不出／写坏了都退回空档案',()=>{
 const store=fakeStorage();
 assert.equal(loadArchive(store).runs.length,0);
 const saved=saveArchive(store,{runs:[{id:'a',at:1,mapId:'m'}],flags:{sees:true},prepSkills:{char_498_inside:0}});
 assert.equal(saved.flags.sees,true);
 assert.ok(store.dump()[ARCHIVE_KEY],'要写到档案键上');
 const back=loadArchive(store);
 assert.equal(back.runs.length,1);
 assert.equal(back.flags.sees,true);
 store.setItem(ARCHIVE_KEY,'{不是 json');
 assert.equal(loadArchive(store).runs.length,0,'坏 JSON 退回空档案');
 assert.equal(loadArchive(null).runs.length,0);
 assert.doesNotThrow(()=>saveArchive(null,emptyArchive()));
});

test('导出 JSON 能被「导入存档」读回：对局存档照旧可 restore，档案随行',()=>{
 const {g,at}=finishedRun();
 const archive=appendRun(emptyArchive(),runRecord(g,NATIVE_DATA,{at}));
 const record=exportRecord(g,archive,{expiresAt:Date.now()+3600000,savedAt:at});
 const restored=NativeSession.restore(NATIVE_DATA,record);
 assert.ok(restored,'多出来的 archive 字段不能影响原来的读档');
 assert.equal(restored.s.mapId,'act1autochess_m03');
 const incoming=archiveFromRecord(record);
 assert.ok(incoming,'导入端要能取出档案');
 assert.equal(incoming.runs.length,1);
 assert.equal(incoming.runs[0].finalDamage,987654);
 // 只有档案（大厅里没有进行中的对局）时：restore 会拒，但档案仍然能导入。
 const onlyArchive=exportRecord(null,archive,{savedAt:at});
 assert.equal(NativeSession.restore(NATIVE_DATA,onlyArchive),null);
 assert.equal(archiveFromRecord(onlyArchive).runs.length,1);
 assert.equal(archiveFromRecord({s:1}),null,'不是档案的 JSON 返回 null');
});

test('导入时按 id 合并、保留置顶顺序，技能配置与开关一起并进来',()=>{
 const local={runs:[{id:'a',at:5,mapId:'m1'},{id:'b',at:4,mapId:'m2'}],prepSkills:{char_498_inside:0},flags:{sees:false}};
 const incoming={runs:[{id:'c',at:6,mapId:'m3'},{id:'a',at:7,mapId:'m1-new'}],prepSkills:{char_1019_siege2:1},flags:{sees:true}};
 const merged=mergeArchives(local,incoming);
 assert.deepEqual(merged.runs.map(r=>r.id),['a','c','b'],'按时间排序、同 id 用导入的版本');
 assert.equal(merged.runs.find(r=>r.id==='a').mapId,'m1-new');
 assert.deepEqual(merged.prepSkills,{char_498_inside:0,char_1019_siege2:1});
 assert.equal(merged.flags.sees,true);
 let big=emptyArchive();
 for(let i=0;i<20;i++)big=appendRun(big,{id:'x'+i,at:i,mapId:'m'});
 assert.equal(mergeArchives(big,emptyArchive()).runs.length,ARCHIVE_LIMIT);
});

test('战前准备页：最近对局字段全列；未解锁时隐藏彩蛋整块不出现',()=>{
 const {g,at}=finishedRun();
 const archive=appendRun(emptyArchive(),runRecord(g,NATIVE_DATA,{at}));
 const html=renderPreparePage(NATIVE_DATA,{tab:'operator'},{esc:v=>String(v??''),avatar:()=>'',archive});
 for(const label of ['最近对局','词条','地图','存活波数','是否通关','最终轮输出','最终轮盟约情况','最终轮场上阵容'])
  assert.ok(html.includes(label),'页面要列出「'+label+'」');
 assert.ok(html.includes('维娜·维多利亚'),'阵容里要有具体干员');
 assert.ok(html.includes('存活 13 波'));
 assert.ok(html.includes((987654).toLocaleString()),'最终轮输出');
 assert.ok(html.includes(NATIVE_DATA.season.bondInfoDict.kazimierzShip.name),'盟约情况');
 // 特殊标记是隐藏彩蛋（用户 2026-09-27）：未解锁时连「特殊标记」四个字与开关都不该出现。
 assert.ok(!html.includes('特殊标记'),'未解锁时不该看到「特殊标记」');
 assert.ok(!html.includes('prep-flags-sees'),'未解锁时不该有开关按钮');
 assert.ok(!html.includes('S.E.E.S.'),'未解锁时不该泄露彩蛋名字');
 const on=renderPreparePage(NATIVE_DATA,{tab:'operator'},{esc:v=>String(v??''),avatar:()=>'',archive:{...archive,flags:{sees:true}}});
 assert.ok(on.includes('特殊标记'),'解锁后才显示这一块');
 assert.match(on,/data-act="prep-flags-sees" class="chosen" aria-pressed="true"/,'解锁后显示为开且高亮');
 const empty=renderPreparePage(NATIVE_DATA,{tab:'operator'},{esc:v=>String(v??''),avatar:()=>''});
 assert.ok(empty.includes('还没有记录'),'没有档案时给提示，不报错');
 assert.ok(!empty.includes('prep-flags-sees'),'空档案同样看不到彩蛋');
});

test('接线门禁：大厅导出按钮、导入分支、记账时机都在',()=>{
 const play=fs.readFileSync('dist/native-play.js','utf8');
 assert.match(play,/querySelector\('\.native-loadout-actions'\)\?\.insertAdjacentHTML\('beforeend','<button data-act="export">导出存档<\/button>'\)/,'主界面动作行要有导出存档按钮');
 assert.match(play,/if\(a==='export'\)\{const archive=archiveWithPrepSkills\(archiveNow\(\)\)/,'导出走档案＋对局存档');
 assert.match(play,/incoming=archiveFromRecord\(record\)/,'导入要认档案');
 assert.match(play,/if\(!game&&!incoming\)throw Error/,'既没有对局也没有档案时要报错');
 assert.match(play,/saveArchive\(archiveStorage\(\),mergeArchives\(/,'导入要合并而不是覆盖');
 assert.match(play,/recordRunIfOver\(g\)/,'对局结束要记账');
 assert.match(play,/if\(a==='prep-flags-sees'\)/,'开关要有动作');
 const prep=fs.readFileSync('dist/native-prep.js','utf8');
 assert.match(prep,/archiveSection\(archive,esc\)/,'页面要渲染档案区');
 assert.match(prep,/const archive=ui\.archive\|\|loadArchive\(storage\(\)\)/,'页面自己读本地档案（调用签名不变）');
 const browser=fs.readFileSync('scripts/build-browser.mjs','utf8');
 assert.ok(browser.includes("'native-archive.js'"),'打包清单要登记 native-archive.js');
 // 样式单独一个文件，由 native-play 启动时挂 <link>，类名两边要对得上。
 const css=fs.readFileSync('dist/native-archive.css','utf8');
 for(const cls of ['native-prep-archive','native-prep-flags','native-prep-run','native-prep-run-lineup'])
  assert.ok(css.includes('.'+cls),'native-archive.css 要有 .'+cls);
 assert.match(play,/ensureArchiveStyles/,'启动时要挂档案区样式');
 assert.match(play,/href='\.\/native-archive\.css'/);
 assert.ok(fs.existsSync('dist/native-archive.css'));
});
