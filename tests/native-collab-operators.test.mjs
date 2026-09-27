import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {BRANCH_POLICIES,branchBehavior} from '../dist/native-branches.js';
import {COLLAB_HOOKS,collabFor} from '../dist/native-collab.js';
import {prepCatalog} from '../dist/native-prep.js';
import {damageReductionFor} from '../dist/native-operator-effects.js';
import {NO_BOND_BAN} from './no-bond-ban.mjs';
import {openBattle,deployNow,enemy,byId} from './effects-harness.mjs';

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

test('通用减免兜底按文案限定伤害类型（物理减伤不吃法术），联动工作发现的两处一起锁',()=>{
 // 通用层原来只按文案关键词匹配就套减免值，不看伤害类型：写「受到的物理伤害-X%」的天赋会连法术一起减。
 // 埃癸斯的天赋回归把它暴露出来；维娜「诸王的叹息」、濯尘芙蓉「重盈」同属这一类（见 docs 的未闭环清单）。
 const aigis=openBattle([{chessId:'chess_collab_aigis',skillIndex:0}]);
 deployNow(aigis.b);
 const a=byId(aigis.b,'char_4218_aigis');
 assert.equal(damageReductionFor(aigis.b,a,'physical'),.1,'物理受伤吃 10% 减免');
 assert.equal(damageReductionFor(aigis.b,a,'arts'),0,'法术受伤不该吃这条物理减伤');
 assert.equal(damageReductionFor(aigis.b,a,'true'),0,'真实伤害不吃');
 const siege=openBattle([{chessId:'chess_char_6_07_a',skillIndex:0}]);
 deployNow(siege.b);
 const s=byId(siege.b,'char_1019_siege2');
 assert.ok(s,'维娜应当在场上（棋子 chess_char_6_07_a）');
 const self=damageReductionFor(siege.b,s,'physical'),arts=damageReductionFor(siege.b,s,'arts');
 assert.ok(self>0,'维娜「诸王的叹息」自身吃物理减伤（实际 '+self+'）');
 assert.equal(arts,0,'同一条天赋不该减免法术');
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

test('部署触发的天赋不会被通用命中兜底重复施加（虎狼丸的恐惧只来自部署斩击）',()=>{
 // 通用天赋兜底（native-operator-effects 的 after-damage 分支）原来只要黑板里有裸 `fear` 键、
 // 文案里出现「伤害」，就在**每次命中**时挂一次恐惧。虎狼丸「黑色猎犬」正好两样都占，
 // 于是他的普通攻击也附带 4 秒恐惧——天赋本意是「部署斩击的最后一下」才恐惧。
 const {b}=openBattle([{chessId:'chess_collab_kormr',skillIndex:0}]);
 deployNow(b);
 const u=byId(b,'char_4220_kormr');
 assert.ok(u,'虎狼丸应当已经部署');
 const probe=enemy(b,{x:u.x+1,y:u.y,hp:100000,def:0,res:0});
 b.hit(u,probe,242,'arts',{});
 assert.equal(probe.statuses.some(s=>s.kind==='fear'),false,'普通攻击不该附带恐惧（恐惧只来自部署斩击）');
});

test('联动钩子层按 charId 分派，共享文件里七个入口都还在接线',()=>{
 // 实现按人分文件，共享代码只留一次调用；这条门禁防止以后重构时把接线删掉（四个人的行为会一起静默失效）。
 for(const row of roster)assert.ok(COLLAB_HOOKS[row.charId],`${row.name} 要有钩子实现`);
 assert.equal(collabFor({charId:'char_4217_makoto'}),COLLAB_HOOKS.char_4217_makoto);
 // 战斗单位上只有 id（＝charId），没有 charId 字段（native-battle 建单位时写 {uid,id,chessId,source}）：
 // 只认 charId 会让七个钩子在战场上全部静默失效，所以这里按真实形态再锁一遍。
 assert.equal(collabFor({uid:1,id:'char_4217_makoto',chessId:'chess_collab_makoto'}),COLLAB_HOOKS.char_4217_makoto,'战斗单位按 id 取钩子');
 assert.equal(collabFor({uid:2,source:{charId:'char_4218_aigis'}}),COLLAB_HOOKS.char_4218_aigis,'预备态对象按 source.charId 取钩子');
 assert.equal(collabFor({charId:'char_498_inside'}),null,'非联动干员不派发钩子');
 assert.equal(collabFor(null),null);
 const effects=fs.readFileSync('dist/native-effects.js','utf8');
 for(const call of ['collabDeploy(battle,deployed)','collabEvent(battle,type,payload,ctx)','collabTick(battle,u,collabCtx)'])
  assert.ok(effects.includes(call),'native-effects 里缺少 '+call);
 const operator=fs.readFileSync('dist/native-operator-effects.js','utf8');
 for(const call of ['collabStatMods(battle,u,out)','collabSkillStart(battle,u,ctx)','collabAttackModifier(battle,source,target,out)','collabDamageReduction(battle,target,type,attacker,reduction)'])
  assert.ok(operator.includes(call),'native-operator-effects 里缺少 '+call);
 const browser=fs.readFileSync('scripts/build-browser.mjs','utf8');
 for(const file of ['native-collab.js','native-collab-kormr.js','native-collab-aigis.js','native-collab-yukari.js','native-collab-makoto.js'])
  assert.ok(browser.includes("'"+file+"'"),'打包清单要登记 '+file);
});
