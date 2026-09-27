import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeSession} from '../dist/native-session.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {enemyBehaviorProfile} from '../dist/native-combat.js';
import {enemyAttackTargets} from '../dist/native-enemy-attacks.js';
import {enemyFacingDamageMultiplier} from '../dist/native-enemy-traits.js';
import {dealDamage} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const OVERRIDES=JSON.parse(read('data/modes/alliance-lower/enemy-behavior-overrides.json')).overrides;

function arena(ids=['chess_char_1_02_b']){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=1000;g.s.capacity=16;
 for(const id of ids)assert.ok(g.gain(id),'gain '+id);
 for(const u of g.s.units.filter(u=>!u.position)){
  let placed=false;
  for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){
   if(g.s.units.some(v=>v.uid!==u.uid&&v.position?.x===x&&v.position?.y===y))continue;
   if(g.canDeploy(u.uid,x,y))placed=g.deploy(u.uid,x,y,0);
  }
  assert.ok(placed,'no tile for '+u.chessId);
 }
 assert.ok(g.perform('start'),g.lastError||'start failed');
 const b=g.battle;b.s.queue=[];b.s.enemies=[];b.s.limit=1000;
 return {b,g,units:b.s.units};
}
function spawn(b,id,x=3,y=3){
 const raw=NATIVE_DATA.enemies[id],o=b.map.origin,p={col:o.col+x,row:o.row-y};
 b.level={...b.level,routes:[{motionMode:raw.motion||'WALK',startPosition:p,endPosition:p,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};
 b.spawn({id,route:0});const e=b.s.enemies.at(-1);e.baseX=x;e.baseY=y;return e;
}
function advance(b,seconds){for(let i=0;i<Math.round(seconds*30);i++)b.step();}
function place(u,x,y,{hp=100000}={}){u.x=x;u.y=y;u.deployed=true;u.maxHp=hp;u.hp=hp;applyStatus(u,'disarm',600);return u;}
function fatal(b,e){return dealDamage(b,{target:e,value:1e6,type:'true',cause:'attack'});}

test('敌人普攻伤害类型以敌人图鉴 damageType 为准，不再从描述文本推断',()=>{
 const allowed=new Set(['PHYSIC','MAGIC','NO_DAMAGE']);
 for(const [id,e] of Object.entries(NATIVE_DATA.enemies)){
  assert.ok(Array.isArray(e.damageTypes)&&e.damageTypes.length,id+' 缺少图鉴 damageType');
  assert.ok(e.damageTypes.every(k=>allowed.has(k)),id+' 出现未知 damageType: '+e.damageTypes.join('/'));
 }
 const src=read('dist/native-battle.js');
 assert.match(src,/damageType:enemyBaseDamageType\(raw\)/,'spawn 必须读权威字段');
 assert.ok(!/description\|\|''\)\.includes\('法术'\)/.test(src),'不得再从描述文本推断伤害类型');
 // 「法术」只出现在防御/条件分句的物理敌人（曾整批被误判成法伤）
 const physical=['enemy_1422_lrsldr','enemy_1422_lrsldr_2','enemy_1166_dusbr','enemy_1010_demon','enemy_1046_agent','enemy_1071_dftman','enemy_1119_vofsd','enemy_1249_lysdb_2','enemy_1329_cbshld','enemy_10065_ftzlc','enemy_1270_nhstlk'];
 // 描述里没写「法术」但图鉴是 MAGIC 的真法伤（曾整批被误判成物理）
 const arts=['enemy_1041_lazerd','enemy_1209_sfden','enemy_1162_magmot','enemy_1288_duskls','enemy_1501_demonk'];
 const {b}=arena();
 for(const id of physical)assert.equal(spawn(b,id).damageType,'physical',NATIVE_DATA.enemies[id].name);
 for(const id of arts)assert.equal(spawn(b,id).damageType,'arts',NATIVE_DATA.enemies[id].name);
 // 多类型取原表第一项，条件型的第二类型由专属实现改写
 assert.deepEqual(NATIVE_DATA.enemies.enemy_1422_lrsldr.damageTypes,['PHYSIC','MAGIC']);
});

test('心虚设计师正面减伤两种大小写都认，且不再只对圆仔生效',()=>{
 const facing=(talent,x)=>{const e={x:3,facingX:1,enemyTalent:talent};return enemyFacingDamageMultiplier(e,{x},'physical');};
 assert.ok(Math.abs(facing({'weakness.damage_resistance':0.8},4)-0.2)<1e-9,'小写键必须生效');
 assert.ok(Math.abs(facing({'Weakness.damage_resistance':0.8},4)-0.2)<1e-9,'圆仔的大写键仍生效');
 assert.equal(facing({},4),1,'没有该天赋不减伤');
 assert.equal(facing({'weakness.damage_resistance':0.8},2),1,'背面不减伤');
 assert.equal(enemyFacingDamageMultiplier({x:3,facingX:1,enemyTalent:{'weakness.damage_resistance':0.8}},{x:4},'true'),1,'真实伤害不减');
 const {b,units}=arena(),ally=units[0],e=spawn(b,'enemy_10097_crshd');
 assert.equal(e.facingX,1,'原地敌人开场也要定朝向');
 const hit=x=>{ally.x=x;return dealDamage(b,{source:ally,target:e,value:1000,type:'physical',cause:'attack'}).total;};
 const front=hit(4),back=hit(2);
 assert.ok(back>0&&Math.abs(front/back-0.2)<1e-9,'正面应为背面的 20%');
});

test('心虚设计师被阻挡时每秒给阻挡者 15% 攻击力神经损伤，脱离阻挡即停',()=>{
 const {b,units}=arena(),ally=units[0],e=spawn(b,'enemy_10097_crshd');
 place(ally,3,3);b.step();b.step();
 assert.equal(e.block,ally.uid);
 const per=e.atk*0.15;
 assert.ok(Math.abs(ally.elemental.neural-per)<1e-6,'首次结算');
 advance(b,0.9);assert.ok(Math.abs(ally.elemental.neural-per)<1e-6,'未满 1 秒不重复结算');
 advance(b,0.2);assert.ok(Math.abs(ally.elemental.neural-per*2)<1e-6,'每秒一次');
 ally.x=9;ally.y=3;b.step();const held=ally.elemental.neural;
 advance(b,3);assert.equal(ally.elemental.neural,held,'不被阻挡就不再造成神经损伤');
});

test('临时收音师普攻附带 20% 攻击力神经损伤',()=>{
 const {b,units}=arena(),ally=units[0],e=spawn(b,'enemy_10094_crstf');
 assert.equal(e.attackElement,'neural');assert.equal(e.attackElementScale,.2);
 place(ally,3,3);b.step();assert.equal(e.block,ally.uid,'近战敌人需要被阻挡才会攻击');
 for(let i=0;i<300&&e.attackCount<1;i++)b.step();
 assert.equal(e.attackCount,1);
 assert.ok(Math.abs(ally.elemental.neural-e.atk*0.2)<1e-6,'实际 '+ally.elemental.neural);
});

test('主角阵营角色普攻附神经损伤、不对空，首次被击倒后 3 秒满血重生一次',()=>{
 const {b,units}=arena(),ally=units[0],e=spawn(b,'enemy_10098_crhro');
 assert.equal(e.enemyFormKind,'crhro');
 assert.equal(e.damageType,'physical');assert.equal(e.attackElement,'neural');assert.equal(e.attackElementScale,.15);
 assert.equal(e.enemyAttack.groundOnly,true,'初始模式普攻不对空');
 ally.flying=true;place(ally,4,3);b.step();assert.deepEqual(enemyAttackTargets(b,e),[],'不选中飞行单位');
 ally.flying=false;b.step();
 for(let i=0;i<400&&e.attackCount<1;i++)b.step();
 assert.equal(e.attackCount,1);
 assert.ok(Math.abs(ally.elemental.neural-e.atk*0.15)<1e-6,'实际 '+ally.elemental.neural);
 // 重生：3 秒、恢复 100% 生命、无敌 0 秒；只有第一次致命伤触发
 fatal(b,e);assert.equal(e.enemyForm,'rebirth');assert.equal(e.hp,e.maxHp);assert.equal(e.canAttack,false);
 advance(b,3.1);assert.equal(e.enemyForm,'revived');assert.equal(e.invulnerable,false);assert.equal(e.canAttack,true);
 fatal(b,e);assert.equal(e.hp,0,'第二次致命伤不再重生');
});

test('反派阵营角色普攻附神经损伤且不对空',()=>{
 const {b,units}=arena(),ally=units[0],e=spawn(b,'enemy_10099_crvln');
 assert.equal(e.damageType,'arts','图鉴为 MAGIC');
 assert.equal(e.attackElement,'neural');assert.equal(e.attackElementScale,.15);
 assert.equal(e.enemyAttack.groundOnly,true);
 ally.flying=true;place(ally,4,3);b.step();assert.deepEqual(enemyAttackTargets(b,e),[]);
 ally.flying=false;b.step();
 for(let i=0;i<400&&e.attackCount<1;i++)b.step();
 assert.equal(e.attackCount,1);
 assert.ok(Math.abs(ally.elemental.neural-e.atk*0.15)<1e-6,'实际 '+ally.elemental.neural);
});

test('灵幛一次攻击命中攻击范围内的所有我方单位',()=>{
 assert.deepEqual(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_1427_lrnazg).attackProfile,{allInRange:true});
 const {b,units}=arena(),near=[units[0]],e=spawn(b,'enemy_1427_lrnazg',3,3);
 place(near[0],4,3);
 const extra=JSON.parse(JSON.stringify(units[0]));
 for(const [x,y,uid] of [[3,4,9001],[2,3,9002],[6,3,9003]]){const c=structuredClone(extra);c.uid=uid;place(c,x,y);b.s.units.push(c);near.push(c);}
 const far=near[3],targets=near.slice(0,3);
 for(let i=0;i<600&&e.attackCount<1;i++)b.step();
 assert.equal(e.attackCount,1);
 assert.ok(targets.every(u=>u.hp<u.maxHp),'范围内三个都该受伤');
 assert.equal(far.hp,far.maxHp,'范围外不受影响');
});

