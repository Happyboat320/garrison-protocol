/**
 * 给原生绘图传完整表现状态，不另写棋盘或把状态映射为缩水的演员列表。
 * presentation 的内容只进只读会话，服务端不会从快照计算生命/奖金/Boss伤害。
 */
import {MultiplayerSession} from './session.js';
export const assetUrl=(data,key)=>data.assets[key]?new URL(`../../dist/${data.assets[key]}`,import.meta.url).href:'';
export function presentationSnapshot(session){
 const record=session.checkpoint();
 // 画图不需要命令历史/旧战报/网络凭据，避免长对局反复传输无关历史。
 record.native.s.commands=[];record.native.s.history=[];
 if(record.native.battle)record.native.battle.events=(record.native.battle.events||[]).slice(-150);
 return {round:session.s.round,record,bonds:session.bonds()};
}
export function restorePresentation(data,snapshot){
 try{
  const game=MultiplayerSession.restoreOnline(data,snapshot.record);
  if(!game)return null;
  game.perform=()=>false;game.tick=()=>{};
  return game;
 }catch{return null;}
}
