import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {renderPreparePage} from '../dist/native-prep.js';
import {appendRun,emptyArchive,normalizeArchive,runRecord,saveArchive,loadArchive} from '../dist/native-archive.js';
import {PASSCODES,applyPasscode,matchPasscode,normalizePasscode} from '../dist/native-passcode.js';

// 大厅「输入密码」的口径（用户 2026-09-27）：输入 20100305 确定 → 弹窗「策略：S.E.E.S.已解锁」
// 并把本地存档的对应标记写成 true；其它数字什么都不做，只提示「什么都没有发生」。
test('密码 20100305 命中并把 S.E.E.S. 标记写成 true',()=>{
 const before=emptyArchive();
 assert.equal(before.flags.sees,false,'默认 false');
 const result=applyPasscode(before,'20100305');
 assert.ok(result.hit,'要命中密码表');
 assert.equal(result.hit.flag,'sees');
 assert.equal(result.hit.title,'策略：S.E.E.S.已解锁');
 assert.equal(result.archive.flags.sees,true);
 assert.equal(before.flags.sees,false,'不能就地改原对象');
 assert.equal(applyPasscode(result.archive,'20100305').archive.flags.sees,true,'重复输入保持 true');
});

test('其它数字什么都不做，档案保持原样',()=>{
 const archive={...emptyArchive(),runs:[{id:'keep',at:5,mapId:'m',types:[]}],prepSkills:{char_498_inside:0}};
 for(const code of ['', '0', '2010030', '20100306', '201003050', '12345678', '2010 0305'.replace(' ','x')]){
  assert.equal(matchPasscode(code),null,'不该命中：'+JSON.stringify(code));
  const result=applyPasscode(archive,code);
  assert.equal(result.hit,null);
  assert.deepEqual(result.archive,normalizeArchive(archive),'没命中时档案内容必须不变（只做一次规范化）');
  assert.equal(result.archive.flags.sees,false);
  assert.equal(result.archive.runs.length,1,'已有战绩不能被碰掉');
 }
 assert.equal(matchPasscode('20100305').name,'S.E.E.S.');
 assert.equal(normalizePasscode(' 2010 0305 '),'20100305');
 assert.equal(matchPasscode(' 2010 0305 ').code,'20100305','空格容忍（键盘只出数字，纯属防御）');
});

test('密码表登记完整：flag 必须在档案默认值里有对应项',()=>{
 const defaults=Object.keys(emptyArchive().flags);
 assert.ok(PASSCODES.length>=1);
 for(const row of PASSCODES){
  assert.match(row.code,/^\d{4,}$/,'密码是纯数字');
  assert.ok(defaults.includes(row.flag),`${row.flag} 要有默认值，否则 normalizeArchive 会把它丢掉`);
  assert.ok(row.title&&row.name);
 }
});

test('解锁后战前准备页的【S.E.E.S.】显示为开',()=>{
 const g=new NativeSessionStub();
 const archive=applyPasscode(appendRun(emptyArchive(),runRecord(g,NATIVE_DATA,{at:1700000000000})),'20100305').archive;
 const html=renderPreparePage(NATIVE_DATA,{tab:'operator'},{esc:v=>String(v??''),avatar:()=>'',archive});
 assert.match(html,/data-act="prep-flags-sees" class="chosen" aria-pressed="true"/);
 assert.ok(html.includes('【S.E.E.S.】开'));
});

test('接线门禁：确认键走 applyPasscode、命中弹窗、未命中只提示「什么都没有发生」',()=>{
 const play=fs.readFileSync('dist/native-play.js','utf8');
 assert.match(play,/import \{PASSCODE_MAX,applyPasscode\} from '\.\/native-passcode\.js'/, '密码逻辑要来自 native-passcode.js');
 assert.match(play,/function passcodeSubmit\(code\)\{\n const result=applyPasscode\(archiveNow\(\),code\);/,'确认后统一走 applyPasscode');
 assert.match(play,/if\(!result\.hit\)\{notice\('什么都没有发生'\);return;\}/,'未命中只提示「什么都没有发生」');
 assert.match(play,/state\.archive=saveArchive\(archiveStorage\(\),result\.archive\)/,'命中要写回本地存档');
 assert.match(play,/\$\{esc\(result\.hit\.title\)\}/,'弹窗用密码表里的标题（策略：S.E.E.S.已解锁）');
 assert.match(play,/const p=state\.passcode\?\?=\{digits:''\}/,'数字键盘的草稿仍在 state.passcode.digits');
 const browser=fs.readFileSync('scripts/build-browser.mjs','utf8');
 assert.ok(browser.includes("'native-passcode.js'"),'打包清单要登记 native-passcode.js');
 // 存档往返：解锁状态要跟着导出/导入走（saveArchive→loadArchive）。
 const store=new Map();
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))};
 const saved=saveArchive(storage,applyPasscode(emptyArchive(),'20100305').archive);
 assert.equal(saved.flags.sees,true);
 assert.equal(loadArchive(storage).flags.sees,true);
});
// 只是给 runRecord 一个「打完的局」的最小会话：字段都在 s 上，不需要真跑战斗。
function NativeSessionStub(){
 return {s:{modeId:'mode_single_normal',bandId:'band_bldsk',mapId:'act1autochess_m03',round:14,hp:10,maxHp:28,units:[],history:[{kind:'training-dummy',totalDamage:1,units:[]}],runResult:{kind:'training-dummy',totalDamage:1,units:[]},waveRoster:{types:['INVISIBLE']},bondBan:{bonds:[]}},bonds:()=>({})};
}
