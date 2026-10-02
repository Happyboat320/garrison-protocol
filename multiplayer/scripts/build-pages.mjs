/** 仅组装发布目录，不改写上游 dist：保留 ESM 的相对目录关系。
 * 本仓库独立 Pages 发布，页面和资源均使用相对路径。
 */
import {buildNativeUI} from './build-native-ui.mjs';
import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
import {rulesFingerprint} from '../server/fingerprint.js';
import {PROTOCOL_VERSION} from '../shared/rules.js';
await buildNativeUI();
const output=new URL('../../.pages/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(new URL('multiplayer/',output),{recursive:true});
await cp(new URL('../../dist/',import.meta.url),new URL('dist/',output),{recursive:true});
for(const entry of ['index.html','client','shared','generated'])await cp(new URL(`../${entry}`,import.meta.url),new URL(`multiplayer/${entry}`,output),{recursive:true});
await writeFile(new URL('multiplayer/version.json',output),JSON.stringify({protocol:PROTOCOL_VERSION,rulesHash:await rulesFingerprint(),websocketUrl:process.env.MULTIPLAYER_PUBLIC_URL||'wss://23-238-114-57.sslip.io/socket'}));
await writeFile(new URL('.nojekyll',output),'');
await writeFile(new URL('index.html',output),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>卫戍协议</title><style>body{background:#101923;color:#e7eef8;font:18px system-ui;max-width:640px;margin:12vh auto;padding:24px}a{display:block;color:#8fe4df;border:1px solid #38515b;border-radius:12px;padding:24px;margin:20px 0;text-decoration:none}small{display:block;color:#b1c1cd;margin-top:8px}</style><h1>卫戍协议 · 盟约</h1><a href="./dist/index.html">单机作战<small>进入原版网页</small></a><a href="./multiplayer/index.html">联机作战<small>2–4 人 · 房间与队友联防</small></a></html>`);
console.log('Pages 站点已生成：.pages/');
