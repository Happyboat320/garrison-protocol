/** 消息入口校验：网络输入永远不能作为路径、HTML 或任意方法名直接执行。 */
import {EMOTES, PROTOCOL_VERSION} from './rules.js';
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
export const RECONNECT_WINDOW_MS = 120_000;
export const CHECKPOINT_VERSION = 1;
export function requireValue(condition, message) { if (!condition) throw Error(message); }
export function validId(value) { return typeof value === 'string' && /^[\w:-]{1,160}$/.test(value); }
export function finite(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function profileOf(raw = {}) {
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 24) : '';
  requireValue(name.length > 0, '请输入玩家昵称');
  // 上传头像在浏览器压成小尺寸 raster；拒绝 SVG 与任意远程地址，避免外部引用。
  const avatar = raw.avatar ?? '🫡';
  requireValue(typeof avatar === 'string' && (EMOTES.includes(avatar) ||
    avatar.length <= 100_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)), '头像格式不支持或体积过大');
  return {name, avatar};
}
export function helloValid(message, rulesHash) {
  requireValue(message.protocol === PROTOCOL_VERSION && message.rulesHash === rulesHash, '客户端规则版本与服务端不一致，请刷新服务端提供的网页');
}
