import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_DATA} from '../dist/runtime-data.js';
import {NativeSession} from '../dist/native-session.js';
import {buildPhasePlan} from '../dist/protocol.js';
import {dealDamage} from '../dist/native-effects.js';

// boss_4 盐风主教昆图斯（enemy_1521_dslily）＝最终战逐名实装回归。
// 口径：PRTS 敌人页（级别0）＋本期 h07_04_s 覆盖，见 dist/native-enemy-skills.js 的 tickDslily 注释。
// 用户明确要求最终战忽略断裂生殖/子代；Doom 初始 CD 200 秒，本期最终战最长 145 秒。这里断言两者都不进入逐名技能表。

function game({operators=0,seed=42}={}){
 const g=new NativeSession(NATIVE_DATA,{modeId:'mode_single_normal',bandId:'band_amiya',mapId:NATIVE_DATA.maps[0].stageId,seed,bondBan:{bonds:[]},finalBossId:'boss_4'});
 g.s.round=buildPhasePlan(NATIVE_DATA,g.s.modeId).filter(t=>t.isBossTurn&&!t.isConditional).at(-1).round;
 if(operators){
  g.s.funds=99999;
  const shop=Object.values(NATIVE_DATA.season.charShopChessDatas).filter(x=>x.charId&&!x.isHidden&&NATIVE_DATA.profiles[x.chessId]?.rangeId==='0-1');
  // canDeploy 对「未部署干员踩已占格」是换位语义：必须显式避开已占格；
  // 多干员时轮换不同干员，避免三张同名卡触发「三合一」吞掉单位。
  const occupied=[];
  for(let k=0;k<operators;k++){
   const u=g.gain(shop[k%shop.length].chessId);
   assert.ok(u,'gain '+shop[k%shop.length].chessId);
   let placed=false;
   for(let y=0;y<g.map.rows&&!placed;y++)for(let x=0;x<g.map.cols&&!placed;x++){
    if(occupied.some(p=>p.x===x&&p.y===y))continue;
    if(g.canDeploy(u.uid,x,y)&&g.deploy(u.uid,x,y,0)){occupied.push({x,y});placed=true;}
   }
   assert.ok(placed,'deploy '+shop[k%shop.length].chessId);
  }
 }
 // 三张同名卡会触发「三合一」奖励挂起，挂起时 beginBattle 直接拒绝；测试不消费奖励。
 g.s.rewardPending=null;g.s.rewardQueue=[];
 assert.ok(g.startBattle(),g.lastError||'boss_4 battle failed to start');
 return g;
}
const bossOf=g=>g.battle.s.enemies.find(e=>e.finalBoss);
const steps=(b,seconds)=>{for(let i=0,n=Math.round(seconds*30);i<n;i++)b.step();};
const isolate=(boss,prefab)=>{for(const s of boss.enemySkills)if(s.prefab===prefab)s.nextAt=0;else s.nextAt=Infinity;};
const isolateOff=boss=>{for(const s of boss.enemySkills)s.nextAt=Infinity;};

test('断裂生殖与物种爆发按豁免口径不在技能表；形态技能三组齐备',()=>{
 const g=game(),boss=bossOf(g);
 const prefabs=boss.enemySkills.map(s=>s.prefab);
 for(const name of ['Tidewater','Rockfall','TidewaterG1','RockfallG1','TidewaterG2','RockfallG2'])assert.ok(prefabs.includes(name),'缺少 '+name);
 for(const name of ['SummonTentac','SummonTentacG1','SummonTentacG2','Doom'])assert.ok(!prefabs.includes(name),name+' 应被 ignoredSkillPrefabs 停用');
});

test('普攻：防御最高的2名、攻击本身无伤害、0.4秒后物理+20%神经损伤',()=>{
 const g=game({operators:2}),b=g.battle,boss=bossOf(g);
 isolate(boss,'__none__');
 const [a,c]=b.s.units,hpA=a.hp,hpC=c.hp;
 boss.attackCooldown=0;
 b.step();
 const strike=boss.pendingStrikes?.[0];
 assert.ok(strike,'普攻排入延迟结算');
 assert.ok(strike.at-b.s.time<=0.4+1e-9&&strike.at-b.s.time>0.3,'延迟 0.4 秒');
 assert.equal(a.hp,hpA,'攻击帧本身无伤害');assert.equal(c.hp,hpC);
 steps(b,.6);
 assert.ok(a.hp<hpA&&c.hp<hpC,'0.4 秒后两名目标都受伤');
 assert.equal(boss.enemyTalent['epdamage.attack@ep_damage_ratio'],.2,'神经损伤倍率读本期黑板');
 const elemental=Math.max(a.elemental?.neural||0,c.elemental?.neural||0);
 assert.ok(elemental>0,'附加神经损伤');
});

