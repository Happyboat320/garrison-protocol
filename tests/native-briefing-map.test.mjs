import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_DATA as data} from '../dist/runtime-data.js';
import {mapThumbKind,mapThumbnail,mapThumbnailHtml,selectableMaps} from '../dist/protocol.js';

// 战前简报的地图缩略图（用户 2026-09-22 口径）：敌人词条右侧要能看到本局战场的缩略图，
// 手机版跟着改布局。缩略图只画裁切区（viewport），颜色只有 CSS 一份（`.terrain-*`），
// 所以这里既测分类口径，也测「每个 kind 都有配色」与三档布局规则。
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>readFile(path.join(root,'dist',file),'utf8');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tile=(tileKey,extra={})=>({tileKey,buildableType:'ALL',heightType:'LOWLAND',...extra});
// 战场真正会画出来的 5 种装置（`native-play.drawDeviceGlyph`），缩略图只认这几件。
const DRAWN_DEVICES=['trap_040_canoe','trap_032_mound','trap_1107_acblock','trap_1106_achplat','trap_218_fttree'];
const DRAWN=Object.fromEntries(DRAWN_DEVICES.map(id=>[id,true]));
const cropTiles=map=>{
 const v=map.viewport,out=[];
 for(let y=v.top;y<=v.bottom;y++)for(let x=v.left;x<=v.right;x++)out.push(map.grid[y]?.[x]);
 return out;
};

test('mapThumbKind：装置 → 入口/目标 → 特殊地块 → 高台 → 隔离 → 阻隔 → 通道 → 地面',()=>{
 // 装置优先于地形（水上平台落在深水上也要画成平台）。
 assert.equal(mapThumbKind(tile('tile_deepsea',{device:'trap_040_canoe',buildableType:'ALL'})),'platform');
 assert.equal(mapThumbKind(tile('tile_road',{device:'trap_032_mound'})),'mound');
 assert.equal(mapThumbKind(tile('tile_road',{device:'trap_1107_acblock'})),'sealed');
 assert.equal(mapThumbKind(tile('tile_road',{device:'trap_1106_achplat'})),'achplat');
 assert.equal(mapThumbKind(tile('tile_road',{device:'trap_218_fttree'})),'bush');
 assert.equal(mapThumbKind(tile('tile_start')),'entry');
 assert.equal(mapThumbKind(tile('tile_start_2')),'entry');
 assert.equal(mapThumbKind(tile('tile_end')),'goal');
 // 特殊地块即使不可部署也不能掉进 corridor。
 assert.equal(mapThumbKind(tile('tile_deepsea',{buildableType:'NONE'})),'water');
 assert.equal(mapThumbKind(tile('tile_mire')),'mire');
 assert.equal(mapThumbKind(tile('tile_infection')),'originium');
 assert.equal(mapThumbKind(tile('tile_smog')),'vent');
 // 可部署高台是高台，不可部署高台（tile_forbidden 一类）也是高台——不是阻隔。
 assert.equal(mapThumbKind(tile('tile_road',{heightType:'HIGHLAND',buildableType:'RANGED'})),'high');
 assert.equal(mapThumbKind(tile('tile_forbidden',{heightType:'HIGHLAND',buildableType:'NONE'})),'high');
 // 隔离平台是地面 + 围栏，不是高台、也不是阻隔。
 assert.equal(mapThumbKind(tile('tile_fence_bound',{passableMask:'FLY_ONLY'})),'isolated');
 assert.equal(mapThumbKind(tile('tile_fence_bound',{passableMask:'FLY_ONLY',heightType:'LOWLAND'})),'isolated');
 assert.equal(mapThumbKind(tile('tile_road',{obstacle:true})),'blocked');
 assert.equal(mapThumbKind(tile('tile_road',{passableMask:'NONE'})),'blocked');
 assert.equal(mapThumbKind(tile('tile_road',{buildableType:'NONE'})),'corridor');
 assert.equal(mapThumbKind(tile('tile_road')),'ground');
 assert.equal(mapThumbKind(undefined),'blocked');
 assert.equal(mapThumbKind(null),'blocked');
});

