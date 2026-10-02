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
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json'};

export async function createMultiplayerServer({host = '0.0.0.0', port = 8080, tls = null} = {}) {
  await buildNativeUI();
  const rulesHash = await rulesFingerprint(), rooms = new RoomManager(NATIVE_DATA, rulesHash);
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
  const sockets = new WebSocketServer({server, path: '/socket', maxPayload: MAX_MESSAGE_BYTES});
  sockets.on('connection', socket => {
    let count = 0, intervalAt = Date.now(); socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', async bytes => {
      try {
        if (Date.now() - intervalAt >= 1000) { count = 0; intervalAt = Date.now(); }
        if (++count > 100) throw Error('消息发送过快');
        await rooms.handle(socket, JSON.parse(bytes.toString()));
      } catch (error) {
        if (socket.readyState === 1) socket.send(JSON.stringify({type: 'error', message: error.message}));
      }
    });
    socket.on('close', () => rooms.disconnect(socket));
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
  return {server, sockets, rooms, rulesHash, port: server.address().port,
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
  const application = await createMultiplayerServer({port: Number(process.env.PORT || 8080), host: process.env.HOST || '0.0.0.0', tls});
  console.log(`联机服务已启动：${tls ? 'https' : 'http'}://localhost:${application.port}/（局域网使用本机 IP）`);
  const stop = async () => { await application.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
