import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {mkdtemp,rm,readFile,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {GameGuyService,normalizeCliEvent,spectatorURL} from '../packages/app-service/index.mjs';
import {normalizeModel} from '../packages/app-service/model.mjs';
import {PluginManager} from '../packages/app-service/plugins.mjs';
import {MonitorService} from '../packages/app-service/monitor.mjs';
import {allowedTools} from '../packages/runtime-dsh/policy.mjs';
import {permissionRows} from '../packages/runtime-dsh/permissions.mjs';
import {Scheduler,nextDaily,localSlot} from '../packages/scheduler/index.mjs';
import {preparePlan} from '../packages/plugin-arknights/lib/prepare.js';
import {configSchema,planSchema,compileTasks} from '../packages/plugin-arknights/lib/plan.js';
const root=resolve(import.meta.dirname,'..');
const pause=()=>new Promise(r=>setTimeout(r,5));
async function until(fn){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,'fixture wait timed out');await pause();}}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
class FakeRuntime extends EventEmitter {
 status='offline';calls=[];starts=[];permissions=new Map();catalog={defaultPreset:'workspace-write',options:['read-only','workspace-write','danger-full-access'].map(value=>({value,name:value}))};
 async start(model){this.starts.push(model);this.status='ready';return {agent:true};}
 async call(method,input){this.calls.push({method,input});if(method==='permission-state'){const preset=this.permissions.get(input.taskId)??'workspace-write';return {sessionId:input.sessionId,preset,sandboxMode:preset,approvalPolicy:preset==='danger-full-access'?'never':'ask'};}if(method==='ensure')return {sessionId:'fixture-'+input.taskId,permission:this.permissions.get(input.taskId)??'workspace-write',permissionCatalog:this.catalog};if(method==='set-permission'){if(!this.catalog.options.some(x=>x.value===input.preset))throw Error('Unknown permission preset');this.permissions.set(input.taskId,input.preset);return {permission:input.preset};}return {}; }
 async stop(){this.status='offline';}
}
const adapter=(execute=async()=>({fixture:true}))=>({id:'arknights',title:'fixture only',defaults:configSchema.parse({}),parseConfig:x=>configSchema.parse(x),configSchema:{type:'object'},planSchema:{type:'object'},capabilities:{schedule:true},validatePlan:(c,p)=>{const plan=planSchema.parse(p);compileTasks(configSchema.parse(c),plan);return plan;},questions:()=>[],diagnose:async()=>({ready:true,fixture:true}),execute});
const cleanups=new WeakMap();
function cleanup(t,fn){cleanups.get(t).push(fn);}
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'gameguy-test-'));cleanups.set(t,[]);t.after(async()=>{try{for(const fn of cleanups.get(t).reverse())await fn();}finally{await rm(dir,{recursive:true,force:true});}});return dir;}
function installedDir(t,dir){const dst=join(root,'product/installed',fp(dir).slice(0,20));cleanup(t,async()=>{assert.ok(resolve(dst).startsWith(resolve(root,'product/installed')+pathSeparator));await rm(dst,{recursive:true,force:true});});return dst;}
const pathSeparator=process.platform==='win32'?'\\':'/';
async function fixture(t,execute){const dir=await temp(t),runtime=new FakeRuntime();const service=await new GameGuyService({root,dataDir:dir,runtimeFactory:()=>runtime}).init();await service.scheduler.stop();service.scheduler.stopping=false;service.engine.register(adapter(execute));installedDir(t,dir);cleanup(t,()=>service.close());return {dir,runtime,service};}
async function task(s,game='arknights',configured=false){const {taskId}=await s.create({text:'fixture task',game});const t=s.task(taskId);t.status='idle';if(configured){t.instance='fixture-'+taskId;await s.engine.configure(game,t.instance,{});}await s.changed();return t;}
async function approve(s,operation,allow=true){await until(()=>s.approvals.size);const a=[...s.approvals.values()][0];await s.resolveApproval(a.id,allow);return operation;}
const fp=c=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
const scheduleInput=(t,c)=>({taskId:t.id,instance:t.instance,configFingerprint:fp(c),plan:planSchema.parse({}),time:'08:00',timeZone:'Asia/Shanghai',maxSeconds:30});

test('independent GameGuy starts without model key or a default scheduled job',async t=>{const {service:s}=await fixture(t);const v=s.snapshot();assert.equal(v.brand,'GameBuddy');assert.equal(v.model.hasKey,false);assert.equal(v.plugins.length,3);assert.equal(v.skills.length,0);assert.equal(v.schedules.schedules.length,0);});
test('host and model policy enforce game scopes, including unbound tasks',async t=>{const {service:s}=await fixture(t);assert.ok(!allowedTools('arknights').includes('pwsh'));assert.ok(!allowedTools('minecraft').includes('gameguy_schedule'));assert.ok(allowedTools('clawclaw').includes('gameguy_install'));assert.throws(()=>allowedTools('invalid'));const a=await task(s,'arknights');await assert.rejects(s.tool(a.id,'Monitor',{command:'ccl start match'}),/作用域/);const b=await task(s,'minecraft');await assert.rejects(s.tool(b.id,'gameguy_schedule',{plan:{},time:'08:00',timeZone:'Asia/Shanghai'}),/作用域/);});
test('unknown task binds original ClawClaw Skill and reapplies runtime scope',async t=>{const {service:s,runtime}=await fixture(t);const {taskId}=await s.create({text:'fixture unknown'});await s.installFromUI('clawclaw');const r=await s.tool(taskId,'gameguy_skill',{game:'clawclaw'});assert.match(r.source,/official/);assert.ok(r.text.includes('ccl'));assert.equal(s.task(taskId).game,'clawclaw');assert.equal(runtime.calls.filter(c=>c.method==='ensure').at(-1).input.game,'clawclaw');await assert.rejects(s.tool(taskId,'gameguy_setup',{game:'minecraft'}),/另一游戏/);});
test('diagnosis is read-only and strict run schemas reject raw resource parameters',async t=>{let count=0;const {service:s}=await fixture(t,async()=>{count++;return {};});const a=await task(s);assert.equal((await s.tool(a.id,'gameguy_diagnose',{})).ready,true);assert.equal(count,0);await assert.rejects(s.tool(a.id,'gameguy_run',{plan:{},stone:1}));assert.equal(s.approvals.size,0);});
test('denied run restores idle status and never calls a game backend',async t=>{let count=0;const {service:s}=await fixture(t,async()=>{count++;return {};});const a=await task(s,'arknights',true);const r=await approve(s,s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30}),false);assert.equal(r.status,'denied');assert.equal(a.status,'idle');assert.equal(count,0);});
test('instant completion persists start then finish, with one wake',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s,'arknights',true);
 const r=await approve(s,s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30}));
 await until(()=>a.finishedRuns?.includes(r.runId));await until(()=>runtime.calls.some(c=>c.method==='wake'));
 const run=s.engine.snapshot().runs.find(r=>r.id===a.runIds[0]);await Promise.all([s.finished(a.id,run),s.finished(a.id,run)]);
 assert.equal(a.runIds.length,1);assert.equal(a.messages.filter(m=>m.text.startsWith('运行结束')).length,1);
 assert.equal(runtime.calls.filter(c=>c.method==='wake').length,1);
 assert.ok(a.messages.findIndex(m=>m.text.startsWith('后端已启动'))<a.messages.findIndex(m=>m.text.startsWith('运行结束')));
});
test('changed configuration invalidates run approval',async t=>{
 const {service:s}=await fixture(t);const a=await task(s,'arknights',true);
 const p=s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30});await until(()=>s.approvals.size);
 await s.engine.configure('arknights',a.instance,{maxFightTimes:4});await assert.rejects(approve(s,p),/配置变化/);assert.equal(a.runIds.length,0);
});
test('stop revokes approval; invalid message cannot reactivate',async t=>{
 const {service:s}=await fixture(t);const a=await task(s,'arknights',true);
 const p=s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30});await until(()=>s.approvals.size);
 assert.equal((await s.stop(a.id)).status,'stopped');assert.equal((await p).status,'denied');
 await assert.rejects(s.message(a.id,'   '));assert.equal(a.cancelled,true);assert.equal(a.runIds.length,0);
});
test('stop fences late runtime ensure',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s);const gate=deferred(),original=runtime.call.bind(runtime);
 runtime.call=async(m,i)=>m==='ensure'?gate.promise:original(m,i);
 const p=s.message(a.id,'second');await pause();await s.stop(a.id);gate.resolve({sessionId:'late'});await p;
 assert.equal(a.status,'stopped');assert.equal(runtime.calls.filter(c=>c.method==='send').length,1);
 await s.wake(a,{kind:'late'});assert.equal(runtime.calls.filter(c=>c.method==='wake').length,0);
});
test('schedule UI uses approval; stopped task may pause, not resume',async t=>{
 const {service:s}=await fixture(t);const a=await task(s,'arknights',true);
 const plan=await s.scheduler.create(scheduleInput(a,s.engine.config(a.instance,'arknights')));
 const p=s.scheduleFromUI({id:plan.id,action:'pause'});await until(()=>s.approvals.size);
 assert.equal(s.scheduler.list().schedules[0].enabled,true);await approve(s,p);
 assert.equal(s.scheduler.list().schedules[0].enabled,false);await s.stop(a.id);
 await approve(s,s.scheduleFromUI({id:plan.id,action:'pause'}));
 await assert.rejects(s.scheduleFromUI({id:plan.id,action:'resume'}),/已停止/);
});
test('scheduled execution skips changed config',async t=>{
 let count=0;const {service:s}=await fixture(t,async()=>{count++;return {};});const a=await task(s,'arknights',true);
 const input=scheduleInput(a,s.engine.config(a.instance,'arknights'));await s.engine.configure('arknights',a.instance,{maxFightTimes:4});
 assert.equal((await s.scheduled(input,{key:'fixture',dueAt:new Date().toISOString()})).status,'skipped-config-changed');assert.equal(count,0);
});
test('completion persistence failure permits later delivery',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s),run={id:'fixture-run',status:'completed',result:{fixture:true}};
 const save=s.store.save.bind(s.store);let fail=true;s.store.save=()=>fail?(fail=false,Promise.reject(Error('disk fixture'))):save();
 await assert.rejects(s.finished(a.id,run));assert.ok(!a.finishedRuns.includes(run.id));await s.finished(a.id,run);
 assert.equal(a.messages.filter(m=>m.text.startsWith('运行结束')).length,1);assert.equal(runtime.calls.filter(c=>c.method==='wake').length,1);
});
test('restart interrupts tasks without reissuing commands',async t=>{
 const dir=await temp(t),runtime=new FakeRuntime();const s=await new GameGuyService({root,dataDir:dir,runtimeFactory:()=>runtime}).init();
 const a=await task(s);a.status='running';await s.changed();await s.close();
 const r=new FakeRuntime(),again=await new GameGuyService({root,dataDir:dir,runtimeFactory:()=>r}).init();cleanup(t,()=>again.close());
 assert.equal(again.task(a.id).status,'interrupted');assert.deepEqual(r.calls.map(c=>c.method),['plugins-sync']);
});

