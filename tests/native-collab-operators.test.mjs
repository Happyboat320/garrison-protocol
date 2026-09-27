import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {BRANCH_POLICIES,branchBehavior} from '../dist/native-branches.js';
import {prepCatalog} from '../dist/native-prep.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';

// S.E.E.S. 联动四人的实装口径（data/modes/alliance-lower/collab-operators.json）：
// 只作隐藏档进技能测试场，不给盟约／卫戍，不进商店池、不进战前准备名册。
// 数值不抄写：本文件把运行时烘出来的 profile 与权威数据 data/normalized/current.json（rel77.0）逐项对齐。
const registry=JSON.parse(fs.readFileSync('data/modes/alliance-lower/collab-operators.json','utf8'));
const current=JSON.parse(fs.readFileSync('data/normalized/current.json','utf8'));
const roster=registry.operators;
const chessIds=roster.map(o=>o.charId&&NATIVE_DATA.profiles[o.chessId]?o.chessId:null).filter(Boolean);
const profiles=chessIds.map(id=>NATIVE_DATA.profiles[id]);
const profileOf=charId=>profiles.find(p=>p.charId===charId);
const bb=t=>Object.fromEntries((t?.blackboard||[]).map(b=>[b.key,b.value??b.valueStr]));
const talentWith=(p,key)=>(p.activeTalents||[]).find(t=>Object.prototype.hasOwnProperty.call(bb(t),key));
const shots=()=>new NativeSession(NATIVE_DATA,{bondBan:NO_BOND_BAN,seed:11});

test('联动的四个人都烘成了可用的 profile，且星级／职业／分支与登记表一致',()=>{
 assert.equal(profiles.length,4,'四个 profile 都要在运行时里');
 for(const row of roster){
  const entity=current.entities[row.charId];
  assert.ok(entity,`权威数据里应有 ${row.charId}`);
  const p=NATIVE_DATA.profiles[row.chessId];
  assert.equal(p.charId,row.charId);
  assert.equal(p.name,row.name);
  assert.equal(p.rank,row.chessLevel,`${row.name} 的阶级`);
  assert.equal(p.rank,entity.rarity,`${row.name} 阶级＝星级`);
  assert.equal(p.profession,row.profession);
  assert.equal(p.branch,row.branch);
  assert.equal(p.position,row.position);
  assert.equal(p.rangeId,row.rangeId,`${row.name} 的精英化后基础范围`);
  assert.equal(p.teamId,entity.teamId??p.teamId,'S.E.E.S. 队标签来自全局 character_table');
  assert.equal(p.status.evolvePhase,row.status.evolvePhase);
  assert.equal(p.status.charLevel,row.status.charLevel);
  assert.equal(p.skillChoices.length,(entity.skillRefs||[]).length,`${row.name} 的技能档数`);
 }
});

test('属性按「最后精英阶段 + 满级」从权威数据取（不是手抄）',()=>{
 for(const row of roster){
  const entity=current.entities[row.charId],phase=entity.phases.at(-1),frame=phase.attributesKeyFrames.at(-1).data,p=NATIVE_DATA.profiles[row.chessId];
  for(const key of ['maxHp','atk','def','magicResistance','cost','blockCnt']){
   assert.equal(p.attributes[key],frame[key],`${row.name}.${key} 应与 rel77 数据一致`);
  }
  assert.equal(p.attributes.respawnTime,frame.respawnTime,`${row.name} 再部署时间`);
  assert.equal(p.attributes.baseAttackTime,frame.baseAttackTime,`${row.name} 攻击间隔`);
 }
});