test('mapThumbnail：只画裁切区，格子顺序与地图一致',()=>{
 for(const map of selectableMaps(data)){
  const v=map.viewport,{cols,rows,cells}=mapThumbnail(map);
  assert.equal(cols,v.right-v.left+1,`${map.stageId} 缩略图列数`);
  assert.equal(rows,v.bottom-v.top+1,`${map.stageId} 缩略图行数`);
  assert.equal(cells.length,cols*rows,`${map.stageId} 格子数 = 列 × 行`);
  assert.ok(cols>0&&rows>0);
  assert.ok(cells.every(k=>typeof k==='string'&&k.length),`${map.stageId} 每格都要有分类`);
  // 逐格与原始地图对齐（顺序：先左右、再上下）。
  assert.deepEqual(cells,cropTiles(map).map(mapThumbKind),`${map.stageId} 逐格分类`);
  // 裁切区外不画：拿整张图遍历一次，数量必然不少于裁切结果。
  assert.ok(cells.length<=map.cols*map.rows);
  // 每个阵地都要能看出敌方入口与防守目标。
  assert.ok(cells.includes('entry'),`${map.stageId} 缩略图要有敌方入口`);
  assert.ok(cells.includes('goal'),`${map.stageId} 缩略图要有防守目标`);
  // 特殊地块与围栏按 tileKey 计数对齐（分类顺序写反就会在这里挂）。
  // 会画出来的装置优先于地形（`trap_040_canoe` 落在深水上就是「水上平台」）；
  // `trap_1105_accrate` 这类**战场上不单独画**的装置不吃格子，仍按地形（围栏）算。
  const crop=cropTiles(map);
  const same=(key,kind)=>assert.equal(cells.filter(k=>k===kind).length,crop.filter(t=>t?.tileKey===key&&!DRAWN[t.device]).length,`${map.stageId} ${key} → ${kind}`);
  same('tile_deepsea','water');same('tile_mire','mire');same('tile_infection','originium');same('tile_smog','vent');same('tile_fence_bound','isolated');
  assert.equal(cells.filter(k=>k==='entry').length,crop.filter(t=>String(t?.tileKey||'').startsWith('tile_start')).length,`${map.stageId} 入口计数`);
  assert.equal(cells.filter(k=>k==='goal').length,crop.filter(t=>String(t?.tileKey||'').startsWith('tile_end')).length,`${map.stageId} 目标计数`);
 }
 // 没有裁切信息时退回整张图；空地图返回 0×0，不抛错。
 const synthetic={cols:2,rows:2,grid:[[tile('tile_start'),tile('tile_road')],[tile('tile_fence_bound'),tile('tile_end')]]};
 assert.deepEqual(mapThumbnail(synthetic),{cols:2,rows:2,cells:['entry','ground','isolated','goal']});
 assert.deepEqual(mapThumbnail(null),{cols:0,rows:0,cells:[]});
 assert.deepEqual(mapThumbnail(undefined),{cols:0,rows:0,cells:[]});
});

test('mapThumbnailHtml：只出 CSS 类，尺寸走 --cols/--rows，标签转义',()=>{
 const map=selectableMaps(data)[0];
 const {cols,rows,cells}=mapThumbnail(map);
 const html=mapThumbnailHtml(map,{esc,label:'本局战场："A" & <B>'});
 assert.equal((html.match(/<i class="terrain-[a-z]+"><\/i>/g)||[]).length,cols*rows,'每个格子一个方块');
 assert.match(html,new RegExp(`^<span class="native-map-thumb" style="--cols:${cols};--rows:${rows}" role="img" aria-label="`));
 assert.match(html,/aria-label="本局战场：&quot;A&quot; &amp; &lt;B&gt;"/,'aria-label 必须转义');
 assert.ok(!/style="[^"]*background/.test(html),'颜色只能来自 CSS 类，不能内联');
 assert.ok(html.includes(`<i class="terrain-${cells[0]}"></i>`));
 assert.equal(mapThumbnailHtml(null,{esc}),'');
 assert.equal(mapThumbnailHtml(undefined,{esc}),'');
});

test('缩略图的每个分类都有 .terrain-* 配色（与战场图例共用色板）',async()=>{
 const css=await read('native.css');
 const kinds=new Set(selectableMaps(data).flatMap(m=>mapThumbnail(m).cells));
 for(const kind of ['platform','mound','sealed','achplat','bush','high','isolated','blocked','entry','goal','corridor','ground','water','mire','originium','vent'])kinds.add(kind);
 for(const kind of kinds)assert.match(css,new RegExp(`\\.terrain-${kind}\\{`),`CSS 缺 .terrain-${kind} 配色`);
});

