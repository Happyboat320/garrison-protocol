import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildNativeUI} from '../scripts/build-native-ui.mjs';
import {NativeSession} from '../../dist/native-session.js';
import {NativeBattle} from '../generated/native-battle.js';
import {NativeSession as OnlineNativeSession} from '../generated/native-session.js';
import {MultiplayerBattle,MultiplayerSession} from '../client/session.js';
import {RoomManager} from '../server/rooms.js';
import {NATIVE_DATA as data} from '../../dist/runtime-data.js';
import {presentationSnapshot,restorePresentation} from '../client/presentation.js';

test('联机UI自动使用当前单机源码：主体只接配置参数/import路径，没有独立绘图/操作副本',async()=>{
 const source=await readFile(new URL('../../dist/native-play.js',import.meta.url),'utf8');
 const generated=await buildNativeUI();
 const mapped=source.replace('nativeWavePlan(data,turn,g.s.waveRoster)','nativeWavePlan(data,turn,g.s.waveRoster,g.waveTable)').replace(/from (['"])\.\/([^'"]+)\1/g,(_,quote,file)=>`from ${quote}${['native-waves.js','native-battle.js','native-economy.js','native-session.js'].includes(file)?'../generated/':'../../dist/'}${file}${quote}`);
 assert.ok(generated.startsWith(mapped+'\n'));
 assert.equal(MultiplayerBattle.prototype.prepareWaves,NativeBattle.prototype.prepareWaves);
 assert.equal(MultiplayerBattle.prototype.prepareFinalBoss,NativeBattle.prototype.prepareFinalBoss);
});
test('备战效果只结算一次：等待联网不会清空商店，默认单机仍正常转换战斗',()=>{
 const options={seed:42,mapId:data.maps.find(m=>m.weight>0).stageId,modeId:'mode_single_normal',bandId:'band_bldsk',bondBan:{bonds:[]}};
 const direct=new NativeSession(data,options),deferred=new OnlineNativeSession(data,options);
 const funds=deferred.s.funds,offers=structuredClone(deferred.s.offers);
 assert.equal(deferred.beginBattle({prepareOnly:true}),true);
 assert.equal(deferred.s.phase,'prep');assert.equal(deferred.s.funds,funds);assert.deepEqual(deferred.s.offers,offers);
 const layers=structuredClone(deferred.s.bondLayers);
 deferred.beginBattle({prepareOnly:true});assert.deepEqual(deferred.s.bondLayers,layers);
 assert.equal(direct.beginBattle(),true);assert.equal(deferred.beginBattle(),true);
 assert.equal(direct.s.phase,'battle');assert.equal(deferred.s.phase,'battle');
 assert.deepEqual(direct.s.bondLayers,deferred.s.bondLayers);
});
test('队友视角通过单机恢复接回原对象，不能执行任何操作，也不会推进模拟',()=>{
 const config=new RoomManager(data,'test').makeConfig({},2);config.bondBan.bonds=[];
 const owner=new MultiplayerSession(data,config,{id:'A',seat:1,bandId:'band_bldsk'});
 const unit=owner.gain('chess_char_1_01_a');let placed=false;for(let y=0;y<owner.map.rows&&!placed;y++)for(let x=0;x<owner.map.cols&&!placed;x++)if(owner.canDeploy(unit.uid,x,y)){owner.deploy(unit.uid,x,y,0);placed=true;}assert.ok(placed);
 owner.prepareOnlineReady();owner.startOnlineBattle({id:'main-1',kind:'main',bossMaxHp:config.bossMaxHp});
 owner.tick();
 const view=restorePresentation(data,presentationSnapshot(owner));assert.ok(view);
 assert.equal(view.battle.s.time,owner.battle.s.time);assert.deepEqual(view.battle.s.units,owner.battle.s.units);
 assert.equal(view.perform('sell',unit.uid),false);
 view.tick();assert.equal(view.battle.s.time,owner.battle.s.time);
});