test('萨卡兹悖谬暴虐兵长占用 3 个阻挡数：剩余阻挡数不足 3 的单位挡不住',()=>{
 assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_1320_wdrrl_2).blockCost,3);
 const {b,units}=arena(['chess_char_1_20_b','chess_char_5_07_b']);
 const defender=units.find(u=>u.id==='char_107_liskam'),solo=units.find(u=>u.id==='char_350_surtr');
 assert.equal(b.stats(defender).blockCnt,3);assert.equal(b.stats(solo).blockCnt,1);
 const e=spawn(b,'enemy_1320_wdrrl_2',4,3);
 place(solo,4.5,3);place(defender,1,8);b.step();
 assert.equal(e.block,null,'1 阻挡单位挡不住占 3 阻挡的敌人');
 place(solo,1,8);place(defender,4.5,3);b.step();
 assert.equal(e.block,defender.uid,'3 阻挡单位可以阻挡');
});

test('越长尘的 4 点阻挡占用来自覆盖表而不是代码硬编码',()=>{
 assert.equal(OVERRIDES.enemy_1302_ymtro_2.blockCost,4);
 assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_1302_ymtro_2).blockCost,4);
 const {b}=arena(),e=spawn(b,'enemy_1302_ymtro_2');
 assert.equal(e.blockCost,4);
 assert.ok(!/blockCost\s*=\s*4/.test(read('dist/native-enemy-transport.js')),'运输模块不再硬编码阻挡占用');
});

