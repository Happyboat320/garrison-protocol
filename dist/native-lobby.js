import {EGG_MODE_ID} from './native-325.js';
import {RANDOM_MAP_ID} from './protocol.js';
const CAT_MODE_ID='mode_cat_all';

export const NATIVE_CHANGELOG={
 version:'0.9-a',publishedAt:'2026-10-02T09:32:57+08:00',displayTime:'2026-10-02 09:32 (UTC+8)',dateLabel:'10.02',
 preview:[
  {topic:'反馈修复',summary:'修复了手机版整备区操作冲突问题。'},
  {topic:'作战界面',summary:'调整了作战界面与交互。'},
  {topic:'道具图标',summary:'实装道具图标。'},
  {topic:'325模式',summary:'已修复数字效果无法解除的问题。'},
  {topic:'模式发现',summary:'尝试解决325模式不易被发现的问题。'}
 ],
 sections:[
  {title:'战斗与面板',items:[
   '修正偶发无法关闭“查看战况”窗口的问题。',
   '让浊心斯卡蒂“鼓舞”提供的面板属性加成正确显示；伤害结算原本正常。',
   '修正伊内丝一技能未阻挡时、能天使一技能偶发的自动开启延迟。',
   '修正干员详情中的出售键、关闭键重叠，以及关闭键压住页眉分割线。'
  ]},
  {title:'盟约与干员获得',items:[
   '奇迹盟约达到100层时补发20资金；跨过清账时点的奖励顺延至下次整备。',
   '拉普兰德的首次刷新判定从本形态获得时开始追踪；回合内购买或三合一后刷新也会触发。',
   '特殊途径获得或转换干员时触发获得时效果；突变细胞转化缪缪会正常获得对应装备。',
   '突变细胞转化后的干员会正常参与三合一并产生进阶奖励。',
   '携带变形同构体时，干员详情会显示转成的盟约，盟约效果继续正常生效。'
  ]},
  {title:'商店与策略',items:[
   '调整维式重锤商店资格：基础版可进常规池，带词条的特殊版走对应专属池。',
   '突变细胞不再出现在商店刷新结果中。',
   '各难度有决策日程时，首次策略决策固定为悬赏；后续决策保持随机。'
  ]},
  {title:'地图与模式',items:[
   '绝境和终极随机地图池仅排除 act1autochess_m01，其他地图及手动选择不受影响。',
   '修复325模式数字效果切出后无法解除的问题；切换到其他模式后关闭，底层使用终极难度。',
   '调整首页提示，尝试解决325模式不易被发现的问题。'
  ]},
  {title:'整备区、显示与部署',items:[
   '保留整备区卡牌原有槽位；基础区有几个空位就下放几张溢出卡，不强制压缩手牌。',
   '临时手牌格只在发生溢出时显示，数量不限；桌面支持横向滚动，手机端用左右翻动箭头查看溢出卡。',
   '手机端翻动箭头每次移动约半个卡槽，避免与干员拖动操作冲突。',
   '增高手机版整备区卡槽以完整显示头像；调整已满提示的布局，避免遮挡左翻按钮。',
   '进阶干员详情名旁标注“进阶”，手牌头像使用金色底色，手机版同步；实装道具图标。',
   '干员不能再放置到已存在的凯瑟琳支援装置格；装置仍不占部署名额。'
  ]}
 ]
};

const escDefault=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const changelogHtml=(value,escape=escDefault)=>escape(value).replace(/325/g,'<span class="native-flow-color">325</span>');

