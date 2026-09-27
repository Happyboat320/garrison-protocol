import test from 'node:test';import assert from 'node:assert/strict';
import {openBattle,deployNow,enemy,byId,logOf,blackboard} from './effects-harness.mjs';
import {yukariHooks as hooks} from '../dist/native-collab-yukari.js';
import {collabFor} from '../dist/native-collab.js';
import {dispatch} from '../dist/native-effects.js';
import reps from './fixtures/effects/representatives.json' with {type:'json'};

// 岳羽由加莉 char_4219_yukari（联动隐藏档 chess_collab_yukari）的回归。
// 口径：天赋/S1/S2 的数值一律从 profile.activeTalents 与 profile.skill 黑板读；文案与备注见
// data/prts/snapshots/2026-09-12-prts/operators.json（S1 备注「※浮空法术伤害半径1.1（碰撞判定）」）。
// 这些用例全部走真实运行时链路：b.activate() → dispatch('skill-start') → operatorSkillStart → collabSkillStart
// → hooks.skillStart；开技事件由 dispatch → collabEvent → hooks.event 派发；逐帧由 tickLogic → collabTick。

function setup(skillIndex=0,extra=[]){
 const {b}=openBattle([{chessId:'chess_collab_yukari',skillIndex},...extra]);
 deployNow(b);
 return {b,u:byId(b,'char_4219_yukari')};
}
function cast(b,u,index=null){
 if(index!=null)u.source.skillIndex=index;
 u.sp=b.spCost(u);u.lastSkill=-999;
 b.activate(u);
}
// 把一名干员的副本放到 (dx,dy) 相对格上；副本是战斗单位，改 uid 以免撞车。
function allyAt(b,template,dx,dy,uid,{ratio=1,hp=null}={}){
 const a=structuredClone(template);
 a.uid=uid;a.x=template.x+dx;a.y=template.y+dy;
 a.hp=hp??Math.max(1,Math.round(a.maxHp*ratio));
 a.statuses=[];a.yukariTriggers=[];a.yukariArcane=null;a.yukariHealAt=null;a.yukariTalentPending=false;a.deployed=true;
 b.s.units.push(a);
 return a;
}
const damageRows=b=>logOf(b,'damage');
const s1Rows=b=>damageRows(b).filter(r=>r.sourceUid===byId(b,'char_4219_yukari').uid);

test('岳羽由加莉 S1「龙卷箭」：三发 multi_atk_scale ＋一次 final_atk_scale 法术伤害并浮空 levitate 秒',()=>{
 const {b,u}=setup(0);
 const rows=blackboard(b.profile(u).skill.blackboard);
 assert.equal(rows.multi_atk_scale,0.8,'无潜能专三档：每发 80%');
 assert.equal(rows.final_atk_scale,4);
 assert.equal(rows.levitate,1.5);
 const e=enemy(b,{x:u.x+1,y:u.y,hp:1e9,atk:0});
 const atk=b.stats(u).atk,hp0=e.hp;
 cast(b,u,0);
 const hits=s1Rows(b).filter(r=>r.targetUid===e.uid);
 assert.equal(hits.length,4,'三发箭矢 + 一次追加范围伤害 = 4 条伤害结算');
 assert.ok(hits.slice(0,3).every(r=>Math.abs(r.hp-atk*rows.multi_atk_scale)<1e-6),'前三发各为 80% 攻击力');
 assert.ok(Math.abs(hits[3].hp-atk*rows.final_atk_scale)<1e-6,'追加伤害为 400% 攻击力');
 assert.ok(Math.abs(hp0-e.hp-atk*(3*rows.multi_atk_scale+rows.final_atk_scale))<1e-6,'合计 3×80% + 400%');
 assert.ok(hits.every(r=>r.cause==='skill'),'全部按技能伤害结算');
 const lev=(e.statuses||[]).find(s=>s.kind==='levitate');
 assert.ok(lev,'目标必须被浮空');
 assert.equal(lev.source,u.uid);
 assert.ok(Math.abs(lev.remaining-rows.levitate)<1e-9,`浮空时长取黑板 levitate=${rows.levitate}（通用兜底的 2 秒要被压回原表值）`);
});

