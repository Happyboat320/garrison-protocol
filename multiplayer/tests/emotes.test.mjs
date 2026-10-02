import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EMOTE_CATALOG, EMOTE_BY_ID} from '../shared/emotes.js';
import {EMOTES} from '../shared/rules.js';
import {profileOf} from '../shared/protocol.js';
import {RoomManager} from '../server/rooms.js';
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {PROTOCOL_VERSION} from '../shared/rules.js';

test('BWIKI 分类图片均有本地 PNG，历史重复去重且不混入站点其它图片',async()=>{
  assert.equal(EMOTES.length,57);
  assert.equal(new Set(EMOTES).size,EMOTES.length);
  assert.deepEqual(EMOTE_CATALOG.categories.map(c=>c.name),['默认','虫动','duel','卫戍协议','卫戍协议：盟约·下半','博士士','米米子','维维美']);
  assert.equal(EMOTE_CATALOG.categories.find(c=>c.name==='duel').emotes.length,0);
  assert.deepEqual(EMOTE_CATALOG.categories.flatMap(c=>c.emotes),EMOTES);
  for(const id of EMOTES){
    const entry=EMOTE_BY_ID[id];assert.match(entry.sourceName,/^表情 /);
    const bytes=await readFile(new URL(`../client/emotes/${entry.file}`,import.meta.url));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  }
  assert.equal(profileOf({name:'旧头像用户',avatar:'🫡'}).avatar,'🫡');
});

test('服务端只接受固定图片表情 ID，不接受外部 URL、旧 emoji 或任意路径',async()=>{
  const manager=new RoomManager(data,'emote-test',{now:()=>100000});
  const messages=[],connection={send:raw=>messages.push(JSON.parse(raw))};
  await manager.handle(connection,{type:'hello',create:true,protocol:PROTOCOL_VERSION,rulesHash:'emote-test',profile:{name:'指挥官',avatar:'🫡'}});
  for(const emote of ['🎉','https://example.com/evil.png','../server/index.js','emote-unknown']){
    await assert.rejects(manager.handle(connection,{type:'emote',emote}),/未知表情/);
  }
  await manager.handle(connection,{type:'emote',emote:EMOTES[0]});
  assert.equal(messages.at(-1).emote,EMOTES[0]);
});
