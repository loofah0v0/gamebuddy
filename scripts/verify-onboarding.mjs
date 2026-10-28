/** Real DSH -> trusted install -> packaged MAA discovery -> config approval -> status.
 * Only environment responses and model decisions are fixtures; no actual device commands.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename,win32} from 'node:path';
import {pathToFileURL} from 'node:url';
import {GameGuyService} from '../packages/app-service/index.mjs';
import {DshRuntime} from '../packages/runtime-dsh/index.mjs';
const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'gameguy-onboarding-'));
let service,setupResult,requests=0;const events=[],calls=[],approvals=[],commands=[],errors=[],approving=new Set();
const cli='D:/fixture/MuMu/nx_main/mumu-cli.exe',maa='D:/fixture/MAA',adb='D:/fixture/platform-tools/adb.exe',python='C:/fixture/Python/python.exe';
const norm=p=>win32.normalize(p).toLowerCase();
const files=new Set([cli,maa+'/MaaCore.dll',maa+'/resource',adb].map(norm));
const fixture={platform:'win32',env:{},exists:async p=>files.has(norm(p)),registryRoots:async()=>['D:/fixture/MuMu',maa],command:async(exe,args,signal)=>{
 signal.throwIfAborted();commands.push({exe,args});
 if(args[0]==='info')return Buffer.from(JSON.stringify({'0':{index:0,name:'本地夹具实例',is_android_started:false}}));
 if(args[0]==='-c')return Buffer.from(JSON.stringify({path:python,bits:64,major:3}));
 throw Error('Non-read-only fixture command forbidden: '+args.join(' '));
}};
const steps=[['gameguy_install',{game:'arknights'}],['gameguy_skill',{game:'arknights'}],['gameguy_setup',{game:'arknights'}],['gameguy_configure',()=>({game:'arknights',instance:setupResult.instance,config:{...setupResult.suggestedConfig,clientType:'Official'}})],['gameguy_status',{}]];
const server=createServer(async(req,res)=>{
 try{
  let text='';for await(const b of req)text+=b;const p=JSON.parse(text);requests++;assert(requests<=steps.length+1,'Unexpected repeated model requests');
  assert.equal(req.url,'/v1/chat/completions');assert.equal(p.model,'fixture-model');
  assert.equal(req.headers.authorization,'Bearer fixture-not-a-real-key');
  const visible=(p.tools??[]).map(x=>x.function.name);assert(visible.includes('gameguy_setup'));assert(visible.includes('pwsh'));assert(visible.includes('glob'));
  const n=calls.length;res.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'fixture-onboarding',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  chunk({role:'assistant'});
  if(n<steps.length){const [name,arg]=steps[n],input=typeof arg==='function'?arg():arg;chunk({tool_calls:[{index:0,id:'setup-step-'+n,type:'function',function:{name,arguments:JSON.stringify({input})}}]});chunk({},'tool_calls');}
  else {chunk({content:'ONBOARDING_FIXTURE_PASS：已通过插件发现并审批保存官服设备配置；设备尚未启动，未登录、未收菜。'});chunk({},'stop');}
  res.end('data: [DONE]\n\n');
 }catch(e){errors.push(e.message);res.writeHead(500);res.end('fixture failed');}
});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 service=new GameGuyService({root,dataDir:dir,runtimeFactory:()=>new DshRuntime({root,dataDir:join(dir,'dsh-runtime'),onApproval:()=>false,onTool:async(id,name,input)=>{
  assert.equal(name,steps[calls.length][0]);const result=await service.tool(id,name,input);calls.push({name,status:result.status});
  if(name==='gameguy_install'){
   const mod=service.plugins.modules.get('arknights'),path=join(service.plugins.dir,'arknights-'+result.version,'lib/discovery.js');
   const {discoverEnvironment}=await import(pathToFileURL(path).href);
   mod.adapter.setup=(c,ctx)=>discoverEnvironment({...c,maaDir:maa,adbPath:adb},ctx,fixture);
  }
  if(name==='gameguy_setup'){setupResult=result;assert.equal(service.task(id).instance,undefined);assert.equal(result.dependenciesReady,true);assert.equal(result.questions.length,1);assert.match(result.questions[0],/官服/);assert.equal(result.addressVerified,false);}
  return result;
 }})});
 service.runtime.on('event',e=>events.push(e));
 service.on('changed',()=>{for(const a of service.approvals.values())if(!approving.has(a.id)){
  assert(['install','configure'].includes(a.kind),'Fixture must not approve game execution');approving.add(a.id);approvals.push(a.kind);setImmediate(()=>void service.resolveApproval(a.id,true).catch(e=>errors.push(e.message)));
 }});
 await service.init();await service.scheduler.stop();
 await service.saveModel({provider:'compatible',model:'fixture-model',baseURL:'http://127.0.0.1:'+server.address().port+'/v1',vision:false},'fixture-not-a-real-key');
 const {taskId}=await service.create({text:'本地测试：帮我通过明日方舟插件配置设备，我用官服，不吃药不购物。不要启动模拟器、登录或执行游戏。',game:'arknights'});
 const deadline=Date.now()+90000;
 while(!events.some(e=>e.type==='assistant'&&e.text?.includes('ONBOARDING_FIXTURE_PASS'))&&!errors.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 assert.deepEqual(errors,[]);assert(events.some(e=>e.type==='assistant'&&e.text?.includes('ONBOARDING_FIXTURE_PASS')),JSON.stringify(events.slice(-15)));
 assert.deepEqual(calls.map(c=>c.name),steps.map(s=>s[0]));assert.deepEqual(approvals,['install','configure']);assert.equal(requests,6);
 const task=service.task(taskId),value=service.engine.config(task.instance).value;assert.equal(value.clientType,'Official');assert.equal(norm(value.emulator.cliPath),norm(cli));assert.equal(value.medicineLimit,0);assert.equal(value.creditShopping,false);
 assert.equal(service.engine.snapshot().runs.length,0);assert.equal(service.engine.snapshot().devices.length,0);assert.equal(service.scheduler.list().schedules.length,0);assert(commands.every(c=>['info','-c'].includes(c.args[0])));
 const report={status:'passed',date:new Date().toISOString(),scope:'real DSH + GameGuy service + verified packaged MAA code; local fixture model/environment; only install/configure approvals auto-accepted in isolated test',modelRequests:requests,toolCalls:calls,approvals,checks:['trusted plugin install','original plugin Skill returned to DSH','packaged plugin owns discovery/schema','unresolved channel only','no configuration before approval','suggested config returned to model and saved after approval','bound task status returned to model','no game/device/schedule side effects'],realModelRequests:0,realGameActions:0,schedulesCreated:0};
 await mkdir(join(root,'artifacts/verification'),{recursive:true});await writeFile(join(root,'artifacts/verification/product-onboarding-v03.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
 await service?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
 const installed=service?.plugins.dir;if(installed){if(resolve(dirname(installed))!==resolve(root,'product/installed'))throw Error('Unsafe onboarding plugin cleanup');await rm(installed,{recursive:true,force:true});}
 if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-onboarding-'))throw Error('Unsafe onboarding data cleanup');await rm(dir,{recursive:true,force:true});
}