test('岳羽由加莉 S1：追加伤害是按 1.1 半径的圆判定，单体三发不打第二个敌人',()=>{
 const {b,u}=setup(0);
 const final=blackboard(b.profile(u).skill.blackboard).final_atk_scale,atk=b.stats(u).atk;
 const primary=enemy(b,{x:u.x+1,y:u.y,hp:1e9,atk:0});      // 主目标（s.enemies 里第一个可打目标）
 const near=enemy(b,{x:u.x+2,y:u.y,hp:1e9,atk:0});          // 与主目标距离 1 → 在 1.1 内
 const far=enemy(b,{x:u.x+3,y:u.y,hp:1e9,atk:0});           // 与主目标距离 2 → 1.1 之外
 assert.ok(b.targets(u).includes(far),'第三个敌人本身在攻击范围内，只是吃不到这次溅射');
 const before=[primary,near,far].map(e=>e.hp);
 cast(b,u,0);
 assert.equal(before[0]-primary.hp,atk*(3*0.8+final),'主目标吃三发＋追加');
 assert.ok(Math.abs(before[1]-near.hp-atk*final)<1e-6,'相邻敌人只吃追加的范围伤害');
 assert.equal(before[2]-far.hp,0,'1.1 半径外的敌人不吃追加伤害');
 assert.equal((near.statuses||[]).some(s=>s.kind==='levitate'),true,'追加伤害命中的目标一起被浮空');
 assert.equal((far.statuses||[]).some(s=>s.kind==='levitate'),false,'没被追加伤害打到的目标不浮空');
});

test('岳羽由加莉天赋「治愈之风」：技能结束后治疗自身与攻击范围内生命比例最低的至多 3 名干员',()=>{
 const {b,u}=setup(0);
 const talent=b.profile(u).activeTalents.find(t=>t.name==='治愈之风');
 const rows=blackboard(talent.blackboard);
 assert.equal(rows.max_target,3,'无潜能二阶段：最多 3 名');
 assert.equal(rows.heal_scale,1);
 const atk=b.stats(u).atk;
 u.hp=Math.round(u.maxHp*0.5);                                        // 自身 50%
 const low=allyAt(b,u,1,0,9001,{ratio:0.2});
 const mid=allyAt(b,u,2,0,9002,{ratio:0.4});
 const high=allyAt(b,u,1,1,9003,{ratio:0.6});                         // 生命比例第 4 低 → 超出 max_target
 const full=allyAt(b,u,2,1,9004,{ratio:1});                           // 满血 → 不参与
 const outside=allyAt(b,u,6,0,9005,{ratio:0.1});                      // 攻击范围外
 assert.equal(b.inside(u,outside,false),false,'范围外的那名干员不该被选');
 cast(b,u,0);                                                          // 瞬发技能：开技帧挂标记
 const before=[u,low,mid,high,full,outside].map(v=>v.hp);
 assert.equal(u.yukariHealAt,b.s.time,'瞬发技能的「技能结束后」在逐帧钩子补结算');
 b.step();                                                             // 同一帧的 tickLogic 会结算
 const healed=[u,low,mid,high,full,outside].map((v,i)=>v.hp-before[i]);
 assert.equal(healed[0],u.maxHp-before[0],'自身按攻击力 100% 治疗（此处受满血上限截断）');
 assert.ok(Math.abs(healed[1]-atk*rows.heal_scale)<1e-6,'生命比例最低的友军吃满一次治疗');
 assert.ok(Math.abs(healed[2]-atk*rows.heal_scale)<1e-6);
 assert.equal(healed[3],0,'第 4 低生命比例的友军超出 max_target');
 assert.equal(healed[4],0,'满血友军不吃治疗');
 assert.equal(healed[5],0,'范围外不治疗');
 const entry=logOf(b,'yukari-talent-heal').at(-1);
 assert.ok(entry,'天赋治疗要留一条结算记录');
 assert.deepEqual(entry.targets,[low.uid,mid.uid,u.uid],'选取次序：生命比例升序（自身也参与，满血时会被满血截断）');
 assert.equal(entry.amount,atk*rows.heal_scale);
 // 持续型技能的「技能结束后」走真正的 skill-end 事件；消费一次后不再重复
 const again=[low,mid].map(v=>v.hp);
 u.yukariTalentPending=true;
 dispatch(b,'skill-end',{target:u});
 assert.equal(u.yukariTalentPending,false,'skill-end 分支要走同一份治疗实现并复位标记');
 assert.ok(low.hp>again[0]||mid.hp>again[1],'skill-end 分支同样会治疗');
 assert.ok(low.hp>again[0]||mid.hp>again[1]);
});

