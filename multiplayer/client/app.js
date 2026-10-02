/** 联机页面独立启动；单机 native-play.js 不参与本页面生命周期。 */
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {richText} from '../../dist/protocol.js';
import {loadArchive} from '../../dist/native-archive.js';
import {visibleBands, freeDeploy} from '../../dist/native-sees.js';
import {loadWaveTable} from '../../dist/native-wave-fill.js';
import {loadBondBan} from '../../dist/native-bond-ban.js';
import {renderSkillDescription} from '../../dist/native-skill-text.js';
import {EMOTES, MODES} from '../shared/rules.js';
import {Connection, endpoint} from './connection.js';
import {MultiplayerSession} from './session.js';
import {drawBoard, cellAt, viewSnapshot, assetUrl} from './board.js';

const root = document.getElementById('online-app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {room:null, playerId:null, game:null, snapshots:{}, view:null, selected:null, item:null, cell:null,
  fault:null, supportTask:null, clockOffset:0, ack:null, pendingTransfers:[], emotes:{}, profile:readProfile()};
let toastTimer;
function notify(text) { const el=document.getElementById('toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500); }
function readProfile() { try {return JSON.parse(localStorage.getItem('garrison-online-profile-v1')) || {name:'指挥官',avatar:'🫡'};}catch{return {name:'指挥官',avatar:'🫡'};} }
const deployCount = s => s.units.filter(u => u.position && !freeDeploy(data,u)).length;
function me() { return state.room?.players.find(p=>p.id===state.playerId); }
const connection = new Connection(receive, status => {document.getElementById('connection-status').textContent=status;});
function avatar(profile) { return profile.avatar?.startsWith('data:image/') ? `<img class="avatar" src="${esc(profile.avatar)}" alt="玩家头像">` : `<span class="avatar">${esc(profile.avatar||'🫡')}</span>`; }
function portrait(key) { const url=assetUrl(data,key);return url?`<img class="portrait" src="${esc(url)}" alt="" loading="lazy" draggable="false">`:''; }
function button(action,text,attrs='',disabled=false) {return `<button data-action="${action}" ${attrs} ${disabled?'disabled':''}>${text}</button>`;}
function saveLocal() {
  if(!state.game || !state.room)return;
  try {sessionStorage.setItem('garrison-online-checkpoint-v1',JSON.stringify({roomId:state.room.id,playerId:state.playerId,checkpoint:state.game.checkpoint()}));}catch{notify('本地恢复点空间不足，服务端仍保留最近同步的恢复点');}
}
function checkpoint() {
  if(!state.game)return;
  saveLocal(); connection.send({type:'checkpoint',checkpoint:state.game.checkpoint()});
}
function peers() {
  return (state.room?.players||[]).filter(p=>p.id!==state.playerId&&!p.eliminated).map(p=>({playerId:p.id,bondCounts:Object.fromEntries(Object.entries(state.snapshots[p.id]?.bonds||{}).map(([id,b])=>[id,b.count||0]))}));
}
// 所有规则消息先更新本地房间，再统一 reconcile；画面快照只进入只读缓存。
function receive(message) {
  try {
    if(message.serverTime)state.clockOffset=message.serverTime-Date.now();
    if(message.type==='welcome') {
      state.playerId=message.playerId;
      if(!state.game) {
        let local;try{local=JSON.parse(sessionStorage.getItem('garrison-online-checkpoint-v1'));}catch{}
        const record=local?.roomId===message.roomId&&local.playerId===message.playerId?local.checkpoint:message.checkpoint;
        if(record){state.game=MultiplayerSession.restoreOnline(data,record);if(!state.game)notify('恢复点无法读取，请保持当前窗口并检查规则版本');}
      }
    } else if(message.type==='room') {
      if(state.room && message.room.id===state.room.id && message.room.revision<state.room.revision)return;
      state.room=message.room; reconcile(); render();
    } else if(message.type==='snapshot') {state.snapshots[message.playerId]=message.snapshot;}
    else if(message.type==='boss') {if(state.room){state.room.boss=message.boss;state.game?.updateBoss(message.boss);}}
    else if(message.type==='emote') {state.emotes[message.playerId]={emote:message.emote,until:Date.now()+3500};renderPlayers();}
    else if(message.type==='result-ack') {state.ack=message.taskId;}
    else if(message.type==='transfer') {if(state.game)state.game.receiveFangTransfer(message.record);else state.pendingTransfers.push(message.record);}
    else if(message.type==='transfer-ack') {const record=state.game?.s.transferOutbox.find(r=>r.transferId===message.transferId);if(record)record.sent=true;}
    else if(message.type==='left') {state.room=null;state.game=null;state.snapshots={};sessionStorage.removeItem('garrison-online-checkpoint-v1');render();}
    else if(message.type==='error') {notify(message.message);}
  } catch(error) {state.fault=error.message;notify('联机状态处理失败：'+error.message);console.error(error);render();}
}
// 处理重连/重复广播时，领取奖励、结算与推进均由已有账本守卫，只执行一次。
function reconcile() {
  const room=state.room,p=me();if(!room?.config||!p?.bandId)return;
  if(!state.game)state.game=new MultiplayerSession(data,room.config,p,peers());
  const game=state.game;
  game.s.teamPeers=peers();
  game.attachTeamTransport({send:record=>{connection.send({type:'transfer',record});return false;}});
  for(const record of state.pendingTransfers)game.receiveFangTransfer(record);state.pendingTransfers=[];
  // room.rewards/room.losses 在推进到下一轮前必须应用一次，在线结算永不由 UI 自己减 hp。
  if(room.lastSettlement && game.online.settlementRound < room.lastSettlement.round) {
    game.settle(room.lastSettlement, room.lastSettlement.players.find(row => row.id === p.id));
  }
  if(room.phase==='settlement')game.settle(room,p);
  if(room.round>game.s.round&&!p.eliminated) {
    if(game.s.phase!=='intermission')game.s.phase='intermission';
    if(!game.advanceRound())throw Error('无法推进到房间回合');
    state.selected=null;state.item=null;state.ack=null;state.view=state.playerId;
  }
  if(room.picked?.[p.id]&&!game.online.choices[room.round]) {
    if(!game.chooseShared(room.picked[p.id]))throw Error('无法领取公共决策');
    game.online.choices[room.round]=room.picked[p.id].id;
  }
  if(room.phase==='prep'&&game.s.phase==='decision'&&!room.choice) {game.s.phase='prep';game.startPreparation();}
  // 联防是强制观战切换：即使用户之前正在看别的队友，也必须切到当前兜底者。
  if(room.phase==='support' && state.supportTask!==room.task.id){state.supportTask=room.task.id;state.view=room.task.playerId;}
  if(room.phase==='boss')game.updateBoss(room.boss);
  if(room.phase==='finished') {
    if(game.battle && room.boss) {
      game.updateBoss(room.boss);
      if(!game.battle.s.finished)game.battle.finish(room.success?'boss-killed':'timeout');
      game.s.runResult={...game.battle.s.result,success:room.success,sharedBossHp:room.boss.hp};
    }
    game.s.hp=p.hp;game.s.phase='finished';
  }
  if(p.eliminated)game.s.hp=0;
  checkpoint();
}
function renderConnect() {
  root.innerHTML=`<section class="connect-panel"><p class="eyebrow">GARRISON PROTOCOL / ONLINE</p><h1>与队友一起守住阵地</h1><p>创建房间后分享房间号。每位指挥官独立布阵，共同联防与迎击最终领袖。</p>
    <form id="connect-form"><label>IP / 主机名<input name="host" required value="${esc(location.hostname||'127.0.0.1')}" placeholder="192.168.1.10"></label>
    <label>端口<input name="port" type="number" min="1" max="65535" required value="${esc(location.port||'8080')}"></label>
    <label>昵称<input name="name" maxlength="24" required value="${esc(state.profile.name)}"></label>
    <label>房间号<input name="room" maxlength="6" placeholder="创建房间时留空"></label>
    <label class="check"><input name="secure" type="checkbox" ${location.protocol==='https:'?'checked':''}>使用加密连接（WSS）</label>
    <div class="profile-edit">${avatar(state.profile)}<label>上传头像<input id="avatar-upload" type="file" accept="image/png,image/jpeg,image/webp"></label></div>
    <div class="actions"><button type="submit" name="intent" value="create" class="primary">创建房间</button><button type="submit" name="intent" value="join">进入房间</button></div></form>
    <p class="muted">局域网：先运行联机服务，再访问 http://服务端IP:端口/ 。</p><a href="../../dist/index.html">进入单机版 →</a></section>`;
}
function playersHtml() {
  return state.room.players.map(p=>`<button class="player ${p.id===state.view?'viewed':''} ${p.eliminated?'eliminated':''}" data-action="view" data-id="${p.id}">
    ${avatar(p)}<span><b>${esc(p.name)}${p.id===state.playerId?' · 我':''}</b><small>${p.hp===null?'待选策略':`${p.hp}/${p.maxHp} 生命`} · ${p.eliminated?'已淘汰':p.connected?(p.ready?'已准备':'在线'):'重连中'}</small></span>
    <span class="emote-bubble">${state.emotes[p.id]?.until>Date.now()?esc(state.emotes[p.id].emote):''}</span></button>`).join('');
}
function renderPlayers(){const el=document.getElementById('players');if(el&&state.room)el.innerHTML=playersHtml();}
function render() {
  if(!state.room){renderConnect();return;}
  const room=state.room,p=me();
  root.innerHTML=`<div class="room-heading"><div><p class="eyebrow">联合模拟</p><h1>房间 <span id="room-code">${esc(room.id)}</span></h1></div><div class="actions">${button('copy','复制房间号')}${button('leave','离开房间')}</div></div>
    <div id="players" class="players">${playersHtml()}</div>
    ${state.fault?`<p class="error">${esc(state.fault)} ${button('reload','重新加载并恢复')}</p>`:''}
    <section id="phase-panel">${phaseHtml(room,p)}</section>
    <section class="social"><div class="emotes">${EMOTES.map(e=>button('emote',e,`data-emote="${e}" aria-label="发送表情 ${e}"`)).join('')}</div><p class="muted" id="phase-status"></p></section>
    <details class="room-log"><summary>房间记录</summary>${room.log.map(row=>`<p>${esc(row.text)}</p>`).join('')}</details>`;
  draw();
}
// UI 按服务端阶段生成；淘汰者不显示可操作的准备界面，仍保留观战与表情。
function phaseHtml(room,p) {
  if(room.phase==='waiting')return `<section class="panel"><h2>等待队友加入 · ${room.players.length}/4</h2><div class="config-grid"><label>行动难度<select id="mode">${MODES.map(id=>`<option value="${id}" ${id==='mode_single_normal'?'selected':''}>${esc(data.season.modeDataDict[id].name)}</option>`).join('')}</select></label><label>作战阵地<select id="map"><option value="random">随机地图</option>${data.maps.filter(m=>m.weight>0).map(m=>`<option value="${m.stageId}">${esc(m.label||m.stageId)}</option>`).join('')}</select></label></div><p class="muted">房主的敌人波次与盟约禁用配置在开局时固定进本局。</p>${p?.id===room.hostId?button('start-room','开始选择策略','class="primary"',room.players.length<2):'<p>等待房主开始。</p>'}</section>`;
  if(room.phase==='strategy') {
    const current=room.players.find(p=>p.id===room.strategyOrder[0]);
    const can=room.strategyOrder[0]===state.playerId;
    return `<h2>${can?'轮到你选择策略':`等待 ${esc(current?.name)} 选择策略`}</h2><div class="strategy-grid">${visibleBands(data,loadArchive(localStorage)).map(b=>{
      const common=data.common.bandDataDict[b.bandId]||{},owner=room.players.find(p=>p.bandId===b.bandId);
      return `<button class="strategy-card" data-action="strategy" data-id="${b.bandId}" ${!can||owner?'disabled':''}>${portrait(common.charId)}<b>${esc(common.bandName||common.name||b.bandId)}</b><span>${esc(richText(b.bandDesc))}</span><small>${b.totalHp} 初始生命${owner?` · ${esc(owner.name)}已选`:''}</small></button>`;
    }).join('')}</div>`;
  }
  const game=state.game;
  if(!game)return '<p>正在建立本地会话……</p>';
  if(room.phase==='decision') {
    const active=room.choice.order[0]===state.playerId;
    return `<h2>${({bounty:'悬赏决策',equipment:'道具补给',tactical:'战术运营'})[room.choice.type]} · 六选一</h2><p>${active?'轮到你选择':`等待 ${esc(room.players.find(p=>p.id===room.choice.order[0])?.name)} 选择`}</p><div class="decision-grid">${room.choice.offers.map(offer=>{
      const owner=Object.entries(room.picked).find(([,v])=>v.id===offer.id)?.[0];
      const desc=offer.kind==='bounty'?`${offer.count} 名 · 击倒奖金 ${offer.coin}`:offer.kind==='equipment'?data.season.effectInfoDataDict[data.season.trapChessDataDict[offer.itemId]?.effectId]?.effectDesc:data.season.effectInfoDataDict[offer.effectId]?.effectDesc;
      return `<button class="decision-card" data-action="choice" data-id="${offer.id}" ${!active||owner?'disabled':''}>${offer.enemyId?portrait(offer.enemyId):''}<b>${esc(offer.name)}</b><span>${esc(richText(desc||''))}</span><small>${owner?`${esc(room.players.find(p=>p.id===owner)?.name)}已选`:'可选择'}</small></button>`;
    }).join('')}</div>`;
  }
  const support=room.phase==='support',isPrep=room.phase==='prep'&&!p.eliminated;
  const heading=({prep:'战斗准备',main:'道中作战',support:'联防接力',boss:'共同迎击领袖',settlement:'本轮结算',finished:room.success?'挑战成功':'挑战结束'})[room.phase];
  const boardViews=support&&room.supportPlayers.length===2?room.supportPlayers:[state.view||state.playerId];
  let html=`<div class="battle-heading"><h2>第 ${room.round} 回合 · ${heading}</h2><span id="battle-hud"></span></div>`;
  if(room.boss)html+=`<div class="boss-health"><label>共同 Boss 生命 <span id="boss-label"></span></label><progress id="boss-hp" max="${room.boss.maxHp}" value="${room.boss.hp}"></progress></div>`;
  html+=`<div class="boards ${boardViews.length===2?'split':''}">${boardViews.map(id=>`<div class="board-panel"><canvas width="880" height="594" data-player="${id}" aria-label="${esc(room.players.find(p=>p.id===id)?.name)}的战场"></canvas><p class="board-note">${id===state.playerId?'你的阵地':`${esc(room.players.find(p=>p.id===id)?.name)} · 只读观战`}${support?` · ${id===room.task.playerId?'正在联防':'等待接力 / 战后状态'}`:''}</p></div>`).join('')}</div>`;
  if(isPrep) {
    html+=`<div class="prep-layout"><section class="panel"><div class="section-heading"><h3>调度中心</h3><span id="economy">${game.s.funds} 资金 · ${game.s.level} 阶</span></div><div class="shop">${game.s.offers.map((id,i)=>id?`<button class="card" data-action="buy" data-index="${i}" ${p.ready?'disabled':''}>${portrait(data.profiles[id]?.charId)}<b>${esc(data.profiles[id]?.name)}</b><small>${game.price(id)} ◆</small></button>`:'<div class="card empty">已购入</div>').join('')}</div><div class="shop items">${game.s.itemOffers.map((id,i)=>id?`<button class="card" data-action="buyItem" data-index="${i}" ${p.ready?'disabled':''}><b>${esc(itemName(id))}</b><small>${data.season.trapChessDataDict[id]?.purchasePrice} ◆</small></button>`:'<div class="card empty">已购入</div>').join('')}</div><div class="actions">${button('refresh',`刷新 · ${game.terms().refreshCost} ◆`,'',p.ready)}${button('upgrade',`升级 · ${game.terms().upgradeCost??'满阶'} ◆`,'',p.ready||game.terms().upgradeCost===null)}${button('lock',game.s.locked?'取消冻结':'冻结商店','',p.ready)}</div></section>
    <section class="panel"><h3>整备区 · ${game.handLength()} / 10 · 部署 ${deployCount(game.s)} / ${game.s.capacity}</h3><div class="hand">${game.s.units.map(u=>`<button draggable="${!p.ready}" class="card ${state.selected===u.uid?'selected':''}" data-action="unit" data-uid="${u.uid}">${portrait(u.charId)}<b>${esc(data.profiles[u.chessId]?.name)}${data.profiles[u.chessId]?.isGolden?' ★':''}</b><small>${u.position?'已部署':'整备中'} · ${u.equipment.length}/2装备</small></button>`).join('')}${game.s.items.map(i=>`<button class="card ${state.item===i.uid?'selected':''}" data-action="item" data-uid="${i.uid}" draggable="${!p.ready}"><b>${esc(itemName(i.chessId))}</b><small>选择后点击干员装备</small></button>`).join('')}${(game.s.summonCards||[]).map(c=>`<button class="card ${state.selected===c.uid?'selected':''}" data-action="summon" data-uid="${c.uid}"><b>${esc(c.name)}</b><small>${c.position?'已放置':'待放置'}</small></button>`).join('')}</div><p class="muted">选择干员或召唤物，点击格位并确认朝向。装备可点选或拖到干员上。</p></section></div>
    ${placementHtml(game,p)}${dossierHtml(game,p)}${rewardsHtml(game)}<div class="ready-bar">${button('ready',p.ready?'取消准备':'准备战斗','class="primary"',!!game.s.rewardPending||!!state.fault)}</div>`;
  } else if(room.phase==='main'||support||room.phase==='boss') {
    html+=`<div class="combat-controls">${game.battle?.s.units.map(u=>`<button data-action="activate" data-uid="${u.uid}" ${game.battle.s.finished?'disabled':''}>${esc(data.profiles[u.chessId]?.name)} <span data-sp="${u.uid}"></span></button>`).join('')}</div>`;
  }
  if(room.phase==='settlement')html+=`<section class="panel result"><p>本轮生命损失 ${room.losses?.[p.id]||0} · 悬赏奖金 ${room.rewards?.[p.id]||0}（下轮到账）</p>${p.eliminated?'<p>你已淘汰，可继续观看队友。</p>':button('next',p.next?'等待队友':'进入下一回合','class="primary"',p.next)}</section>`;
  if(room.phase==='finished')html+=`<section class="panel result"><h3>${room.success?'共同击破最终领袖':'本局已结束'}</h3><p>剩余生命 ${p.hp}/${p.maxHp}</p>${game.s.runResult?`<p>你的总伤害 ${Math.round(game.s.runResult.totalDamage||0).toLocaleString()}</p>`:''}<div class="actions">${button('export','导出本次记录')}${button('leave','回到联机大厅','class="primary"')}</div></section>`;
  if(room.phase==='finished'&&game.s.runResult?.units)html+=damageReportHtml(game.s.runResult);
  html+=`<details class="bonds"><summary>当前视角的盟约与层数</summary><div id="bond-content"></div></details>`;
  return html;
}
/** 原引擎保留的逐干员1秒采样：直接画战报曲线，不用表现事件反推伤害。 */
function damageReportHtml(result) {
  const rows=(result.units||[]).filter(u=>u.damage>0).sort((a,b)=>b.damage-a.damage);
  return `<details class="panel damage-report" open><summary>逐干员伤害报告 · 1秒DPS采样</summary>${rows.map(u=>{
    const samples=u.dpsSamples||[],max=Math.max(1,...samples);
    const points=samples.map((value,i)=>`${10+i*580/Math.max(1,samples.length-1)},${100-value/max*85}`).join(' ');
    return `<div class="damage-row"><b>${esc(data.profiles[state.game.s.units.find(v=>v.uid===u.uid)?.chessId]?.name||u.id)}</b><span>${Math.round(u.damage).toLocaleString()} 伤害</span><svg viewBox="0 0 600 110" role="img" aria-label="${esc(u.id)}的每秒DPS曲线"><path d="M10 100H590" stroke="#4a6470"/><polyline fill="none" stroke="#83e4d5" stroke-width="2" points="${points}"/></svg></div>`;
  }).join('')||'<p>本场没有记录到干员伤害。</p>'}</details>`;
}
function itemName(id){return data.season.effectInfoDataDict[data.season.trapChessDataDict[id]?.effectId]?.effectName||id;}
function placementHtml(game,p) {
  if(!state.cell)return '';
  return `<section class="placement"><b>格位 ${state.cell.x+1}, ${state.cell.y+1} · 选择朝向</b><div class="actions">${['右 →','下 ↓','左 ←','上 ↑'].map((label,i)=>button('place',label,`data-dir="${i}"`,p.ready)).join('')}${button('cancel-place','取消')}</div></section>`;
}
function dossierHtml(game,p) {
  const u=game.s.units.find(u=>u.uid===state.selected),summon=game.s.summonCards.find(u=>u.uid===state.selected);
  if(summon)return `<section class="panel">${esc(summon.name)} ${button('withdrawSummon','收回召唤物',`data-uid="${summon.uid}"`,p.ready)}</section>`;
  if(!u){const item=game.s.items.find(i=>i.uid===state.item);return item?`<section class="panel"><h3>${esc(itemName(item.chessId))}</h3><p>${esc(richText(data.season.effectInfoDataDict[data.season.trapChessDataDict[item.chessId]?.effectId]?.effectDesc||''))}</p>${button('destroy','销毁装备',`data-uid="${item.uid}"`,p.ready)}</section>`:'';}
  const profile=data.profiles[u.chessId],skill=profile.skillChoices[u.skillIndex??profile.skillIndex]||profile;
  return `<section class="panel dossier"><h3>${esc(profile.name)} · ${profile.rank}阶${profile.isGolden?'精锐':''}</h3><p>${(profile.bonds||[]).map(id=>esc(data.season.bondInfoDict[id]?.name||id)).join(' / ')}</p><div class="actions">${profile.skillChoices.map((_,i)=>button('skill',`S${i+1}${i===(u.skillIndex??profile.skillIndex)?' ✓':''}`,`data-uid="${u.uid}" data-index="${i}"`,p.ready)).join('')}${button('withdraw','撤回整备区',`data-uid="${u.uid}"`,p.ready||!u.position)}${button('sell','出售',`data-uid="${u.uid}"`,p.ready)}</div><p>${renderSkillDescription(skill.skill)}</p><p>${profile.garrisons.map(g=>esc(richText(g.garrisonDesc))).join('<br>')}</p><div class="actions">${u.equipment.map((item,index)=>`<span>${esc(itemName(item.chessId))}${button('destroyEquip','销毁',`data-uid="${u.uid}" data-index="${index}"`,p.ready)}${state.item?button('replace','替换此槽',`data-uid="${u.uid}" data-index="${index}"`,p.ready):''}</span>`).join('')}</div></section>`;
}
function rewardsHtml(game) {
  const r=game.s.rewardPending;if(!r)return '';
  return `<section class="panel rewards"><h3>领取奖励后才能准备</h3><div class="actions">${(r.offers||[]).map(id=>button('takePromotion',esc(data.profiles[id]?.name||itemName(id)),`data-id="${esc(id)}"`)).join('')}</div></section>`;
}
function snapshotFor(id) {return id===state.playerId&&state.game?viewSnapshot(state.game):state.snapshots[id];}
function draw() {
  const game=state.game,room=state.room;if(!game||!room)return;
  for(const canvas of root.querySelectorAll('canvas')) {
    const id=canvas.dataset.player,snapshot=snapshotFor(id);
    let range=[];
    const unit=game.s.units.find(u=>u.uid===state.selected);
    if(id===state.playerId&&unit&&state.cell) {
      const profile=data.profiles[unit.chessId],skill=profile.skillChoices[unit.skillIndex??profile.skillIndex]?.skill||profile.skill;
      range=(data.ranges[skill?.rangeId||profile.rangeId]?.grids||profile.range.grids).map(row=>{
        let x=row.col,y=-row.row;for(let i=0;i<unit.dir;i++)[x,y]=[-y,x];return {x:x+state.cell.x,y:y+state.cell.y};
      });
    }
    drawBoard(canvas,data,snapshot,{selected:id===state.playerId?state.selected:null,selectedCell:id===state.playerId?state.cell:null,range,label:room.players.find(p=>p.id===id)?.name||''});
  }
  const hud=document.getElementById('battle-hud');if(hud)hud.textContent=game.battle?`${Math.max(0,Math.ceil(game.battle.s.limit-game.battle.s.time))}秒 · 漏失${game.battle.s.leaks} · ${Math.floor(game.battle.s.cost)}部署费用`:'';
  if(room.boss){const hp=document.getElementById('boss-hp'),label=document.getElementById('boss-label');if(hp)hp.value=room.boss.hp;if(label)label.textContent=`${Math.ceil(room.boss.hp).toLocaleString()} / ${room.boss.maxHp.toLocaleString()}`;}
  for(const span of root.querySelectorAll('[data-sp]')){const u=game.battle?.s.units.find(u=>u.uid===+span.dataset.sp);if(u)span.textContent=`SP ${Math.floor(u.sp)} / ${game.battle.spCost(u)}`;}
  const content=document.getElementById('bond-content');
  if(content&&content.closest('details').open) {
    const snapshot=snapshotFor(state.view||state.playerId);
    content.innerHTML=Object.entries(snapshot?.bonds||{}).filter(([,b])=>b.count||b.active).map(([id,b])=>`<p><b>${esc(data.season.bondInfoDict[id]?.name||id)}</b> ${b.count}人 · ${snapshot.layers[id]||0}层${b.active?' · 已激活':''}</p>`).join('');
  }
}
// 原会话负责具体操作是否合法；这里另加房间阶段/就绪门禁，禁止旁观视角发出部署命令。
function perform(action,...args) {
  if(!state.game||state.room.phase!=='prep'||me().ready||me().eliminated||state.fault)return false;
  const ok=state.game.perform(action,...args);if(!ok)notify(state.game.lastError||'当前条件不能执行：请检查资金、格位、整备区或奖励');
  else {checkpoint();publishSnapshot();}render();return ok;
}
function equip(uid,slot=null){if(perform('equip',state.item,uid,slot)){state.item=null;render();}}
root.addEventListener('click', async event => {
  const target=event.target.closest('[data-action]');if(!target)return;
  const {action,id,uid,index,dir}=target.dataset;
  try {
    if(action==='copy'){if(navigator.clipboard)await navigator.clipboard.writeText(state.room.id);else{const input=document.createElement('textarea');input.value=state.room.id;document.body.append(input);input.select();document.execCommand('copy');input.remove();}notify('房间号已复制');}
    else if(action==='leave'){connection.send({type:'leave'});}
    else if(action==='reload'){location.reload();}
    else if(action==='view'){state.view=id;render();}
    else if(action==='emote'){connection.send({type:'emote',emote:target.dataset.emote});}
    else if(action==='start-room')connection.send({type:'start',config:{modeId:document.getElementById('mode').value,mapId:document.getElementById('map').value,waveTable:loadWaveTable(),bondBan:loadBondBan(data)}});
    else if(action==='strategy')connection.send({type:'strategy',bandId:id});
    else if(action==='choice')connection.send({type:'choice',id});
    else if(action==='ready'){if(!me().ready&&!state.game.prepareOnlineReady()){notify('请先领取开战前产生的奖励');render();return;}checkpoint();publishSnapshot();connection.send({type:'ready',ready:!me().ready});}
    else if(action==='next'){checkpoint();connection.send({type:'next'});}
    else if(action==='unit') {if(state.item)equip(+uid);else{state.selected=+uid;state.cell=null;render();}}
    else if(action==='summon'){state.selected=+uid;state.cell=null;render();}
    else if(action==='item'){state.item=state.item===+uid?null:+uid;state.selected=null;render();}
    else if(action==='replace')equip(+uid,+index);
    else if(action==='cancel-place'){state.cell=null;render();}
    else if(action==='place') {
      if(!state.cell)return;const kind=state.game.s.summonCards.some(c=>c.uid===state.selected)?'deploySummon':'deploy';
      if(perform(kind,state.selected,state.cell.x,state.cell.y,+dir)){state.cell=null;render();}
    } else if(action==='activate') {
      const b=state.game?.battle,u=b?.s.units.find(u=>u.uid===+uid);
      if(b&&!b.s.finished&&u?.deployed&&u.sp>=b.spCost(u)&&!b.skillActive(u))b.activate(u);else notify('技力不足或技能正在持续');
    } else if(action==='export') {
      const record={format:'garrison-protocol-multiplayer-result',room:state.room,local:state.game.checkpoint()};
      const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`联机战报-${state.room.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } else if(['buy','buyItem'].includes(action))perform(action,+index);
    else if(action==='skill')perform(action,+uid,+index);
    else if(action==='destroyEquip')perform(action,+uid,+index);
    else if(action==='takePromotion')perform(action,id);
    else if(['sell','withdraw','withdrawSummon','destroy'].includes(action))perform(action,+uid);
    else if(['refresh','upgrade','lock'].includes(action))perform(action);
  } catch(error){notify(error.message);}
});
root.addEventListener('click',event=>{
  const canvas=event.target.closest('canvas');if(!canvas||canvas.dataset.player!==state.playerId||!state.game)return;
  if(state.room.phase!=='prep'||me().ready)return;
  const cell=cellAt(canvas,event,data,state.game.s.mapId);if(!cell)return;
  if(state.selected){state.cell=cell;render();}
  else {const unit=state.game.s.units.find(u=>u.position?.x===cell.x&&u.position?.y===cell.y);if(unit){state.selected=unit.uid;render();}}
});
let drag=null;
root.addEventListener('dragstart',event=>{const el=event.target.closest('[data-uid]');if(!el)return;drag={uid:+el.dataset.uid,kind:el.dataset.action};event.dataTransfer.setData('text/plain',String(drag.uid));});
root.addEventListener('dragover',event=>{if(event.target.closest('canvas,[data-action="unit"]'))event.preventDefault();});
root.addEventListener('drop',event=>{
  event.preventDefault();if(!drag||!state.game)return;
  const unit=event.target.closest('[data-action="unit"]'),canvas=event.target.closest('canvas');
  if(drag.kind==='item'&&unit){state.item=drag.uid;equip(+unit.dataset.uid);}
  else if(drag.kind==='unit'&&canvas?.dataset.player===state.playerId){state.selected=drag.uid;state.cell=cellAt(canvas,event,data,state.game.s.mapId);render();}
  drag=null;
});
root.addEventListener('change',async event=>{
  if(event.target.id!=='avatar-upload')return;
  try {
    const file=event.target.files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('请选择8MB以内的 PNG/JPEG/WebP 图片');
    const image=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const length=Math.min(image.width,image.height);canvas.getContext('2d').drawImage(image,(image.width-length)/2,(image.height-length)/2,length,length,0,0,128,128);
    state.profile.avatar=canvas.toDataURL('image/webp',.8);image.close();localStorage.setItem('garrison-online-profile-v1',JSON.stringify(state.profile));render();
  }catch(error){notify(error.message);}
});
root.addEventListener('submit',async event=>{
  if(event.target.id!=='connect-form')return;event.preventDefault();
  try {
    const form=new FormData(event.target),url=endpoint(form.get('host'),form.get('port'),form.has('secure'));
    if(location.protocol==='https:'&&!form.has('secure'))throw Error('HTTPS 网页请使用 WSS；局域网普通连接请打开服务端的 HTTP 页面');
    const address=new URL(url);address.protocol=form.has('secure')?'https:':'http:';address.pathname='/health';
    const health=await fetch(address,{signal:AbortSignal.timeout(8000)}).then(r=>r.json());
    const localHealth=await fetch(new URL('../../health',import.meta.url),{signal:AbortSignal.timeout(8000)}).then(r=>r.json());
    if(health.rulesHash!==localHealth.rulesHash)throw Error('两个服务端规则版本不同，请打开目标服务端提供的页面');
    state.profile.name=String(form.get('name')).trim();localStorage.setItem('garrison-online-profile-v1',JSON.stringify(state.profile));
    connection.stop();
    await connection.connect(url,{rulesHash:health.rulesHash,create:event.submitter.value==='create',roomId:String(form.get('room')).trim().toUpperCase(),profile:state.profile,flags:loadArchive(localStorage).flags});
  }catch(error){notify('连接失败：'+error.message);}
});
function publishSnapshot(){if(state.game)connection.send({type:'snapshot',snapshot:viewSnapshot(state.game)});}
let last=performance.now(),accumulator=0,lastPublish=0,lastCheckpoint=0,lastReport=0,lastBoss=0,lastPaint=0,lastTransfer=0;
// 仅推进房间分配给自己的任务。taskId 防止同一轮广播反复重建战斗。
function advance() {
  const now=performance.now(),gap=Math.min(5,(now-last)/1000);last=now;
  try {
    const game=state.game,room=state.room,p=me();
    if(game&&room&&!state.fault&&!p.eliminated) {
      const task=room.task,canStart=task&&Date.now()+state.clockOffset>=task.startedAt;
      if(canStart&&['main','boss'].includes(room.phase)&&game.online.taskId!==task.id) {
        if(!game.startOnlineBattle(task))throw Error('全员准备后本地无法开战，请检查尚未领取的奖励');
        if(room.boss)game.updateBoss(room.boss);
        state.ack=null;accumulator=0;checkpoint();render();
      }
      if(canStart&&room.phase==='support'&&task.playerId===state.playerId&&game.online.taskId!==task.id) {
        game.online.supportStartTime=game.battle.s.time;game.startSupport(task);state.ack=null;accumulator=0;checkpoint();render();
      }
      const ownBattle=['main','boss'].includes(room.phase)||room.phase==='support'&&task?.playerId===state.playerId;
      if(ownBattle&&game.s.phase==='battle'&&!game.battle.s.finished&&canStart) {
        accumulator+=gap;
        const deadline=performance.now()+100;
        while(accumulator>=1/30&&!game.battle.s.finished){game.tick();accumulator-=1/30;if(performance.now()>deadline)break;}
      } else accumulator=0;
      if(room.phase==='boss'&&game.online.taskId===task.id&&now-lastBoss>=120) {
        connection.send({type:'boss-progress',taskId:game.online.taskId,damage:game.online.damage,healing:game.online.healing});lastBoss=now;
      }
      if(game.online.report&&state.ack!==game.online.report.taskId&&now-lastReport>=600&&ownBattle) {
        connection.send({type:'result',...game.online.report});lastReport=now;checkpoint();
      }
      if(now-lastPublish>=160){publishSnapshot();lastPublish=now;}
      if(now-lastCheckpoint>=2500){checkpoint();lastCheckpoint=now;}
      if(now-lastTransfer>=1000){for(const record of game.s.transferOutbox||[])if(!record.sent)connection.send({type:'transfer',record});lastTransfer=now;}
    }
    if(now-lastPaint>=33){draw();lastPaint=now;}
    const status=document.getElementById('phase-status');if(status&&room)status.textContent=me()?.eliminated?'你已淘汰，继续观战':room.phase==='support'?'联防按顺序接力，最终向原漏怪玩家结算':'全体存活玩家准备后同步开战';
  } catch(error){state.fault=error.message;console.error(error);notify('战斗已暂停：'+error.message);render();}
}
// 后台定时器与可见动画共用推进函数，避免打开队友视角或切后台就停止自己的模拟。
function frame(){advance();requestAnimationFrame(frame);}requestAnimationFrame(frame);
setInterval(()=>{if(document.hidden)advance();renderPlayers();},250);
window.addEventListener('pagehide',checkpoint);
// 同一标签页刷新可凭短期凭证重连；不使用单机的任何存档键。
render();
try {
  const saved=JSON.parse(sessionStorage.getItem('garrison-online-connection-v1'));
  if(saved){connection.credentials=saved.credentials;connection.connect(saved.url,saved.hello);}
}catch{}
// 浏览器验收仅暴露读状态接口，不为生产用户添加越权房间控制命令。
window.__garrisonOnline={get state(){return state;},connection};