test('canonical CLI notifications omit raw fields; remote exit remains unknown',()=>{
 const e=normalizeCliEvent({type:'cli-stream',streamId:'x',sequence:1,data:{events:['fact https://example.com/?key=123'],messages:['token=abc'],raw:'private',spectator:'hidden',backlog:{remaining_events:5},truncated:true}});
 assert.ok(!JSON.stringify(e).includes('example.com'));assert.ok(!JSON.stringify(e).includes('abc'));assert.ok(!JSON.stringify(e).includes('private'));
 assert.equal(e.data.backlog.command,'ccl events');assert.equal(normalizeCliEvent({type:'cli-exit',code:0}).remoteParticipation,'unknown');
});
test('spectator URL allowlist rejects deceptive origins',()=>{
 assert.equal(spectatorURL('https://myclaw.163.com/watch'),'https://myclaw.163.com/watch');
 for(const u of ['http://myclaw.163.com','https://myclaw.163.com.evil.com','https://evilmyclaw.163.com','https://user@myclaw.163.com','file:///D:/test','https://myclaw.163.com:8443'])assert.throws(()=>spectatorURL(u));
});
test('Monitor cancellation during pending approval cannot spawn CLI',async()=>{
 const gate=deferred(),m=new MonitorService(root,()=>gate.promise,()=>{});
 const p=m.start('t',{command:'ccl start match'});await assert.rejects(m.start('other',{command:'ccl start match'}),/one active stream/);
 await m.stop('t');gate.resolve(true);assert.equal((await p).status,'denied');assert.equal(m.active.size,0);await m.dispose();
});
test('Monitor rejects shell syntax and force takeover before approval',async()=>{
 let approvals=0;const m=new MonitorService(root,()=>{approvals++;return false;},()=>{});
 for(const command of ['ccl start match; echo a','ccl start match --force','powershell echo x','ccl start match | echo x'])await assert.rejects(m.start('t',{command}));
 assert.equal(approvals,0);await m.dispose();
});
test('failed model route rolls back and never persists plaintext key',async t=>{
 const {service:s,runtime,dir}=await fixture(t);const old=structuredClone(s.modelStore.data),start=runtime.start.bind(runtime);
 runtime.start=async m=>{if(m.model==='broken')throw Error('fixture failure');return start(m);};
 await assert.rejects(s.saveModel({provider:'compatible',model:'broken',baseURL:'http://127.0.0.1:1234/v1',vision:false},'fixture-key'));
 assert.deepEqual(s.modelStore.data,old);assert.equal(s.hasKey,false);assert.ok(!(await readFile(join(dir,'model.json'),'utf8')).includes('fixture-key'));
 await assert.rejects(s.saveModel({provider:'compatible',model:'fixture',baseURL:'http://example.com/v1'},'x'));
});