test('岳羽由加莉 S2「明镜止水」：最多 max_target 名干员获得触发型效果，优先结城理与术师',()=>{
 const {b,u}=setup(1,[{chessId:'chess_collab_makoto',skillIndex:0},reps.operators.dusk,reps.operators.yak]);
 const rows=blackboard(b.profile(u).skill.blackboard);
 assert.equal(rows.max_target,4,'无潜能专三档：最多 4 名');
 assert.equal(rows.duration,15);
 assert.equal(rows.damage_up,0.3);
 const makoto=byId(b,'char_4217_makoto'),dusk=byId(b,'char_2015_dusk'),yak=byId(b,'char_199_yak');
 assert.equal(b.profile(makoto).profession,'SPECIAL');
 assert.equal(b.profile(dusk).profession,'CASTER');
 makoto.x=u.x+1;makoto.y=u.y;dusk.x=u.x+2;dusk.y=u.y;yak.x=u.x;yak.y=u.y+1;
 const extra=allyAt(b,yak,1,1,9001);                                   // 第五名候选（同职业、uid 更大）
 for(const v of [u,makoto,dusk,yak,extra])assert.ok(b.inside(u,v,true),'候选都要在射程内');
 cast(b,u,1);
 const chosen=logOf(b,'yukari-mirror-calm').at(-1).targets;
 assert.equal(chosen.length,rows.max_target);
 assert.ok(chosen.includes(makoto.uid),'结城理优先');
 assert.ok(chosen.includes(dusk.uid),'其次术师干员');
 assert.ok(chosen.includes(u.uid),'自身也在射程内、属于末尾顺位');
 assert.equal(chosen.includes(extra.uid),false,'同顺位按部署先后（同帧按 uid）取人，超出的不发');
 for(const v of [u,makoto,dusk,yak]){
  const trig=(v.yukariTriggers||[]).find(t=>t.sourceUid===u.uid);
  assert.ok(trig,`${v.id} 应拿到触发型效果`);
  assert.equal(trig.damageUp,rows.damage_up);
  assert.equal(trig.duration,rows.duration);
 }
});

test('岳羽由加莉 S2：被施加者开技后获得 duration 秒的术法充盈，施加当帧不自我触发',()=>{
 const {b,u}=setup(1,[{chessId:'chess_collab_makoto',skillIndex:0}]);
 const makoto=byId(b,'char_4217_makoto');
 makoto.x=u.x+1;makoto.y=u.y;
 assert.equal(collabFor(u),hooks,'battle 单位要能按 id(=charId) 取到本文件的钩子');
 cast(b,u,1);                                                          // 施加触发型效果
 assert.equal(u.yukariTriggers.length,1,'自身也在射程内，会拿到一份');
 assert.equal(u.yukariArcane,undefined,'施加的那一帧自己不算「施放技能后」——同帧不得自我触发');
 assert.equal(u.statuses.some(s=>s.kind==='magicArcane'),false);
 cast(b,makoto,0);                                                     // 友军开技 → 派发 skill-start
 assert.ok(makoto.yukariArcane,'被施加者开技后要起效');
 assert.equal(makoto.yukariArcane.value,0.3);
 assert.equal(makoto.yukariArcane.until,b.s.time+15,'窗口时长取黑板 duration');
 assert.equal(makoto.yukariTriggers.length,0,'触发型效果消费一次');
 const arc=makoto.statuses.find(s=>s.kind==='magicArcane');
 assert.ok(arc,'术法充盈要落成一条可见状态（时长交给状态表逐帧走）');
 assert.equal(arc.source,u.uid);
 assert.ok(Math.abs(arc.remaining-15)<1e-9);
 assert.equal(arc.value,0.3);
 cast(b,u,0);                                                          // 她自己下一次开技才消费自己那份
 assert.ok(u.yukariArcane,'下一次开技时自己的那份才触发');
 assert.equal(u.yukariTriggers.length,0);
 // 离场要把触发型效果与窗口清掉（否则再部署回来还带着上一世的术法充盈）
 dispatch(b,'exit',{target:makoto,reason:'retreat'});
 assert.equal(makoto.yukariArcane,null);
 assert.equal(makoto.yukariTriggers.length,0);
});

