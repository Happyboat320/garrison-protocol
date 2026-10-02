/** 在 /garrison-protocol 子路径从纯静态站点进入，连接另一端口的真实 WebSocket 服务。
 * 静态服务器完全没有 /health，确保 Pages 不会依赖 Node 才能加载。
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createMultiplayerServer} from '../server/index.js';
const realtime=await createMultiplayerServer({host:'127.0.0.1',port:0});
process.env.MULTIPLAYER_PUBLIC_URL=`ws://127.0.0.1:${realtime.port}/socket`;
await import('../scripts/build-pages.mjs');
const staticServer=http.createServer(async(req,res)=>{
  try {
    const target=decodeURIComponent(new URL(req.url,'http://local').pathname);
    if(!target.startsWith('/garrison-protocol/')||target.includes('..'))throw Error();
    const file=target.slice("/garrison-protocol/".length)||'index.html';
    const bytes=await readFile(new URL(`../../.pages/${file}`,import.meta.url));
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(bytes);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({args:['--no-sandbox']});
const errors=[],pages=[];
try {
  for(let seat=0;seat<2;seat++) {
    const context=await browser.newContext();const page=await context.newPage();pages.push(page);
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${staticServer.address().port}/garrison-protocol/`);
    await page.getByRole('link',{name:/联机作战/}).click();
    await page.locator('#connect-form').waitFor();
    assert.equal(await page.locator('input[name="port"]').inputValue(),String(realtime.port));
    if(seat===0)await page.locator('button[value="create"]').click();
    else {await page.locator('input[name="room"]').fill(await pages[0].locator('#room-code').innerText());await page.locator('button[value="join"]').click();}
    await page.locator('#room-code').waitFor();
  }
  await pages[0].locator('[data-action="start-room"]').click();
  for(const page of pages){await page.locator('.online-briefing').waitFor();await page.locator('[data-action="briefing-ready"]').click();}
  for(const page of pages)await page.locator('.strategy-card:not([disabled])').first().click();
  for(const page of pages)await page.locator('#native-canvas').waitFor();
  assert.deepEqual(errors,[]);console.log('Pages /garrison-protocol 子路径、跨服务连接、两人选策略验收通过');
} finally {await browser.close();await realtime.close();await new Promise(resolve=>staticServer.close(resolve));}
