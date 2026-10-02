import {permissions,applyStatus,removeStatus,isIsolated} from './status.js';
import {attackableAllies,dealDamage,applyLoss,applyElementDamage,commitExit,getActor,newAttackId,addEffect,grantShield,teleportActor} from './native-effects.js';
import {FPS} from './combat.js';
import {windupSeconds,enemyChainTargets,enemyRayHitDistance,enemyTargetValid,compareEnemyTargets} from './native-combat.js';

const ATTACK_SKILLS=new Set(['AOEAttack','CrossAttack','PowerAttack','StunAttack','stuncombat','DeathEye','PollutedRangedAtk','ironsandstorm','armorpiercing']);
const VISUAL_SKILLS=new Set(['BornAnim','StartRun','EndAnim','BeginAnim']);

// 腐败/凋零骑士的技能前摇（用户 2026-09-23 口径）：发动前一秒本体紫色发光闪烁；同伴离场触发强化后缩到半秒。
export const KNIGHT_WINDUP_SECONDS=1;
export const KNIGHT_WINDUP_SECONDS_RAGED=.5;
export function knightWindupSeconds(enemy){return enemy?.knightRage?KNIGHT_WINDUP_SECONDS_RAGED:KNIGHT_WINDUP_SECONDS;}

// 敌人只有一个共享SP槽；每个技能有独立CD。负CD表示不靠CD自动就绪，仍可消耗SP。
export function initEnemySkills(enemy,raw,now){
 enemy.enemyTags=raw.enemyTags||[];
 enemy.enemyPeriodicSpawn??=raw.enemyBehavior?.periodicSpawn||null;
 if(enemy.id==='enemy_10034_cnvsax'){enemy.jazzCounterMode??=false;enemy.jazzModeChanged??=false;}
 if(raw.skills?.some(s=>s.prefabKey==='boomb'))enemy.canAttack=enemy.baseCanAttack=false;
 if(enemy.id==='enemy_10001_trslim')enemy.lowHpRatio=0; // 逃跑由一次性技能负责，不走通用永久低血强化。
 if(enemy.id==='enemy_1504_cqbw')enemy.lowHpRatio=0;
 if(enemy.enemySkills){for(const s of enemy.enemySkills)s.initCooldown??=Number(raw.skills?.find(row=>row.prefabKey===s.prefab)?.initCooldown??0);return;}
 enemy.enemySkills=(raw.skills||[]).filter(s=>s.prefabKey&&(!VISUAL_SKILLS.has(s.prefabKey)||s.prefabKey==='StartRun'&&enemy.id==='enemy_10001_trslim')&&!(raw.enemyBehavior?.ignoredSkillPrefabs||[]).includes(s.prefabKey)).map((s,index)=>({
  index,prefab:s.prefabKey,priority:Number(s.priority)||0,cooldown:Number(s.cooldown),initCooldown:Number(s.initCooldown),spCost:Number(s.spCost)||0,
  nextAt:Number(s.initCooldown)>=0?now+Number(s.initCooldown):null,used:false,
  bb:Object.fromEntries((s.blackboard||[]).map(r=>[r.key,r.valueStr??r.value]))
 }));
 enemy.enemySp=raw.spData?{type:raw.spData.spType,max:Math.max(0,Number(raw.spData.maxSp)||0),increment:Number(raw.spData.increment)||0}:null;
 enemy.sp=Math.min(enemy.enemySp?.max||0,Math.max(0,Number(raw.spData?.initSp)||0));
 enemy.enemyRank=raw.levelType||'NORMAL';
 enemy.enemyTalent=Object.fromEntries((raw.talentBlackboard||[]).map(r=>[r.key,r.valueStr??r.value]));
 if(enemy.id==='enemy_10087_hlchgr')enemy.nextEnhanceAt=now+Number(enemy.enemyTalent['SkillTrigger.interval']);
 if(enemy.id==='enemy_10034_cnvsax'){enemy.jazzCounterMode=false;enemy.jazzModeChanged=false;}
 if(enemy.id==='enemy_10044_wintun'){enemy.wineCarrying=true;enemy.canAttack=false;enemy.speed=enemy.baseSpeed*Number(enemy.enemyTalent['1.move_speed']);}
}

export function changeEnemySp(enemy,amount,{duringSkill=false}={}){
 if(!enemy.enemySp||enemy.hp<=0||!Number.isFinite(amount)||(!duringSkill&&enemy.enemyCast))return 0;
 const before=enemy.sp;enemy.sp=Math.max(0,Math.min(enemy.enemySp.max,before+amount));return enemy.sp-before;
}
export function enemySpEvent(enemy,type){
 if(enemy.enemySp?.type===type)return changeEnemySp(enemy,enemy.enemySp.increment);
 return 0;
}
export function enemySkillReady(enemy,skill,now){
 if(enemy.enemyCast||skill.used&&['AOEAttack','boomb','BlockedBoom','StartRun'].includes(skill.prefab))return false;
 if(skill.nextAt!=null&&now+1e-9<skill.nextAt)return false;
 if(skill.nextAt==null&&skill.spCost<=0)return false;
 return skill.spCost<=0||enemy.sp+1e-9>=skill.spCost;
}
export function beginEnemySkill(battle,enemy,skill,extra={}){
 if(!enemySkillReady(enemy,skill,battle.s.time))return false;
 const spent=extra.allSp?enemy.sp:skill.spCost;
 changeEnemySp(enemy,-spent);
 enemy.enemyCast={index:skill.index,spent,...extra};
 if(extra.shiftImmune){enemy.enemyCast.baseShiftImmune=!!enemy.shiftImmune;enemy.shiftImmune=true;}
 if(skill.prefab==='DeathEye'){
  enemy.enemyCast.immunities={...enemy.immunities};removeStatus(enemy,'silence');enemy.immunities={...enemy.immunities,silence:true};
 }
 battle.emit('enemy-skill-start',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:skill.prefab,sp:enemy.sp});
 return true;
}
export function endEnemySkill(battle,enemy,{refund=false}={}){
 const cast=enemy.enemyCast;if(!cast)return;
 const skill=enemy.enemySkills[cast.index];enemy.enemyCast=null;
 if(cast.immunities)enemy.immunities=cast.immunities;
 if(cast.baseShiftImmune!==undefined)enemy.shiftImmune=cast.baseShiftImmune;
 if(refund)changeEnemySp(enemy,cast.spent);
 else skill.used=true;
 skill.nextAt=skill.cooldown>=0?battle.s.time+skill.cooldown:null;
 enemy.nextSkillAt=skill.nextAt??Infinity;
 battle.emit('enemy-skill-end',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:skill.prefab,refunded:refund});
}

export function selectEnemyAttackSkill(battle,enemy,target){
 if(!target||enemy.enemyCast)return null;
 if(['enemy_1404_msnip','enemy_1517_xi'].includes(enemy.id))return null; // 专属施法，不复用通用CrossAttack命中目标。
 const ready=enemy.enemySkills.filter(s=>ATTACK_SKILLS.has(s.prefab)&&enemySkillReady(enemy,s,battle.s.time)&&
  !(enemy.id==='enemy_2003_rockman'&&s.prefab==='StunAttack')&&
  !(s.prefab==='ironsandstorm'&&enemy.enemyForm!=='warden')&&
  !(s.prefab==='armorpiercing'&&(enemy.enemyForm!=='assassin'||enemy.block!==target.uid))&&
  !(s.prefab==='CrossAttack'&&Math.abs(enemy.x-target.x)>1e-6&&Math.abs(enemy.y-target.y)>1e-6)&&
  !(s.prefab==='DeathEye'&&enemy.deathEye));
 if(!ready.length)return null;
 const priority=Math.min(...ready.map(s=>s.priority)),top=ready.filter(s=>s.priority===priority);
 const skill=top.length===1?top[0]:top[Math.floor(battle.economy.random()*top.length)];
 return {index:skill.index,prefab:skill.prefab,scale:Number(skill.bb.atk_scale??skill.bb.damage_scale)||1,
  radius:Number(skill.bb.range_radius)||1,splash:skill.prefab==='AOEAttack',stun:Number(skill.bb.stun)||0,stunBeforeDamage:skill.prefab==='StunAttack',
  type:['CrossAttack','ironsandstorm'].includes(skill.prefab)?'arts':skill.prefab==='armorpiercing'?'physical':null,noDirectAttack:skill.prefab==='DeathEye',polluted:skill.prefab==='PollutedRangedAtk',
  targets:skill.prefab==='ironsandstorm'?Number(skill.bb.max_target):undefined,hits:skill.prefab==='armorpiercing'?Number(skill.bb.times):undefined,defPenetration:skill.prefab==='armorpiercing'?Number(skill.bb.def_penetrate):undefined};
}

