/** 多浏览器验收：真实房间/网页交互，战斗场景用真实引擎构造确定的击倒结果。 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createMultiplayerServer} from '../server/index.js';
import {decisionOffers,roundPlan} from '../shared/rules.js';
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
const app=await createMultiplayerServer({host:'127.0.0.1',port:0});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[],pages=[],contexts=[];
const base=`http://127.0.0.1:${app.port}`;
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
try {
  for(let i=0;i<4;i++) {
    const context=await browser.newContext({viewport:{width:1400,height:1000}});contexts.push(context);
    const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);await page.locator('#connect-form').waitFor();await page.locator('input[name="name"]').fill(`玩家${i+1}`);
    if(i===0) {
      const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.fillStyle='#7ef';x.fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];});
      await page.locator('#avatar-upload').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
      await page.waitForFunction(()=>document.querySelector('img.avatar')?.src.startsWith('data:image/'));
      await page.locator('input[name="name"]').fill('玩家1');
      await page.locator('button[value="create"]').click();
    } else {
      const code=await pages[0].locator('#room-code').innerText();
      await page.locator('input[name="room"]').fill(code);await page.locator('button[value="join"]').click();
    }
    await page.locator('#room-code').waitFor();
  }
  await pages[0].waitForFunction(()=>window.__garrisonOnline.state.room.players.length===4);
  await pages[0].locator('[data-action="start-room"]').click();
  for(const page of pages){await page.locator('.online-briefing').waitFor();await page.locator('[data-action="briefing-ready"]').click();}
  for(const page of pages) {await page.locator('.strategy-card:not([disabled])').first().click();}
  for(const page of pages)await page.locator('#native-canvas').waitFor();
  await pages[0].locator('[data-action="emote"][data-emote="🎉"]').click();
  await pages[1].waitForFunction(()=>document.querySelector('.emote-bubble')?.textContent==='🎉');
  // 表情从发送者头像旁出现，实际计时五秒；拖动浮框不影响棋盘或点击。
  const bubble=pages[1].locator('.player-avatar-wrap .emote-bubble').filter({hasText:'🎉'});
  assert.equal(await bubble.count(),1);
  await pages[1].waitForTimeout(4200);
  assert.equal(await bubble.count(),1);
  await pages[1].waitForFunction(()=>![...document.querySelectorAll('.emote-bubble')].some(el=>el.textContent==='🎉'));
  const handle=await pages[0].locator('.social-drag-handle').boundingBox();
  const before=await pages[0].locator('#online-social').boundingBox();
  await pages[0].mouse.move(handle.x+15,handle.y+10);await pages[0].mouse.down();
  await pages[0].mouse.move(handle.x+215,handle.y+160,{steps:10});await pages[0].mouse.up();
  const moved=await pages[0].locator('#online-social').boundingBox();
  assert.ok(moved.x>before.x+150&&moved.y>before.y+100);
  await pages[0].locator('[data-action="view"]').first().click();
  const retained=await pages[0].locator('#online-social').boundingBox();
  assert.equal(retained.x,moved.x);assert.equal(retained.y,moved.y);
  // 返回左上方，避免后续部署测试被浮框覆盖。
  await pages[0].evaluate(()=>{localStorage.removeItem('garrison-online-social-position');});
  const relocated=await pages[0].locator('.social-drag-handle').boundingBox();
  await pages[0].mouse.move(relocated.x+15,relocated.y+10);await pages[0].mouse.down();
  await pages[0].mouse.move(relocated.x-185,relocated.y-140,{steps:10});await pages[0].mouse.up();
  // 买牌、选择落点和朝向均通过 UI，不直接改干员布阵。
  await pages[0].locator('[data-act="buy"]').first().click();
  await pages[0].locator('[data-act="buy"]').first().click();
  const uid=await pages[0].evaluate(()=>window.__garrisonOnline.state.game.s.units[0]?.uid);
  assert.ok(uid);
  const cell=await pages[0].evaluate(uid=>{const g=window.__garrisonOnline.state.game;for(let y=0;y<g.map.rows;y++)for(let x=0;x<g.map.cols;x++)if(g.canDeploy(uid,x,y))return{x,y};},uid);
  const card=await pages[0].locator(`#native-hand [data-act="select"][data-uid="${uid}"]`).boundingBox();
  const point=await pages[0].evaluate(cell=>window.__garrisonOnline.nativeUI.cellPoint(cell.x,cell.y),cell);
  await pages[0].mouse.move(card.x+card.width/2,card.y+card.height/2);await pages[0].mouse.down();await pages[0].mouse.move(point.x,point.y,{steps:12});await pages[0].mouse.up();
  await pages[0].locator('[data-act="aim"][data-dir="0"]').click();
  await pages[0].locator('[data-act="place-confirm"]').click();
  await pages[0].waitForFunction(()=>window.__garrisonOnline.state.game.s.units[0].position!==null);
  const p0=await pages[0].evaluate(()=>window.__garrisonOnline.state.playerId);
  await pages[1].locator(`[data-action="view"][data-id="${p0}"]`).click();
  await pages[1].waitForFunction(id=>window.__garrisonOnline.state.snapshots[id]?.record.native.s.units.length>0,p0);
  await pages[1].locator('#native-canvas').click({position:{x:60,y:60}});
  assert.equal(await pages[1].evaluate(()=>window.__garrisonOnline.state.game.s.units.length),0);
  await pages[0].screenshot({path:new URL('../artifacts/preparation.png',import.meta.url).pathname,fullPage:true});
  // 准备状态可取消，在全员准备前仍未开战。
  await pages[0].locator('[data-act="start"]').click();
  await pages[0].waitForFunction(()=>window.__garrisonOnline.state.room.players.find(p=>p.id===window.__garrisonOnline.state.playerId).ready);
  await pages[0].locator('[data-act="start"]').click();
  await pages[0].waitForFunction(()=>!window.__garrisonOnline.state.room.players.find(p=>p.id===window.__garrisonOnline.state.playerId).ready);
  // 真实刷新重连恢复整备状态（不依赖仍在内存中的会话）。
  await pages[0].reload();await pages[0].locator('#native-canvas').waitFor();
  assert.equal(await pages[0].evaluate(()=>window.__garrisonOnline.state.game.s.units[0].uid),uid);
  for(const page of pages){const id=await page.evaluate(()=>window.__garrisonOnline.state.playerId);await page.locator(`[data-action="view"][data-id="${id}"]`).click();await page.locator('[data-act="start"]').click();}
  for(const page of pages)await page.waitForFunction(()=>!!window.__garrisonOnline.state.game.battle);
  // 让玩家3/4成为完美作战者；玩家1/2实际跑完原波次，产生漏怪。
  for(let i=0;i<4;i++)await pages[i].evaluate(async perfect=>{
    const g=window.__garrisonOnline.state.game,{dealDamage}=await import('/dist/native-effects.js');
    if(perfect) {
      for(const q of g.battle.s.queue.splice(0)){g.battle.spawn(q);const enemy=g.battle.s.enemies.at(-1);dealDamage(g.battle,{target:enemy,amount:1e9,type:'true'});}
      for(let n=0;n<15000&&!g.battle.s.finished;n++){for(const e of g.battle.s.enemies.slice())if(e.hp>0)dealDamage(g.battle,{target:e,amount:1e9,type:'true'});g.tick();}
    } else for(let n=0;n<15000&&!g.battle.s.finished;n++)g.tick();
  },i>=2);
  for(const page of pages)await page.waitForFunction(()=>window.__garrisonOnline.state.room.phase==='support');
  assert.equal(await pages[0].locator('#native-canvas,#online-second-canvas').count(),2);
  const sizes=await pages[0].locator('#native-canvas,#online-second-canvas').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));assert.ok(Math.abs(sizes[0].height-sizes[1].height)<2);assert.ok(Math.abs(sizes[0].width-sizes[1].width)<2);
  await pages[0].screenshot({path:new URL('../artifacts/support.png',import.meta.url).pathname,fullPage:true});
  let current=await pages[0].evaluate(()=>window.__garrisonOnline.state.room.task.playerId);
  const first=await Promise.all(pages.map(p=>p.evaluate(()=>window.__garrisonOnline.state.playerId)));
  let index=first.indexOf(current);
  await pages[index].waitForFunction(()=>window.__garrisonOnline.state.game.online.kind==='support');
  await pages[index].evaluate(()=>{const g=window.__garrisonOnline.state.game;for(let n=0;n<15000&&!g.battle.s.finished;n++)g.tick();});
  await pages[0].waitForFunction(first=>window.__garrisonOnline.state.room.task.playerId!==first,current);
  current=await pages[0].evaluate(()=>window.__garrisonOnline.state.room.task.playerId);index=first.indexOf(current);
  await pages[index].waitForFunction(()=>window.__garrisonOnline.state.game.online.kind==='support');
  await pages[index].evaluate(async()=>{const g=window.__garrisonOnline.state.game,{dealDamage}=await import('/dist/native-effects.js');for(const q of g.battle.s.queue.splice(0)){g.battle.spawn(q);dealDamage(g.battle,{target:g.battle.s.enemies.at(-1),amount:1e9,type:'true'});}for(let n=0;n<15000&&!g.battle.s.finished;n++){for(const e of g.battle.s.enemies.slice())if(e.hp>0)dealDamage(g.battle,{target:e,amount:1e9,type:'true'});g.tick();}});
  for(const page of pages)await page.waitForFunction(()=>window.__garrisonOnline.state.room.phase==='settlement');
  assert.equal(await pages[0].evaluate(()=>window.__garrisonOnline.state.room.losses[window.__garrisonOnline.state.playerId]),0);
  // 公共六选场景使用真实服务端阶段，浏览器依次点击，不直接发选项消息。
  const room=[...app.rooms.rooms.values()][0];
  room.round=6;room.phase='decision';room.task=null;room.picked={};
  room.choice={type:'tactical',offers:decisionOffers(data,'tactical',6,()=>.35),order:room.players.map(p=>p.id)};
  // 测试快进到决策前一轮，保持会话推进账本一致，避免为验收等待所有回合的真实时间。
  for(const page of pages)await page.evaluate(()=>{const g=window.__garrisonOnline.state.game;g.s.round=5;g.s.phase='intermission';});
  app.rooms.broadcast(room);
  for(const page of pages)await page.locator('.decision-card').first().waitFor();
  assert.equal(await pages[0].locator('.decision-card').count(),6);
  for(const page of pages) {await page.locator('.decision-card:not([disabled])').first().click();}
  for(const page of pages)await page.locator('#native-canvas').waitFor();
  assert.equal(new Set(Object.values(room.picked).map(o=>o.id)).size,4);
  // 共享Boss测试：各自独立地图，公共HP与实际伤害同步。
  room.round=roundPlan(data,room.config.modeId).at(-1).round;room.phase='prep';room.choice=null;room.picked={};
  for(const p of room.players)p.ready=false;
  for(const page of pages)await page.evaluate(round=>{const g=window.__garrisonOnline.state.game;g.s.round=round;g.s.phase='prep';g.s.prepApplied=false;g.s.rewardPending=null;g.s.units=[];g.s.summonCards=[];},room.round);
  app.rooms.broadcast(room);
  for(const page of pages){const id=await page.evaluate(()=>window.__garrisonOnline.state.playerId);await page.locator(`[data-action="view"][data-id="${id}"]`).click();await page.locator('[data-act="start"]').click();}
  for(const page of pages)await page.waitForFunction(()=>window.__garrisonOnline.state.game.battle?.s.finalBossId);
  const max=room.boss.maxHp;
  await pages[0].evaluate(()=>{const g=window.__garrisonOnline.state.game;const e=g.battle.s.enemies.find(e=>e.finalBoss);e.hp-=100;});
  await pages[1].waitForFunction(max=>window.__garrisonOnline.state.room.boss.hp<=max-100,max);
  await pages[1].evaluate(()=>{const g=window.__garrisonOnline.state.game;g.battle.s.enemies.find(e=>e.finalBoss).hp=0;});
  for(const page of pages)await page.waitForFunction(()=>window.__garrisonOnline.state.room.phase==='finished'&&window.__garrisonOnline.state.room.success);
  await pages[0].screenshot({path:new URL('../artifacts/result.png',import.meta.url).pathname,fullPage:true});
  await pages[0].setViewportSize({width:390,height:844});assert.ok(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const download=pages[0].waitForEvent('download');await pages[0].locator('[data-action="export"]').click();await download;
  await pages[0].locator('[data-action="leave"]').last().click();await pages[0].locator('#connect-form').waitFor();
  assert.deepEqual(errors,[]);
  await writeFile(new URL('../artifacts/browser.json',import.meta.url),JSON.stringify({passed:true,checks:['4人真实连接','上传头像','表情广播','策略互斥','买牌/布阵','只读观战','取消准备','刷新重连','两段联防分屏','六选轮选','公共Boss血量与击破','手机布局','战报导出/回大厅'],errors},null,2));
  console.log('浏览器联机验收通过');
} catch(error) {
  const debug=await Promise.all(pages.map(p=>p.evaluate(()=>({room:window.__garrisonOnline?.state.room, fault:window.__garrisonOnline?.state.fault, report:window.__garrisonOnline?.state.game?.online.report,phase:window.__garrisonOnline?.state.game?.s.phase,toast:document.getElementById('toast')?.textContent})).catch(()=>null)));
  await writeFile(new URL('../artifacts/failure.json',import.meta.url),JSON.stringify({message:error.message,errors,debug},null,2));
  throw error;
} finally {for(const context of contexts)await context.close();await browser.close();await app.close();}