test('two trusted packages install atomically and coalesce concurrent calls',async t=>{
 const dir=await temp(t);let registrations=0,disposals=0;
 const p=await new PluginManager(root,installedDir(t,dir),{register:()=>{registrations++;return async()=>{disposals++;};}}).init();
 const a=p.install('minecraft'),b=p.install('minecraft');assert.equal(a,b);await a;
 assert.equal(registrations,1);assert.equal(p.list().filter(x=>x.enabled).length,1);assert.equal((await p.install('minecraft')).status,'already-enabled');
 await p.disable('minecraft');assert.equal(disposals,1);assert.equal(p.list().some(x=>x.enabled),false);
 await p.install('minecraft');assert.equal(registrations,2);await p.disable('minecraft');
 await p.install('arknights');assert.equal(registrations,3);await p.disable('arknights');
});
test('plugin integrity rejects extra files and catalog version mismatches',async t=>{
 const dir=await temp(t),p=await new PluginManager(root,installedDir(t,dir),{register:()=>async()=>{}}).init();
 const item=p.catalog.find(x=>x.id==='minecraft'),copy=join(dir,'copy');await cp(join(root,'product/plugins/minecraft'),copy,{recursive:true});
 await p.verify(copy,item);await writeFile(join(copy,'extra.js'),'fixture');await assert.rejects(p.verify(copy,item),/inventory/);
 await assert.rejects(p.verify(join(root,'product/plugins/minecraft'),{...item,version:'99.0.0'}),/Incompatible/);
});
test('official Skill resource paths cannot escape declared directory',async t=>{
 const dir=await temp(t),p=await new PluginManager(root,installedDir(t,dir),{register:()=>async()=>{}}).init();
 await assert.rejects(p.skill('clawclaw'),/Enable/);await p.install('clawclaw');assert.ok((await p.skill('clawclaw','references/STREAM.md')).text.length>0);
 for(const path of ['../package.json','/SKILL.md','D:/file'])await assert.rejects(p.skill('clawclaw',path));
 await p.disable('clawclaw');assert.equal(p.list().find(x=>x.id==='clawclaw').installed,true);await assert.rejects(p.skill('clawclaw'),/Enable/);
});
test('teardown failure does not falsely mark plugin enabled',async t=>{
 const dir=await temp(t),p=await new PluginManager(root,installedDir(t,dir),{register:()=>async()=>{throw Error('fixture teardown');}}).init();
 await p.install('minecraft');await assert.rejects(p.disable('minecraft'),/teardown/);assert.equal(p.modules.has('minecraft'),false);assert.equal(p.disposers.has('minecraft'),false);
});
test('MAA plan compilation forbids unapproved medicine, shopping, stone and excess roguelike',()=>{
 const c=configSchema.parse({}),p=planSchema.parse({});assert.ok(compileTasks(c,p).length>0);
 for(const plan of [{shopping:true},{fight:{stage:'1-7',times:1,medicine:1}},{fight:{stage:'1-7',times:1,stone:1}},{roguelike:{theme:'Phantom',runs:4}}])assert.throws(()=>compileTasks(c,planSchema.parse(plan)));
});
const clock=Date.parse('2026-10-22T23:59:00Z');
const schedulerInput={taskId:'t',instance:'fixture',plan:{daily:true},configFingerprint:'fixture',time:'08:00',timeZone:'Asia/Shanghai',maxSeconds:30};
test('daily timezone calculation skips DST nonexistent time',()=>{
 assert.equal(nextDaily(clock,'08:00','Asia/Shanghai'),'2026-10-23T00:00:00.000Z');
 assert.equal(nextDaily(Date.parse('2026-03-08T06:00:00Z'),'02:30','America/New_York'),'2026-03-09T06:30:00.000Z');
 assert.throws(()=>nextDaily(clock,'08:00','invalid-timezone'));
});
test('scheduler persists occurrence claim BEFORE executing, concurrent ticks deduplicate',async t=>{
 const dir=await temp(t);let now=clock,count=0;const s=await new Scheduler(dir,async(_plan,e)=>{
  const disk=JSON.parse(await readFile(join(dir,'schedules.json'),'utf8'));assert.equal(disk.occurrences.find(x=>x.key===e.key).status,'claimed');count++;return {status:'started',runId:'r'};
 },()=>now).init();cleanup(t,()=>s.stop());await s.create(schedulerInput);now+=60000;await Promise.all([s.tick(),s.tick()]);assert.equal(count,1);
 const e=s.list().occurrences[0];await s.finish(e.key,{id:'r',status:'completed'});assert.equal(s.list().occurrences[0].status,'completed');
});
test('DST repeated local hour executes only once',async t=>{
 const dir=await temp(t);let now=Date.parse('2026-11-01T05:29:00Z'),count=0;
 const s=await new Scheduler(dir,async()=>{count++;return {status:'completed'};},()=>now).init();cleanup(t,()=>s.stop());
 await s.create({...schedulerInput,time:'01:30',timeZone:'America/New_York'});now+=60000;await s.tick();now=Date.parse('2026-11-01T06:30:00Z');await s.tick();assert.equal(count,1);
 assert.equal(localSlot(new Date('2026-11-01T05:30:00Z'),'America/New_York'),localSlot(new Date(now),'America/New_York'));
});

test('offline occurrences never replay and interrupted runs remain unknown',async t=>{
 const dir=await temp(t);let now=clock,count=0;
 const s=await new Scheduler(dir,async()=>{count++;return {status:'started'};},()=>now).init();await s.create(schedulerInput);now+=60000;await s.tick();await s.stop();
 now+=86400000;const again=await new Scheduler(dir,async()=>{count++;return {status:'started'};},()=>now).init();cleanup(t,()=>again.stop());
 assert.equal(count,1);assert.ok(again.list().occurrences.some(e=>e.status==='interrupted'));assert.ok(again.list().occurrences.some(e=>e.status==='skipped-offline'));
 await again.tick();assert.equal(count,1);
});
test('late or busy schedules skip without consuming retries',async t=>{
 const dir=await temp(t);let now=clock,count=0;
 const s=await new Scheduler(dir,async()=>{count++;throw Error('device busy');},()=>now).init();cleanup(t,()=>s.stop());await s.create(schedulerInput);
 now+=120001;await s.tick();assert.equal(count,0);assert.equal(s.list().occurrences[0].status,'skipped-late');
 now=Date.parse(s.list().schedules[0].nextRun);await s.tick();await s.tick();assert.equal(count,1);assert.equal(s.list().occurrences[0].status,'skipped-conflict');
});
test('scheduler write failure rolls back claim and forbids execution before durability',async t=>{
 const dir=await temp(t);let now=clock,count=0;const s=await new Scheduler(dir,async()=>{count++;return {status:'completed'};},()=>now).init();cleanup(t,()=>s.stop());
 const save=s.store.save.bind(s.store);s.store.save=()=>Promise.reject(Error('fixture disk'));
 await assert.rejects(s.create(schedulerInput));assert.equal(s.list().schedules.length,0);s.store.save=save;await s.create(schedulerInput);
 now+=60000;s.store.save=()=>Promise.reject(Error('fixture disk'));await assert.rejects(s.tick());assert.equal(count,0);assert.equal(s.list().occurrences.length,0);
 s.store.save=save;await s.tick();assert.equal(count,1);
});

test('official Skill Monitor description is bounded and displayed; denial never starts CLI',async t=>{
 const {service:s}=await fixture(t);const a=await task(s,'clawclaw');await s.installFromUI('clawclaw');
 const p=s.tool(a.id,'Monitor',{command:'ccl start match',timeout_ms:1800000,description:'clawclaw event stream'});
 await until(()=>s.approvals.size);const approval=[...s.approvals.values()][0];
 assert.equal(approval.details.description,'clawclaw event stream');
 await s.resolveApproval(approval.id,false);assert.equal((await p).status,'denied');assert.equal(s.monitor.active.size,0);
 await assert.rejects(s.tool(a.id,'Monitor',{command:'ccl start match',description:'x'.repeat(201)}));
 await assert.rejects(s.tool(a.id,'Monitor',{command:'ccl start match',persistent:true}));
 assert.equal(s.approvals.size,0);
});

test('plugin declared permissions must match the trusted catalog before enabling',async t=>{
 const dir=await temp(t),p=await new PluginManager(root,installedDir(t,dir),{register:()=>async()=>{}}).init();
 const item=p.catalog.find(x=>x.id==='minecraft'),src=join(root,'product/plugins/minecraft');
 await p.verify(src,{...item,permissions:[...item.permissions].reverse()});
 await assert.rejects(p.verify(src,{...item,permissions:[...item.permissions,'process:shell']}),/permissions/);
 await assert.rejects(p.verify(src,{...item,permissions:[]}),/permissions/);
});

