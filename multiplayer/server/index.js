/** 独立启动：不接入单机 Pages 构建，也不改变 npm run dev。 */
import {buildNativeUI} from '../scripts/build-native-ui.mjs';
import http from 'node:http';
import https from 'node:https';
import {readFile, stat, realpath, readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {rulesFingerprint} from './fingerprint.js';
import {WebSocketServer} from 'ws';
import {NATIVE_DATA} from '../../dist/runtime-data.js';
import {RoomManager} from './rooms.js';
import {MAX_MESSAGE_BYTES} from '../shared/protocol.js';
import {PROTOCOL_VERSION} from '../shared/rules.js';
import {normalizeLimits, startupLimits} from './limits.js';
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json'};

export async function createMultiplayerServer({host = '0.0.0.0', port = 8080, tls = null, ...rawLimits} = {}) {
  const limits = normalizeLimits(rawLimits);
  await buildNativeUI();
  const rulesHash = await rulesFingerprint(), rooms = new RoomManager(NATIVE_DATA, rulesHash, limits);
  const handler = async (request, response) => {
    try {
      const url = new URL(request.url, 'http://local');
      if (url.pathname === '/health' || url.pathname === '/multiplayer/version.json') {
        response.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':'*'});
        return response.end(JSON.stringify({ok: true, protocol: PROTOCOL_VERSION, rulesHash}));
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); return response.end(); }
      let target = decodeURIComponent(url.pathname);
      if (target === '/') { response.writeHead(302, {Location:'/multiplayer/index.html'}); return response.end(); }
      // 只允许分发联机页面、JS/CSS 与游戏静态资源，不把整个仓库当静态根公开。
      const allowed = target === '/multiplayer/index.html' || target === '/multiplayer/client/native-play.generated.js' || /^\/multiplayer\/(client|shared|generated)\/[\w-]+\.(js|css)$/.test(target) ||
        /^\/dist\/[\w-]+\.(js|css|html)$/.test(target) || /^\/dist\/assets\/[\w/.-]+$/.test(target);
      if (!allowed || target.includes('..')) { response.writeHead(404); return response.end('Not found'); }
      const file = await realpath(path.join(ROOT, target.slice(1)));
      if (!file.startsWith(ROOT + path.sep)) { response.writeHead(404); return response.end(); }
      const info = await stat(file); if (!info.isFile()) throw Error('Not a file');
      response.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length':info.size, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'});
      if (request.method === 'HEAD') return response.end();
      createReadStream(file).pipe(response);
    } catch { response.writeHead(404); response.end('Not found'); }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.headersTimeout = 10_000; server.requestTimeout = 15_000; server.keepAliveTimeout = 5_000;
  const sockets = new WebSocketServer({noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false});
  server.on('upgrade', (request, socket, head) => {
    // 无条件信任 X-Forwarded-For 会被伪造，这里使用全局容量，不按用户提供的 IP 分桶。
    if (request.url !== '/socket' || sockets.clients.size >= limits.maxConnections) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request));
  });
  sockets.on('connection', socket => {
    let count = 0, byteCount = 0, intervalAt = Date.now(); socket.alive = true;
    // WebSocket 已建立但迟迟不完成有效入房的连接，在十秒后释放。
    const helloDeadline = setTimeout(() => { if (!socket.roomId) socket.close(1008, '入房超时'); }, limits.helloTimeoutMs);
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', async bytes => {
      try {
        if (socket.readyState !== 1) return;
        if (Date.now() - intervalAt >= 1000) { count = 0; byteCount = 0; intervalAt = Date.now(); }
        byteCount += bytes.length;
        if (++count > limits.maxMessagesPerSecond || byteCount > limits.maxBytesPerSecond) {
          // 在 JSON 解析与业务处理之前拒绝洪泛；超限后不继续发送大量错误回复。
          socket.close(1008, '消息频率或流量超限'); return;
        }
        await rooms.handle(socket, JSON.parse(bytes.toString()));
      } catch (error) {
        if (socket.readyState === 1) socket.send(JSON.stringify({type: 'error', message: error.message}));
      }
    });
    socket.on('close', () => { clearTimeout(helloDeadline); rooms.disconnect(socket); });
    socket.on('error', () => {});
  });
  const sweep = setInterval(() => rooms.sweep(), 1000);
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, 20_000);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return {server, sockets, rooms, rulesHash, limits, port: server.address().port,
    async close() {
      clearInterval(sweep); clearInterval(heartbeat);
      for (const socket of sockets.clients) socket.terminate();
      await new Promise(resolve => sockets.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cert = process.env.TLS_CERT, key = process.env.TLS_KEY;
  const tls = cert && key ? {cert: await readFile(cert), key: await readFile(key)} : null;
  const application = await createMultiplayerServer({port: Number(process.env.PORT || 8080), host: process.env.HOST || '0.0.0.0', tls,
    ...startupLimits(process.argv.slice(2), process.env)});
  console.log(`联机服务已启动：${tls ? 'https' : 'http'}://localhost:${application.port}/（局域网使用本机 IP）`);
  console.log(`资源限制：${JSON.stringify(application.limits)}`);
  const stop = async () => { await application.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
