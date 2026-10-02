/** 启动参数仅控制服务资源，不改变玩法与客户端规则指纹。
 * CLI 优先于环境变量；拒绝 0、负数、NaN 和未知参数，避免静默关闭限制。
 */
export function positiveInteger(value, name) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw Error(`${name} 必须是正整数`);
  }
  return Number(value);
}

export function normalizeLimits(raw = {}) {
  const maxRooms = positiveInteger(raw.maxRooms ?? 10, 'maxRooms');
  return {
    maxRooms,
    // 为每房四人之外预留入房/重连的连接容量；容量检查在 WebSocket 升级前进行。
    maxConnections: positiveInteger(raw.maxConnections ?? maxRooms * 4 + 16, 'maxConnections'),
    maxMessagesPerSecond: positiveInteger(raw.maxMessagesPerSecond ?? 100, 'maxMessagesPerSecond'),
    maxBytesPerSecond: positiveInteger(raw.maxBytesPerSecond ?? 8 * 1024 * 1024, 'maxBytesPerSecond'),
    helloTimeoutMs: positiveInteger(raw.helloTimeoutMs ?? 10_000, 'helloTimeoutMs'),
  };
}

const PARAMETERS = {
  'max-rooms': ['maxRooms', 'MAX_ROOMS'],
  'max-connections': ['maxConnections', 'MAX_CONNECTIONS'],
  'max-messages-per-second': ['maxMessagesPerSecond', 'MAX_MESSAGES_PER_SECOND'],
  'max-bytes-per-second': ['maxBytesPerSecond', 'MAX_BYTES_PER_SECOND'],
};
export function startupLimits(args = [], env = {}) {
  const raw = {};
  for (const [key, name] of Object.values(PARAMETERS)) if (env[name] !== undefined) raw[key] = env[name];
  for (let i = 0; i < args.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!match || !PARAMETERS[match[1]]) throw Error(`未知启动参数：${args[i]}`);
    raw[PARAMETERS[match[1]][0]] = positiveInteger(match[2] ?? args[++i], match[1]);
  }
  return normalizeLimits(raw);
}
