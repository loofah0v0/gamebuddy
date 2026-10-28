import {homeMetadataSchema} from '../packages/app-service/home-metadata.mjs';
import {mkdir,cp,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
async function files(dir,base=''){let rows=[];for(const e of await readdir(join(dir,base),{withFileTypes:true})){const p=base?base+'/'+e.name:e.name;if(e.isDirectory())rows.push(...await files(dir,p));else if(e.isFile())rows.push({path:p,sha256:createHash('sha256').update(await readFile(join(dir,p))).digest('hex')});else throw Error('Plugin cannot contain symlinks');}return rows.sort((a,b)=>a.path.localeCompare(b.path));}
await mkdir(join(root,'product/plugins'),{recursive:true});
const catalog=[];
const metadata={arknights:{title:'明日方舟',description:'对话配置 MAA，收基建、领日常、刷理智与有限肉鸽。',category:'日常助手',tags:['MAA','收菜','基建','理智','肉鸽'],backend:'MAA',prompt:'帮我配置明日方舟插件并检查环境，先讨论我的收菜需求，不要直接操作游戏。',requirements:['已登录的游戏客户端或模拟器','MAA / ADB / Python（Buddy 可协助发现）']},minecraft:{title:'Minecraft',description:'让 Buddy 进入你的世界，探索、移动、采集与制作。',category:'沙盒游戏',tags:['MC','我的世界','Mineflayer','探索','建造'],backend:'Mineflayer',prompt:'帮我配置 Minecraft 插件，询问我授权的服务器地址和账号方式，先连接观察，不破坏建筑。',requirements:['你授权的 Minecraft Java 版服务器','游戏账号或测试服离线身份']},clawclaw:{title:'龙虾杀',description:'选一个人设，让 Buddy 参与推理、发言和投票，右侧实时观战。',category:'社交推理',tags:['ClawClaw','人设','推理','官方 Skill'],backend:'官方 Skill · ccl',prompt:'帮我配置龙虾杀插件，读取官方 Skill，和我确认人设后再开局，在右侧展示官方观战。',requirements:['官方 ccl CLI 0.9.1（随应用提供）','首次按官方流程完成身份配置']}};
for(const [game,folder,permissions] of [['arknights','plugin-arknights',['process:python','device:adb','device:emulator','capture:device']],['minecraft','plugin-minecraft',['network:game-server','actions:bounded']]]){
 const dst=resolve(root,'product/plugins',game);if(!dst.startsWith(resolve(root,'product/plugins')+ '/'.replace('/',process.platform==='win32'?'\\':'/')))throw Error('Unsafe build target');await rm(dst,{recursive:true,force:true});await mkdir(dst,{recursive:true});for(const sub of ['lib','skills',...(game==='arknights'?['worker']:[])])await cp(join(root,'packages',folder,sub),join(dst,sub),{recursive:true,filter:src=>!src.split(/[\\/]/).includes('__pycache__')&&!src.endsWith('.pyc')});
 const version=game==='arknights'?'0.3.7':'0.3.2',home=homeMetadataSchema.parse(JSON.parse(await readFile(join(root,'packages',folder,'home.json'),'utf8')));
 await writeFile(join(dst,'package.json'),JSON.stringify({name:'@gameguy/plugin-'+game,version,type:'module'}));
 const manifest={id:game,version,apiVersion:1,entry:'lib/index.js',permissions,home,files:await files(dst)};
 await writeFile(join(dst,'manifest.json'),JSON.stringify(manifest,null,2));catalog.push({...metadata[game],home,kind:'adapter',id:game,version:manifest.version,permissions,manifestSha256:createHash('sha256').update(await readFile(join(dst,'manifest.json'))).digest('hex')});
}
const game='clawclaw',dst=resolve(root,'product/plugins',game);if(!dst.startsWith(resolve(root,'product/plugins')+(process.platform==='win32'?'\\':'/')))throw Error('Unsafe Skill build target');await rm(dst,{recursive:true,force:true});await mkdir(join(dst,'skills'),{recursive:true});await cp(join(root,'node_modules/@myclaw163/clawclaw-cli/skills/clawclaw'),join(dst,'skills/clawclaw'),{recursive:true});
await writeFile(join(dst,'package.json'),JSON.stringify({name:'@gameguy/plugin-clawclaw',version:'0.3.1',type:'module'}));
const home=homeMetadataSchema.parse(JSON.parse(await readFile(join(root,'packages/plugin-clawclaw/home.json'),'utf8')));
const manifest={home,id:game,version:'0.3.1',apiVersion:1,kind:'skill',entry:'skills/clawclaw/SKILL.md',permissions:['process:ccl','network:official-game','preview:spectator'],dependencies:{'@myclaw163/clawclaw-cli':'0.9.1'},files:await files(dst)};await writeFile(join(dst,'manifest.json'),JSON.stringify(manifest,null,2));catalog.push({...metadata[game],home,id:game,kind:'skill',version:manifest.version,permissions:manifest.permissions,dependencies:manifest.dependencies,manifestSha256:createHash('sha256').update(await readFile(join(dst,'manifest.json'))).digest('hex')});
await import('./build-agent-extensions.mjs');
await writeFile(join(root,'product/catalog.json'),JSON.stringify(catalog,null,2));
console.log('GameBuddy game market built: MAA + Mineflayer + official ClawClaw Skill package (local trusted catalog).');