export function renderLobby({data,state,avatar,esc=escDefault}){
 const operatorCount=Object.keys(data.profiles).length;
 const enemyCount=Object.keys(data.enemies).length;
 const mapCount=data.maps.filter(m=>m.weight>0).length;
 const modes=Object.values(data.season.modeDataDict).filter(m=>m.modeType!=='MULTI'&&m.modeDifficulty!=='TRAINING');
 modes.push({modeId:EGG_MODE_ID,name:'325模式'});
 modes.push({modeId:CAT_MODE_ID,name:'海猫模式'});
 const maps=data.maps.filter(m=>m.weight>0);
 // 阵地下拉第一项是哨兵「随机地图」（用户 2026-09-22 口径，且为默认）：开局时按本局种子抽一个具体阵地。
 const randomMapOption=`<option value="${RANDOM_MAP_ID}" ${state.map===RANDOM_MAP_ID?'selected':''}>随机地图</option>`;
 return `<main class="native-lobby"><header class="native-lobby-topbar"><div class="native-brand"><span class="native-brand-mark" aria-hidden="true">◇</span><div><span class="native-eyebrow">RHODES ISLAND / PRTS</span><strong>联合防卫终端</strong></div></div><div class="native-lobby-meta"><span class="native-live-dot">ONLINE</span></div></header><section class="native-hero"><div class="native-hero-copy"><p class="native-kicker">卫戍协议 · 盟约下半期</p><h1>卫戍协议</h1><p class="native-hero-lead">以真实数据驱动的独立战斗模拟。调配干员、构筑盟约，在连续回合中守住阵地。</p><div class="native-hero-actions"><button class="native-primary native-hero-start" data-act="new"><span>开始一局</span><small>随机生成特训、最终 Boss 与增援 →</small></button></div><div class="native-hero-facts" aria-label="终端数据"><span><b>${operatorCount}</b><small>干员数据</small></span><span><b>${enemyCount}</b><small>敌人档案</small></span><span><b>${mapCount}</b><small>可用阵地</small></span></div></div><aside class="native-home-card native-hero-panel" aria-labelledby="native-update-title"><div class="native-card-heading native-update-heading"><div><span class="native-eyebrow native-panel-kicker">UPDATE LOG / TERMINAL</span><h2 id="native-update-title">更新日志</h2></div><span class="native-card-index">${esc(NATIVE_CHANGELOG.version)}</span></div><div class="native-operation-line"><span>版本 / 更新时间</span><time class="native-operation-code" datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.displayTime)}</time></div><ul class="native-update-list">${NATIVE_CHANGELOG.preview.map(item=>`<li><time datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.dateLabel)}</time><div><b>${changelogHtml(item.topic,esc)}</b><p>${changelogHtml(item.summary,esc)}</p></div></li>`).join('')}</ul><div class="native-signal"><span aria-hidden="true"></span><small>点击卡片查看完整更新日志</small><time datetime="${NATIVE_CHANGELOG.publishedAt}">${esc(NATIVE_CHANGELOG.version)}</time></div><button class="native-update-hitbox" data-act="update-log" aria-label="查看完整更新日志 ${esc(NATIVE_CHANGELOG.version)}" aria-haspopup="dialog"></button></aside></section><div class="native-home"><section class="native-home-card native-loadout"><div class="native-card-heading"><div><span class="native-eyebrow">MISSION SETUP</span><h2>任务配置</h2></div><span class="native-card-index">01</span></div><label class="native-field-label" for="native-mode">行动难度<select id="native-mode">${modes.map(m=>`<option value="${m.modeId}" ${m.modeId===state.mode?'selected':''}>${m.name}</option>`).join('')}</select></label><label class="native-field-label" for="native-map">作战阵地<select id="native-map">${randomMapOption}${maps.map((m,i)=>`<option value="${m.stageId}" ${m.stageId===state.map?'selected':''}>阵地 ${i+1} · ${m.stageId}</option>`).join('')}</select></label><div class="native-loadout-actions"><button class="native-prep-entry" data-act="prepare"><span class="native-prep-entry-icon" aria-hidden="true">◈</span><span class="native-prep-entry-label">战前准备</span></button>${state.game?'<button data-act="resume">恢复本地模拟</button>':''}<button data-act="import">导入存档</button></div></section><section class="native-home-card native-database"><div class="native-card-heading"><div><span class="native-eyebrow">REFERENCE / TOOLS</span><h2>资料与工具</h2></div><span class="native-card-index">02</span></div><div class="native-tool-grid"><button data-act="editor"><span class="native-tool-icon">▦</span><span><b>协议自定义</b><small>编辑敌人波次、盟约禁用名单与随机禁用方案</small></span><em>→</em></button><button data-act="archive"><span class="native-tool-icon">▤</span><span><b>战绩与解锁</b><small>查看最近对局与已解锁内容</small></span><em>→</em></button><button data-act="passcode"><span class="native-tool-icon">※</span><span><b class="native-flow-color">输入密码</b><small>用数字键盘输入密码</small></span><em>→</em></button></div></section></div><footer class="native-lobby-footer"><span>本期预设与属性来源：PRTS / 历史游戏数据</span><span>非官方同人作品 · v0.9 combat console</span></footer></main>`;
}