function releaseCaptured(battle,enemy,cast){
 for(const uid of cast.victims||[]){const victim=getActor(battle.s,uid);if(victim?.swallowedBy===enemy.uid){delete victim.swallowedBy;removeStatus(victim,'root',enemy.uid);}}
}
export function checkWEnrage(battle,enemy){
 if(enemy.id!=='enemy_1504_cqbw'||enemy.wEnraged||enemy.hp<=0||enemy.hp>=enemy.maxHp*.5)return;
 const skill=enemy.enemySkills?.find(s=>s.prefab==='C4');if(!skill)return;
 enemy.wEnraged=true;skill.nextAt=battle.s.time;enemy.nextSkillAt=skill.nextAt;
 if(enemy.enemyCast?.c4Targets)enemy.enemyCast.c4CooldownReset=true;
 battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'low-hp'});
}
function detonateC4(battle,enemy){
 const cast=enemy.enemyCast;if(!cast?.c4Targets)return;
 const skill=enemy.enemySkills[cast.index];
 // 先结束施法并清引用，避免爆炸引发退场/反伤时重入引爆。
 endEnemySkill(battle,enemy);enemy.formHold=false;
 if(cast.c4CooldownReset){skill.nextAt=battle.s.time;enemy.nextSkillAt=skill.nextAt;}
 for(const bomb of cast.c4Targets){
  const target=getActor(battle.s,bomb.uid);
  if(!target?.deployed||target.hp<=0||target.deployGen!==bomb.deployGen)continue;
  battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'physical',attackId:cast.attackId,suppressAttackZone:true});
  battle.emit('impact',{uid:enemy.uid,x:target.x,y:target.y,radius:.3,type:'physical',enemy:true});
 }
}
export function cancelEnemyCast(battle,enemy,{lostTarget=false}={}){
 if(enemy.zaroCage&&(enemy.hp<=0||enemy.enemyForm!=='initial'))clearZaroCage(battle,enemy);
 const cast=enemy.enemyCast;if(!cast)return;
 if(cast.c4Targets){detonateC4(battle,enemy);return;}
 if(cast.xiCross){enemy.formHold=false;endEnemySkill(battle,enemy);return;}
 if(cast.xiBurst){enemy.formHold=false;enemy.shiftImmune=cast.previousShiftImmune;enemy.shieldLayers=(enemy.shieldLayers||[]).filter(l=>l.id!=='xi-burst');enemy.shield=enemy.shieldLayers.reduce((n,l)=>n+l.remaining,0);endEnemySkill(battle,enemy);return;}
 if(cast.degenCircle||cast.phantomAoe||cast.wildCalling){enemy.formHold=false;endEnemySkill(battle,enemy);return;}
 if(cast.crossShot){enemy.formHold=false;enemy.formInvisible=enemy.baseInvisible;enemy.invisible=enemy.formInvisible&&!enemy.revealed;endEnemySkill(battle,enemy);return;}
 if(cast.knightCharge||cast.knightArrow||cast.refreshShield){enemy.formHold=false;endEnemySkill(battle,enemy);return;}
 if(cast.bomb){enemy.formHold=false;endEnemySkill(battle,enemy,{refund:true});return;}
 if(cast.charge&&!cast.hitAttempted){
  const short=(enemy.statuses||[]).some(s=>s.kind==='stun'||s.kind==='sleep');
  enemy.enemyLostUntil=battle.s.time+Number(enemy.enemyTalent[short?'data.attack@fail_duration2':'data.attack@fail_duration']);
  enemy.canAttack=false;
 }
 releaseCaptured(battle,enemy,cast);enemy.stanceUntil=0;
 endEnemySkill(battle,enemy,{refund:lostTarget&&enemy.enemySkills[cast.index].prefab==='PollutedRangedAtk'});
}

function endZaroVictim(battle,enemy,entry,skill){
 const target=getActor(battle.s,entry.uid),source='zaro-cage:'+enemy.uid;
 if(target&&target.deployGen===entry.deployGen){removeStatus(target,'attackSpeedDown',source);removeStatus(target,'cannotRetreat',source);}
 changeEnemySp(enemy,Number(skill.bb.sp));
}
function clearZaroCage(battle,enemy){
 const cage=enemy.zaroCage;if(!cage)return;enemy.zaroCage=null;const skill=enemy.enemySkills[cage.skillIndex];
 for(const entry of cage.targets)endZaroVictim(battle,enemy,entry,skill);
 removeStatus(enemy,'skillLock','zaro-cage:'+enemy.uid);enemy.zaroSilenceUntil=battle.s.time+Number(skill.bb.duration_wait);
 applyStatus(enemy,'skillLock',Number(skill.bb.duration_wait),{source:'zaro-cage:'+enemy.uid,resistible:false});
}
export function checkZaroCageHealth(battle,enemy){
 if(enemy.zaroCage&&(enemy.hp<=enemy.zaroCage.releaseHp||enemy.enemyForm!=='initial'))clearZaroCage(battle,enemy);
}
function tickZaroCage(battle,enemy){
 checkZaroCageHealth(battle,enemy);const cage=enemy.zaroCage,source='zaro-cage:'+enemy.uid;
 if(cage){
  const skill=enemy.enemySkills[cage.skillIndex],bb=skill.bb,duration=Number(bb.duration_bleed),now=battle.s.time;
  const integral=t=>t<=duration?t*t/(2*duration):t-duration/2;
  const ratio=Number(bb.hp_ratio)*(integral(Math.max(0,now-cage.startedAt))-integral(Math.max(0,cage.lastAt-cage.startedAt)));cage.lastAt=now;
  const keep=[];
  for(const entry of cage.targets){const target=getActor(battle.s,entry.uid);
   if(target?.hp>0&&target.deployed&&target.deployGen===entry.deployGen){
    applyStatus(target,'attackSpeedDown',.2,{source,value:Number(bb.attack_speed),resistible:false});applyStatus(target,'cannotRetreat',.2,{source,resistible:false});
    if(ratio>0)applyLoss(battle,{source:enemy,target,amount:target.maxHp*ratio});
   }
   if(target?.hp>0&&target.deployed&&target.deployGen===entry.deployGen)keep.push(entry);else endZaroVictim(battle,enemy,entry,skill);
  }
  cage.targets=keep;if(!keep.length)clearZaroCage(battle,enemy);
 }
 if(enemy.zaroCage||enemy.zaroSilenceUntil>battle.s.time)applyStatus(enemy,'skillLock',enemy.zaroCage ? .2 : enemy.zaroSilenceUntil-battle.s.time,{source,resistible:false});
}

function mouseKingTargets(battle,enemy){
 const targets=battle.enemySkillTargets(enemy,{range:Number.MAX_VALUE,groundOnly:true,ignoreBlock:true});let low=null,high=null;
 for(const target of targets){const hp=battle.stats(target).maxHp;if(!low||hp<low.hp)low={target,hp};if(!high||hp>high.hp)high={target,hp};}
 return {low:low?.target,high:high?.target};
}

function tryReidRush(battle,enemy){
 if(enemy.enemyForm==='rebirth'||enemy.block!=null||enemy.action)return;
 const skill=enemy.enemySkills.find(s=>s.prefab==='Rush');if(!skill||!enemySkillReady(enemy,skill,battle.s.time))return;
 const routeCells=[{x:Math.round(enemy.x),y:Math.round(enemy.y),index:enemy.cmd-1}];
 for(let i=enemy.cmd;i<(enemy.route?.length||0);i++){
  const point=enemy.route[i];if(point.kind!=='move')break;
  routeCells.push({x:Math.round(point.x),y:Math.round(point.y),index:i});if(point.checkpointIndex!=null)break;
 }
 const targets=battle.enemySkillTargets(enemy,{range:Number(skill.bb.range_radius),ranged:true,ignoreBlock:true}).filter(t=>routeCells.some(p=>p.x===Math.round(t.x)&&p.y===Math.round(t.y))).sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y));
 const target=targets[0];if(!target||!beginEnemySkill(battle,enemy,skill))return;
 const point=routeCells.find(p=>p.x===Math.round(target.x)&&p.y===Math.round(target.y)),old=enemy.route[point.index];
 enemy.route=[...enemy.route.slice(0,enemy.cmd),{...(point.index>=enemy.cmd?old:{}),kind:'move',x:point.x,y:point.y},...enemy.route.slice(Math.max(enemy.cmd,point.index+1))];enemy.cmdLeft=null;
 enemy.reidRushUntil=battle.s.time+Number(skill.bb.duration);enemy.speed=enemy.baseSpeed*(1+Number(skill.bb.move_speed));endEnemySkill(battle,enemy);
 // PRTS 技能0 备注「※重生后：此技能释放的动画动作期间免疫晕眩」：只有复活之后的冲刺才免晕，冲刺结束还原。
 if(enemy.enemyForm==='revived'){enemy.reidRushStunImmune=true;enemy.reidRushBaseStun=!!enemy.immunities.stun;enemy.immunities.stun=true;}
 battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'enemy-form',form:'冲锋'});
}
function tickMouseKingSkills(battle,enemy,control){
 const {low,high}=mouseKingTargets(battle,enemy);
 if(enemy.mouseMarkEnabled){enemy.mouseMinUid=low?.uid??null;enemy.mouseMaxUid=high?.uid??null;}
 if(!low||enemy.hidden||enemy.enemyCast||enemy.action||!control.attack||!control.skill||control.silenced||enemy.mouseSkillFrame===battle.s.frame)return;
 const ready=enemy.enemySkills.filter(s=>['DriftSand','SandStorm','Mark'].includes(s.prefab)&&enemySkillReady(enemy,s,battle.s.time));
 if(!ready.length)return;
 const priority=Math.min(...ready.map(s=>s.priority)),choices=ready.filter(s=>s.priority===priority),skill=choices.length===1?choices[0]:choices[Math.floor(battle.economy.random()*choices.length)];
 if(!beginEnemySkill(battle,enemy,skill))return;enemy.mouseSkillFrame=battle.s.frame;
 if(skill.prefab==='Mark'){enemy.mouseMarkEnabled=true;enemy.mouseMinUid=low.uid;enemy.mouseMaxUid=high.uid;}
 else if(skill.prefab==='DriftSand'){
  const cells=battle.data.ranges['x-7'].grids,attackId=newAttackId(battle);
  for(const target of attackableAllies(battle.s))if(cells.some(c=>Math.round(target.x)-Math.round(high.x)===c.col&&Math.round(target.y)-Math.round(high.y)===c.row))
   battle.resolveEnemyStrike(enemy,target,{amount:Number(skill.bb.damage),type:'physical',cause:'extra',attackId,suppressAttackZone:true});
  battle.emit('impact',{uid:enemy.uid,x:high.x,y:high.y,radius:3,type:'physical',enemy:true});
 }else{
  addEffect(battle,{kind:'zone',stackRule:'stack',sourceUid:enemy.uid,talentOrSkillId:'mouse-sand-prison',x:Math.round(low.x),y:Math.round(low.y),radius:1,interval:1,nextAt:battle.s.time+1,endsAt:battle.s.time+Number(skill.bb.duration),trackSide:'ally',values:{mouseSand:true,damage:Number(skill.bb.damage),attackScale:1+Number(skill.bb.atk),weakDuration:Number(skill.bb.duration)},refKind:'owner',persistAfterSourceGone:true});
 }
 endEnemySkill(battle,enemy);
}

function xiTargets(battle,enemy){
 return attackableAllies(battle.s).filter(t=>!t.flying&&enemyTargetValid(t)&&!t.invisible&&!permissions(t).sleeping).sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y)||a.uid-b.uid);
}
function tickXiMarks(battle,enemy){
 const targets=enemy.xiMarkEnabled&&enemy.enemyForm!=='rebirth'?xiTargets(battle,enemy):[];
 enemy.xiNearestUid=targets[0]?.uid??null;enemy.xiFarthestUid=enemy.enemyForm==='second'&&targets.length>1?targets.at(-1).uid:null;
}

