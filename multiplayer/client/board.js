/**
 * 联机只读棋盘渲染器：自身和队友都使用同一种快照格式。
 * 这里只画图，不复算队友伤害，不修改地图或战斗对象。
 */
import {blowerCells} from '../../dist/native-environment.js';
import {enemySprite, tileLiftAmount, isolatedPlatform} from '../../dist/protocol.js';
const images = new Map();
export function assetUrl(data, key) { return data.assets[key] ? new URL(`../../dist/${data.assets[key]}`, import.meta.url).href : ''; }
function picture(data, key) {
  const url = assetUrl(data, key); if (!url) return null;
  if (!images.has(url)) { const img = new Image(); img.src = url; images.set(url, img); }
  const img = images.get(url); return img.complete && img.naturalWidth ? img : null;
}
export function viewSnapshot(session) {
  const battle = session.battle, live = ['battle', 'intermission', 'finished'].includes(session.s.phase) && !!battle;
  const actor = u => ({uid: u.uid, id: u.id || u.charId, chessId: u.chessId, x: u.x ?? u.position?.x,
    y: u.y ?? u.position?.y, dir: u.dir, name: u.name, hp: u.hp, maxHp: u.maxHp, sp: u.sp,
    deployed: u.deployed, down: u.down, dollForm: u.dollForm, persona: u.persona, skillLeft: u.skillLeft,
    statuses: u.statuses?.map(s => ({type:s.type, left:s.left})), spriteScale: u.spriteScale,
    revivePhase: u.revivePhase, revive: u.revive, spriteId: u.spriteId,
    type: u.type, kind: u.kind, equipment: (u.source?.equipment || u.equipment || []).map(i => i.chessId),
    skillIndex: u.source?.skillIndex ?? u.skillIndex});
  return {round: session.s.round, mapId: session.s.mapId, phase: session.s.phase, bandId: session.s.bandId,
    time: battle?.s.time || 0, limit: battle?.s.limit || 0, cost: battle?.s.cost || 0,
    units: live ? battle.s.units.map(actor) : session.s.units.filter(u => u.position).map(actor),
    summons: live ? (battle.s.summons || []).map(actor) : (session.s.summonCards || []).filter(c => c.position).map(actor),
    enemies: live ? battle.s.enemies.filter(e => e.hp > 0).map(actor) : [],
    bonds: session.bonds(), layers: {...session.s.bondLayers},
    dominionCells: live ? battle.s.dominionCells : null, bossArea: !live ? session.finalBossPrepArea() : null,
    leaks: battle?.s.leaks || 0, kills: (battle?.s.kills || 0) - (battle?.s.derivedKills || 0), total: battle?.s.total || 0};
}
export function drawBoard(canvas, data, snapshot, {selected = null, selectedCell = null, range = [], label = ''} = {}) {
  const c = canvas.getContext('2d'), map = data.maps.find(m => m.stageId === snapshot?.mapId);
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (!map) { c.fillStyle='#8fa4a8'; c.font='22px sans-serif'; c.fillText('等待队友发布布阵',30,70); return; }
  const size = Math.min(canvas.width / map.cols, (canvas.height - 34) / map.rows), top = 34;
  c.fillStyle='#a6c8cb'; c.font='16px sans-serif'; c.fillText(label,12,23);
  for (let y=0;y<map.rows;y++) for(let x=0;x<map.cols;x++) {
    const tile=map.grid[y][x], px=x*size, lift=tileLiftAmount(tile,size), py=top+y*size-lift;
    const special = tile.tileKey;
    c.fillStyle = tile.buildableType==='NONE' ? '#1c242b' : tile.heightType==='HIGHLAND' ? '#455369' : '#303d43';
    if(special==='tile_deepsea') c.fillStyle='#153b54';
    if(special==='tile_mire') c.fillStyle='#44492d';
    if(special==='tile_infection') c.fillStyle='#643f35';
    if(special==='tile_smog') c.fillStyle='#4b5760';
    if(lift){c.fillStyle='#263342';c.fillRect(px+1,py+size-lift,size-2,lift+2);c.fillStyle='#455369';}
    c.fillRect(px+1,py+1,size-2,size-2);
    if(special==='tile_start'||special==='tile_end'){c.strokeStyle=special==='tile_start'?'#df7568':'#60bce4';c.lineWidth=4;c.strokeRect(px+6,py+6,size-12,size-12);c.fillStyle=c.strokeStyle;c.font=`${size*.2}px sans-serif`;c.fillText(special==='tile_start'?'入口':'目标',px+size*.25,py+size*.57);}
    if(isolatedPlatform(tile)) {c.strokeStyle='#b9905d';c.lineWidth=3;c.strokeRect(px+5,py+5,size-10,size-10);}
    const badge = {tile_deepsea:'深水',tile_mire:'沼泽',tile_infection:'源石',tile_smog:'排气'}[special];
    if(badge){c.fillStyle='#b8b7a4';c.font=`${size*.15}px sans-serif`;c.fillText(badge,px+4,py+size-5);}
    if(range.some(row=>row.x===x&&row.y===y)){c.fillStyle='#d6bd5838';c.fillRect(px+2,py+2,size-4,size-4);}
    if(snapshot.bossArea && x>=snapshot.bossArea.firstColumn && y<snapshot.bossArea.rows) {
      c.fillStyle='#a0444466';c.fillRect(px+2,py+2,size-4,size-4);c.fillStyle='#e4b5b5';c.font=`${size*.16}px sans-serif`;c.fillText('Boss占位',px+4,py+size*.55);
    }
    if(selectedCell?.x===x&&selectedCell?.y===y){c.strokeStyle='#73ece0';c.lineWidth=3;c.strokeRect(px+2,py+2,size-4,size-4);}
  }
  for(const wind of blowerCells(map).values()){c.fillStyle='#79b2c588';c.font=`${size*.35}px sans-serif`;c.fillText(['→','↓','←','↑'][wind.index],(wind.x+.35)*size,top+(wind.y+.6)*size);}
  // 红蓝门沿用地图配置，装置用标记辅助识别；地形部署合法性仍走原 canDeploy。
  for(const device of map.devices || []) {
    const x=device.x??device.position?.col,y=device.y??device.position?.row;
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    c.fillStyle='#d1b178';c.font=`${size*.15}px sans-serif`;const glyph={'trap_1105_accrate':'箱体','trap_040_canoe':'平台','trap_013_blower':'气流','trap_1106_acseal':'封印'}[device.id]||'装置';c.fillText(glyph,x*size+5,top+y*size+15);
  }
  for(const [actors,enemy] of [[snapshot.units||[],false],[snapshot.summons||[],false],[snapshot.enemies||[],true]]) {
    for(const a of actors) {
      if(!Number.isFinite(a.x)||!Number.isFinite(a.y))continue;
      const sprite=enemy?enemySprite(a):{key:a.id,scale:1,tint:null};
      const width=size*.66*(sprite.scale||1), px=(a.x+.5)*size, py=top+(a.y+.5)*size-tileLiftAmount(map.grid[Math.round(a.y)]?.[Math.round(a.x)],size);
      const pic=picture(data,sprite.key);
      c.save();
      if(a.deployed===false)c.globalAlpha=.35;
      c.fillStyle=enemy?'#ab4b49':'#459d9b';
      if(pic)c.drawImage(pic,px-width/2,py-width/2,width,width);else{c.beginPath();c.arc(px,py,size*.25,0,Math.PI*2);c.fill();}
      if(a.dollForm){c.fillStyle=a.persona==='orpheus'?'#ead69a77':a.persona==='thanatos'?'#213d7d88':'#74398577';c.fillRect(px-width/2,py-width/2,width,width);}
      if(sprite.tint){c.fillStyle='#76625755';c.fillRect(px-width/2,py-width/2,width,width);}
      if(a.maxHp>0){c.fillStyle='#111';c.fillRect(px-size*.3,py+size*.29,size*.6,4);c.fillStyle=enemy?'#ef786c':'#78d8aa';c.fillRect(px-size*.3,py+size*.29,size*.6*Math.max(0,a.hp/a.maxHp),4);}
      if(!enemy){
        const arrow=['→','↓','←','↑'][a.dir||0];c.fillStyle='#efffff';c.font=`${size*.22}px sans-serif`;c.fillText(arrow,px+size*.23,py);
        if(a.down>0){c.font=`${size*.18}px sans-serif`;c.fillText(`${Math.ceil(a.down)}s`,px-size*.2,py);}
      }
      if(a.uid===selected){c.strokeStyle='#83f5e7';c.lineWidth=3;c.strokeRect(px-size*.38,py-size*.38,size*.76,size*.76);}
      c.restore();
    }
  }
}
export function cellAt(canvas, event, data, mapId) {
  const map=data.maps.find(m=>m.stageId===mapId), rect=canvas.getBoundingClientRect();
  if(!map)return null;
  const size=Math.min(canvas.width/map.cols,(canvas.height-34)/map.rows);
  const x=Math.floor((event.clientX-rect.left)*canvas.width/rect.width/size);
  const y=Math.floor(((event.clientY-rect.top)*canvas.height/rect.height-34)/size);
  return x>=0&&y>=0&&x<map.cols&&y<map.rows?{x,y}:null;
}