// Model URL additions: no external network or real credentials.
test('model URL normalizes whitespace, trailing slashes and model ID',()=>{
 const m=normalizeModel({provider:'compatible',model:'  fixture-id  ',baseURL:'  https://EXAMPLE.com/custom/v1///  '});
 assert.equal(m.baseURL,'https://example.com/custom/v1');assert.equal(m.model,'fixture-id');assert.equal(m.vision,false);
 assert.equal(normalizeModel({provider:'deepseek',model:'official',baseURL:'unused'}).baseURL,'');
 for(const url of ['http://localhost:1234/v1','http://127.0.0.1:1234/v1','http://[::1]:1234/v1'])assert.equal(normalizeModel({provider:'compatible',model:'x',baseURL:url}).baseURL,url);
});
test('model URL rejects secret-bearing URLs, remote plaintext HTTP and complete method endpoints',()=>{
 for(const baseURL of ['','not a url','ftp://example.com/v1','http://example.com/v1','https://user:secret@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1?','https://example.com/v1#secret','https://example.com/v1#','https://example.com/v1/chat/completions/','https://example.com/v1/models']){
  assert.throws(()=>normalizeModel({provider:'compatible',model:'x',baseURL}));
 }
 assert.throws(()=>normalizeModel({provider:'compatible',model:'   ',baseURL:'https://example.com/v1'}));
 assert.throws(()=>normalizeModel({provider:'compatible',model:'x',baseURL:'https://exam\nple.com/v1'}));
});
test('invalid model URL never restarts runtime or overwrites persisted settings',async t=>{
 const {service:s,runtime,dir}=await fixture(t);await s.saveModel({provider:'compatible',model:'fixture',baseURL:'https://example.com/v1'},'local-fixture-key');
 const before=await readFile(join(dir,'model.json'),'utf8'),starts=runtime.starts.length;
 for(const baseURL of ['https://example.com/v1?token=x','http://remote.example/v1','https://example.com/v1/chat/completions'])await assert.rejects(s.saveModel({provider:'compatible',model:'fixture',baseURL},'rejected-key'));
 assert.equal(runtime.starts.length,starts);assert.equal(await readFile(join(dir,'model.json'),'utf8'),before);assert.equal(s.runtimeKey,'local-fixture-key');
 assert.ok(!JSON.stringify(s.snapshot()).includes('local-fixture-key'));
});
test('model URL saves canonical API route without claiming network validation',async t=>{
 const {service:s,runtime,dir}=await fixture(t);const result=await s.saveModel({provider:'compatible',model:' fixture ',baseURL:' https://EXAMPLE.com/custom/v1/// '},'local-fixture-key');
 assert.equal(result.apiConnectionVerified,false);assert.equal(result.configured,true);assert.equal(runtime.starts.at(-1).baseURL,'https://example.com/custom/v1');assert.equal(runtime.starts.at(-1).model,'fixture');
 const disk=await readFile(join(dir,'model.json'),'utf8');assert.ok(!disk.includes('local-fixture-key'));assert.equal(JSON.parse(disk).baseURL,'https://example.com/custom/v1');
});
test('model persistence failure rolls runtime and settings back to previous route/key',async t=>{
 const {service:s,runtime}=await fixture(t);await s.saveModel({provider:'compatible',model:'old',baseURL:'https://example.com/v1'},'previous-fixture');
 const previous=structuredClone(s.modelStore.data),save=s.modelStore.save.bind(s.modelStore);let fail=true;
 s.modelStore.save=async()=>{if(fail){fail=false;throw Error('fixture storage failure');}return save();};
 await assert.rejects(s.saveModel({provider:'compatible',model:'new',baseURL:'https://other.example/v1'},'new-fixture'),/storage failure/);
 assert.deepEqual(s.modelStore.data,previous);assert.equal(s.runtimeKey,'previous-fixture');assert.equal(runtime.starts.at(-1).key,'previous-fixture');assert.equal(runtime.starts.at(-1).baseURL,previous.baseURL);
});

// Permission tests use a fake native service. The real sandbox is exercised separately.
test('full SDK overlays native permission services without duplicate inserts',()=>{
 for(const mode of ['read-only','workspace-write','danger-full-access']){
  const rows=permissionRows(root,mode);
  assert.ok(rows.every(r=>!r.insert&&!r.name));
  assert.equal(rows.find(r=>r.id==='sandbox-policy').config.workspaceRoot,root);
  assert.deepEqual(rows.find(r=>r.id==='permission').config.presets,{'read-only':{sandbox:'read-only',approval:'ask'},'workspace-write':{sandbox:'workspace-write',approval:'ask'},'danger-full-access':{sandbox:'danger-full-access',approval:'never'}});
  assert.equal(rows.find(r=>r.id==='approval').config.policy,mode==='danger-full-access'?'never':'ask');
  assert.equal(rows.find(r=>r.id==='web-search-deepseek').disabled,true);
 }
 assert.equal(permissionRows(root,'workspace-write',true).find(r=>r.id==='web').config.searchProvider,'deepseek-official');
 assert.throws(()=>permissionRows(root,'invalid'));
});
test('session permission switch is native, invalid preset cannot change it, stopped task stays stopped',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s);
 for(const preset of ['read-only','danger-full-access','workspace-write']){assert.equal((await s.setPermission(a.id,preset)).permission,preset);assert.equal(a.permission,preset);}
 await assert.rejects(s.setPermission(a.id,'invented-mode'),/Unknown/);assert.equal(a.permission,'workspace-write');
 await s.stop(a.id);const sent=runtime.calls.filter(c=>c.method==='send').length;
 await s.setPermission(a.id,'read-only');assert.equal(a.status,'stopped');assert.equal(a.cancelled,true);assert.equal(runtime.calls.filter(c=>c.method==='send').length,sent);
 assert.deepEqual(s.snapshot().permissionCatalog,runtime.catalog);
});
test('active and approval tasks reject permission changes without calling native setter',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s);
 for(const status of ['thinking','running','approval','stopping','unknown']){a.status=status;await assert.rejects(s.setPermission(a.id,'danger-full-access'),/停止/);}
 a.status='idle';const p=s.approve(a.id,'dsh-approval',{toolName:'write'});await assert.rejects(s.setPermission(a.id,'danger-full-access'));await approve(s,p,false);
 assert.equal(runtime.calls.some(c=>c.method==='set-permission'),false);
});
test('permission switch excludes messages and concurrent switches throughout native ensure',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s),gate=deferred(),original=runtime.call.bind(runtime);
 runtime.call=(m,i)=>m==='ensure'?gate.promise:original(m,i);
 const p=s.setPermission(a.id,'read-only'),before=a.messages.length;
 await assert.rejects(s.message(a.id,'must not be admitted'),/切换/);assert.equal(a.messages.length,before);
 await assert.rejects(s.setPermission(a.id,'danger-full-access'),/停止/);
 gate.resolve({sessionId:'fixture',permission:'workspace-write',permissionCatalog:runtime.catalog});await p;
 assert.equal(a.permission,'read-only');assert.equal(s.permissionChanges.size,0);
});
test('message persistence gap and overlapping admissions cannot permit permission changes',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s),gate=deferred(),save=s.changed.bind(s);
 s.changed=()=>gate.promise;
 const p=s.message(a.id,'fixture followup');await assert.rejects(s.setPermission(a.id,'read-only'),/停止/);
 s.changed=save;gate.resolve();await p;a.status='idle';
 s.admitRuntime(a.id);s.admitRuntime(a.id);s.releaseRuntime(a.id);
 await assert.rejects(s.setPermission(a.id,'read-only'),/停止/);s.releaseRuntime(a.id);
 assert.equal((await s.setPermission(a.id,'read-only')).permission,'read-only');
});
test('permission save failure retains committed native state instead of pretending rollback',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s),save=s.store.save.bind(s.store);
 s.store.save=()=>Promise.reject(Error('fixture disk'));
 await assert.rejects(s.setPermission(a.id,'danger-full-access'),/DSH 会话为准/);
 assert.equal(a.permission,'danger-full-access');assert.equal(runtime.permissions.get(a.id),'danger-full-access');assert.equal(s.permissionChanges.size,0);
 s.store.save=save;await s.changed();
});
test('native approval abort removes the card, restores status and rejects late approval',async t=>{
 const {service:s}=await fixture(t),a=await task(s),controller=new AbortController();
 const p=s.approve(a.id,'dsh-approval',{toolName:'write',arguments:{file_path:'fixture'}},{signal:controller.signal});
 const id=[...s.approvals.keys()][0];assert.equal(a.status,'approval');controller.abort();assert.equal(await p,false);assert.equal(s.approvals.size,0);assert.equal(a.status,'idle');await assert.rejects(s.resolveApproval(id,true),/过期/);
 assert.equal(await s.approve(a.id,'dsh-approval',{}, {signal:controller.signal}),false);assert.equal(s.approvals.size,0);
});
test('live full-access + never runs validated game requests without a second approval card',async t=>{
 let calls=0;const {service:s,runtime}=await fixture(t,async()=>{calls++;return {fixture:true};});const a=await task(s,'arknights',true);
 await s.setPermission(a.id,'danger-full-access');const r=await s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30});
 assert.equal(r.status,'started');await until(()=>calls===1);assert.equal(s.approvals.size,0);assert.equal(a.gameApprovalMode,'auto');
 assert(a.messages.some(m=>m.text==='无需审批模式已授权：run'));assert(runtime.calls.some(c=>c.method==='permission-state'));assert.equal(a.runIds.length,1);
});