test('简报接线：词条右侧挂地图卡，只有一条简报分支',async()=>{
 const play=await read('native-play.js'),protocol=await read('protocol.js');
 // 缩略图的装置表只能等于战场真正画出来的那 5 件，别在这里偷偷多认或漏认装置。
 for(const id of DRAWN_DEVICES){
  assert.ok(play.includes(`else if(id==='${id}')`),`战场绘制里没有 ${id}，缩略图不该认它`);
  assert.ok(protocol.includes(`${id}:`),`缩略图装置表缺 ${id}`);
 }
 assert.match(protocol,/const THUMB_DEVICE=\{trap_040_canoe:'platform',trap_032_mound:'mound',trap_1107_acblock:'sealed',trap_1106_achplat:'achplat',trap_218_fttree:'bush'\}/,'装置表顺序/内容要一眼可核对');
 assert.match(play,/import \{[^}]*mapThumbnailHtml[^}]*\} from '\.\/protocol\.js'/);
 assert.match(play,/data\.maps\.find\(m=>m\.stageId===d\.mapId\)/,'要用本局 draft.mapId 找地图');
 assert.equal((play.match(/native-tags with-map/g)||[]).length,1,'词条容器只有一处，别留旧分支');
 assert.equal((play.match(/native-tags/g)||[]).length,1);
 assert.match(play,/<article class="native-briefing-map">[\s\S]*?mapThumbnailHtml\(map,\{esc,/,'地图卡排在词条后面，缩略图用同一套 esc');
 assert.match(play,/label:`本局战场：阵地 \$\{mapName\+1\}/,'缩略图的无障碍标签要报出阵地号');
 // 「抽中三种词条，战斗按 … 轮换出怪。」这句已按用户要求删掉，连它专用的 `roster.order` 与
 // `:nth-of-type(2)` 规则一起清掉（留着会误伤下面「盟约缺席情况」那段说明）。
 assert.ok(!play.includes('轮换出怪'),'简报不再写轮换顺序那句话');
 assert.ok(!play.includes('roster.order'),'没有别处再用轮换顺序，变量一起删');
 assert.ok(!/native-briefing>p:nth-of-type/.test(await read('native.css')),'针对那句 <p> 的 nth-of-type 规则要一起删');
});

test('布局：桌面挤到第 4 列，窄屏／竖屏／横屏各有规则',async()=>{
 const css=await read('native.css');
 assert.match(css,/\.native-tags\.with-map\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\) minmax\(170px,220px\);align-items:start\}/,'桌面：词条三列 + 地图一列');
 assert.match(css,/\.native-map-thumb\{display:grid;grid-template-columns:repeat\(var\(--cols\),1fr\);grid-template-rows:repeat\(var\(--rows\),1fr\)/,'缩略图按 --cols/--rows 排格子（两个变量都要被 CSS 用上）');
 // ≤1000px 单列；≤820px 地图整行落到词条下面；≤600px 再压紧。
 assert.match(css,/@media\(max-width:1000px\)\{[\s\S]*?\.native-tags\.with-map\{grid-template-columns:minmax\(0,1fr\)\}/);
 assert.match(css,/\.native-tags\.with-map\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\.native-briefing-map\{grid-column:1\/-1/,'窄屏地图独占一行');
 assert.match(css,/\.native-briefing-map\{padding:8px\}\.native-briefing-map \.native-map-thumb\{max-width:none;gap:1px;padding:4px\}/,'手机竖屏缩略图跟着列宽');
 // 手机横屏（矮屏）不能再多占一行：挤进同一排第 4 列。
 assert.match(css,/html\.native-landscape-ui \.native-tags\.with-map\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\) minmax\(112px,150px\)\}/);
 assert.match(css,/html\.native-landscape-ui \.native-briefing-map\{grid-column:auto;flex-direction:column/);
 assert.match(css,/html\.native-landscape-ui \.native-briefing-map \.native-map-thumb\{max-width:150px/);
 // 规则必须写在横屏媒体查询里，否则会漏掉真的手机。
 const landscape=css.slice(css.indexOf('@media (orientation:landscape) and (max-height:600px) and (max-width:1100px){',css.indexOf('.native-map-thumb')));
 assert.ok(landscape.indexOf('html.native-landscape-ui .native-tags.with-map')>-1,'横屏规则要在矮屏媒体查询内');
});
