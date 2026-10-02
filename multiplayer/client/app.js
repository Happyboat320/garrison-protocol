/** 联机页面独立启动；单机 native-play.js 不参与本页面生命周期。 */
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {richText} from '../../dist/protocol.js';
import {loadArchive} from '../../dist/native-archive.js';
import {visibleBands} from '../../dist/native-sees.js';
import {loadWaveTable} from '../../dist/native-wave-fill.js';
import {loadBondBan, bondBanBriefingHtml, bannedOperatorsHtml} from '../../dist/native-bond-ban.js';
import {EMOTES, MODES} from '../shared/rules.js';
import {Connection, endpoint} from './connection.js';
import {MultiplayerSession} from './session.js';
import {nativeUI} from './native-play.generated.js';
import {presentationSnapshot, restorePresentation, assetUrl} from './presentation.js';

// Pages 没有动态 /health：构建时写入与服务端相同的规则指纹。
const publishedVersion = await fetch(new URL('../version.json',import.meta.url),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('联机版本文件缺失');return r.json();});
const defaultEndpoint = publishedVersion.websocketUrl ? new URL(publishedVersion.websocketUrl) : null;
const root = document.getElementById('online-app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {room:null, playerId:null, game:null, snapshots:{}, view:null, selected:null, item:null, cell:null,
  fault:null, supportTask:null, clockOffset:0, ack:null, pendingTransfers:[], emotes:{}, profile:readProfile()};