test('desktop preload forwards permission over its restricted bridge and rejects unknown actions',async()=>{
 const calls=[];let exposed;
 runInNewContext(await readFile(join(root,'packages/desktop/preload.cjs'),'utf8'),{process:{isMainFrame:false},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,'gameguy');exposed=api;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return args[2].preset==='bad'?{ok:false,error:'Unknown permission preset'}:{ok:true,value:{permission:args[2].preset}};}}};}});
 assert.ok(Object.isFrozen(exposed));
 const input={taskId:'fixture',preset:'read-only'};assert.equal((await exposed.invoke('permission',input)).permission,'read-only');assert.deepEqual(calls[0],['gameguy:invoke','permission',input]);
 await assert.rejects(exposed.invoke('permission',{taskId:'fixture',preset:'bad'}),/Unknown permission preset/);
 await assert.rejects(exposed.invoke('unrestricted-shell'),/Unsupported action/);assert.equal(calls.length,2);
});


test('setup delegates discovery and schemas to plugin, persists config only after approval',async t=>{
 const {service:s}=await fixture(t),a=await task(s);let context;
 s.engine.adapter('arknights').setup=async(c,ctx)=>{context=ctx;return {suggestedConfig:{...c,clientType:'Bilibili'},questions:['fixture channel'],ready:false};};
 const r=await s.tool(a.id,'gameguy_setup',{game:'arknights'});assert.equal(context.configured,false);assert.equal(context.root,root);
 assert.deepEqual(r.configSchema,s.engine.adapter('arknights').configSchema);assert.deepEqual(r.planSchema,s.engine.adapter('arknights').planSchema);
 assert.equal(r.suggestedConfig.clientType,'Bilibili');assert.equal(a.instance,undefined);assert.equal(s.approvals.size,0);assert.equal(s.engine.snapshot().configs.length,0);
 const pending=s.tool(a.id,'gameguy_configure',{game:'arknights',instance:r.instance,config:r.suggestedConfig});await until(()=>s.approvals.size);assert.equal(a.instance,undefined);
 await approve(s,pending);assert.equal(a.instance,r.instance);assert.equal(s.engine.config(r.instance).value.clientType,'Bilibili');
});
test('setup cannot inspect another task instance and privacy denies discovery/diagnosis',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true),b=await task(s,'arknights',true);let calls=0;
 s.engine.adapter('arknights').setup=async c=>{calls++;return {suggestedConfig:c};};
 await assert.rejects(s.tool(a.id,'gameguy_setup',{game:'arknights',instance:b.instance}),/属于当前任务/);
 a.privacy=true;await assert.rejects(s.tool(a.id,'gameguy_setup',{game:'arknights'}),/privacy/);await assert.rejects(s.tool(a.id,'gameguy_diagnose',{}),/privacy/);assert.equal(calls,0);
});
test('stop cancels setup, waits cleanup; permissions/model/plugin changes blocked while pending',async t=>{
 const {service:s}=await fixture(t),a=await task(s),entered=deferred(),cleanupGate=deferred();let signal;
 s.engine.adapter('arknights').setup=async(c,ctx)=>{signal=ctx.signal;entered.resolve();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));await cleanupGate.promise;return {suggestedConfig:c};};
 const pending=s.tool(a.id,'gameguy_setup',{game:'arknights'});const rejected=assert.rejects(pending,/停止|abort/i);await entered.promise;
 await assert.rejects(s.setPermission(a.id,'read-only'),/停止活动/);await assert.rejects(s.saveModel(s.modelStore.data,''),/等待/);await assert.rejects(s.disableFromUI('arknights'),/先停止/);
 let done=false;const stopping=s.stop(a.id).then(()=>done=true);await pause();assert.equal(signal.aborted,true);assert.equal(done,false);
 cleanupGate.resolve();await stopping;await rejected;assert.equal(s.setupJobs.size,0);assert.equal(a.status,'stopped');assert.equal(a.instance,undefined);
});
test('setup rejects changed configuration and privacy in late plugin results',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true),gate=deferred();
 s.engine.adapter('arknights').setup=async()=>gate.promise;
 const pending=s.tool(a.id,'gameguy_setup',{game:'arknights'});const rejected=assert.rejects(pending,/配置变化/);await until(()=>s.setupJobs.size);
 await s.engine.configure('arknights',a.instance,{maxFightTimes:2});gate.resolve({suggestedConfig:{}});await rejected;
 const gate2=deferred();s.engine.adapter('arknights').setup=async()=>gate2.promise;const next=s.tool(a.id,'gameguy_setup',{game:'arknights'});const rejected2=assert.rejects(next,/privacy/);await until(()=>s.setupJobs.size);a.privacy=true;gate2.resolve({suggestedConfig:{}});await rejected2;
});
test('host diagnosis of an unbound task cancels and waits backend cleanup',async t=>{
 const {service:s}=await fixture(t),a=await task(s),entered=deferred(),gate=deferred();let signal;
 s.engine.adapter('arknights').diagnose=async(_c,sig)=>{signal=sig;entered.resolve();await new Promise(r=>sig.addEventListener('abort',r,{once:true}));await gate.promise;return {ready:true};};
 const pending=s.tool(a.id,'gameguy_diagnose',{});const rejected=assert.rejects(pending,/停止|abort/i);await entered.promise;
 let done=false;const stopping=s.stop(a.id).then(()=>done=true);await pause();assert.equal(signal.aborted,true);assert.equal(done,false);gate.resolve();await stopping;await rejected;assert.equal(s.setupJobs.size,0);
});
test('disabled plugin schedules skip, and host does not import game business schemas',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true),input=scheduleInput(a,s.engine.config(a.instance));
 s.engine.plugins.delete('arknights');assert.equal((await s.scheduled(input,{key:'fixture',dueAt:new Date().toISOString()})).status,'skipped-plugin-disabled');
 const source=await readFile(join(root,'packages/app-service/index.mjs'),'utf8');assert(!/import[^;]*(?:plugin-arknights|plugin-minecraft)/.test(source));assert(!source.includes('compileTasks'));
 let calls=0;s.engine.register({...adapter(),validatePlan:()=>{calls++;return {pluginOwned:true};}});assert.deepEqual(s.validatePlan('arknights',{},{}),{pluginOwned:true});assert.equal(calls,1);
});