test('技能按登记的 skillLevel 取档，黑板书与权威 skill_table 逐项一致',()=>{
 for(const row of roster){
  const entity=current.entities[row.charId],p=NATIVE_DATA.profiles[row.chessId];
  (entity.skillRefs||[]).forEach((ref,index)=>{
   const level=current.skills[ref.skillId].levels[Math.min(row.status.skillLevel-1,current.skills[ref.skillId].levels.length-1)];
   const baked=p.skillChoices[index].skill;
   assert.ok(baked,`${row.name} 技能${index+1} 应当烘进档位`);
   assert.equal(baked.name,level.name);
   assert.equal(baked.spData.spCost,level.spData.spCost,`${row.name}「${level.name}」消耗`);
   assert.equal(baked.spData.initSp,level.spData.initSp,`${row.name}「${level.name}」初始技力`);
   assert.equal(baked.duration,level.duration,`${row.name}「${level.name}」持续时间`);
   assert.deepEqual(bb(baked),bb(level),`${row.name}「${level.name}」黑板`);
  });
 }
});

test('天赋按无潜能（pot0）与最后阶段取档，数值直接来自候选黑板',()=>{
 assert.deepEqual(bb(talentWith(profileOf('char_4220_kormr'),'final_atk_scale')),{atk_scale:1,final_atk_scale:2,fear:4},'虎狼丸「黑色猎犬」（无潜能档；满潜才是 200%／400%）');
 const aigis=talentWith(profileOf('char_4218_aigis'),'damage_scale');
 assert.deepEqual(bb(aigis),{damage_scale:1.1,damage_resistance:.1},'埃癸斯「反暗影特殊压制兵装」');
 const yukari=talentWith(profileOf('char_4219_yukari'),'heal_scale');
 assert.deepEqual(bb(yukari),{max_target:3,heal_scale:1},'岳羽由加莉「治愈之风」');
 const makoto=profileOf('char_4217_makoto'),doll=talentWith(makoto,'sluggish'),sees=talentWith(makoto,'multi_attack_total_cnt');
 assert.deepEqual(bb(doll),{atk:.8,base_attack_time:.4,sluggish:8,max_hp_t1:.35,range_id:0},'结城理「不羁之力」');
 assert.deepEqual(bb(sees),{atk_scale:4.3,multi_attack_total_cnt:1,final_damage_different_ratio:1,range_id:0},'结城理「S.E.E.S. 总攻击」');
 const phases=(profile,key)=>profile.activeTalents.filter(t=>Object.prototype.hasOwnProperty.call(bb(t),key));
 assert.equal(phases(makoto,'sluggish').length,1,'同一档天赋只取一条候选');
 assert.equal(profileOf('char_4220_kormr').skillChoices.length,0,'虎狼丸没有主动技能');
 assert.equal(profileOf('char_4217_makoto').trait?.candidates?.[0]?.blackboard?.find(b=>b.key==='duration')?.value,20,'傀儡师替身时长走分支特性黑板');
});

test('隐藏档不挂盟约与卫戍，商店抽取与战前准备名册都看不到',()=>{
 const g=shots();
 const eligible=g.eligible();
 for(const row of roster){
  const shop=NATIVE_DATA.season.charShopChessDatas[row.chessId];
  assert.ok(shop,`${row.name} 要有商店记录（技能测试场加人需要它）`);
  assert.equal(shop.isHidden,true,`${row.name} 必须是隐藏档`);
  assert.equal(shop.shopLevelSortId,999);
  assert.deepEqual(NATIVE_DATA.season.charChessDataDict[row.chessId].bondIds,[],`${row.name} 不属于任何盟约`);
  assert.deepEqual(NATIVE_DATA.season.charChessDataDict[row.chessId].garrisonIds,[],`${row.name} 没有卫戍`);
  assert.deepEqual(NATIVE_DATA.profiles[row.chessId].bonds,[]);
  assert.deepEqual(NATIVE_DATA.profiles[row.chessId].garrisons,[]);
  assert.ok(!eligible.some(o=>o.chessId===row.chessId),`${row.name} 不该进调配池`);
 }
 g.s.funds=99999;g.s.phase='prep';
 for(let i=0;i<60;i++){
  g.refresh();
  for(const id of g.s.offers)assert.ok(!chessIds.includes(id),`商店刷新不该出现联动档 ${id}`);
  for(const id of Object.keys(g.s.stock||{}))assert.ok(!chessIds.includes(id),`库存表不该出现联动档 ${id}`);
 }
 const catalog=prepCatalog(NATIVE_DATA);
 assert.equal(catalog.operators.length,112,'战前准备仍是 112 名可见预设');
 for(const row of roster)assert.ok(!catalog.operators.some(o=>o.charId===row.charId),`${row.name} 不该出现在战前准备名册`);
});