function crownRouteGoal(route,cmd){
 let index=-1;
 for(let i=cmd;i<route.length;i++){if(route[i].kind!=='move')break;index=i;if(route[i].checkpointIndex!=null)break;}
 return index;
}

function rejoinCrownRoute(battle,enemy){
 const pending=enemy.crownRejoin;if(!pending)return true;
 const route=enemy.route||[],index=crownRouteGoal(route,enemy.cmd);
 if(index<0){enemy.formHold=pending.formHold;enemy.crownRejoin=null;return true;}
 const goal=route[index],origin=battle.map.origin,toMap=(x,y)=>({col:origin.col+x,row:origin.row-y});let path;
 try{path=battle.path({startPosition:toMap(Math.round(enemy.x),Math.round(enemy.y)),endPosition:toMap(goal.x,goal.y),checkpoints:[],allowDiagonalMove:enemy.routeDiagonal},false).slice(1);}
 catch(error){if(!String(error.message).startsWith('原始路线不可达：'))throw error;enemy.formHold=true;return false;}
 // 路径数组可能被多个实体共享，只替换本体的剩余段，保留原始路径点编号与后续指令。
 if(path.length)Object.assign(path.at(-1),goal);else path=[{...goal}];
 enemy.route=[...route.slice(0,enemy.cmd),...path,...route.slice(index+1)];enemy.cmdLeft=null;enemy.formHold=pending.formHold;enemy.crownRejoin=null;return true;
}

function tickCrownBlink(battle,enemy){
 if(enemy.crownRejoin){const ready=rejoinCrownRoute(battle,enemy);if(enemy.crownBlink)enemy.formHold=true;else if(!ready)return true;}
 const state=enemy.crownBlink;if(!state)return false;
 if(state.degen&&!state.struck&&battle.s.time+1e-9>=state.strikeAt){
  state.struck=true;const target=getActor(battle.s,state.targetUid);
  if(target?.deployed&&target.hp>0&&target.deployGen===state.targetDeployGen)for(let hit=0;hit<state.hits&&enemy.crownBlink===state&&enemy.hp>0;hit++)battle.resolveEnemyStrike(enemy,target,{scale:state.scale,type:'physical',attackId:state.attackId});
 }
 if(!state.moved&&battle.s.time+1e-9>=state.moveAt){
  state.moved=true;
  if(teleportActor(battle,enemy,{x:state.x,y:state.y,source:enemy,mode:'blink',allowOccupied:true,exactCoordinates:true,allowFlyOnly:false})){
   if(state.phantomSpawn)battle.queueEnemySpawn({id:'enemy_2017_csphts',derived:true},state.phantomSpawn);
   enemy.cmd=state.cmd;enemy.cmdLeft=null;enemy.lastCheckpoint=Math.max(enemy.lastCheckpoint||0,state.checkpoint||0);enemy.crownRejoin={formHold:state.restore.formHold};rejoinCrownRoute(battle,enemy);enemy.formHold=true;
  }
 }
 if(battle.s.time+1e-9>=state.endsAt){Object.assign(enemy,state.restore);if(enemy.crownRejoin)enemy.formHold=true;if((state.degen||state.phantomSpawn)&&battle.s.time<state.unblockEndsAt){enemy.unblockable=true;enemy.unblockableUntil=state.unblockEndsAt;}enemy.crownBlink=null;return false;}
 return true;
}

function tryCrownBlink(battle,enemy,skill=enemy.enemySkills.find(s=>s.prefab==='blink')){
 if(enemy.block==null||enemy.action||enemy.attackCooldown>1)return false;
 if(!skill||!enemySkillReady(enemy,skill,battle.s.time))return false;
 const degen=enemy.enemyFormKind==='degen',phantom=enemy.id==='enemy_2016_csphtm',target=getActor(battle.s,enemy.block);
 if(degen&&(!target?.deployed||target.hp<=0))return false;
 const route=enemy.route||[],index=crownRouteGoal(route,enemy.cmd),goal=route[index];
 const dx=goal?goal.x-enemy.x:enemy.moveDirection?.x??0,dy=goal?goal.y-enemy.y:enemy.moveDirection?.y??0,length=Math.hypot(dx,dy),distance=Number(skill.bb.dist);if((length<1e-9&&!degen)||!(distance>0))return false;
 const x=enemy.x+(length>0?dx/length*distance:0),y=enemy.y+(length>0?dy/length*distance:0),tile=battle.map.grid[Math.round(y)]?.[Math.round(x)];
 const valid=length>1e-9&&tile&&tile.passableMask!=='NONE'&&tile.passableMask!=='FLY_ONLY'&&!tile.obstacle;
 if(!beginEnemySkill(battle,enemy,skill))return false;
 const restore={unblockable:!!enemy.unblockable,invulnerable:!!enemy.invulnerable,shiftImmune:!!enemy.shiftImmune,formHold:!!enemy.formHold,canAttack:enemy.canAttack};
 let cmd=enemy.cmd,checkpoint=enemy.lastCheckpoint||0;
 if(valid&&goal&&length<=distance+1e-9){
  cmd=index+1;checkpoint=Math.max(checkpoint,goal.checkpointIndex||0);
  while(route[cmd]?.kind==='wait'&&route[cmd].x===goal.x&&route[cmd].y===goal.y){checkpoint=Math.max(checkpoint,route[cmd].checkpointIndex||0);cmd++;}
 }
 if(valid)while(cmd<route.length){const p=route[cmd];if(!['move','wait'].includes(p.kind))break;const px=p.x-enemy.x,py=p.y-enemy.y,along=(px*dx+py*dy)/length,lateral=Math.abs(px*dy-py*dx)/length;if(lateral>.01||along<-.01||along>distance+1e-9)break;checkpoint=Math.max(checkpoint,p.checkpointIndex||0);cmd++;}
 enemy.crownBlink={moveAt:battle.s.time+.5,endsAt:battle.s.time+(degen||phantom ? .5 : 1),moved:!valid,x,y,cmd,checkpoint,restore,protect:!!valid,...(phantom?{unblockEndsAt:battle.s.time+1,phantomSpawn:{x:enemy.x,y:enemy.y,route:structuredClone(enemy.route),cmd:enemy.cmd,routeDiagonal:enemy.routeDiagonal}}:{}),...(degen?{degen:true,strikeAt:battle.s.time+.3,struck:false,unblockEndsAt:battle.s.time+1,targetUid:target.uid,targetDeployGen:target.deployGen,hits:enemy.enemyForm==='second'?2:1,scale:Number(skill.bb.atk_scale),attackId:newAttackId(battle)}:{})};
 enemy.unblockable=true;enemy.block=null;
 if(valid){enemy.invulnerable=true;enemy.shiftImmune=true;enemy.formHold=true;enemy.canAttack=false;}
 enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;endEnemySkill(battle,enemy);
 battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'blink',text:degen?'速杀':'闪现'});return true;
}