test('Agent status exposes only own device readiness without confirmation tokens, including failure and stop',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true),b=await task(s,'arknights',true),unbound=await task(s);
 const p=s.engine.adapter('arknights');p.deviceLaunch=()=>({executable:'fixture-only',instanceIndex:0});
 let gate=deferred();p.startDevice=async c=>{await gate.promise;return {config:c,detail:{fixture:true}};};
 await s.engine.requestDevice(b.instance);await s.engine.requestDevice(a.instance);
 const token=s.engine.devicePrompt(a.instance).token;assert.ok(token);
 let status=await s.tool(a.id,'gameguy_status',{});assert.equal(status.devices.length,1);assert.equal(status.devices[0].instance,a.instance);assert.equal(status.devices[0].status,'confirmation-required');assert.ok(!JSON.stringify(status).includes(token));assert.ok(!JSON.stringify(status).includes(b.instance));
 assert.deepEqual((await s.tool(unbound.id,'gameguy_status',{})).devices,[]);
 const started=await approve(s,s.tool(a.id,'gameguy_device_start',{}));assert.equal(started.status,'starting');assert.equal((await s.tool(a.id,'gameguy_status',{})).devices[0].status,'starting');
 gate.resolve();await until(()=>s.engine.snapshot().devices.find(d=>d.instance===a.instance)?.status==='ready');
 status=await s.tool(a.id,'gameguy_status',{});assert.equal(status.devices[0].status,'ready');assert.deepEqual(status.devices[0].detail,{fixture:true});assert.match(status.devices[0].message,/尚未验证游戏登录/);
 gate=deferred();const failing=await approve(s,s.tool(a.id,'gameguy_device_start',{}));assert.equal(failing.status,'starting');gate.reject(Error('fixture startup failed'));await until(()=>s.engine.snapshot().devices.find(d=>d.instance===a.instance)?.status==='failed');assert.equal((await s.tool(a.id,'gameguy_status',{})).devices[0].status,'failed');
 p.startDevice=async(_c,signal)=>{await new Promise(r=>signal.addEventListener('abort',r,{once:true}));signal.throwIfAborted();};
 await approve(s,s.tool(a.id,'gameguy_device_start',{}));await s.stop(a.id);status=await s.tool(a.id,'gameguy_status',{});assert.equal(status.status,'stopped');assert.equal(status.devices[0].status,'stopped');assert.equal(status.devices.length,1);assert.ok(!JSON.stringify(status).includes('token'));
});

test('pure plugin preparation exposes schema and cannot bind or execute a device',async t=>{
 const {service:s}=await fixture(t);Object.assign(s.engine.adapter('arknights'),{requestSchema:{type:'object'},prepare:preparePlan});const a=await task(s);
 const setup=await s.tool(a.id,'gameguy_setup',{game:'arknights'});assert.deepEqual(setup.requestSchema,{type:'object'});
 const p=await s.tool(a.id,'gameguy_prepare',{game:'arknights',request:{intent:'daily',base:{mode:'normal'}}});
 assert.equal(p.proposalOnly,true);assert.equal(p.persisted,false);assert.equal(p.ready,true);assert.equal(a.instance,undefined);
 assert.equal(s.approvals.size,0);assert.equal(s.engine.snapshot().runs.length,0);assert.equal(s.engine.snapshot().devices.length,0);assert.equal(s.scheduler.list().schedules.length,0);
});
test('prepared policy expansions still require configure and run approvals',async t=>{
 let executions=0;const {service:s}=await fixture(t);Object.assign(s.engine.adapter('arknights'),{execute:async()=>{executions++;return {};},requestSchema:{type:'object'},prepare:preparePlan});
 const a=await task(s,'arknights',true),old=structuredClone(s.engine.config(a.instance).value);
 const p=await s.tool(a.id,'gameguy_prepare',{game:'arknights',request:{intent:'farm',fight:{stage:'1-7',times:8,medicine:1}}});
 assert.deepEqual(s.engine.config(a.instance).value,old);assert.equal(s.approvals.size,0);
 await assert.rejects(s.tool(a.id,'gameguy_run',{plan:p.plan}),/授权策略/);assert.equal(executions,0);
 const denied=await approve(s,s.tool(a.id,'gameguy_configure',{game:'arknights',instance:a.instance,config:p.proposedConfig}),false);
 assert.equal(denied.status,'denied');assert.deepEqual(s.engine.config(a.instance).value,old);
 await approve(s,s.tool(a.id,'gameguy_configure',{game:'arknights',instance:a.instance,config:p.proposedConfig}));
 assert.equal(s.engine.config(a.instance).value.medicineLimit,1);await approve(s,s.tool(a.id,'gameguy_run',{plan:p.plan,maxSeconds:30}),false);assert.equal(executions,0);
});
test('prepare rejects wrong game, unsupported adapter and stopped task',async t=>{
 const {service:s}=await fixture(t);const a=await task(s);await assert.rejects(s.tool(a.id,'gameguy_prepare',{game:'arknights',request:{intent:'daily'}}),/不支持/);
 Object.assign(s.engine.adapter('arknights'),{requestSchema:{type:'object'},prepare:preparePlan});await assert.rejects(s.tool(a.id,'gameguy_prepare',{game:'minecraft',request:{intent:'daily'}}),/另一游戏/);
 await s.stop(a.id);await assert.rejects(s.tool(a.id,'gameguy_prepare',{game:'arknights',request:{intent:'daily'}}),/停止/);
});
test('trusted MAA package ships the real intent compiler and progressive Skill references',async t=>{
 const dir=await temp(t),p=await new PluginManager(root,installedDir(t,dir),{register:()=>async()=>{}}).init();cleanup(t,()=>p.disable('arknights'));
 const r=await p.install('arknights');assert.equal(r.version,'0.3.7');
 const mod=p.modules.get('arknights');assert.ok(mod.adapter.requestSchema);const prepared=mod.adapter.prepare(mod.adapter.defaults,{intent:'base'});
 assert.equal(prepared.ready,true);assert.deepEqual(prepared.tasks.find(t=>t.type==='Custom').params,{task_names:['InfrastBegin']});assert.equal(prepared.plan.baseCollect,true);
 for(const path of ['SKILL.md','references/tasks.md','references/connection.md','references/schedule.md','references/official-scripts.md'])assert.ok((await p.skill('arknights',path)).text.length>100);
});

const agentQuestion={questions:[{id:'channel',question:'选择游戏渠道',options:[{label:'官服'},{label:'B服'}]}]};
test('native question card detaches state and only returns validated answers',async t=>{
 const {service:s}=await fixture(t),a=await task(s),controller=new AbortController();
 const pending=s.ask(a.id,agentQuestion,{signal:controller.signal}),q=[...s.questions.values()][0];
 const snapshot=s.snapshot();assert.equal(snapshot.questions.length,1);assert.equal(snapshot.questions[0].resolve,undefined);snapshot.questions[0].questions[0].question='changed';assert.equal(q.questions[0].question,'选择游戏渠道');
 await assert.rejects(s.resolveQuestion(q.id,{answers:[{id:'channel',selected:['不存在']}]}));assert.equal(s.questions.size,1);
 assert.deepEqual(await s.resolveQuestion(q.id,{answers:[{id:'channel',selected:['官服']}]}),{accepted:true});
 assert.deepEqual(await pending,{answers:[{id:'channel',selected:['官服']}]});assert.equal(s.questions.size,0);assert.equal(a.status,'idle');
});
test('question abort, expiry and epoch changes cannot grant plan approval',async t=>{
 const {service:s}=await fixture(t),a=await task(s);const review={questions:[{id:'review',question:'Review',options:[{label:'Approve'}],intent:{kind:'plan-review',approve:'Approve'}}]};
 for(const mode of ['abort','expiry','epoch']){
  const ctrl=new AbortController(),pending=s.ask(a.id,review,{signal:ctrl.signal}),q=[...s.questions.values()][0];
  if(mode==='abort')ctrl.abort();else {if(mode==='expiry')q.expiresAt=new Date(0).toISOString();else s.cancelEpoch.set(a.id,(s.cancelEpoch.get(a.id)??0)+1);await s.resolveQuestion(q.id,{answers:[{id:'review',selected:['Approve']}]});}
  assert.deepEqual(await pending,{answers:[]});assert.equal(s.questions.size,0);
 }
});
test('stop and close settle question waiters without late approval',async t=>{
 const {service:s}=await fixture(t),a=await task(s);const pending=s.ask(a.id,agentQuestion),id=[...s.questions.keys()][0];await s.stop(a.id);assert.deepEqual(await pending,{answers:[]});await assert.rejects(s.resolveQuestion(id,{answers:[{id:'channel',selected:['官服']}]}));
 const b=await task(s),closing=s.ask(b.id,agentQuestion);await s.close();assert.deepEqual(await closing,{answers:[]});assert.equal(s.questions.size,0);
});
test('slash commands go directly to DSH without GameGuy prefixes or model sends',async t=>{
 const {service:s,runtime}=await fixture(t);const before=runtime.calls.length;const {taskId}=await s.create({text:'/plan'});const calls=runtime.calls.slice(before);assert.equal(calls.filter(c=>c.method==='send').length,0);assert.deepEqual(calls.find(c=>c.method==='command').input,{taskId,text:'/plan'});
 await s.message(taskId,'/unknown');assert.equal(runtime.calls.filter(c=>c.method==='command').at(-1).input.text,'/unknown');assert.equal(runtime.calls.filter(c=>c.method==='send').length,0);
});
test('native idle event updates plan capabilities but child status cannot idle the root',async t=>{
 const {service:s}=await fixture(t),a=await task(s);a.status='thinking';await s.runtimeEvent({type:'child-status',taskId:a.id,status:'idle',agentId:'child'});assert.equal(a.status,'thinking');await s.runtimeEvent({type:'agent-status',taskId:a.id,status:'idle',capabilities:{planMode:{active:false},tools:[],commands:[]}});assert.equal(a.status,'idle');assert.equal(a.capabilities.planMode.active,false);
});