test('形态（血线）：已损 33% 进第二形态（攻击+40%、G1 组独立初始化 CD），66% 进第三形态（+70%）',()=>{
 const g=game(),b=g.battle,boss=bossOf(g);
 const atkBase=b.enemyAttackDamage(boss,1,null);
 dealDamage(b,{source:null,target:boss,value:Math.floor(boss.maxHp/3)+1,type:'true'});
 b.step();
 assert.equal(boss.dslilyForm,2,'跨过 33% 血线进第二形态');
 assert.ok(Math.abs(b.enemyAttackDamage(boss,1,null)/atkBase-1.4)<1e-9,'攻击力 +40%');
 const tide1=boss.enemySkills.find(s=>s.prefab==='Tidewater'),tideG1=boss.enemySkills.find(s=>s.prefab==='TidewaterG1');
 assert.equal(tide1.nextAt,Infinity,'第一形态技能组停用');
 assert.ok(Math.abs(tideG1.nextAt-b.s.time-15)<1e-9,'G1 组按各自初始 CD 独立初始化');
 dealDamage(b,{source:null,target:boss,value:Math.floor(boss.maxHp/3)+1,type:'true'});
 b.step();
 assert.equal(boss.dslilyForm,3,'累计 66% 进第三形态');
 assert.ok(Math.abs(b.enemyAttackDamage(boss,1,null)/atkBase-1.7)<1e-9,'攻击力 +70%');
 assert.ok(Math.abs(boss.enemySkills.find(s=>s.prefab==='RockfallG2').nextAt-b.s.time-13)<1e-9,'G2 组 CD 独立初始化');
});

test('形态（计时）：开战 75 秒进第二形态；200 秒计时锚点前移同样进第三形态',()=>{
 const g=game(),b=g.battle,boss=bossOf(g);
 steps(b,74.8);
 assert.equal(boss.dslilyForm,1,'75 秒前保持第一形态');
 steps(b,.5);
 assert.equal(boss.dslilyForm,2,'75 秒进第二形态');
 // 本期时限＝100+开战生命（约 130 秒），200 秒计时在真实对局里不可达（第三形态只能靠血线进）；
 // 这里前移计时锚点验证计时触发本身的语义。
 boss.dslilySpawnAt=b.s.time-199.9;
 steps(b,.5);
 assert.equal(boss.dslilyForm,3,'计时到 200 秒进第三形态');
});

test('大潮：全场我方单位受法术伤害并附加神经损伤（数值读各形态黑板）',()=>{
 const g=game({operators:2}),b=g.battle,boss=bossOf(g);
 isolate(boss,'Tidewater');
 boss.attackCooldown=0;
 const [a,c]=b.s.units,hpA=a.hp,hpC=c.hp;
 b.step();
 assert.ok(a.hp<hpA&&c.hp<hpC,'全场两名单位都受伤');
 assert.ok(a.elemental?.neural>0&&c.elemental?.neural>0,'附加神经损伤');
 const expected=boss.enemySkills.find(s=>s.prefab==='Tidewater').bb;
 assert.equal(expected.atk_scale,.5);assert.equal(expected.ep_damage_ratio,.5);
});

test('崩坍：第一形态防御最高2人延迟1秒；第三形态目标数扩到8',()=>{
 {
  const g=game({operators:3}),b=g.battle,boss=bossOf(g);
  isolate(boss,'Rockfall');
  boss.attackCooldown=0;
  b.step();
  const strike=boss.pendingStrikes?.at(-1);
  assert.ok(strike&&strike.entries.length===2,'第一形态选防御最高的 2 人');
  assert.ok(strike.at-b.s.time>0.9&&strike.at-b.s.time<=1,'延迟 1 秒');
  const hp=b.s.units.map(u=>u.hp);
  steps(b,.5);
  assert.deepEqual(b.s.units.map(u=>u.hp),hp,'1 秒内不结算');
  steps(b,.7);
  const damaged=b.s.units.filter(u=>u.hp<hp[b.s.units.indexOf(u)]);assert.ok(damaged.length===2,'恰好 2 人受伤');
 }
 {
  const g=game({operators:3}),b=g.battle,boss=bossOf(g);
  boss.dslilyForm=3; // 直接置第三形态：G2 组目标数 8
  isolateOff(boss);
  boss.enemySkills.find(s=>s.prefab==='RockfallG2').nextAt=0;
  boss.attackCooldown=0;
  b.step();
  const strike=boss.pendingStrikes?.at(-1);
  assert.ok(strike&&strike.entries.length===3,'第三形态目标数 8，全场只有 3 人时全打');
  steps(b,1.2);
  assert.ok(b.s.units.every(u=>u.hp<u.maxHp),'全员受伤');
 }
});

test('击破本体立即胜利，不受形态与残留影响',()=>{
 const g=game({operators:1}),b=g.battle,boss=bossOf(g);
 dealDamage(b,{source:b.s.units[0],target:boss,value:boss.hp+1000,type:'true'});
 g.tick();
 assert.equal(g.s.phase,'finished');
 assert.equal(g.s.runResult.kind,'final-boss');
 assert.equal(g.s.runResult.reason,'boss-killed');
 assert.equal(g.s.runResult.success,true);
});