test('技能测试场是唯一入口：干员表取全部 profile，加人不依赖精英化链',()=>{
 const source=fs.readFileSync('dist/native-play.js','utf8');
 assert.match(source,/sandboxOperators=Object\.values\(data\.profiles\)\.filter\(p=>p\?\.charId\)/, '测试场干员表仍取含隐藏档的全部 profile');
 assert.match(source,/data\.season\.charShopChessDatas\[id\]/, 'sandboxAddOperator 仍按 chessId 取商店记录');
 const pickable=Object.values(NATIVE_DATA.profiles).filter(p=>p?.charId).map(p=>p.chessId);
 for(const row of roster)assert.ok(pickable.includes(row.chessId),`${row.name} 应能在测试场选到`);
 assert.equal(NATIVE_DATA.season.charChessDataDict['chess_collab_makoto'].upgradeChessId,null,'隐藏档没有精锐化链');
});

test('游击手／裂空炮手的特性数据与分支策略一一对应',()=>{
 const rules=JSON.parse(fs.readFileSync('data/prts/branch-rules.json','utf8')).records;
 const yukari=rules.find(r=>r.id==='supportiveranger'),breaker=rules.find(r=>r.id==='skybreaker');
 assert.ok(yukari,'游击手（supportiveranger）要有分支记录');
 assert.equal(yukari.profession,'SUPPORT');
 assert.match(yukari.baseTrait,/触发型效果/);
 assert.equal(yukari.runtime.antiAir,true);
 assert.equal(BRANCH_POLICIES.supportiveranger.antiAir,true);
 const y=profileOf('char_4219_yukari'),b=branchBehavior(y,false);
 assert.equal(b.antiAir,true,'游击手可对空');
 assert.equal(b.damageType,'arts','辅助分支默认法术伤害');
 assert.equal(branchBehavior(y,true).damageType,'arts');
 assert.match(breaker.baseTrait,/技能期间攻击造成范围伤害/);
 assert.equal(breaker.runtime.splashDuringSkill,1.1);
 assert.equal(BRANCH_POLICIES.skybreaker.splashDuringSkill,1.1,'代码里的溅射半径要跟数据一致');
 const a=profileOf('char_4218_aigis');
 assert.equal(branchBehavior(a,false).style,'single','非技能期不溅射');
 assert.equal(branchBehavior(a,false).airOnlyIdle,true);
 const active=branchBehavior(a,true);
 assert.equal(active.style,'splash','技能期攻击变成范围伤害');
 assert.equal(active.radius,1.1);
 assert.equal(BRANCH_POLICIES.supportiveranger.triggerEffect,true,'触发型效果挂在这条分支上');
});

test('四张头像已登记进资源清单且文件在位',()=>{
 const manifest=JSON.parse(fs.readFileSync('dist/assets/prts/manifest.json','utf8'));
 for(const row of roster){
  const entry=manifest.assets[row.charId];
  assert.ok(entry,`${row.name} 的头像要登记`);
  assert.equal(entry.kind,'operator');
  assert.equal(NATIVE_DATA.assets[row.charId],entry.file,'运行时资源表要指向同一文件');
  assert.ok(fs.existsSync('dist/'+entry.file),'头像文件应当落盘：'+entry.file);
  assert.equal(entry.width,180);
  assert.equal(entry.height,180);
  assert.match(entry.sourcePage,/prts\.wiki/,'来源页要留档');
 }
});