test('session model selection uses native RPC without restart, chat or stopped-task reactivation',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s);await s.stop(a.id);
 const original=runtime.call.bind(runtime),calls=runtime.calls.length,starts=runtime.starts.length,messages=a.messages.length;
 const selected={provider:'gameguy',model:'fixture-b'};
 runtime.call=async(m,i)=>{if(m==='select-model'){runtime.calls.push({method:m,input:i});return {next:i.selection,lastUsed:{provider:'gameguy',model:'fixture-a'},pending:true,unavailable:false};}return original(m,i);};
 const result=await s.selectSessionModel(a.id,selected);
 assert.deepEqual(result.next,selected);assert.equal(a.sessionModel.pending,true);assert.equal(a.cancelled,true);assert.equal(a.status,'stopped');assert.equal(a.messages.length,messages);assert.equal(runtime.starts.length,starts);
 assert.deepEqual(runtime.calls.slice(calls).map(c=>c.method),['ensure','select-model']);
 const directory=await s.sessionModels(a.id);assert.deepEqual(directory.sessionModel.next,selected);assert.equal(a.status,'stopped');
});
test('model catalog/selection admission excludes global route updates and permission mutations',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s),gate=deferred(),original=runtime.call.bind(runtime);
 runtime.call=async(m,i)=>m==='model-catalog'?gate.promise:original(m,i);
 const loading=s.sessionModels(a.id);await until(()=>s.runtimeAdmissions.has(a.id));
 await assert.rejects(s.saveModel({provider:'deepseek',model:'deepseek-flash'},'fake'),/操作完成/);
 await assert.rejects(s.setPermission(a.id,'read-only'),/停止活动/);
 gate.resolve({models:[]});await loading;assert.equal(s.runtimeAdmissions.size,0);
 assert.throws(()=>s.selectSessionModel(a.id,{provider:'gameguy',model:'x',apiKey:'must-not-accept'}));
 assert.equal(runtime.calls.filter(c=>c.method==='select-model').length,0);
});
test('session model operations serialize native durable selection, and release after failure',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s),gate=deferred(),seen=[],original=runtime.call.bind(runtime);
 runtime.call=async(m,i)=>{if(m!=='select-model')return original(m,i);seen.push(i.selection.model);if(seen.length===1){await gate.promise;throw Error('native rejected');}return {next:i.selection,pending:true};};
 const first=s.selectSessionModel(a.id,{provider:'gameguy',model:'first'});const failed=assert.rejects(first,/native rejected/);
 const second=s.selectSessionModel(a.id,{provider:'gameguy',model:'second'});await until(()=>seen.length===1);assert.deepEqual(seen,['first']);assert.equal(s.runtimeAdmissions.get(a.id),2);
 gate.resolve();await failed;const result=await second;assert.deepEqual(seen,['first','second']);assert.equal(result.next.model,'second');assert.equal(a.sessionModel.next.model,'second');assert.equal(s.runtimeAdmissions.size,0);
});
test('global model update rejects concurrent prompts before modifying user history',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s),gate=deferred();runtime.start=async()=>gate.promise;
 const before=a.messages.length,count=s.store.data.tasks.length;s.hasKey=false;
 const saving=s.saveModel({provider:'deepseek',model:'deepseek-flash'},'fixture');
 assert.equal(s.modelChanging,true);await assert.rejects(s.message(a.id,'must not append'),/模型连接正在更新/);await assert.rejects(s.create({text:'must not create'}),/模型连接正在更新/);
 assert.equal(a.messages.length,before);assert.equal(s.store.data.tasks.length,count);gate.resolve({});await saving;assert.equal(s.modelChanging,false);
});
test('privacy pause and resume work without a game instance, including official Skill tasks',async t=>{
 const {service:s}=await fixture(t);for(const game of ['clawclaw',undefined]){
  const a=await task(s,game);if(game===undefined)delete a.game;
  assert.equal((await s.privacy(a.id,true)).privacy,true);assert.equal(a.privacy,true);assert.equal(a.cancelled,true);
  const stopped=a.status;assert.equal((await s.privacy(a.id,false)).privacy,false);assert.equal(a.privacy,false);assert.equal(a.status,stopped);assert.equal(a.cancelled,true);
 }
});
test('privacy pause blocks frames immediately while stop is pending and rejects overlapping resume',async t=>{
 const {service:s,runtime}=await fixture(t),a=await task(s,'arknights',true),gate=deferred();let captures=0;
 s.engine.adapter('arknights').screenshot=async()=>{captures++;return Buffer.from('fixture');};
 const call=runtime.call.bind(runtime);runtime.call=(m,i)=>m==='cancel'?gate.promise:call(m,i);
 const p=s.privacy(a.id,true);assert.equal(a.privacy,true);await until(()=>a.status==='stopping');
 await assert.rejects(s.capture(a.id),/隐私/);await assert.rejects(s.privacy(a.id,false),/切换/);
 await assert.rejects(s.execute(a,{},30,{occurrence:'fixture',dueAt:new Date().toISOString()}),/隐私/);
 assert.equal(captures,0);gate.resolve({});await p;assert.equal(s.privacyChanges.size,0);
});
test('failed pause remains fail-closed even when backend privacy was not committed',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true),stop=s.stop.bind(s);
 s.engine.adapter('arknights').screenshot=async()=>Buffer.from('fixture');s.stop=async()=>{throw Error('fixture stop failed');};
 await assert.rejects(s.privacy(a.id,true),/stop failed/);assert.equal(a.privacy,true);assert.equal(s.privacyChanges.size,0);
 await assert.rejects(s.capture(a.id),/隐私/);await assert.rejects(s.execute(a,{},30,{occurrence:'fixture',dueAt:new Date().toISOString()}),/隐私/);s.stop=stop;
});
test('in-flight capture is discarded even after pause and resume complete',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true),gate=deferred();let captures=0;
 s.engine.adapter('arknights').screenshot=async()=>{captures++;return gate.promise;};
 const p=s.capture(a.id);await until(()=>captures===1);await s.privacy(a.id,true);await s.privacy(a.id,false);
 gate.resolve(Buffer.from('stale fixture'));await assert.rejects(p,/丢弃/);assert.equal(a.privacy,false);
 s.engine.adapter('arknights').screenshot=async()=>Buffer.from('fresh fixture');assert.equal((await s.capture(a.id)).dataURL,'data:image/png;base64,'+Buffer.from('fresh fixture').toString('base64'));
});
test('in-flight capture cannot be returned to a newly bound instance',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true),gate=deferred();let called=false;
 s.engine.adapter('arknights').screenshot=async()=>{called=true;return gate.promise;};const p=s.capture(a.id);await until(()=>called);
 a.instance='different-fixture';gate.resolve(Buffer.from('stale'));await assert.rejects(p,/丢弃/);
});
test('failed backend resume keeps task private and releases transition lock',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true);await s.privacy(a.id,true);
 const preview=s.engine.preview.bind(s.engine);s.engine.preview=async()=>{throw Error('fixture resume failed');};
 await assert.rejects(s.privacy(a.id,false),/resume failed/);assert.equal(a.privacy,true);assert.equal(s.privacyChanges.size,0);
 s.engine.preview=preview;await s.privacy(a.id,false);assert.equal(a.privacy,false);
});
test('resume persistence failure rolls engine privacy back before releasing lock',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true);await s.privacy(a.id,true);
 const save=s.store.save.bind(s.store);s.store.save=async()=>{throw Error('fixture disk failed');};
 await assert.rejects(s.privacy(a.id,false),/disk failed/);assert.equal(a.privacy,true);assert.equal(s.engine.snapshot().preview.privacy,true);assert.equal(s.privacyChanges.size,0);
 await assert.rejects(s.capture(a.id),/隐私/);s.store.save=save;await s.privacy(a.id,false);
});
test('uncertain resume rollback reports both failures and still blocks this task',async t=>{
 const {service:s}=await fixture(t),a=await task(s,'arknights',true);await s.privacy(a.id,true);
 const save=s.store.save.bind(s.store),preview=s.engine.preview.bind(s.engine);s.store.save=async()=>{throw Error('fixture disk failed');};
 s.engine.preview=(...args)=>args[2]===true?Promise.reject(Error('fixture rollback failed')):preview(...args);
 await assert.rejects(s.privacy(a.id,false),e=>e instanceof AggregateError&&e.errors.length===2&&/未确认/.test(e.message));
 assert.equal(a.privacy,true);assert.equal(s.privacyChanges.size,0);await assert.rejects(s.execute(a,{},30,{occurrence:'fixture',dueAt:new Date().toISOString()}),/隐私/);
 s.store.save=save;s.engine.preview=preview;
});