// 自施法/吞噬不依赖普通攻击目标；所有伤害和强制击杀仍进入 native-effects。
export function tickEnemySkills(battle,enemy,dt){
 if(!enemy.enemySkills)return;
 if(enemy.hp<=0){cancelEnemyCast(battle,enemy);return;}
 // 最终 Boss 逐名分流：普攻与技能由专用 tick 全权接管（通用普攻已在 prepareFinalBoss 关闭）。
 if(enemy.id==='enemy_9033_acdeer'){tickSmdeer(battle,enemy);return;}
 if(enemy.id==='enemy_1521_dslily'){tickDslily(battle,enemy);return;}
 if(tickCrownBlink(battle,enemy))return;
 if(enemy.enemyFormKind==='xi')tickXiMarks(battle,enemy);
 if(enemy.enemyFormKind==='zaro'){tickZaroCage(battle,enemy);if(!enemy.hidden&&dt>0)battle.addBloodDebt(Number(enemy.enemyTalent['Passive.sp'])*dt);}
 if(enemy.reidRushUntil!=null&&battle.s.time+1e-9>=enemy.reidRushUntil){
  enemy.reidRushUntil=null;enemy.speed=enemy.baseSpeed;
  // PRTS「重生后：此技能释放的动画动作期间免疫晕眩」——免疫只在这次冲刺期间有效，结束要还原。
  if(enemy.reidRushStunImmune){enemy.reidRushStunImmune=false;enemy.immunities.stun=!!enemy.reidRushBaseStun;enemy.reidRushBaseStun=false;}
 }
 checkWEnrage(battle,enemy);
 if(enemy.runUntil!=null&&battle.s.time+1e-9>=enemy.runUntil){enemy.runUntil=null;enemy.speed=enemy.baseSpeed;enemy.unblockable=enemy.baseUnblockable;}
 if(enemy.wineCarrying&&enemy.block!=null){enemy.wineCarrying=false;enemy.canAttack=enemy.baseCanAttack;enemy.speed=enemy.baseSpeed;}
 const control=permissions(enemy),cast=enemy.enemyCast;
 if(cast?.wildCalling){
  if(enemy.hidden||enemy.enemyForm!=='second'||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  const skill=enemy.enemySkills[cast.index];
  while(battle.s.time+1e-9>=cast.nextPulseAt&&cast.nextPulseAt<=cast.endsAt+1e-9){battle.addBloodDebt(Number(skill.bb.sp));cast.nextPulseAt+=1;}
  if(battle.s.time+1e-9>=cast.endsAt){enemy.formHold=false;endEnemySkill(battle,enemy);}
  return;
 }
 if(cast?.phantomAoe){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.fireAt){
   const skill=enemy.enemySkills[cast.index],targets=attackableAllies(battle.s).filter(t=>Math.hypot(t.x-enemy.x,t.y-enemy.y)<=2+1e-9),attackId=newAttackId(battle);
   for(const target of targets)if(enemy.hp>0&&enemy.enemyCast===cast){
    battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'physical',cause:target.uid===cast.targetUid&&target.deployGen===cast.targetDeployGen?'attack':'splash',attackId});
    applyElementDamage(battle,{source:enemy,target,amount:battle.enemyAttackDamage(enemy)*Number(skill.bb.ep_damage_ratio),type:'neural',cause:'skill',attackId});
   }
   battle.emit('impact',{uid:enemy.uid,x:enemy.x,y:enemy.y,radius:2,type:'physical',enemy:true});
   if(enemy.enemyCast===cast){enemy.formHold=false;endEnemySkill(battle,enemy);}
  }
  return;
 }
 if(cast?.xiCross){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.fireAt){
   const skill=enemy.enemySkills[cast.index],cells=battle.data.ranges['x-6'].grids,attackId=newAttackId(battle);
   for(const entry of cast.targets){const center=getActor(battle.s,entry.uid);if(!center?.deployed||center.hp<=0||center.deployGen!==entry.deployGen)continue;
    for(const target of attackableAllies(battle.s))if(enemy.enemyCast===cast&&cells.some(p=>Math.round(target.x)-Math.round(center.x)===p.col&&Math.round(target.y)-Math.round(center.y)===p.row))battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'arts',cause:'splash',attackId});
    battle.emit('impact',{uid:enemy.uid,x:center.x,y:center.y,radius:2,type:'arts',enemy:true,shape:'cross'});
   }
   if(enemy.enemyCast===cast){enemy.formHold=false;endEnemySkill(battle,enemy);}
  }
  return;
 }
 if(cast?.xiBurst){
  const layer=enemy.shieldLayers?.find(l=>l.id==='xi-burst'&&l.remaining>0);
  if(!layer||enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(!cast.fired&&battle.s.time+1e-9>=cast.fireAt){
   cast.fired=true;const skill=enemy.enemySkills[cast.index],radius=Number(skill.bb.range_radius),attackId=newAttackId(battle);
   for(const target of attackableAllies(battle.s))if(enemy.enemyCast===cast&&!target.flying&&Math.hypot(target.x-enemy.x,target.y-enemy.y)<=radius+1e-9)battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'arts',cause:'splash',attackId});
   battle.emit('impact',{uid:enemy.uid,x:enemy.x,y:enemy.y,radius,type:'arts',enemy:true});
  }
  if(enemy.enemyCast===cast&&battle.s.time+1e-9>=cast.endsAt)cancelEnemyCast(battle,enemy);
  return;
 }
 if(cast?.degenCircle){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.fireAt){
   const skill=enemy.enemySkills[cast.index],radius=Number(skill.bb.range_radius),targets=attackableAllies(battle.s).filter(t=>enemyTargetValid(t)&&!permissions(t).sleeping&&Math.hypot(t.x-enemy.x,t.y-enemy.y)<=radius+1e-9),attackId=newAttackId(battle);
   for(let hit=0;hit<cast.hits&&enemy.enemyCast===cast;hit++)for(const target of targets){
    if(enemy.enemyCast!==cast)break;if(target.hp>0)battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'physical',attackId});
   }
   battle.emit('impact',{uid:enemy.uid,x:enemy.x,y:enemy.y,radius,type:'physical',enemy:true});
   if(enemy.enemyCast===cast){enemy.formHold=false;endEnemySkill(battle,enemy);}
  }
  return;
 }
 if(cast?.crossShot){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  const skill=enemy.enemySkills[cast.index];
  if(!cast.fired&&battle.s.time+1e-9>=cast.fireAt){
   cast.fired=true;
   const target=attackableAllies(battle.s,{includeInvisible:true}).filter(t=>enemyTargetValid(t)&&!permissions(t).sleeping&&(!t.invisible||t.statuses?.some(s=>s.kind==='camouflage'))).map(t=>({target:t,distance:enemyRayHitDistance(enemy,t,cast.direction)})).filter(r=>Number.isFinite(r.distance)).sort((a,b)=>a.distance-b.distance||a.target.uid-b.target.uid)[0]?.target;
   if(target){battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'arts',cause:'skill',attackId:cast.attackId});applyStatus(target,'stun',Number(skill.bb.stun),{source:enemy.uid});}
   battle.emit('strike',{uid:enemy.uid,x:enemy.x,y:enemy.y,targetX:target?.x??enemy.x+cast.direction.x*10,targetY:target?.y??enemy.y+cast.direction.y*10,ranged:true,enemy:true,type:'arts',style:'cross-shot'});
  }
  if(battle.s.time+1e-9>=cast.endsAt)cancelEnemyCast(battle,enemy);
  return;
 }
 if(cast&&['PollutedRangedAtk','DeathEye'].includes(enemy.enemySkills[cast.index].prefab)&&enemy.action){
  const action=enemy.action,target=getActor(battle.s,action.target);
  if(!target?.deployed||target.hp<=0||(action.targetDeployGen!=null&&target.deployGen!==action.targetDeployGen)||!battle.enemySkillTargets(enemy).includes(target)){
   enemy.action=null;cancelEnemyCast(battle,enemy,{lostTarget:true});return;
  }
 }
 if(enemy.id==='enemy_1509_mousek'){tickMouseKingSkills(battle,enemy,control);return;}
 if(cast?.knightArrow){
  // 前摇结束才发射爆炸箭；前摇期间被打断（沉默/隐匿）就取消，不产生弹道。
  if(enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);enemy.formHold=false;return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const skill=enemy.enemySkills[cast.index],targets=battle.enemySkillTargets(enemy).slice(0,3);
   if(targets.length){
    const attackId=newAttackId(battle),delay=Number(skill.bb['dekght_2[aoe].interval']),amount=battle.enemyAttackDamage(enemy,Number(skill.bb['dekght_2[aoe].atk_scale']));
    for(const target of targets)addEffect(battle,{kind:'delayed',stackRule:'stack',sourceUid:enemy.uid,targetUid:target.uid,targetDeployGen:target.deployGen,talentOrSkillId:'knight-explosive-arrow',attackId,interval:null,nextAt:battle.s.time+delay,endsAt:battle.s.time+delay,values:{knightBomb:true,type:'arts'},snapshot:{damage:amount},refKind:'owner',persistAfterSourceGone:true});
   }
   enemy.formHold=false;enemy.attackCooldown=Math.ceil(enemy.interval*FPS);endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.refreshShield){
  // PRTS 泥岩「刷新屏障」：※技能期间持有失衡免疫、晕眩免疫（失衡免疫由 beginEnemySkill 的
  // extra.shiftImmune 开关，晕眩免疫按 extra.immunities 快照还原）。技能走完前摇才真正刷盾。
  if(enemy.hidden||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);enemy.formHold=false;return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const skill=enemy.enemySkills[cast.index];
   battle.refreshMudrockShield(enemy,skill.bb);
   enemy.formHold=false;enemy.attackCooldown=Math.ceil(enemy.interval*FPS);endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.knightCharge){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const target=getActor(battle.s,cast.targetUid),skill=enemy.enemySkills[cast.index];
   endEnemySkill(battle,enemy);enemy.formHold=false;
   if(target?.hp>0&&target.deployed&&target.deployGen===cast.targetDeployGen&&enemy.block===target.uid){
    const attackId=newAttackId(battle);
    for(const victim of attackableAllies(battle.s))if(Math.abs(Math.round(victim.x)-Math.round(target.x))+Math.abs(Math.round(victim.y)-Math.round(target.y))<=1)
     battle.resolveEnemyStrike(enemy,victim,{scale:Number(skill.bb[victim===target?'atk_scale':'dekght[aoe].atk_scale']),type:'physical',attackId,suppressAttackZone:true});
    battle.emit('impact',{uid:enemy.uid,x:target.x,y:target.y,radius:1,type:'physical',enemy:true});
   }
  }
  return;
 }
 if(cast?.c4Targets){
  if(enemy.hidden||!control.attack||!control.skill||control.silenced||battle.s.time+1e-9>=cast.endsAt)detonateC4(battle,enemy);
  return;
 }
 if(enemy.id==='enemy_10034_cnvsax'){
  const counter=!(enemy.invisible&&!enemy.revealed&&enemy.block==null&&!enemy.immunities?.invisible);
  if(counter!==enemy.jazzCounterMode){enemy.jazzCounterMode=counter;enemy.jazzModeChanged=true;}
  if(!counter&&enemy.jazzModeChanged){
   enemy.action=null;
   if(cast){cancelEnemyCast(battle,enemy);return;}
   if(dt>0)for(const skill of enemy.enemySkills)if(skill.nextAt!=null)skill.nextAt+=dt;
  }
 }
 if(cast?.multiAttack&&(!control.attack||!control.skill||control.silenced||enemy.hidden)){cancelEnemyCast(battle,enemy);return;}
 if(enemy.enemySp?.type==='INCREASE_WITH_TIME')changeEnemySp(enemy,enemy.enemySp.increment*dt);
 if(cast?.bomb){
  if(enemy.hidden||!control.skill||!control.attack){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const target=getActor(battle.s,cast.targetUid),skill=enemy.enemySkills[cast.index];
   if(!target?.deployed||target.hp<=0){cancelEnemyCast(battle,enemy);return;}
   const attackId=newAttackId(battle);
   for(const victim of attackableAllies(battle.s))if(Math.abs(Math.round(victim.x)-Math.round(target.x))<=1&&Math.abs(Math.round(victim.y)-Math.round(target.y))<=1)
    battle.resolveEnemyStrike(enemy,victim,{scale:1,type:'physical',attackId,suppressAttackZone:true});
   enemy.speed=enemy.baseSpeed*Number(skill.bb.move_speed);enemy.formHold=false;
   battle.emit('impact',{uid:enemy.uid,x:target.x,y:target.y,radius:1,type:'physical',enemy:true});
   endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.charge){
  if(enemy.hidden||!control.skill||!control.attack||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(!cast.hitChecked&&battle.s.time+1e-9>=cast.hitAt){
   cast.hitChecked=true;
   const target=getActor(battle.s,cast.targetUid);
   if(target?.deployed&&target.hp>0&&enemy.block===target.uid){
    cast.hitAttempted=true;
    battle.resolveEnemyStrike(enemy,target,{scale:Number(enemy.enemySkills[cast.index].bb.atk_scale_s),attackId:newAttackId(battle)});
   }
  }
  if(battle.s.time+1e-9>=cast.endsAt){if(!cast.hitAttempted)cancelEnemyCast(battle,enemy);else{enemy.stanceUntil=0;endEnemySkill(battle,enemy);}}
  return;
 }
 if(enemy.enemyLostUntil!=null){
  if(battle.s.time+1e-9<enemy.enemyLostUntil)return;
  enemy.enemyLostUntil=null;enemy.canAttack=enemy.baseCanAttack;
 }
 if(cast?.victims){
  if(enemy.hidden||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   const skill=enemy.enemySkills[cast.index];
   for(const uid of cast.victims){const victim=getActor(battle.s,uid);if(victim?.hp>0&&victim.swallowedBy===enemy.uid){changeEnemySp(enemy,Number(skill.bb.sp)||0,{duringSkill:true});commitExit(battle,{target:victim,killer:enemy,reason:'devour'});}}
   releaseCaptured(battle,enemy,cast);enemy.stanceUntil=0;endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.spawn){
  if(enemy.hidden||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  if(battle.s.time+1e-9>=cast.endsAt){
   for(const dx of cast.spawn.offsets)battle.queueEnemySpawn({id:cast.spawn.enemyKey,derived:true},{x:enemy.x+dx,y:enemy.y,route:structuredClone(enemy.route),cmd:enemy.cmd||0});
   enemy.stanceUntil=0;endEnemySkill(battle,enemy);
  }
  return;
 }
 if(cast?.channel){
  if(enemy.hidden||!control.skill||control.silenced){cancelEnemyCast(battle,enemy);return;}
  const skill=enemy.enemySkills[cast.index],locked=cast.targetUid==null?null:getActor(battle.s,cast.targetUid);
  if(cast.channel==='jazz'&&(!locked||locked.hp<=0||!locked.deployed)){cancelEnemyCast(battle,enemy);return;}
  while(battle.s.time+1e-9>=cast.nextAt&&cast.nextAt<cast.endsAt&&cast.shots<cast.maxShots){
   cast.nextAt+=cast.interval;
   const target=cast.channel==='jazz'?locked:attackableAllies(battle.s).filter(a=>!a.hidden&&!a.untargetable&&Math.abs(Math.round(a.x)-cast.x)<=1&&Math.abs(Math.round(a.y)-cast.y)<=1).sort((a,b)=>b.hp/b.maxHp-a.hp/a.maxHp||b.uid-a.uid)[0];
   if(!target)continue;
   cast.shots++;
   battle.resolveEnemyStrike(enemy,target,{scale:Number(skill.bb.atk_scale),type:'arts',attackId:newAttackId(battle),suppressAttackZone:true});
   if(cast.channel==='jazz')applyElementDamage(battle,{source:enemy,target,amount:enemy.atk*Number(skill.bb.ep_damage_ratio),type:'burn',cause:'skill'});
  }
  if(battle.s.time+1e-9>=cast.endsAt){enemy.stanceUntil=0;endEnemySkill(battle,enemy);}
  return;
 }
 if(enemy.id==='enemy_10087_hlchgr'){
  const interval=Number(enemy.enemyTalent['SkillTrigger.interval']),max=Number(enemy.enemyTalent['SkillTrigger.max_stack_cnt']);
  if(!(interval>0)||battle.s.time+1e-9<enemy.nextEnhanceAt)return;
  enemy.nextEnhanceAt+=interval;
  if(enemy.hidden||enemy.enemyCast||!control.skill||!control.attack)return;
  const skill=enemy.enemySkills.find(s=>s.prefab==='ForeverEnhance');
  if(!skill||(enemy.enhanceStacks||0)>=max||!beginEnemySkill(battle,enemy,skill))return;
  enemy.enhanceStacks=(enemy.enhanceStacks||0)+1;
  enemy.atk=enemy.baseAtk*(1+enemy.enhanceStacks*Number(skill.bb.atk_add));
  enemy.speed=enemy.baseSpeed*(1+enemy.enhanceStacks*Number(skill.bb.move_speed_add));
  endEnemySkill(battle,enemy);return;
 }
 if(enemy.hidden||enemy.enemyCast||!control.skill||!control.attack)return;
 if(/^enemy_10085_hllevi(?:_2)?$/.test(enemy.id)&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='Roar');
  if(skill&&beginEnemySkill(battle,enemy,skill)){
   for(const target of attackableAllies(battle.s))if(!target.flying&&enemyTargetValid(target)&&!permissions(target).sleeping)
    applyStatus(target,'attackSpeedDown',Number(skill.bb.duration),{source:'invited-prayer',value:Number(skill.bb.attack_speed),resistible:false});
   endEnemySkill(battle,enemy);return;
  }
 }
 if(enemy.enemyFormKind==='echo'&&!control.silenced&&!enemy.action&&!(enemy.attackCooldown>0)){
  const skill=enemy.enemySkills.find(s=>s.prefab==='Skill');
  if(skill&&beginEnemySkill(battle,enemy,skill)){
   const echoes=battle.s.enemies.filter(e=>e.hp>0&&e.enemyFormKind==='echo');
   for(const e of echoes)if(!e.hidden){const pipe=e.enemyForm==='pipe';battle.enemyEchoBurst(e,pipe ? .8 : 1.6,1,Number(e.enemyTalent[pipe?'4.ep_damage_ratio_passion':'4.ep_damage_ratio_depassion']));}
   for(const e of echoes)changeEnemySp(e,-e.sp,{duringSkill:true});enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;endEnemySkill(battle,enemy);return;
  }
 }
 if(enemy.enemyFormKind==='xi'&&enemy.enemyForm!=='rebirth'&&!enemy.action&&!(enemy.attackCooldown>0)){
  const targets=xiTargets(battle,enemy),suffix=enemy.enemyForm==='second'?'Reborn':'',candidates=enemy.enemySkills.filter(s=>enemySkillReady(enemy,s,battle.s.time)&&targets.length&&(s.prefab==='CrossAttack'||s.prefab==='ShieldBurst'+suffix&&targets.some(t=>Math.hypot(t.x-enemy.x,t.y-enemy.y)<=Number(s.bb.range_radius)+1e-9)||s.prefab==='CrossAttackMark'+suffix&&!s.used));
  const priority=Math.min(...candidates.map(s=>s.priority)),top=candidates.filter(s=>s.priority===priority),skill=top.length>1?top[Math.floor(battle.economy.random()*top.length)]:top[0];
  if(skill?.prefab.startsWith('CrossAttackMark')&&beginEnemySkill(battle,enemy,skill)){enemy.xiMarkEnabled=true;endEnemySkill(battle,enemy);tickXiMarks(battle,enemy);return;}
  if(skill?.prefab==='CrossAttack'){
   const selected=[targets[0],...(enemy.enemyForm==='second'&&targets.length>1?[targets.at(-1)]:[])],timing=battle.enemyAttackTiming(enemy);
   if(beginEnemySkill(battle,enemy,skill,{xiCross:true,targets:selected.map(t=>({uid:t.uid,deployGen:t.deployGen})),fireAt:battle.s.time+timing.windupFrames/FPS})){enemy.formHold=true;enemy.attackCooldown=timing.frames;return;}
  }
  if(skill&&attackableAllies(battle.s).some(t=>enemyTargetValid(t)&&!t.flying&&!t.invisible&&!permissions(t).sleeping&&Math.hypot(t.x-enemy.x,t.y-enemy.y)<=Number(skill.bb.range_radius)+1e-9)&&beginEnemySkill(battle,enemy,skill,{xiBurst:true,fireAt:battle.s.time+14.33,endsAt:battle.s.time+Number(skill.bb.duration),fired:false,previousShiftImmune:!!enemy.shiftImmune})){
   enemy.formHold=true;enemy.shiftImmune=true;enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;grantShield(battle,enemy,{id:'xi-burst',amount:Number(skill.bb.dynamic),types:['physical','arts'],endsAt:enemy.enemyCast.endsAt,sourceUid:enemy.uid});return;
  }
 }
 if(enemy.enemyFormKind==='zaro'&&enemy.enemyForm==='second'&&!control.silenced&&!battle.isBloodDebtSettlement()&&!enemy.action&&!(enemy.attackCooldown>0)){
  const skill=enemy.enemySkills.find(s=>s.prefab==='WildCalling');
  if(skill&&beginEnemySkill(battle,enemy,skill,{wildCalling:true,nextPulseAt:battle.s.time+1,endsAt:battle.s.time+Number(skill.bb.duration)})){enemy.formHold=true;enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;return;}
 }
 if(enemy.enemyFormKind==='zaro'&&enemy.enemyForm==='initial'&&!enemy.action&&!(enemy.attackCooldown>0)){
  const skill=enemy.enemySkills.find(s=>s.prefab==='FearCage'),targets=battle.enemySkillTargets(enemy,{ranged:true,range:Number.MAX_VALUE,ignoreBlock:true}).slice(0,Number(skill?.bb.max_target)||0);
  if(skill&&targets.length&&beginEnemySkill(battle,enemy,skill)){
   enemy.zaroCage={skillIndex:skill.index,startedAt:battle.s.time,lastAt:battle.s.time,releaseHp:enemy.hp+enemy.maxHp*Number(skill.bb.hp_ratio_offset),targets:targets.map(t=>({uid:t.uid,deployGen:t.deployGen}))};
   enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;endEnemySkill(battle,enemy);tickZaroCage(battle,enemy);return;
  }
 }
 if(enemy.enemyFormKind==='degen'&&enemy.enemyForm!=='rebirth'&&!control.silenced&&!enemy.action&&!(enemy.attackCooldown>0)){
  const suffix=enemy.enemyForm==='second'?'2':'',candidates=enemy.enemySkills.filter(s=>[ 'Blink'+suffix,'CircleAttack'+suffix].includes(s.prefab)&&enemySkillReady(enemy,s,battle.s.time)&&(s.prefab.startsWith('Blink')?enemy.block!=null:attackableAllies(battle.s).some(t=>enemyTargetValid(t)&&!permissions(t).sleeping&&Math.hypot(t.x-enemy.x,t.y-enemy.y)<=Number(s.bb.range_radius)+1e-9)));
  const priority=Math.min(...candidates.map(s=>s.priority)),top=candidates.filter(s=>s.priority===priority),skill=top.length>1?top[Math.floor(battle.economy.random()*top.length)]:top[0];
  if(skill?.prefab.startsWith('Blink')&&tryCrownBlink(battle,enemy,skill))return;
  if(skill&&attackableAllies(battle.s).some(t=>enemyTargetValid(t)&&!permissions(t).sleeping&&Math.hypot(t.x-enemy.x,t.y-enemy.y)<=Number(skill.bb.range_radius)+1e-9)){
   const timing=battle.enemyAttackTiming(enemy);
   if(beginEnemySkill(battle,enemy,skill,{degenCircle:true,hits:enemy.enemyForm==='second'?2:1,fireAt:battle.s.time+timing.windupFrames/FPS})){enemy.formHold=true;enemy.attackCooldown=timing.frames;return;}
  }
 }
 if(enemy.id==='enemy_1404_msnip'&&!control.silenced&&enemy.block==null&&!enemy.action&&!(enemy.attackCooldown>0)){
  const skill=enemy.enemySkills.find(s=>s.prefab==='CrossAttack'),directions=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
  const targets=attackableAllies(battle.s).filter(t=>enemyTargetValid(t)&&!t.invisible&&!permissions(t).sleeping&&directions.some(d=>Number.isFinite(enemyRayHitDistance(enemy,t,d))));
  targets.sort((a,b)=>compareEnemyTargets({...a,tauntLevel:battle.stats(a).tauntLevel},{...b,tauntLevel:battle.stats(b).tauntLevel}));
  const target=targets[0],direction=target&&directions.find(d=>Number.isFinite(enemyRayHitDistance(enemy,target,d)));
  if(skill&&target&&beginEnemySkill(battle,enemy,skill,{crossShot:true,direction,fireAt:battle.s.time+1.4,endsAt:battle.s.time+Number(skill.bb.duration),attackId:newAttackId(battle)})){
   enemy.formHold=true;enemy.formInvisible=false;enemy.invisible=false;enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;return;
  }
 }
 // attackCooldown is reduced later this frame; <=1 lets a ready skill take the attack slot before a basic hit starts.
 if(['enemy_2016_csphtm','enemy_2017_csphts'].includes(enemy.id)&&!control.silenced&&!enemy.action&&enemy.attackCooldown<=1){
  // AOE优先级0，闪现优先级1；目标查询绕过迷彩，仍排除不可选和沉睡。
  const targets=attackableAllies(battle.s).filter(t=>enemyTargetValid(t)&&!permissions(t).sleeping&&Math.hypot(t.x-enemy.x,t.y-enemy.y)<=2+1e-9);
  targets.sort((a,b)=>Number(b.uid===enemy.block)-Number(a.uid===enemy.block)||compareEnemyTargets({...a,tauntLevel:battle.stats(a).tauntLevel},{...b,tauntLevel:battle.stats(b).tauntLevel}));
  const skill=enemy.enemySkills.find(s=>s.prefab==='aoe');
  if(skill&&targets.length&&enemySkillReady(enemy,skill,battle.s.time)){
   const timing=battle.enemyAttackTiming(enemy),target=targets[0];
   if(beginEnemySkill(battle,enemy,skill,{phantomAoe:true,targetUid:target.uid,targetDeployGen:target.deployGen,fireAt:battle.s.time+timing.windupFrames/FPS})){enemy.formHold=true;enemy.attackCooldown=timing.frames;return;}
  }
  if(enemy.id==='enemy_2016_csphtm'&&tryCrownBlink(battle,enemy))return;
 }
 if(enemy.id==='enemy_1502_crowns'&&!control.silenced&&tryCrownBlink(battle,enemy))return;
 if(enemy.id==='enemy_2050_smsha'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='ChainBuff');
  const candidates=battle.s.enemies.filter(e=>e!==enemy&&e.hp>0&&!e.hidden&&!e.untargetable&&!e.invulnerable&&!permissions(e).sleeping&&!isIsolated(e));
  const first=candidates.filter(e=>Math.hypot(e.x-enemy.x,e.y-enemy.y)<=enemy.range).sort((a,b)=>(b.taunt||0)-(a.taunt||0)||b.uid-a.uid)[0];
  if(skill&&first&&beginEnemySkill(battle,enemy,skill)){
   const chain=enemyChainTargets(first,candidates,Number(skill.bb['chain.max_target']),Number(skill.bb.projectile_range)),amount=battle.enemyAttackDamage(enemy,Number(skill.bb.atk_scale)),attackId=newAttackId(battle);let from=enemy;
   for(let i=0;i<chain.length;i++){
    const target=chain[i];dealDamage(battle,{source:enemy,target,amount:amount*Math.pow(Number(skill.bb['chain.atk_scale']),i),type:'arts',cause:'skill',attackId});
    if(target.hp>0){applyStatus(target,'attackSpeedUp',Number(skill.bb.duration),{source:'snow-priest-gift',value:Number(skill.bb.attack_speed),resistible:false});applyStatus(target,'chainMoveSpeed',Number(skill.bb.duration),{source:'snow-priest-gift',value:Number(skill.bb.move_speed),resistible:false});}
    battle.emit('strike',{uid:enemy.uid,x:from.x,y:from.y,targetX:target.x,targetY:target.y,ranged:true,enemy:true,type:'arts',style:'chain-buff',hit:i});from=target;
   }
   enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;endEnemySkill(battle,enemy);return;
  }
 }
 if(enemy.id==='enemy_2003_rockman'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='StunAttack');
  const targets=battle.enemySkillTargets(enemy,{ranged:true,ignoreBlock:true}).filter(t=>!t.statuses?.some(s=>s.kind==='stun')).sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y));
  if(skill&&targets.length&&beginEnemySkill(battle,enemy,skill,{holdsPosition:true})){
   const target=targets[0],timing=battle.enemyAttackTiming(enemy);enemy.attackCooldown=timing.frames;
   enemy.action={startedAt:battle.s.time,left:timing.windupFrames,target:target.uid,targets:[target.uid],ranged:true,attackId:newAttackId(battle),special:{index:skill.index,prefab:skill.prefab,scale:Number(skill.bb.atk_scale),stun:Number(skill.bb.stun),stunBeforeDamage:true,type:'physical'}};return;
  }
 }
 if(enemy.id==='enemy_1539_reid'&&dt===0&&!control.silenced)tryReidRush(battle,enemy);
 // 腐败/凋零骑士（用户 2026-09-23 口径）：技能发动前先做 1 秒前摇（表现＝本体紫色发光闪烁），
 // 场上同伴离场触发强化后缩短为 0.5 秒。前摇期间原地不动、不结算伤害，前摇结束才真正发动技能。
 if(enemy.id==='enemy_1513_dekght_2'&&!control.silenced&&!enemy.action&&!enemy.enemyCast){
  const skill=enemy.enemySkills.find(s=>s.prefab==='TripleAttack');
  if(skill&&battle.enemySkillTargets(enemy).length&&beginEnemySkill(battle,enemy,skill,{knightArrow:true,windupUntil:battle.s.time+knightWindupSeconds(enemy),endsAt:battle.s.time+knightWindupSeconds(enemy)})){
   enemy.formHold=true;return;
  }
 }
 if(enemy.id==='enemy_1513_dekght'&&!control.silenced&&!enemy.action&&enemy.block!=null&&!enemy.enemyCast){
  const skill=enemy.enemySkills.find(s=>s.prefab==='ChargeAttack'),target=getActor(battle.s,enemy.block),windup=knightWindupSeconds(enemy);
  if(skill&&target&&beginEnemySkill(battle,enemy,skill,{knightCharge:true,targetUid:target.uid,targetDeployGen:target.deployGen,windupUntil:battle.s.time+windup,endsAt:battle.s.time+windup+Number(skill.bb.duration)})){
   enemy.formHold=true;enemy.attackCooldown=Math.ceil(enemy.interval*FPS);return;
  }
 }
 if(enemy.id==='enemy_2008_flking'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='refreshshield');
  if(skill&&beginEnemySkill(battle,enemy,skill)){
   grantShield(battle,enemy,{id:'tombstone-shield',amount:enemy.maxHp*Number(skill.bb.hp_ratio),sourceUid:enemy.uid});endEnemySkill(battle,enemy);return;
  }
 }
 if(enemy.id==='enemy_1511_mdrock'&&!control.silenced&&!enemy.action&&!enemy.enemyCast){
  const skill=enemy.enemySkills.find(s=>s.prefab==='RefreshShield');
  // PRTS：重置自身法术屏障 ※技能期间持有失衡免疫、晕眩免疫 —— 前摇期间原地不动并免疫失衡/晕眩。
  const extra={refreshShield:true,shiftImmune:true,immunities:{...enemy.immunities},endsAt:battle.s.time+windupSeconds(enemy.interval)};
  if(skill&&beginEnemySkill(battle,enemy,skill,extra)){
   enemy.immunities.stun=true;enemy.formHold=true;enemy.attackCooldown=Math.ceil(enemy.interval*FPS);return;
  }
 }
 if(enemy.id==='enemy_1504_cqbw'&&!control.silenced&&!enemy.action){
  const skill=enemy.enemySkills.find(s=>s.prefab==='C4');
  const targets=skill?battle.enemySkillTargets(enemy,{groundOnly:!enemy.wEnraged,range:Number(skill.bb.range_radius)}).slice(0,enemy.wEnraged?3:1):[];
  if(targets.length&&enemySkillReady(enemy,skill,battle.s.time)&&beginEnemySkill(battle,enemy,skill,{c4Targets:targets.map(t=>({uid:t.uid,deployGen:t.deployGen})),endsAt:battle.s.time+3.2,attackId:newAttackId(battle)})){
   enemy.formHold=true;enemy.attackCooldown=Math.ceil(enemy.interval*FPS);return;
  }
 }
 if(enemy.id==='enemy_10001_trslim'&&!control.silenced&&enemy.hp<enemy.maxHp*.5){
  const skill=enemy.enemySkills.find(s=>s.prefab==='StartRun');
  if(skill&&beginEnemySkill(battle,enemy,skill)){
   enemy.speed=enemy.baseSpeed*(1+Number(skill.bb.move_speed));enemy.unblockable=true;enemy.block=null;enemy.action=null;
   enemy.runUntil=battle.s.time+Number(skill.bb.block_free_time);endEnemySkill(battle,enemy);
   battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'low-hp'});return;
  }
 }
 const barrel=enemy.enemySkills.find(s=>s.prefab==='BlockedBoom');
 if(barrel&&enemy.wineCarrying===false&&!control.silenced&&!enemy.action&&beginEnemySkill(battle,enemy,barrel)){
  const target=getActor(battle.s,enemy.block);
  if(target?.deployed&&target.hp>0){
   // PRTS半径2；本期黑板提供区域持续时间、攻速、闪避与强击倍率。
   addEffect(battle,{kind:'zone',sourceUid:enemy.uid,talentOrSkillId:'enemy-wine-zone',stackRule:'stack',x:Math.round(target.x),y:Math.round(target.y),radius:2,interval:null,nextAt:null,endsAt:battle.s.time+Number(barrel.bb.fixed_duration),values:{enemyWineBuff:true,attackSpeed:Number(barrel.bb.attack_speed),physicalDodge:Number(barrel.bb.prob)},refKind:'owner',persistAfterSourceGone:true});
   battle.resolveEnemyStrike(enemy,target,{scale:Number(barrel.bb.blockee_atk_scale),type:'physical',attackId:newAttackId(battle),suppressAttackZone:true});
  }
  endEnemySkill(battle,enemy);enemy.attackCooldown=Math.ceil(enemy.interval*FPS);return;
 }
 const bomb=enemy.enemySkills.find(s=>s.prefab==='boomb');
 if(bomb){
  const target=battle.enemySkillTargets(enemy)[0];
  if(target&&beginEnemySkill(battle,enemy,bomb,{bomb:true,targetUid:target.uid,endsAt:battle.s.time+windupSeconds(enemy.interval)}))enemy.formHold=true;
  return;
 }
 if(enemy.id==='enemy_10144_xdelk_2'&&!control.silenced&&!enemy.action&&enemy.attackCooldown<=1&&enemy.block!=null){
  const skill=enemy.enemySkills.find(s=>s.prefab==='skill');
  if(skill&&beginEnemySkill(battle,enemy,skill,{charge:true,targetUid:enemy.block,hitAt:battle.s.time+6.6,endsAt:battle.s.time+Number(skill.bb.duration),hitAttempted:false})){
   enemy.stanceUntil=enemy.enemyCast.endsAt;return;
  }
 }
 if(enemy.enemyPeriodicSpawn&&!control.silenced){
  const spec=enemy.enemyPeriodicSpawn,skill=enemy.enemySkills.find(s=>s.prefab===spec.skill);
  if(skill&&beginEnemySkill(battle,enemy,skill,{spawn:spec,endsAt:battle.s.time+spec.delay}))enemy.stanceUntil=battle.s.time+spec.delay;
  return;
 }
 if(['enemy_1273_stmgun_2','enemy_10034_cnvsax'].includes(enemy.id)&&!control.silenced&&!enemy.action&&enemy.attackCooldown<=1){
  const jazz=enemy.id==='enemy_10034_cnvsax',concealed=enemy.invisible&&!enemy.revealed&&enemy.block==null;
  if(jazz&&concealed)return;
  const skill=enemy.enemySkills.find(s=>s.prefab===(jazz?'fire':'Cannon'));
  const targets=attackableAllies(battle.s).filter(a=>!a.invisible&&!a.untargetable&&Math.hypot(a.x-enemy.x,a.y-enemy.y)<=enemy.range);
  if(jazz)targets.sort((a,b)=>Number(b.uid===enemy.block)-Number(a.uid===enemy.block)||b.deployAt-a.deployAt||b.uid-a.uid);
  else targets.sort((a,b)=>b.maxHp-a.maxHp||b.uid-a.uid);
  const target=targets[0];
  if(skill&&target){
   // PRTS 自行炮：九格锁定区域，6秒内每0.5秒攻击，最多10次。爵士乐手参数取本期黑板。
   const duration=jazz?Number(skill.bb['enemy_cnvsax[cd].duration']):6,interval=jazz?Number(skill.bb.hit_interval):.5;
   const extra={channel:jazz?'jazz':'cannon',targetUid:jazz?target.uid:null,x:Math.round(target.x),y:Math.round(target.y),nextAt:battle.s.time+interval,endsAt:battle.s.time+duration,interval,shots:0,maxShots:jazz?Math.ceil(duration/interval):10};
   if(!jazz)extra.immunities={...enemy.immunities};
   // PRTS 高准度伦蒂尼姆城防自行炮「轰炸」：技能动画期间持有失衡免疫、晕眩/冻结/浮空/沉睡免疫。
   // 失衡免疫是独立的 shiftImmune（不在 immunities 表里），必须一并开关，否则施法中仍可被推动。
   if(!jazz)extra.shiftImmune=true;
   if(beginEnemySkill(battle,enemy,skill,extra)){
    enemy.stanceUntil=extra.endsAt;
    if(!jazz)for(const kind of ['stun','frozen','sleep','levitate'])enemy.immunities[kind]=true;
   }
  }
  if(enemy.enemyCast)return;
 }
 if(enemy.id!=='enemy_9009_acfort'||control.silenced||enemy.action||enemy.attackCooldown>1)return;
 const choices=[];
 for(const skill of enemy.enemySkills){
  if(!enemySkillReady(enemy,skill,battle.s.time))continue;
  if(skill.prefab==='KillOthers'){
   const victims=battle.s.enemies.filter(e=>e!==enemy&&e.hp>0&&!e.hidden&&!isIsolated(e)&&e.flying&&!e.swallowedBy&&e.enemyRank==='NORMAL'&&Math.hypot(e.x-enemy.x,e.y-enemy.y)<=enemy.range*Number(skill.bb.range_radius));
   if(victims.length)choices.push({skill,victims:victims.slice(0,3)});
  }else if(skill.prefab==='FireWeapon'){
   const targets=attackableAllies(battle.s).filter(a=>!a.invisible&&!a.untargetable);
   if(targets.length)choices.push({skill,targets});
  }
 }
 if(!choices.length)return;
 const priority=Math.min(...choices.map(c=>c.skill.priority)),top=choices.filter(c=>c.skill.priority===priority),choice=top.length===1?top[0]:top[Math.floor(battle.economy.random()*top.length)];
 const {skill,victims,targets}=choice;
 if(victims){
  const endsAt=battle.s.time+Number(skill.bb.duration);
  if(!beginEnemySkill(battle,enemy,skill,{endsAt,victims:victims.map(e=>e.uid)}))return;
  enemy.stanceUntil=endsAt;
  for(const victim of victims){victim.swallowedBy=enemy.uid;applyStatus(victim,'root',Number(skill.bb.duration),{source:enemy.uid,resistible:false});}
 }else{
  const shots=Math.floor(enemy.sp);if(!beginEnemySkill(battle,enemy,skill,{allSp:true}))return;
  for(let i=0;i<shots;i++){const alive=targets.filter(t=>t.hp>0);if(!alive.length)break;const target=alive[Math.floor(battle.economy.random()*alive.length)];dealDamage(battle,{source:enemy,target,amount:enemy.atk*Number(skill.bb.atk_scale),type:'physical',cause:'skill'});}
  endEnemySkill(battle,enemy);
 }
 enemy.attackCooldown=Math.max(enemy.attackCooldown,Math.ceil(enemy.interval*FPS));
}

