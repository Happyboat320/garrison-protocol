/**
 * 本文件在构建时追加到最新 native-play.js 的模块作用域。
 * 只接管联网的生命周期：不复制商店、部署、档案、技能按钮、战报或绘图。
 * 单机仍直接使用原源码/原 bundle，本接口仅存在于联机入口。
 */
let onlineHooks=null,lastOnlinePaint=0,lastOnlineLayout=null;
const singleRender=render,singleAction=action,singleAdvance=advance,singleDraw=draw;
// 切换视角/决策窗口时画布可能暂时隐藏；不把零尺寸送进原绘图的渐变半径。
draw=function(){if(!canvas?.isConnected||!state.game)return;const rect=canvas.getBoundingClientRect();if(rect.width<=32||rect.height<=44)return;const z=geometry();if(!(z.tw>0&&z.th>0))return;singleDraw();};
// 所有原交互入口（包括触屏操作）共用 action，阶段门禁在会话 perform 中再检查。
action=function(button,anchor){
 if(onlineHooks?.action(button,anchor))return;
 return singleAction(button,anchor);
};
// 联机存档只能走独立恢复点，不能覆盖单机 localStorage 的 SAVE/CHECKPOINT_SAVE。
save=function(){onlineHooks?.save();};
saveCheckpoint=function(){onlineHooks?.save();};
rememberView=function(){};
render=function(){
 if(!state.game)return;
 singleRender();onlineHooks?.afterRender();
};
// 模拟由网络任务驱动，与队友视角无关；原 rAF 仍负责 HUD、特效、音效与绘制。
advance=function(now,live){
 if(!onlineHooks)return singleAdvance(now,live);
 // 完整原生绘图比快照小棋盘更重；限制到 30 FPS，模拟仍按原来的 30 Hz。
 if(live&&now-lastOnlinePaint<1000/30)return;lastOnlinePaint=now;
 const battle=state.game?.battle;
 if(battle)playBattleEvents(battle.s,live?state.muted:true,state.volume);
 if(state.view==='game'&&state.game){updateHud();if(live)draw();}
 onlineHooks.paintExtra?.();
};
// 移除单机启动时临时恢复的视图；直到房间选策略后才挂上联机会话。
dismissRoundEnd();state.game=null;state.view='lobby';root.innerHTML='';
export const nativeUI={
 configure(hooks){onlineHooks=hooks;},
 mount(game){
  const identityChanged=state.game?.s.playerId!==game?.s.playerId||state.game?.s.round!==game?.s.round;
  const layout=game?JSON.stringify([game.s.phase,game.s.round,game.s.level,game.s.funds,game.s.locked,game.s.units.map(u=>[u.uid,u.chessId,u.position,u.skillIndex,u.equipment]),game.s.items,game.s.summonCards,game.s.offers,game.s.itemOffers,game.s.rewardPending]):null;
  if(identityChanged){dismissRoundEnd();state.modal=null;state.inspect=null;state.preview=null;state.selected=null;state.item=null;state.summonSelected=null;state.resultUnitUid=null;}
  state.game=game;state.view='game';state.paused=false;state.speed=1;state.sandbox=null;runtimeFault=null;
  if(game){
   attachZoneVisual(game.battle);
   // 新快照只换数据；布局不变时保持 DOM，避免观战页面每次同步都拆掉按钮/画布。
   if(identityChanged||layout!==lastOnlineLayout||!canvas?.isConnected)render();
   else {updateHud();draw();onlineHooks?.afterRender();}
  }else{root.innerHTML='';canvas=null;}
  lastOnlineLayout=layout;
 },
 refresh(){if(state.game)render();},
 get state(){return state;},
 cellPoint(x,y){const z=geometry();return {x:z.r.left+z.ox+(x+.5)*z.tw,y:z.r.top+z.oy+(y+.5)*z.th};},
 drawOn(target,game){
  if(!target||!game)return;
  // 只读视角临时替换绘图上下文，不推进也不修改队友会话；左右联防调用同一 draw。
  const previous={game:state.game,canvas,selected:state.selected,preview:state.preview,view:state.view};
  try{state.game=game;canvas=target;state.selected=null;state.preview=null;state.view='game';draw();}
  finally{state.game=previous.game;canvas=previous.canvas;state.selected=previous.selected;state.preview=previous.preview;state.view=previous.view;}
 },
 clear(){dismissRoundEnd();state.game=null;state.modal=null;root.innerHTML='';canvas=null;},
 notice,
};
