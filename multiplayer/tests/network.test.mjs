import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createMultiplayerServer} from '../server/index.js';
import {PROTOCOL_VERSION} from '../shared/rules.js';

test('真实WebSocket房间、表情广播、重连及静态资源边界',async()=>{
  const app=await createMultiplayerServer({host:'127.0.0.1',port:0});
  const sockets=[];
  try {
    const base=`http://127.0.0.1:${app.port}`;
    assert.equal((await fetch(base+'/health').then(r=>r.json())).rulesHash,app.rulesHash);
    const page=await fetch(base+'/');assert.match(await page.text(),/联机作战/);
    assert.equal((await fetch(base+'/multiplayer/client/app.js')).status,200);
    assert.equal((await fetch(base+'/.git/config')).status,404);
    assert.equal((await fetch(base+'/multiplayer/server/rooms.js')).status,404);
    async function client(hello) {
      const ws=new WebSocket(`ws://127.0.0.1:${app.port}/socket`);sockets.push(ws);
      const messages=[];ws.on('message',bytes=>messages.push(JSON.parse(bytes)));
      await new Promise(resolve=>ws.once('open',resolve));
      ws.send(JSON.stringify({type:'hello',protocol:PROTOCOL_VERSION,rulesHash:app.rulesHash,profile:{name:'指挥官',avatar:'👍'},...hello}));
      const wait=async predicate=>{const limit=Date.now()+5000;while(Date.now()<limit){const found=messages.find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('等待消息超时');};
      return {ws,messages,wait};
    }
    const a=await client({create:true}),welcome=await a.wait(m=>m.type==='welcome');
    const b=await client({roomId:welcome.roomId});await b.wait(m=>m.type==='welcome');
    a.ws.send(JSON.stringify({type:'emote',emote:'🎉'}));assert.equal((await b.wait(m=>m.type==='emote')).emote,'🎉');
    a.ws.close();await new Promise(resolve=>a.ws.once('close',resolve));
    const again=await client({roomId:welcome.roomId,resumeToken:welcome.resumeToken});
    assert.equal((await again.wait(m=>m.type==='welcome')).playerId,welcome.playerId);
  } finally {for(const ws of sockets)ws.terminate();await app.close();}
});
