/**
 * 每次构建从当前单机源码生成薄联机入口，不维护游戏代码副本，也不改 dist。
 * UI 只追加扩展；规则仅注入三个边界：波次配置、只结算备战、战斗实例工厂。
 * 有意检查替换点：上游改变接口时构建明确失败，避免静默运行过时的规则。
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const extensions=new Set(['native-waves.js','native-battle.js','native-economy.js','native-session.js']);
function replaceOnce(source,needle,replacement){
 if(!source.includes(needle)||source.indexOf(needle)!==source.lastIndexOf(needle))throw Error(`上游联机接口需要重新核对：${needle.slice(0,100)}`);
 return source.replace(needle,replacement);
}
function imports(source,ui=false){
 return source.replace(/from (['"])\.\/([^'"]+)\1/g,(_,quote,file)=>{
  const target=extensions.has(file)?(ui?'../generated/':'./')+file:'../../dist/'+file;
  return `from ${quote}${target}${quote}`;
 });
}
async function writeChanged(target,content){
 if(await readFile(target,'utf8').catch(()=>null)!==content)await writeFile(target,content);
}
export async function buildNativeUI(){
 await mkdir(new URL('../generated/',import.meta.url),{recursive:true});
 for(const name of extensions){
  let source=await readFile(new URL(`../../dist/${name}`,import.meta.url),'utf8');
  if(name==='native-waves.js')source=replaceOnce(source,'roster=null){return buildWavePlan(data,turn,roster);','roster=null,table=null){return buildWavePlan(data,turn,roster,table);');
  if(name==='native-battle.js'){
   source=replaceOnce(source,'nativeWavePlan(this.data,turn,this.economy.s.waveRoster)','nativeWavePlan(this.data,turn,this.economy.s.waveRoster,this.economy.waveTable)');
   source=replaceOnce(source,'this.economy.s.randomState,doors);','this.economy.s.randomState,doors,this.economy.waveTable);');
  }
  if(name==='native-economy.js'){
   source=replaceOnce(source,' beginBattle(){',' beginBattle({prepareOnly=false}={}){');
   source=replaceOnce(source,'if(this.s.prepApplied)return super.beginBattle();','if(this.s.prepApplied)return prepareOnly?true:super.beginBattle();');
   source=replaceOnce(source,'this.s.prepApplied=true;if(this.s.rewardPending)return true;return super.beginBattle();','this.s.prepApplied=true;if(this.s.rewardPending||prepareOnly)return true;return super.beginBattle();');
  }
  if(name==='native-session.js'){
   source=replaceOnce(source,' startBattle(){',' createBattle(turn){return new NativeBattle(this.data,this,this.map,turn);}\n startBattle({prepareOnly=false}={}){');
   source=replaceOnce(source,'this.battle=new NativeBattle(this.data,this,this.map,turn);return true;}','this.battle=this.createBattle(turn);return true;}');
   source=replaceOnce(source,'this.applyTouchReplacement();this.settleTartarusRound();const ok=this.beginBattle();','if(!this.s.prepApplied){this.applyTouchReplacement();this.settleTartarusRound();}const ok=this.beginBattle({prepareOnly});');
  }
  await writeChanged(new URL(`../generated/${name}`,import.meta.url),imports(source));
 }
 const source=await readFile(new URL('../../dist/native-play.js',import.meta.url),'utf8');
 const extension=await readFile(new URL('../client/native-extension.js',import.meta.url),'utf8');
 for(const symbol of ['function render(','function action(','function advance(','function draw(','const state='])if(!source.includes(symbol))throw Error(`上游 UI 接口改变，需检查联机接线：${symbol}`);
 const configured=replaceOnce(source,'nativeWavePlan(data,turn,g.s.waveRoster)','nativeWavePlan(data,turn,g.s.waveRoster,g.waveTable)');
 const output=imports(configured,true)+'\n'+extension;
 await writeChanged(new URL('../client/native-play.generated.js',import.meta.url),output);
 return output;
}
if(process.argv[1]?.endsWith('build-native-ui.mjs'))await buildNativeUI();