test('岳羽由加莉 S2：术法充盈的数值只从技能黑板读（改黑板 → 触发窗口跟着变）',()=>{
 const {b,u}=setup(1);
 const skill=b.profile(u).skill;
 const row=key=>skill.blackboard.find(r=>r.key===key);
 const original={damage_up:row('damage_up').value,duration:row('duration').value};
 try{
  row('damage_up').value=0.5;row('duration').value=5;
  cast(b,u,1);
  const trig=u.yukariTriggers.find(t=>t.sourceUid===u.uid);
  assert.equal(trig.damageUp,0.5,'触发型效果里的增伤来自黑板');
  assert.equal(trig.duration,5);
  cast(b,u,0);                                                         // 下一次开技触发窗口
  assert.equal(u.yukariArcane.value,0.5);
  assert.equal(u.yukariArcane.until,b.s.time+5);
  const arc=u.statuses.find(s=>s.kind==='magicArcane');
  assert.equal(arc.value,0.5);
  assert.ok(Math.abs(arc.remaining-5)<1e-9);
  const e=enemy(b,{x:u.x+1,y:u.y,hp:1e9,atk:0});
  const hp0=e.hp;b.hit(u,e,100,'arts');
  assert.ok(Math.abs(hp0-e.hp-100*(1+0.5))<1e-6,'自己作为伤害来源时按黑板值增伤');
  b.s.time=u.yukariArcane.until+1;
  const hp1=e.hp;b.hit(u,e,100,'arts');
  assert.ok(Math.abs(hp1-e.hp-100)<1e-6,'窗口过期后不再增伤');
 }finally{row('damage_up').value=original.damage_up;row('duration').value=original.duration;}
});

test('术法充盈：任何干员（含友军）在窗口内造成的伤害都乘 (1+damage_up)',()=>{
 const {b,u}=setup(1,[{chessId:'chess_collab_makoto',skillIndex:0}]);
 const makoto=byId(b,'char_4217_makoto');
 makoto.x=u.x+1;makoto.y=u.y;
 cast(b,u,1);                                                          // S2 给范围内友军挂触发型效果
 cast(b,makoto,0);                                                     // 友军开技 → 消费触发、拿到窗口
 assert.ok(makoto.statuses.some(s=>s.kind==='magicArcane'&&Math.abs(s.value-0.3)<1e-9),'发到友军身上的术法充盈状态确实存在');
 assert.ok(makoto.yukariArcane&&makoto.yukariArcane.until>b.s.time,'友军的术法充盈窗口在');
 const e=enemy(b,{x:makoto.x+1,y:makoto.y,hp:1e9,atk:0});
 const hp0=e.hp;b.hit(makoto,e,100,'arts');
 assert.ok(Math.abs(hp0-e.hp-130)<1e-6,'友军的伤害乘上 (1+damage_up)：'+(hp0-e.hp));
 // 窗口过期后回到原值。
 makoto.yukariArcane.until=b.s.time-.01;
 const hp1=e.hp;b.hit(makoto,e,100,'arts');
 assert.ok(Math.abs(hp1-e.hp-100)<1e-6,'过期后不再加成');
 // 自己作为伤害来源同样走共享层那一条通道；本文件不再自己乘算（否则同一份加成算两遍）。
 assert.equal(typeof hooks.attackModifier,'undefined','增伤已收到共享层通道，本文件不再挂钩子');
 const self=enemy(b,{x:u.x,y:u.y+1,hp:1e9,atk:0});
 u.yukariArcane={until:b.s.time+10,value:.3,sourceUid:u.uid};
 const hp2=self.hp;b.hit(u,self,100,'arts');
 assert.ok(Math.abs(hp2-self.hp-130)<1e-6,'自己作为来源也照旧加成');
});