// ===== 最终 Boss 逐名实装（docs/FINAL_BOSS_4_5_7_PLAN_2026-09-28.md 施工单；用户 2026-09-28 继续推进）=====
// 两个 Boss 的普攻与技能在这里全权接管：native-battle 的通用普攻对它们关闭（canAttack=false），
// tickEnemySkills 头部按 enemy.id 分流到这里。目标选取就地实现（enemyAttackTargets 在 native-enemy-attacks
// 里反向 import 本模块，不能再引回来）。

// ===== boss_7 “萨米的意志”（enemy_9033_acdeer）=====
// PRTS 敌人页（级别0）＋本期 h07_07_s 覆盖：
// - 普攻「冰凌」：对目标所在整列，自该列最上方每 0.2 秒落下一枚冰凌，物理伤害（baseAttackTime 6）；
//   半血后「普通攻击可额外选择1个不同的列」（Madness.enemy_smdeer_mad[attack].max_cnt=2，普通 1 列）。
// - 「自然涌动」Lasso：40/60 秒 CD，选 1 名我方单位晕眩 10 秒并每秒承受 20% 攻击力法伤；
//   半血后额外选 1 个目标（Madness.enemy_smdeer_mad[skill].max_target=2）。
// - 半血被动：物理/法术伤害降低 60%（Madness.damage_resistance，真伤/元素不减）——在 dealDamage 结算。
// - 「叹息」Doom 999/999 秒：本时限内不可达，保留原表资料不做触发。
// - 自缚（formHold）、不可阻挡、失衡免疫与巨型受击矩形在 prepareFinalBoss/inside() 套用。
const SMDEER_SPIKE_INTERVAL=.2,SMDEER_MAD_RATIO=.5;
function smdeerMad(enemy){return enemy.hp<enemy.maxHp*SMDEER_MAD_RATIO;}
function smdeerFieldTargets(battle,enemy){
 return attackableAllies(battle.s).filter(u=>enemyTargetValid(u)&&!permissions(u).sleeping&&Math.hypot(u.x-enemy.x,u.y-enemy.y)<=enemy.range+1e-9)
  .sort((a,b)=>compareEnemyTargets({tauntLevel:a.kind==='summon'?(a.neutral?a.taunt||0:0):battle.stats(a).tauntLevel,deployAt:a.deployAt||0,uid:a.uid},{tauntLevel:b.kind==='summon'?(b.neutral?b.taunt||0:0):battle.stats(b).tauntLevel,deployAt:b.deployAt||0,uid:b.uid}));
}
function tickSmdeerIce(battle,enemy){
 const storm=enemy.iceStorm;if(!storm)return false;
 let done=true;
 for(const column of storm.columns){
  if(column.row>=storm.rows)continue;
  if(battle.s.time+1e-9<column.nextAt){done=false;continue;}
  column.nextAt+=SMDEER_SPIKE_INTERVAL;
  const y=storm.top+column.row;column.row++;
  const victims=attackableAllies(battle.s).filter(t=>Math.round(t.x)===column.x&&Math.round(t.y)===y);
  for(const target of victims)dealDamage(battle,{source:enemy,target,amount:battle.enemyAttackDamage(enemy,1),type:'physical',cause:'attack',attackId:storm.attackId});
  battle.emit('strike',{uid:enemy.uid,x:column.x,y:storm.top,targetX:column.x,targetY:y,ranged:true,enemy:true,type:'physical',style:'ice-spike',hit:victims.length});
  if(column.row<storm.rows)done=false;
 }
 if(done)enemy.iceStorm=null;
 return true;
}
function tickSmdeer(battle,enemy){
 const control=permissions(enemy);
 if(enemy.enemyCast&&!control.skill){cancelEnemyCast(battle,enemy);return;}
 const cast=enemy.enemyCast;
 if(cast?.lasso){
  const skill=enemy.enemySkills[cast.index];
  while(battle.s.time+1e-9>=cast.nextAt&&cast.nextAt<cast.endsAt){
   cast.nextAt+=1;
   for(const entry of cast.targets){
    const target=getActor(battle.s,entry.uid);
    if(target?.deployed&&target.hp>0&&target.deployGen===entry.deployGen)dealDamage(battle,{source:enemy,target,amount:battle.enemyAttackDamage(enemy,Number(skill.bb.atk_scale)),type:'arts',cause:'skill',attackId:cast.attackId});
   }
  }
  if(battle.s.time+1e-9>=cast.endsAt){enemy.stanceUntil=0;endEnemySkill(battle,enemy);}
  return;
 }
 if(tickSmdeerIce(battle,enemy))return;
 if(!control.attack||control.silenced||enemy.action||enemy.attackCooldown>0)return;
 // 自然涌动优先于普攻冰凌（技能占用攻击档）。
 const lasso=enemy.enemySkills.find(s=>s.prefab==='Lasso');
 if(lasso&&enemySkillReady(enemy,lasso,battle.s.time)){
  const picked=smdeerFieldTargets(battle,enemy).slice(0,smdeerMad(enemy)?Math.max(1,Number(enemy.enemyTalent['Madness.enemy_smdeer_mad[skill].max_target'])||2):Math.max(1,Number(lasso.bb.max_target)||1));
  if(picked.length&&beginEnemySkill(battle,enemy,lasso,{lasso:true,targets:picked.map(t=>({uid:t.uid,deployGen:t.deployGen})),nextAt:battle.s.time+1,endsAt:battle.s.time+Number(lasso.bb.projectile_life_time),attackId:newAttackId(battle)})){
   enemy.stanceUntil=enemy.enemyCast.endsAt;enemy.attackCooldown=battle.enemyAttackTiming(enemy).frames;
   for(const target of picked)if(applyStatus(target,'stun',Number(lasso.bb.projectile_life_time),{source:enemy.uid}))battle.emit('control',{uid:target.uid,kind:'stun',x:target.x,y:target.y});
   return;
  }
 }
 const targets=smdeerFieldTargets(battle,enemy);
 if(!targets.length)return;
 const maxColumns=smdeerMad(enemy)?Math.max(1,Number(enemy.enemyTalent['Madness.enemy_smdeer_mad[attack].max_cnt'])||2):Math.max(1,Number(enemy.enemyTalent['Madness.attack@max_cnt'])||1);
 const columns=[];
 for(const target of targets){const x=Math.round(target.x);if(columns.some(entry=>entry.x===x))continue;columns.push({x,row:0,nextAt:battle.s.time});if(columns.length>=maxColumns)break;}
 if(!columns.length)return;
 const timing=battle.enemyAttackTiming(enemy);
 enemy.attackCooldown=timing.frames;
 for(const column of columns)column.nextAt=battle.s.time+timing.windupFrames/FPS;
 enemy.iceStorm={columns,top:0,rows:battle.map.rows,attackId:newAttackId(battle)};
 battle.emit('enemy-skill',{uid:enemy.uid,x:enemy.x,y:enemy.y,skill:'IceSpike',columns:columns.map(c=>c.x)});
}

