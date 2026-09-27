// 大厅「输入密码」的密码表与效果（用户 2026-09-27 口径）。
//
// 密码表负责解锁 S.E.E.S.、325 模式与海猫模式的本地标记；其它数字**什么都不做**，界面只提示「什么都没有发生」。
// 纯函数放在这里（不碰 DOM），native-play 只负责取档案、写档案、弹提示，方便单测。
import {normalizeArchive} from './native-archive.js';

export const PASSCODE_MAX=12;
// 以后加密码就往这张表里加一项：flag 必须在 native-archive 的 ARCHIVE_FLAG_DEFAULTS 里有默认值。
export const PASSCODES=Object.freeze([
 Object.freeze({code:'20100305',flag:'sees',name:'S.E.E.S.',title:'策略：S.E.E.S.已解锁'}),
 Object.freeze({code:'325',flag:'egg325',name:'325模式',title:'325模式已解锁'}),
 Object.freeze({code:'20190501',flag:'cat',name:'海猫模式',title:'海猫模式已解锁'})
]);
export function normalizePasscode(code){return String(code??'').replace(/\s+/g,'');}
export function matchPasscode(code){
 const want=normalizePasscode(code);
 return PASSCODES.find(row=>row.code===want)||null;
}
// 命中就返回「置位后的新档案」；没命中原样返回（调用方据此只提示「什么都没有发生」）。
export function applyPasscode(archive,code){
 const hit=matchPasscode(code),base=normalizeArchive(archive);
 if(!hit)return {hit:null,archive:base};
 return {hit,archive:normalizeArchive({...base,flags:{...base.flags,[hit.flag]:true}})};
}