test('live native permission overrides stale full-access task/UI cache',async t=>{
 let calls=0;const {service:s}=await fixture(t,async()=>{calls++;return {};});const a=await task(s,'arknights',true);a.permission='danger-full-access';
 const p=s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30});await approve(s,p,false);assert.equal(calls,0);assert.equal(a.gameApprovalMode,'confirm');
});
test('native composer full-access switch is honored even if saved task still says workspace-write',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s,'arknights',true);a.permission='workspace-write';runtime.permissions.set(a.id,'danger-full-access');
 const r=await s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30});assert.equal(r.status,'started');assert.equal(s.approvals.size,0);assert.equal(a.permission,'danger-full-access');
});
test('unknown, offline, mismatched or restricted native permission never auto-authorizes games',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s,'arknights',true);const original=runtime.call.bind(runtime);
 for(const state of [null,{sessionId:'another-session',preset:'danger-full-access',sandboxMode:'danger-full-access',approvalPolicy:'never'},{sessionId:a.sessionId,preset:'custom',sandboxMode:'workspace-write',approvalPolicy:'never'},{sessionId:a.sessionId,preset:'custom',sandboxMode:'danger-full-access',approvalPolicy:'ask'}]){
  runtime.call=(m,i)=>m==='permission-state'?Promise.resolve(state):original(m,i);
  const p=s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30});assert.equal((await approve(s,p,false)).status,'denied');assert.equal(a.runIds.length,0);
 }
 runtime.call=(m,i)=>m==='permission-state'?Promise.reject(Error('offline fixture')):original(m,i);
 assert.equal((await approve(s,s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30}),false)).status,'denied');
});
test('full-access still rejects invalid plans and spending above saved limits before authorization',async t=>{
 let calls=0;const {service:s,runtime}=await fixture(t,async()=>{calls++;return {};});const a=await task(s,'arknights',true);await s.setPermission(a.id,'danger-full-access');
 const before=runtime.calls.filter(c=>c.method==='permission-state').length;
 for(const plan of [{stone:1},{shopping:true},{fight:{stage:'1-7',times:6,medicine:1}}])await assert.rejects(s.tool(a.id,'gameguy_run',{plan,maxSeconds:30}));
 assert.equal(calls,0);assert.equal(a.runIds.length,0);assert.equal(s.approvals.size,0);assert.equal(runtime.calls.filter(c=>c.method==='permission-state').length,before);
});
test('auto-approved configuration and emulator connection stay managed and keep device locks',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s);await s.setPermission(a.id,'danger-full-access');let starts=0;
 const r=await s.tool(a.id,'gameguy_configure',{game:'arknights',instance:'auto-fixture',config:{}});assert.equal(r.instance,'auto-fixture');assert.equal(a.instance,'auto-fixture');
 const plugin=s.engine.adapter('arknights');plugin.deviceLaunch=()=>({executable:'fixture-only.exe',instanceIndex:0});plugin.startDevice=async c=>{starts++;return {config:c,detail:{fixture:true}};};
 const device=await s.tool(a.id,'gameguy_device_start',{});assert.equal(device.status,'starting');await until(()=>starts===1);assert.equal(s.approvals.size,0);
 assert(runtime.calls.filter(c=>c.method==='permission-state').length>=4);
});
test('full-access keeps privacy pause and stopped-task guards',async t=>{
 let calls=0;const {service:s}=await fixture(t,async()=>{calls++;return {};});const a=await task(s,'arknights',true);await s.setPermission(a.id,'danger-full-access');
 a.privacy=true;await assert.rejects(s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30}),/隐私/);assert.equal(calls,0);a.privacy=false;
 await s.stop(a.id);await assert.rejects(s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30}),/已停止/);assert.equal(a.runIds.length,0);
});
test('native tool cancellation immediately clears business approval without waiting five minutes',async t=>{
 const {service:s}=await fixture(t);const a=await task(s,'arknights',true),controller=new AbortController();
 const p=s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30},{signal:controller.signal});await until(()=>s.approvals.size);controller.abort();
 assert.equal((await p).status,'denied');assert.equal(s.approvals.size,0);assert.equal(a.runIds.length,0);assert.equal(a.status,'idle');
});
test('stop while live permission lookup is pending cannot auto-start a backend',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s,'arknights',true),gate=deferred(),original=runtime.call.bind(runtime);
 runtime.call=(m,i)=>m==='permission-state'?gate.promise:original(m,i);
 const p=s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30});await pause();await s.stop(a.id);
 gate.resolve({sessionId:a.sessionId,preset:'danger-full-access',sandboxMode:'danger-full-access',approvalPolicy:'never'});
 assert.equal((await p).status,'denied');assert.equal(a.runIds.length,0);assert.equal(s.approvals.size,0);
});
test('auto-approval audit persistence failure and native policy downgrade prevent execution',async t=>{
 const {service:s,runtime}=await fixture(t);const a=await task(s,'arknights',true);await s.setPermission(a.id,'danger-full-access');const changed=s.changed.bind(s);
 s.changed=()=>Promise.reject(Error('audit disk fixture'));await assert.rejects(s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30}),/audit disk/);assert.equal(a.runIds.length,0);s.changed=changed;
 s.changed=async()=>{await changed();runtime.permissions.set(a.id,'workspace-write');};
 assert.equal((await s.tool(a.id,'gameguy_run',{plan:{},maxSeconds:30})).status,'denied');assert.equal(a.runIds.length,0);s.changed=changed;
});
test('full-access does not automatically answer player questions or bypass native escalation requests',async t=>{
 const {service:s}=await fixture(t);const a=await task(s);await s.setPermission(a.id,'danger-full-access');
 const q=s.ask(a.id,{questions:[{id:'channel',question:'Choose channel',options:[{label:'Official'},{label:'Bilibili'}]}]});assert.equal(s.questions.size,1);await s.dismissQuestions(a.id);assert.deepEqual(await q,{answers:[]});
 const p=s.approve(a.id,'dsh-approval',{toolName:'write'});assert.equal(s.approvals.size,1);assert.equal(await approve(s,p,false),false);
});

