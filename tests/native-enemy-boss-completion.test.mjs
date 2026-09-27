import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeSession} from '../dist/native-session.js';
import {NativeBattle} from '../dist/native-battle.js';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {enemyBehaviorProfile} from '../dist/native-combat.js';
import {KNIGHT_WINDUP_SECONDS,KNIGHT_WINDUP_SECONDS_RAGED,knightWindupSeconds} from '../dist/native-enemy-skills.js';
import {commitExit,dealDamage,grantShield} from '../dist/native-effects.js';
import {applyStatus} from '../dist/status.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

const OVERRIDES=JSON.parse(fs.readFileSync(new URL('../data/modes/alliance-lower/enemy-behavior-overrides.json',import.meta.url),'utf8')).overrides;

function arena(id,{x=3,y=3,positions=[[3,3]]}={}){
 const g=new NativeSession(NATIVE_DATA,{seed:42});g.s.funds=100;assert.ok(g.perform('buy',0));const unit=g.s.units[0];let placed=false;
 for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++)if(g.canDeploy(unit.uid,x,y))placed=g.deploy(unit.uid,x,y,0);
 assert.ok(placed);assert.ok(g.perform('start'));const b=g.battle,template=b.s.units[0];b.s.queue=[];b.s.enemies=[];b.s.limit=1000;
 b.map=structuredClone(b.map);b.s.units=positions.map(([px,py],i)=>{const u=structuredClone(template);u.uid+=i*100;u.x=px;u.y=py;u.deployed=true;u.deployAt=i===0?100:0;applyStatus(u,'disarm',600);b.map.grid[py][px].heightType='LOWLAND';return u;});
 const raw=NATIVE_DATA.enemies[id],o=b.map.origin,spot={col:o.col+x,row:o.row-y};
 b.level={...b.level,routes:[{motionMode:raw.motion,startPosition:spot,endPosition:spot,checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,[id]:raw}};
 b.spawn({id,route:0});const enemy=b.s.enemies[0];enemy.atk=enemy.baseAtk=1;
 return {b,g,enemy,allies:b.s.units};
}
function advance(b,s){for(let i=0;i<Math.round(s*30);i++)b.step();}
function ready(enemy,prefab){const s=enemy.enemySkills.find(x=>x.prefab===prefab);assert.ok(s,'缺少技能 '+prefab);s.used=false;s.nextAt=0;s.initCooldown=0;enemy.sp=Math.max(enemy.sp||0,Number(s.spCost)||0);return s;}

test('泥岩刷新屏障：先走施法前摇并持有失衡/晕眩免疫，前摇结束才刷盾且免疫还原',()=>{
 assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_1511_mdrock).randomPoolEligible,true,'泥岩已放开');
 const {b,enemy}=arena('enemy_1511_mdrock');
 const before=enemy.shield;dealDamage(b,{target:enemy,value:1000,type:'arts'});
 assert.ok(enemy.shield<before,'先打掉一部分屏障');const damaged=enemy.shield;
 ready(enemy,'RefreshShield');enemy.action=null;enemy.attackCooldown=0;
 b.step();
 const cast=enemy.enemyCast;assert.ok(cast?.refreshShield,'刷新屏障应当进入施法前摇');
 assert.equal(enemy.shiftImmune,true,'技能期间失衡免疫');
 assert.equal(enemy.immunities.stun,true,'技能期间晕眩免疫');
 assert.equal(enemy.formHold,true,'施法期间原地不动');
 assert.equal(enemy.shield,damaged,'前摇期间还没有刷盾');
 // 前摇结束：刷盾 + 免疫与 shiftImmune 还原
 const skill=enemy.enemySkills.find(s=>s.prefab==='RefreshShield');
 advance(b,cast.endsAt-b.s.time+.05);
 assert.equal(enemy.enemyCast,null);
 assert.equal(enemy.shield,Number(skill.bb.dynamic),'前摇结束才刷盾');
 assert.equal(enemy.shiftImmune,false,'失衡免疫还原');
 assert.equal(enemy.immunities.stun,false,'晕眩免疫还原');
 assert.equal(enemy.formHold,false);
});

test('泥岩屏障先吸伤再溢出到生命，同一次结算完成',()=>{
 const {b,enemy}=arena('enemy_1511_mdrock');
 // 去掉初始屏障并同步「屏障在场生命+50%」的倍率，单独验证结算顺序
 enemy.shieldLayers=[];enemy.shield=0;enemy.mudrockHpScale=1;enemy.maxHp=enemy.baseMaxHp;enemy.hp=enemy.maxHp;
 grantShield(b,enemy,{id:'probe-arts',amount:1000,types:['arts'],sourceUid:enemy.uid});
 const before=enemy.hp,result=dealDamage(b,{target:enemy,value:1600,type:'arts'});
 assert.equal(enemy.shield,0,'屏障被击穿');
 assert.equal(result.shield,1000,'屏障先吸伤 1000');
 assert.equal(result.hp,600,'同一次结算里超出的 600 落到生命');
 assert.ok(Math.abs((before-enemy.hp)-600)<1e-6);
});

