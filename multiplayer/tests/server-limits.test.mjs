import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {RoomManager} from '../server/rooms.js';
import {createMultiplayerServer} from '../server/index.js';
import {normalizeLimits, startupLimits} from '../server/limits.js';
import {PROTOCOL_VERSION} from '../shared/rules.js';

const fake = () => ({send(){}});
const hello = extra => ({type:'hello',protocol:PROTOCOL_VERSION,rulesHash:'test',profile:{name:'指挥官',avatar:'👍'},...extra});

test('启动限制支持环境变量、两种 CLI 形式，非法参数直接失败', () => {
  assert.equal(normalizeLimits().maxRooms,10);
  assert.equal(normalizeLimits().maxConnections,56);
  assert.equal(startupLimits(['--max-rooms','10','--max-connections=48'],{MAX_ROOMS:'3'}).maxRooms,10);
  assert.equal(startupLimits([],{MAX_ROOMS:'3'}).maxRooms,3);
  for (const value of ['0','-1','1.5','NaN','Infinity','',undefined]) {
    assert.throws(() => startupLimits(['--max-rooms',value]), /正整数/);
  }
  assert.throws(() => startupLimits(['--unknown=10']), /未知/);
});

test('第十一间房被拒绝，已有房间仍可加入与重连，退出释放名额', async () => {
  const manager=new RoomManager(data,'test',{maxRooms:10});
  const connections=Array.from({length:10},fake);
  for(const connection of connections)await manager.handle(connection,hello({create:true}));
  assert.equal(manager.rooms.size,10);
  await assert.rejects(manager.handle(fake(),hello({create:true})), /最多 10 个/);
  const room=manager.rooms.get(connections[0].roomId), player=room.players[0];
  await manager.handle(fake(),hello({roomId:room.id}));
  manager.disconnect(connections[0]);
  const returning=fake();
  await manager.handle(returning,hello({roomId:room.id,resumeToken:player.resumeToken}));
  assert.equal(manager.rooms.size,10);
  assert.equal(returning.playerId,player.id);
  await manager.handle(connections[1],{type:'leave'});
  await manager.handle(fake(),hello({create:true}));
  assert.equal(manager.rooms.size,10);
});

test('非法建房不留空房；到期断线房自动回收并允许新房', async () => {
  let now=100000;
  const manager=new RoomManager(data,'test',{maxRooms:1,now:()=>now});
  for(let i=0;i<3;i++)await assert.rejects(manager.handle(fake(),hello({create:true,profile:{name:''}})));
  assert.equal(manager.rooms.size,0);
  const connection=fake();await manager.handle(connection,hello({create:true}));
  manager.disconnect(connection);now+=120001;
  await manager.handle(fake(),hello({create:true}));
  assert.equal(manager.rooms.size,1);
});

test('慢接收连接不无限积压发送队列，房间日志有固定上限', () => {
  const manager=new RoomManager(data,'test');let terminated=false;
  manager.send({readyState:1,bufferedAmount:5*1024*1024,terminate(){terminated=true;},send(){assert.fail('不能继续发送');}},{});
  assert.equal(terminated,true);
  const room={log:[]};for(let i=0;i<200;i++)manager.log(room,String(i));
  assert.equal(room.log.length,100);assert.equal(room.log[0].text,'100');
});

async function open(app) {
  const socket=new WebSocket(`ws://127.0.0.1:${app.port}/socket`);
  await once(socket,'open');return socket;
}
test('WebSocket 连接容量在升级前拒绝超额连接',async()=>{
  const app=await createMultiplayerServer({host:'127.0.0.1',port:0,maxConnections:1});
  try {
    const first=await open(app);
    const extra=new WebSocket(`ws://127.0.0.1:${app.port}/socket`);
    const error=await new Promise(resolve=>extra.once('error',resolve));
    assert.match(error.message,/503/);
    assert.equal(app.sockets.clients.size,1);
    first.terminate();await once(first,'close');
  }finally{await app.close();}
});

test('未入房连接超时断开，不占房间容量',async()=>{
  const app=await createMultiplayerServer({host:'127.0.0.1',port:0,helloTimeoutMs:100});
  try {
    const socket=await open(app),[code]=await once(socket,'close');
    assert.equal(code,1008);assert.equal(app.rooms.rooms.size,0);
  }finally{await app.close();}
});

test('消息数量和字节速率超限均断开连接',async()=>{
  for(const options of [{maxMessagesPerSecond:2},{maxBytesPerSecond:50}]) {
    const app=await createMultiplayerServer({host:'127.0.0.1',port:0,...options});
    try {
      const socket=await open(app),closed=once(socket,'close');
      for(let i=0;i<3;i++)socket.send(JSON.stringify({type:'ping',clientTime:'x'.repeat(60)}));
      const [code]=await closed;assert.equal(code,1008);
      assert.equal(app.rooms.rooms.size,0);
    }finally{await app.close();}
  }
});