// ===== boss_4 盐风主教昆图斯（enemy_1521_dslily）=====
// PRTS 敌人页（级别0）＋本期 h07_04_s 覆盖：
// - 普攻：同时攻击防御最高的 2 名我方单位，攻击本身无伤害，0.4 秒后造成 100% 攻击力物理伤害并附加
//   20% 攻击力神经损伤（epdamage.attack@ep_damage_ratio）。攻击半径 99＝全场。
// - 形态（growup1/2）：已损生命跨越 33%×当前阶段数，或开战后 75/200 秒，进入第二/第三形态；
//   攻击力 +40%/+70%（atkup1.atk/atkup2.atk，在 NativeBattle.enemyAttackDamage 生效）；
//   换形态启用对应技能组（Tidewater/Rockfall 的 G1/G2 档），形态期 CD 独立初始化，旧组停用。
// - 大潮 Tidewater：全场我方单位，法术伤害＋神经损伤（数值读各形态技能黑板）。
// - 崩坍 Rockfall：防御最高 2/4/8 人（按形态），1 秒后 140% 攻击力物理伤害。
// - 断裂生殖 SummonTentac 与子代装置、物种爆发 Doom：按用户 2026-09-28 指示豁免（overrides 的
//   ignoredSkillPrefabs 显式停用，原表资料保留）；子代相关机制与预置地块都不做。
const DSLILY_FORM_SKILLS={1:['Tidewater','Rockfall','SummonTentac'],2:['TidewaterG1','RockfallG1','SummonTentacG1'],3:['TidewaterG2','RockfallG2','SummonTentacG2']};
const DSLILY_ROCKFALL_TARGETS={1:2,2:4,3:8};
function dslilyFormSkills(enemy,form=(enemy.dslilyForm||1)){return (DSLILY_FORM_SKILLS[form]||[]).map(name=>enemy.enemySkills.find(s=>s.prefab===name)).filter(Boolean);}
function dslilyAdvanceForm(battle,enemy,form){
 enemy.dslilyForm=form;
 const active=new Set(DSLILY_FORM_SKILLS[form]||[]);
 for(const skill of enemy.enemySkills){
  if(active.has(skill.prefab))skill.nextAt=battle.s.time+Math.max(0,Number(skill.initCooldown)||0);
  else if(Object.values(DSLILY_FORM_SKILLS).some(names=>names.includes(skill.prefab)))skill.nextAt=Infinity;
 }
 battle.emit('enemy-phase',{uid:enemy.uid,x:enemy.x,y:enemy.y,phase:'form-'+form,text:form===2?'第二形态':'第三形态'});
}
function tickDslilyForms(battle,enemy){
 const form=enemy.dslilyForm||1;if(form>=3)return;
 const lost=enemy.maxHp-enemy.hp;
 if(form===1){
  const ratio=Number(enemy.enemyTalent['growup1.hp_ratio'])||1/3,interval=Number(enemy.enemyTalent['growup1.interval'])||75;
  if(lost>=enemy.maxHp*ratio||battle.s.time>=enemy.dslilySpawnAt+interval)dslilyAdvanceForm(battle,enemy,2);
 }else{
  const ratio=Number(enemy.enemyTalent['growup2.hp_ratio'])||1/3,interval=Number(enemy.enemyTalent['growup2.interval'])||200;
  if(lost>=enemy.maxHp*ratio*form||battle.s.time>=enemy.dslilySpawnAt+interval)dslilyAdvanceForm(battle,enemy,3);
 }
}
function tickDslilyStrikes(battle,enemy){
 const list=enemy.pendingStrikes;if(!list?.length)return;
 enemy.pendingStrikes=list.filter(strike=>{
  if(battle.s.time+1e-9<strike.at)return true;
  for(const entry of strike.entries){
   const target=getActor(battle.s,entry.uid);
   if(!target?.deployed||target.hp<=0||target.deployGen!==entry.deployGen)continue;
   battle.resolveEnemyStrike(enemy,target,{scale:strike.scale,type:strike.type,attackId:strike.attackId});
   if(strike.ep>0&&target.hp>0)applyElementDamage(battle,{source:enemy,target,amount:battle.enemyAttackDamage(enemy,strike.ep),type:'neural',cause:'skill',attackId:strike.attackId});
  }
  return false;
 });
 if(!enemy.pendingStrikes.length)enemy.pendingStrikes=null;
}
function dslilyHighestDef(battle,enemy,count){
 return attackableAllies(battle.s).slice().sort((a,b)=>battle.stats(b).def-battle.stats(a).def||a.uid-b.uid).slice(0,count);
}
function tickDslily(battle,enemy){
 const control=permissions(enemy);
 if(enemy.enemyCast&&!control.skill){cancelEnemyCast(battle,enemy);return;}
 tickDslilyStrikes(battle,enemy);
 tickDslilyForms(battle,enemy);
 if(!control.attack||control.silenced||enemy.action||enemy.attackCooldown>0)return;
 const timing=battle.enemyAttackTiming(enemy);
 const ready=dslilyFormSkills(enemy).filter(s=>enemySkillReady(enemy,s,battle.s.time));
 if(ready.length){
  const priority=Math.min(...ready.map(s=>s.priority)),top=ready.filter(s=>s.priority===priority),skill=top.length>1?top[Math.floor(battle.economy.random()*top.length)]:top[0];
  if(skill.prefab.startsWith('Tidewater')){
   if(beginEnemySkill(battle,enemy,skill,{dslilyTide:true})){
    const attackId=newAttackId(battle),scale=Number(skill.bb.atk_scale)||0,ep=Number(skill.bb.ep_damage_ratio)||0;
    for(const target of attackableAllies(battle.s)){
     if(scale>0)dealDamage(battle,{source:enemy,target,amount:battle.enemyAttackDamage(enemy,scale),type:'arts',cause:'skill',attackId});
     if(ep>0&&target.hp>0)applyElementDamage(battle,{source:enemy,target,amount:battle.enemyAttackDamage(enemy,ep),type:'neural',cause:'skill',attackId});
    }
    endEnemySkill(battle,enemy);enemy.attackCooldown=timing.frames;return;
   }
  }else if(skill.prefab.startsWith('Rockfall')){
   const targets=dslilyHighestDef(battle,enemy,DSLILY_ROCKFALL_TARGETS[enemy.dslilyForm||1]||2);
   if(targets.length&&beginEnemySkill(battle,enemy,skill,{dslilyRockfall:true})){
    enemy.pendingStrikes??=[];enemy.pendingStrikes.push({at:battle.s.time+1,attackId:newAttackId(battle),scale:Number(skill.bb.atk_scale)||1.4,type:'physical',ep:0,entries:targets.map(t=>({uid:t.uid,deployGen:t.deployGen}))});
    endEnemySkill(battle,enemy);enemy.attackCooldown=timing.frames;return;
   }
  }
 }
 // 普攻：防御最高的 2 名，攻击本身无伤害，0.4 秒后物理＋神经损伤。
 const targets=dslilyHighestDef(battle,enemy,2);
 if(!targets.length)return;
 enemy.attackCooldown=timing.frames;
 enemy.pendingStrikes??=[];enemy.pendingStrikes.push({at:battle.s.time+.4,attackId:newAttackId(battle),scale:1,type:'physical',ep:Number(enemy.enemyTalent['epdamage.attack@ep_damage_ratio'])||0,entries:targets.map(t=>({uid:t.uid,deployGen:t.deployGen}))});
}