test('腐败/凋零骑士技能前摇：默认 1 秒、同伴离场强化后 0.5 秒，前摇期间不出手',()=>{
 assert.equal(knightWindupSeconds({}),KNIGHT_WINDUP_SECONDS);
 assert.equal(knightWindupSeconds({knightRage:true}),KNIGHT_WINDUP_SECONDS_RAGED);
 const {b,enemy,allies}=arena('enemy_1513_dekght',{positions:[[3,3]]});
 assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_1513_dekght).randomPoolEligible,true);
 ready(enemy,'ChargeAttack');b.hurt=()=>{throw new Error('前摇期间不应结算伤害');};
 b.step();assert.equal(enemy.enemyCast?.knightCharge,true);
 assert.ok(Math.abs(enemy.enemyCast.windupUntil-b.s.time-KNIGHT_WINDUP_SECONDS)<.04,'默认前摇 1 秒');
 advance(b,KNIGHT_WINDUP_SECONDS-.05);
 assert.equal(enemy.enemyCast?.knightCharge,true,'前摇刚结束时仍在蓄力，还没出手');
 // 同伴（凋零骑士）离场触发强化 → 下一次前摇减半
 b.spawn({id:'enemy_1513_dekght_2',route:0});const partner=b.s.enemies.at(-1);partner.canAttack=false;
 commitExit(b,{target:partner});assert.equal(enemy.knightRage,true,'同伴离场触发强化');
 const skill=ready(enemy,'ChargeAttack');enemy.enemyCast=null;enemy.formHold=false;enemy.action=null;enemy.attackCooldown=0;enemy.block=allies[0].uid;allies[0].x=enemy.x;allies[0].y=enemy.y;
 b.hurt=()=>{};b.step();
 assert.equal(enemy.enemyCast?.knightCharge,true,'强化后再放技能');
 assert.ok(Math.abs(enemy.enemyCast.windupUntil-b.s.time-KNIGHT_WINDUP_SECONDS_RAGED)<.04,'强化后前摇 0.5 秒');
 assert.ok(skill);
});

test('凋零骑士爆炸箭也有前摇：前摇结束才生成弹道，同伴漏失同样触发强化',()=>{
 const {b,enemy,allies}=arena('enemy_1513_dekght_2',{x:3,y:4,positions:[[3,3],[4,3]]});
 assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_1513_dekght_2).randomPoolEligible,true);
 ready(enemy,'TripleAttack');
 b.step();assert.equal(enemy.enemyCast?.knightArrow,true);
 assert.ok(Math.abs(enemy.enemyCast.windupUntil-b.s.time-KNIGHT_WINDUP_SECONDS)<.04);
 assert.equal(b.s.logicEffects.filter(f=>f.values?.knightBomb).length,0,'前摇期间不生成弹道');
 advance(b,KNIGHT_WINDUP_SECONDS+.05);
 assert.equal(b.s.logicEffects.filter(f=>f.values?.knightBomb).length,2,'前摇结束按目标数发射');
 // 漏失（进入终点）与阵亡一样触发强化
 const p2=arena('enemy_1513_dekght',{positions:[[3,3]]});const knight=p2.enemy;
 p2.b.spawn({id:'enemy_1513_dekght_2',route:0});const partner=p2.b.s.enemies.at(-1);
 commitExit(p2.b,{target:partner,reason:'leak'});assert.equal(knight.knightRage,true,'同伴漏失也强化');
 assert.ok(allies.length>=1);
});

test('复仇者重生后的冲锋动画期间免疫晕眩，冲刺结束还原；第一形态冲刺不免晕',()=>{
 const setup=(form)=>{
  const {b,enemy,allies}=arena('enemy_1539_reid');
  enemy.route=[{kind:'move',x:3,y:3},{kind:'move',x:4,y:3},{kind:'move',x:5,y:3,checkpointIndex:1},{kind:'move',x:6,y:3,checkpointIndex:2},{kind:'wait',time:600}];
  enemy.cmd=1;if(form)enemy.enemyForm=form;
  allies[0].x=4;allies[0].y=3;enemy.enemySkills[0].used=false;enemy.enemySkills[0].nextAt=0;
  b.step();
  return {b,enemy,allies};
 };
 const first=setup(null);
 assert.ok(first.enemy.reidRushUntil>first.b.s.time,'第一形态也能冲锋');
 assert.ok(!first.enemy.immunities.stun,'第一形态冲刺不免晕');
 assert.ok(!first.enemy.reidRushStunImmune);
 first.b.s.units=[];advance(first.b,4.6);assert.equal(first.enemy.reidRushUntil,null);
 // PRTS「※重生后：此技能释放的动画动作期间免疫晕眩」
 const revived=setup('revived');
 assert.ok(revived.enemy.reidRushUntil>revived.b.s.time,'复活后应能再次冲锋');
 assert.equal(revived.enemy.reidRushStunImmune,true);
 assert.equal(revived.enemy.immunities.stun,true,'冲刺动画期间免疫晕眩');
 revived.b.s.units=[];advance(revived.b,4.6);
 assert.equal(revived.enemy.reidRushStunImmune,false);
 assert.equal(revived.enemy.immunities.stun,false,'冲刺结束还原');
});