let toastTimer;
// 浮框位置只在本地保存；重绘/观战切换保持位置，不占游戏棋盘布局。
let socialPosition;
try { socialPosition=JSON.parse(localStorage.getItem('garrison-online-social-position')); } catch {}
function positionSocial() {
  const panel=document.getElementById('online-social');if(!panel?.classList.contains('floating'))return;
  const x=Math.max(0,Math.min((Number.isFinite(socialPosition?.x)?socialPosition.x:12),Math.max(0,innerWidth-panel.offsetWidth)));
  const y=Math.max(0,Math.min((Number.isFinite(socialPosition?.y)?socialPosition.y:80),Math.max(0,innerHeight-panel.offsetHeight)));
  panel.style.left=x+'px';panel.style.top=y+'px';socialPosition={x,y};
}
window.addEventListener('resize',positionSocial);
root.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('.social-drag-handle');if(!handle||event.button!==0)return;
  const panel=handle.closest('#online-social'),rect=panel.getBoundingClientRect();
  const origin={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
  handle.setPointerCapture(event.pointerId);event.preventDefault();
  const move=e=>{socialPosition={x:origin.left+e.clientX-origin.x,y:origin.top+e.clientY-origin.y};positionSocial();};
  const finish=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);try{localStorage.setItem('garrison-online-social-position',JSON.stringify(socialPosition));}catch{}};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
});
function notify(text) { const el=document.getElementById('online-toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500); }
function readProfile() { try {return JSON.parse(localStorage.getItem('garrison-online-profile-v1')) || {name:'指挥官',avatar:'🫡'};}catch{return {name:'指挥官',avatar:'🫡'};} }
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
    } else if(message.type==='snapshot') {state.snapshots[message.playerId]=message.snapshot;if(state.view===message.playerId||state.room?.phase==='support'&&state.room.task.playerId===message.playerId)syncNativeView();}
    else if(message.type==='boss') {if(state.room){state.room.boss=message.boss;state.game?.updateBoss(message.boss);}}
    else if(message.type==='emote') {state.emotes[message.playerId]={emote:message.emote,until:Date.now()+5000};renderPlayers();}
    else if(message.type==='result-ack') {state.ack=message.taskId;}
    else if(message.type==='transfer') {if(state.game)state.game.receiveFangTransfer(message.record);else state.pendingTransfers.push(message.record);}
    else if(message.type==='transfer-ack') {const record=state.game?.s.transferOutbox.find(r=>r.transferId===message.transferId);if(record)record.sent=true;}
    else if(message.type==='left') {state.room=null;state.game=null;state.snapshots={};state.peerViews={};nativeUI.clear();sessionStorage.removeItem('garrison-online-checkpoint-v1');render();}
    else if(message.type==='error') {notify(message.message);}
  } catch(error) {state.fault=error.message;notify('联机状态处理失败：'+error.message);console.error(error);render();}
}
// 处理重连/重复广播时，领取奖励、结算与推进均由已有账本守卫，只执行一次。
function reconcile() {
  const room=state.room,p=me();if(!room?.config||!p?.bandId)return;
  if(!state.game)state.game=new MultiplayerSession(data,room.config,p,peers());
  state.game.commandAllowed=type=>canEdit()||type==='mineCommand'&&ownView()&&state.game.s.phase==='battle';
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
    <form id="connect-form"><label>IP / 主机名<input name="host" required value="${esc(defaultEndpoint?.hostname||location.hostname||'127.0.0.1')}" placeholder="192.168.1.10"></label>
    <label>端口<input name="port" type="number" min="1" max="65535" required value="${esc(defaultEndpoint?.port||(defaultEndpoint?.protocol==='wss:'?'443':location.port||(location.protocol==='https:'?'443':'8080')))}"></label>
    <label>昵称<input name="name" maxlength="24" required value="${esc(state.profile.name)}"></label>
    <label>房间号<input name="room" maxlength="6" placeholder="创建房间时留空"></label>
    <label class="check"><input name="secure" type="checkbox" ${(defaultEndpoint?.protocol==='wss:'||location.protocol==='https:')?'checked':''}>使用加密连接（WSS）</label>
    <div class="profile-edit">${avatar(state.profile)}<label>上传头像<input id="avatar-upload" type="file" accept="image/png,image/jpeg,image/webp"></label></div>
    <div class="actions"><button type="submit" name="intent" value="create" class="primary">创建房间</button><button type="submit" name="intent" value="join">进入房间</button></div></form>
    <p class="muted">局域网：先运行联机服务，再访问 http://服务端IP:端口/ 。</p><a href="./index.html">进入单机版 →</a></section>`;
}
function playersHtml() {
  return state.room.players.map(p=>`<button class="player ${p.id===state.view?'viewed':''} ${p.eliminated?'eliminated':''}" data-action="view" data-id="${p.id}">
    <span class="player-avatar-wrap">${avatar(p)}<span class="emote-bubble">${state.emotes[p.id]?.until>Date.now()?esc(state.emotes[p.id].emote):''}</span></span><span><b>${esc(p.name)}${p.id===state.playerId?' · 我':''}</b><small>${p.hp===null?'待选策略':`${p.hp}/${p.maxHp} 生命`} · ${p.eliminated?'已淘汰':p.connected?(p.ready?'已准备':'在线'):'重连中'}</small></span>
    </button>`).join('');
}
function renderPlayers(){const el=document.getElementById('players');if(el&&state.room){const markup=playersHtml();if(el._markup!==markup){el.innerHTML=markup;el._markup=markup;}}}
function render() {
  if(!state.room){renderConnect();return;}
  const room=state.room,p=me();
  root.innerHTML=`<div class="room-heading"><div><p class="eyebrow">联合模拟</p><h1>房间 <span id="room-code">${esc(room.id)}</span></h1></div><div class="actions">${button('copy','复制房间号')}${button('leave','离开房间')}</div></div>

    ${state.fault?`<p class="error">${esc(state.fault)} ${button('reload','重新加载并恢复')}</p>`:''}
    <section id="phase-panel">${phaseHtml(room,p)}</section>
    <aside id="online-social" class="${['prep','main','support','boss'].includes(room.phase)?'floating':''}" aria-label="队友视角与表情"><div class="social-drag-handle" title="拖动移动">⠿ 队友视角 / 表情</div><div id="players" class="players">${playersHtml()}</div><section class="social"><div class="emotes">${EMOTES.map(e=>button('emote',e,`data-emote="${e}" aria-label="发送表情 ${e}"`)).join('')}</div><p class="muted" id="phase-status"></p></section></aside>
    <details class="room-log"><summary>房间记录</summary>${room.log.map(row=>`<p>${esc(row.text)}</p>`).join('')}</details>`;
  positionSocial();
  syncNativeView();
  draw();
}
// UI 按服务端阶段生成；淘汰者不显示可操作的准备界面，仍保留观战与表情。
function phaseHtml(room,p) {
  if(room.phase==='waiting')return `<section class="panel"><h2>等待队友加入 · ${room.players.length}/4</h2><div class="config-grid"><label>行动难度<select id="mode">${MODES.map(id=>`<option value="${id}" ${id==='mode_single_normal'?'selected':''}>${esc(data.season.modeDataDict[id].name)}</option>`).join('')}</select></label><label>作战阵地<select id="map"><option value="random">随机地图</option>${data.maps.filter(m=>m.weight>0).map(m=>`<option value="${m.stageId}">${esc(m.label||m.stageId)}</option>`).join('')}</select></label></div><p class="muted">房主的敌人波次与盟约禁用配置在开局时固定进本局。</p>${p?.id===room.hostId?button('start-room','开始游戏','class="primary"',room.players.length<2):'<p>等待房主开始。</p>'}</section>`;
  if(room.phase==='briefing') {
    // 复用单机禁用预览与干员名单，展示服务端已冻结的本局结果。
    const briefing=bondBanBriefingHtml(data,room.config.bondBan,{esc});
    return `<section class="online-briefing">${briefing||'<h2>本局没有禁用盟约</h2>'}<div class="briefing-operators" hidden>${bannedOperatorsHtml(data,room.config.bondBan,{esc,avatar:portrait})}</div><div class="actions">${button('briefing-ready',p.briefingSeen?'等待队友确认':'已了解，进入策略选择','class="primary"',p.briefingSeen)}</div></section>`;
  }
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
  if(room.phase==='settlement')return `<section class="panel"><p>本轮生命损失 ${room.losses?.[p.id]||0} · 悬赏奖金 ${room.rewards?.[p.id]||0}（下轮到账）</p>${p.eliminated?'<p>你已淘汰，可继续观看队友。</p>':button('next',p.next?'等待队友':'进入下一回合','class="primary"',p.next)}</section>`;
  if(room.phase==='finished')return `<section class="panel"><h3>${room.success?'共同击破最终领袖':'本局已结束'}</h3>${button('export','导出本次记录')}${button('leave','回到联机大厅','class="primary"')}</section>`;
  return `<div class="online-round">第 ${room.round} 回合 · ${({prep:'战斗准备',main:'道中作战',support:'联防接力',boss:'共同迎击领袖'})[room.phase]||room.phase}${room.boss?` · Boss 剩余 <span id="boss-label">${Math.ceil(room.boss.hp)}</span>`:''}</div>`;
}
function ownView(){return !state.view||state.view===state.playerId;}
function observedGame(id=state.view){
 if(!id||id===state.playerId)return state.game;
 const snapshot=state.snapshots[id];if(!snapshot)return null;
 state.peerViews??={};const cached=state.peerViews[id];
 if(cached?.snapshot===snapshot)return cached.game;
 const game=restorePresentation(data,snapshot);state.peerViews[id]={snapshot,game};return game;
}
function syncNativeView(){
  const visible=state.game&&state.room&&!['waiting','briefing','strategy','decision'].includes(state.room.phase);
  const app=document.getElementById('app');app.hidden=!visible;
  if(!visible){nativeUI.clear();return;}
  const ids=state.room.phase==='support'&&state.room.supportPlayers.length===2?[state.room.task.playerId,...state.room.supportPlayers.filter(id=>id!==state.room.task.playerId)]:null;
  const primary=ids?ids[0]:state.view||state.playerId;
  nativeUI.mount(observedGame(primary)||state.game);
  if(ids){
    const board=document.querySelector('.native-board');
    board?.classList.add('online-split');
    if(!board?.querySelector('#online-second-canvas'))board?.insertAdjacentHTML('beforeend',`<canvas id="online-second-canvas" aria-label="第二名联防队友的战场"></canvas>`);
    app.dataset.secondPlayer=ids[1];
  }else delete app.dataset.secondPlayer;
}
function draw(){
  const second=document.getElementById('online-second-canvas');
  if(second)nativeUI.drawOn(second,observedGame(document.getElementById('app').dataset.secondPlayer));
  const label=document.getElementById('boss-label');if(label&&state.room?.boss)label.textContent=Math.ceil(state.room.boss.hp).toLocaleString();
}
// 游戏主体只由 nativeUI 的原 UI 处理；此模块只处理网络按钮和房间状态。
nativeUI.configure({
 save(){checkpoint();publishSnapshot();},
 paintExtra:draw,
 action(button){
  const action=button.dataset.act;
  if(action==='home'){connection.send({type:'leave'});return true;}
  if(action==='start'){ready();return true;}
  if(action==='next'){connection.send({type:'next'});return true;}
  if(action==='export'){exportOnline();return true;}
  if(['pause','speed','new','begin','resume','import','sandbox'].includes(action))return true;
  return false;
 },
 afterRender(){
  const app=document.getElementById('app');
  if(state.room?.phase==='support'&&state.room.supportPlayers.length===2&&!app.querySelector('#online-second-canvas')){const board=app.querySelector('.native-board');board?.classList.add('online-split');board?.insertAdjacentHTML('beforeend','<canvas id="online-second-canvas" aria-label="第二名联防队友的战场"></canvas>');app.dataset.secondPlayer=state.room.supportPlayers.find(id=>id!==state.room.task.playerId);}
  const board=app.querySelector('.native-board');
  const split=state.room?.phase==='support'&&state.room.supportPlayers.length===2;
  if(split&&board){
    if(!board.querySelector('.online-split-label'))board.insertAdjacentHTML('beforeend','<span class="online-split-label"></span><span class="online-split-label right"></span>');
    const current=state.room.task.playerId,other=state.room.supportPlayers.find(id=>id!==current);
    board.querySelector('.online-split-label').textContent=(state.room.players.find(p=>p.id===current)?.name||'队友')+' · 正在联防';
    board.querySelector('.online-split-label.right').textContent=(state.room.players.find(p=>p.id===other)?.name||'队友')+' · 等待 / 战后状态';
  }else if(board){board.classList.remove('online-split');board.querySelector('#online-second-canvas')?.remove();for(const el of board.querySelectorAll('.online-split-label'))el.remove();}
  app.classList.toggle('online-readonly',!canEdit());
  for(const button of app.querySelectorAll('[data-act="pause"],[data-act="speed"]'))button.hidden=true;
  const start=app.querySelector('[data-act="start"]');if(start){start.textContent=me()?.ready?'取消准备':'准备完毕 →';start.disabled=!!state.fault||!!state.game?.s.rewardPending||!ownView()||!!me()?.eliminated;}
  const next=app.querySelector('[data-act="next"]');if(next)next.disabled=state.room?.phase!=='settlement'||me()?.next||me()?.eliminated;
 },
});
function canEdit(){return ownView()&&state.room?.phase==='prep'&&!me()?.ready&&!me()?.eliminated&&!state.fault;}
function ready(){
 if(!ownView()||!state.game||state.room?.phase!=='prep'||me()?.eliminated)return;
 try{if(!me().ready&&!state.game.prepareOnlineReady()){notify('请先领取开战前产生的奖励');syncNativeView();return;}checkpoint();publishSnapshot();connection.send({type:'ready',ready:!me().ready});}catch(error){notify(error.message);}
}
function exportOnline(){
 const url=URL.createObjectURL(new Blob([JSON.stringify({format:'garrison-protocol-multiplayer-result',room:state.room,local:state.game?.checkpoint()},null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=`联机战报-${state.room.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// 捕获层阻止只读视角/就绪后的拖放、键盘部署和手动技能。网络 ready/next/home 仍可用。
const nativeRoot=document.getElementById('app');
for(const name of ['pointerdown','pointerup','click','keydown'])nativeRoot.addEventListener(name,event=>{
 const locked=!ownView()||me()?.eliminated||me()?.ready&&state.room?.phase==='prep'||state.room?.phase==='support'&&state.room.task?.playerId!==state.playerId;
 if(!locked)return;
 const act=event.target.closest('[data-act]')?.dataset.act;
 if(['home','start','next','export','result','result-unit','close','mute','reduce-fx','fullscreen','limits','branches','ban-list','bond-info','field-info','supply-toggle','hand-scroll'].includes(act))return;
 event.preventDefault();event.stopImmediatePropagation();
},true);
root.addEventListener('click',async event=>{
 const closeList=event.target.closest('.briefing-operators [data-act="close"]');
 if(closeList){closeList.closest('.briefing-operators').hidden=true;return;}
 const banButton=event.target.closest('[data-act="ban-list"]');
 if(banButton){const list=root.querySelector('.briefing-operators');if(list)list.hidden=!list.hidden;return;}
 const target=event.target.closest('[data-action]');if(!target)return;
 const {action,id}=target.dataset;
 try{
  if(action==='copy'){await navigator.clipboard?.writeText(state.room.id);notify('房间号已复制');}
  else if(action==='leave')connection.send({type:'leave'});
  else if(action==='reload')location.reload();
  else if(action==='view'){state.view=id;render();}
  else if(action==='emote')connection.send({type:'emote',emote:target.dataset.emote});
  else if(action==='start-room')connection.send({type:'start',config:{modeId:document.getElementById('mode').value,mapId:document.getElementById('map').value,waveTable:loadWaveTable(),bondBan:loadBondBan(data)}});
  else if(action==='briefing-ready')connection.send({type:'briefing-ready'});
  else if(action==='strategy')connection.send({type:'strategy',bandId:id});
  else if(action==='choice')connection.send({type:'choice',id});
  else if(action==='ready')ready();
  else if(action==='next')connection.send({type:'next'});
  else if(action==='export')exportOnline();
 }catch(error){notify(error.message);}
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
    const localHealth=publishedVersion;
    if(health.rulesHash!==localHealth.rulesHash)throw Error('网页与服务端规则版本不同，请刷新网页或等待发布同步');
    state.profile.name=String(form.get('name')).trim();localStorage.setItem('garrison-online-profile-v1',JSON.stringify(state.profile));
    connection.stop();
    await connection.connect(url,{rulesHash:health.rulesHash,create:event.submitter.value==='create',roomId:String(form.get('room')).trim().toUpperCase(),profile:state.profile,flags:loadArchive(localStorage).flags});
  }catch(error){notify('连接失败：'+error.message);}
});
function publishSnapshot(){if(state.game)connection.send({type:'snapshot',snapshot:presentationSnapshot(state.game)});}
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
      if(now-lastPublish>=400){publishSnapshot();lastPublish=now;}
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
window.__garrisonOnline={nativeUI,get state(){return state;},connection};
