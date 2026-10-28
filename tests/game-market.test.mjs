import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,mkdtemp,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {PluginManager} from '../packages/app-service/plugins.mjs';
import {GameGuyService} from '../packages/app-service/index.mjs';
import {buildSkillPackage} from '../packages/app-service/game-package.mjs';
import {allowedTools} from '../packages/runtime-dsh/policy.mjs';
const root=resolve(import.meta.dirname,'..');
let registration;runInNewContext(await readFile(join(root,'packages/native-client/client.js'),'utf8'),{window:{__ModuleLoader__:{load:r=>{registration=r;}}},console});
const ui=registration.factory(()=>({})).ui;
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'gameguy-market-test-'));t.after(async()=>{assert.equal(resolve(dirname(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('gameguy-market-test-'));await rm(dir,{recursive:true,force:true});});return dir;}
class Runtime extends EventEmitter{status='ready';calls=[];async start(){return {};}async call(method,input){this.calls.push({method,input});if(method==='ensure')return {sessionId:'fixture'};return {};}async stop(){this.status='offline';}}
async function service(t){const dir=await temp(t),runtime=new Runtime(),s=await new GameGuyService({root,dataDir:dir,runtimeFactory:()=>runtime}).init();await s.scheduler.stop();s.plugins.dir=join(dir,'install');await mkdir(s.plugins.dir);t.after(()=>s.close());return {s,runtime,dir};}
test('market catalog contains three real independently installable packages',async t=>{
 const name=basename(await temp(t)),install=join(root,'product/installed',name);t.after(async()=>{assert.equal(resolve(dirname(install)),resolve(root,'product/installed'));await rm(install,{recursive:true,force:true});});const p=await new PluginManager(root,install,{register:()=>()=>{}}).init();assert.deepEqual(p.list().map(x=>x.id).sort(),['arknights','clawclaw','minecraft']);
 for(const item of p.list()){await p.install(item.id);assert.equal(p.list().find(x=>x.id===item.id).installed,true);assert((await p.skill(item.id)).text.length>100);}
 assert.equal(p.list().find(x=>x.id==='clawclaw').kind,'skill');assert.equal(p.skillRegistrations().length,3);
});
test('disabled Skill package stays installed across restart and does not register an adapter',async t=>{
 const dir=join(await temp(t),'install');let calls=0;const engine={register:()=>{calls++;return()=>{};}};
 const p=await new PluginManager(root,dir,engine).init();await p.install('clawclaw');assert.equal(calls,0);await p.disable('clawclaw');await assert.rejects(p.skill('clawclaw'),/Enable/);
 const again=await new PluginManager(root,dir,engine).init();assert.equal(again.list().find(x=>x.id==='clawclaw').installed,true);assert.equal(again.list().some(x=>x.enabled),false);
});
test('tampered official Skill is rejected before activation',async t=>{
 const dir=await temp(t),p=await new PluginManager(root,join(dir,'install'),{register:()=>assert.fail('no adapter')}).init();await p.install('clawclaw');await p.disable('clawclaw');await writeFile(join(p.location('clawclaw'),'skills/clawclaw/SKILL.md'),'tampered');await assert.rejects(p.install('clawclaw'),/integrity/);assert.equal(p.modules.size,0);
});
test('Skill dependency mismatch rejects activation and never runs an installer',async t=>{
 const dir=await temp(t),copy=join(dir,'root');await mkdir(join(copy,'product'),{recursive:true});await cp(join(root,'product/plugins'),join(copy,'product/plugins'),{recursive:true});await cp(join(root,'product/catalog.json'),join(copy,'product/catalog.json'));await mkdir(join(copy,'node_modules/@myclaw163/clawclaw-cli'),{recursive:true});await writeFile(join(copy,'node_modules/@myclaw163/clawclaw-cli/package.json'),' {"version":"0.0.0"}');
 const p=await new PluginManager(copy,join(dir,'install'),{register:()=>assert.fail()}).init();await assert.rejects(p.install('clawclaw'),/version mismatch/);assert.equal(p.modules.size,0);
});
test('market search and filters work without exposing technical JSON',()=>{
 const items=[{id:'minecraft',title:'Minecraft',tags:['MC','我的世界'],kind:'adapter',installed:true},{id:'clawclaw',title:'龙虾杀',kind:'skill'},{id:'arknights',title:'明日方舟',tags:['MAA','基建'],kind:'adapter'},{id:'base-script',title:'收基建脚本',kind:'script',installed:true}];
 assert.equal(ui.marketRows(items,'mc').length,1);assert.equal(ui.marketRows(items,'maa')[0].id,'arknights');assert.equal(ui.marketRows(items,'龙虾')[0].id,'clawclaw');assert.equal(ui.marketRows(items,'','installed').length,2);assert.equal(ui.marketRows(items,'','script').length,1);assert.equal(ui.marketRows(items,'','game').length,3);assert.equal(ui.marketRows(items,'不存在').length,0);
});
test('native market navigation uses real DSH slots and advanced page is preserved',async()=>{
 const source=await readFile(join(root,'packages/native-client/client.js'),'utf8');assert(source.includes("key:'game-market'"));assert(source.includes("id:'game-market'"));assert(source.includes("selectPanel('agent-extensions')"));assert(!source.includes("key:'plugins'"));
 const advanced=await readFile(join(root,'packages/agent-extensions/client.js'),'utf8');assert(advanced.includes('const PANEL_ID = "agent-extensions"'));assert(!advanced.includes('ctx.slots.inject("sidebar.panellist"'));assert(advanced.includes('PluginManagerPage'));assert(advanced.includes('plugins.row.config'));
 const upstream=await readFile(join(root,'node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js'),'utf8');assert(upstream.includes('const PANEL_ID = "plugins"'));assert(upstream.includes('ctx.slots.inject("sidebar.panellist"'));
});
test('script packaging is data-only; trusted custom IDs install without hardcoding',async t=>{
 const dir=await temp(t),source=join(dir,'source'),output=join(dir,'root/product/plugins/my-daily');await mkdir(join(source,'skills/my-daily'),{recursive:true});await mkdir(join(source,'scripts'));await mkdir(join(dir,'root/product/plugins'),{recursive:true});
 await writeFile(join(source,'skills/my-daily/SKILL.md'),'# Daily fixture\nRead the script, test it, ask before game effects.');await writeFile(join(source,'scripts/run.mjs'),'throw Error("must never execute during installation");');
 const item=await buildSkillPackage({id:'my-daily',kind:'script',version:'1.0.0',title:'每日脚本',description:'测试包',permissions:['process:node']},source,output);
 await writeFile(join(dir,'root/product/catalog.json'),JSON.stringify([item]));const p=await new PluginManager(join(dir,'root'),join(dir,'install'),{register:()=>assert.fail('script must not be treated as adapter')}).init();await p.install(item.id);assert.equal(p.list()[0].enabled,true);assert((await p.skill(item.id)).text.includes('fixture'));assert.deepEqual(allowedTools(item.id,'script'),allowedTools());
});
test('authoring rejects traversal, unversioned dependencies and missing Skill',async t=>{
 const dir=await temp(t),source=join(dir,'source');await mkdir(source);const base={id:'daily',kind:'script',version:'1.0.0',title:'日常',description:'',permissions:[]};
 for(const input of [{...base,id:'../x'},{...base,version:'latest'},{...base,dependencies:{x:'*'}}])await assert.rejects(buildSkillPackage(input,source,join(dir,'out')));
 await assert.rejects(buildSkillPackage(base,source,join(dir,'out')),/SKILL/);
});
test('host install/disable synchronizes Skill lifecycle without touching game tasks',async t=>{
 const {s,runtime}=await service(t);await s.installFromUI('clawclaw');const sync=runtime.calls.filter(x=>x.method==='plugins-sync').at(-1);assert.deepEqual(sync.input.skills.map(x=>x.name),['clawclaw']);assert.equal(sync.input.packages.length,3);await s.disableFromUI('clawclaw');assert.equal(runtime.calls.at(-1).input.skills.length,0);assert.equal(s.store.data.tasks.length,0);assert.equal(s.scheduler.list().schedules.length,0);
});
test('active official stream prevents disabling the package',async t=>{
 const {s}=await service(t);await s.installFromUI('clawclaw');s.monitor.active.set('fixture',{});await assert.rejects(s.disableFromUI('clawclaw'),/前台连接/);assert.equal(s.plugins.modules.has('clawclaw'),true);s.monitor.active.clear();
});
test('runtime synchronization failure rolls back enablement and persisted state',async t=>{
 const {s,runtime}=await service(t);const call=runtime.call.bind(runtime);let fail=true;runtime.call=async(method,input)=>{if(method==='plugins-sync'&&fail){fail=false;throw Error('fixture sync');}return call(method,input);};await assert.rejects(s.installFromUI('clawclaw'),/fixture sync/);assert.equal(s.plugins.modules.has('clawclaw'),false);assert(!s.store.data.enabled.includes('clawclaw'));assert.equal(runtime.calls.at(-1).input.skills.length,0);
});

test('advanced gateway metadata is owned by its actual package, not blindly re-exported',async()=>{const {TYPERT}=await import('../packages/agent-extensions/typert.mjs');assert.equal(TYPERT.package,'@gameguy/agent-extensions');const remote=await readFile(join(root,'packages/agent-extensions/remote.mjs'),'utf8');assert(remote.includes('@gameguy/agent-extensions#pluginRegistryProbe'));assert(!remote.includes('@deepseek-ai/dsh-client-ui-plugin-manager#'));});