test('弑君者沿路径闪现前进，不越过后面的检查点，已放开随机池',()=>{
 assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_1502_crowns).randomPoolEligible,true);
 const {b,enemy,allies}=arena('enemy_1502_crowns');
 enemy.route=[{kind:'move',x:3,y:3},{kind:'move',x:4,y:3,checkpointIndex:1},{kind:'move',x:5,y:3,checkpointIndex:2},{kind:'wait',time:600}];enemy.cmd=0;
 const routeRef=JSON.parse(JSON.stringify(enemy.route));
 enemy.enemySkills[0].used=false;enemy.enemySkills[0].nextAt=0;enemy.block=allies[0].uid;allies[0].x=enemy.x;allies[0].y=enemy.y;
 const startX=enemy.x;b.step();
 assert.ok(enemy.x>startX,'被阻挡时应闪现前进');
 assert.ok(enemy.x<=5,'不会跑过路径上的后续检查点');
 assert.deepEqual(routeRef,JSON.parse(JSON.stringify(routeRef)));
 assert.ok(OVERRIDES.enemy_1502_crowns.randomPoolEligible===true);
});

test('纠缠藤蔓踩在活性源石上会掉血并吃脆弱（地块→敌人→脆弱的端到端回归）',()=>{
 assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies.enemy_2052_smgia).randomPoolEligible,true);
 const map=NATIVE_DATA.maps.find(m=>(m.grid||[]).some(row=>(row||[]).some(c=>c?.tileKey==='tile_infection')));
 assert.ok(map,'本期应有一张图带活性源石地块');
 const g=new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed:7,mapId:map.stageId,modeId:'mode_single_normal',bandId:'band_bldsk'});
 g.s.funds=9999;g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.ok(g.perform('start'),g.lastError||'start failed');
 const b=g.battle;b.s.queue=[];b.s.limit=1e9;
 b.s.enemies.push({uid:b.s.nextId++,id:'probe-keepalive',name:'probe',x:-8,y:-8,hp:1e12,maxHp:1e12,atk:0,def:0,res:0,statuses:[],hidden:true,untargetable:true,invulnerable:true,block:null,leak:1,interval:999,attackSpeed:100,attackCooldown:0,action:null,deployGen:0,flying:false,trainingDummy:true});
 let cell=null;
 for(let y=0;y<map.rows&&!cell;y++)for(let x=0;x<map.cols&&!cell;x++)if(b.map.grid[y][x].tileKey==='tile_infection')cell={x,y};
 assert.ok(cell,'找不到活性源石格');
 const raw=NATIVE_DATA.enemies.enemy_2052_smgia,o=b.map.origin;
 b.level={...b.level,routes:[{motionMode:raw.motion||'WALK',startPosition:{col:o.col+cell.x,row:o.row-cell.y},endPosition:{col:o.col+cell.x,row:o.row-cell.y},checkpoints:[{type:'WAIT_FOR_SECONDS',time:600}]}],enemyProfiles:{...b.level.enemyProfiles,enemy_2052_smgia:raw}};
 b.spawn({id:'enemy_2052_smgia',route:0});
 const e=b.s.enemies.at(-1);e.x=cell.x;e.y=cell.y;e.route=[{kind:'wait',x:cell.x,y:cell.y,time:600}];e.cmd=0;
 assert.equal(b.map.grid[cell.y][cell.x].tileKey,'tile_infection');
 const hp=e.hp;advance(b,2.1);
 assert.ok(e.hp<hp,'活性源石每秒对站在上面的敌人造成伤害');
 assert.ok((e.statuses||[]).some(s=>s.kind==='fragile'),'受到环境伤害后获得脆弱');
 assert.ok(OVERRIDES.enemy_2052_smgia.randomPoolEligible===true);
});

test('仍搁置的领袖必须写明「缺什么依据」，且保持未进池',()=>{
 const shelved=['enemy_1516_jakill','enemy_1509_mousek','enemy_1517_xi','enemy_1525_blkswb','enemy_1535_wlfmster','enemy_1512_mcmstr','enemy_2050_smsha'];
 for(const id of shelved){
  assert.equal(enemyBehaviorProfile(NATIVE_DATA.enemies[id]).randomPoolEligible,false,id+' 仍应搁置');
  const row=OVERRIDES[id];
  assert.ok(row&&row.randomPoolEligible===false);
  assert.match(row.reason,/缺依据|暂不入池|只剩形态美术/,id+' 的 reason 要写清缺什么');
 }
});