test('载客单位处于失衡位移时停止装载，位移结束恢复',()=>{
 const {b}=arena(),carrier=spawn(b,'enemy_10159_mntrjn'),rider=spawn(b,'enemy_1007_slime');
 carrier.shift={vx:0,vy:0,hardUntil:b.s.time+5,startedAt:b.s.time,sourceUid:null,projectile:false,fresh:false,pulls:[],nextDamageAt:b.s.time+5};
 b.step();assert.equal(rider.hidden,false,'失衡位移期间不装载');
 carrier.shift=null;carrier.shiftRejoin=false;b.step();assert.equal(rider.hidden,true,'位移结束后恢复装载');
});

test('自行炮轰炸施法期间获得失衡免疫，技能结束后还原',()=>{
 const {b,units}=arena(),ally=units[0],e=spawn(b,'enemy_1273_stmgun_2');
 place(ally,4,3);ally.invisible=false;
 const skill=e.enemySkills.find(s=>s.prefab==='Cannon');assert.ok(skill);
 skill.used=false;skill.nextAt=0;skill.initCooldown=0;e.sp=e.enemySp?.max||skill.spCost||0;
 for(let i=0;i<90&&!e.enemyCast;i++)b.step();
 assert.equal(e.enemyCast?.channel,'cannon','应进入轰炸施法');
 assert.equal(e.shiftImmune,true,'施法中失衡免疫');
 advance(b,7);
 assert.equal(e.enemyCast,null);
 assert.equal(e.shiftImmune,false,'施法结束还原');
});

test('每个未进随机池的本期敌人都必须在覆盖表登记 randomPoolEligible:false 与 reason',()=>{
 const missing=[];
 for(const [id,e] of Object.entries(NATIVE_DATA.enemies)){
  if(enemyBehaviorProfile(e).randomPoolEligible!==false)continue;
  const row=OVERRIDES[id];
  if(!row||row.randomPoolEligible!==false||!String(row.reason||'').trim())missing.push(id);
 }
 assert.deepEqual(missing,[],'未登记未进池的敌人: '+missing.join('、'));
 assert.equal(Object.keys(NATIVE_DATA.enemies).length,215);
 const excluded=Object.entries(NATIVE_DATA.enemies).filter(([,e])=>enemyBehaviorProfile(e).randomPoolEligible===false).length;
 assert.equal(excluded,32,'本期未进池敌人数量（2026-09-23 放开 6 名领袖后）');
});
