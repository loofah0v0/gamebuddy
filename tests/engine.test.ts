import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {Engine,checkId} from '../packages/core/src/engine.js';
import type {GamePlugin,Json,GameRuntime,RunRecord} from '../packages/core/src/contracts.js';
import {z} from 'zod';
function deferred(){let done!:()=>void;const promise=new Promise<void>(r=>done=r);return {promise,done};}
const abortWait=(r:GameRuntime)=>new Promise<Json>(resolve=>{if(r.signal.aborted)resolve({stopped:true});else r.signal.addEventListener('abort',()=>resolve({stopped:true}),{once:true});});
function plugin(execute:GamePlugin['execute']=async()=>({ok:true}),extras:Partial<GamePlugin>={}):GamePlugin{return {id:'arknights',title:'fake for tests',defaults:{address:'127.0.0.1:5555'},parseConfig:i=>z.object({address:z.string()}).strict().parse(i),configSchema:{type:'object'},planSchema:{type:'object'},capabilities:{schedule:false},validatePlan:(_c,p)=>p,questions:()=>[],diagnose:async()=>({ready:true}),execute,...extras};}
async function fixture(t:any,p=plugin()){
 const root=await mkdtemp(join(tmpdir(),'gameguy-test-'));const engine=new Engine(root);await engine.init();engine.register(p);
 t.after(async()=>{await engine.dispose();const target=resolve(root);assert.equal(dirname(target),resolve(tmpdir()));assert(basename(target).startsWith('gameguy-test-'));await rm(target,{recursive:true,force:true});});
 await engine.configure('arknights','main',{address:'127.0.0.1:5555'});return {engine,root};
}
async function finish(engine:Engine){for(let i=0;i<200;i++){if((engine.snapshot() as any).runs[0]?.status!=='running')return;await new Promise(r=>setTimeout(r,5));}throw Error('test backend did not settle');}

test('instance IDs, ownership and snapshots are fenced',async t=>{
 for(const id of ['../escape','','a/b','a'.repeat(65)])assert.throws(()=>checkId(id));
 const {engine}=await fixture(t);engine.register(plugin(undefined,{id:'minecraft'}));
 await assert.rejects(engine.configure('minecraft','main',{address:'local'}),/another game/);
 const s=engine.snapshot() as any;s.configs[0].id='changed';s.catalog[0].title='changed';assert.equal((engine.snapshot() as any).configs[0].id,'main');
 await assert.rejects(engine.preview('main','https://evil.test'),/official/);
});
test('one device has one owner, stop waits cleanup before unlocking',async t=>{
 const entered=deferred(),cleanup=deferred();const {engine}=await fixture(t,plugin(async(_c,_p,r)=>{entered.done();await abortWait(r);await cleanup.promise;return {done:true};}));
 await engine.configure('arknights','alias',{address:'127.0.0.1:5555'});await engine.run('main',{});await entered.promise;
 await assert.rejects(engine.run('alias',{}),/busy/);await assert.rejects(engine.configure('arknights','main',{address:'other'}),/busy/);
 let stopped=false;const stopping=engine.stop('main').then(()=>stopped=true);await new Promise(r=>setTimeout(r,15));assert.equal(stopped,false);
 await assert.rejects(engine.run('alias',{}),/busy/);cleanup.done();await stopping;assert.equal((engine.snapshot() as any).runs[0].status,'stopped');
});
test('events, result and completion notifications cannot mutate history',async t=>{
 const data={value:1};const result={value:2};let notified:RunRecord|undefined;const notification=deferred();
 const {engine,root}=await fixture(t,plugin(async(_c,_p,r)=>{r.event('one',data);data.value=99;for(let i=0;i<205;i++)r.event('count',{i});await r.deliver?.('durable',{ok:true});assert((await readFile(join(root,'state.json'),'utf8')).includes('durable'));return result;}));
 await engine.run('main',{}, {onFinish:r=>{notified=r;r.events.length=0;notification.done();}});await notification.promise;result.value=99;
 const run=(engine.snapshot() as any).runs[0];assert.equal(run.status,'completed');assert.equal(run.result.value,2);assert.equal(run.events.length,200);assert(notified);
});
test('scheduled runs dedupe, skip stale occurrences and reject future dueAt',async t=>{
 let calls=0;const {engine}=await fixture(t,plugin(async()=>{calls++;return {ok:true};}));
 const options={occurrence:'main:v1:2026-10-22',dueAt:new Date().toISOString()};await engine.run('main',{},options);await finish(engine);
 const duplicate=await engine.run('main',{},options) as any;assert.equal(duplicate.status,'duplicate');duplicate.run.status='failed';assert.equal((engine.snapshot() as any).runs[0].status,'completed');assert.equal(calls,1);
 assert.equal((await engine.run('main',{}, {occurrence:'old',dueAt:new Date(Date.now()-1800001).toISOString()}) as any).status,'skipped-late');
 await assert.rejects(engine.run('main',{}, {occurrence:'future',dueAt:new Date(Date.now()+120000).toISOString()}),/future/);
 await assert.rejects(engine.run('main',{}, {occurrence:'missing'}),/dueAt/);await assert.rejects(engine.run('main',{}, {maxSeconds:9}),/maxSeconds/);
});
test('restart marks unfinished run interrupted without automatic replay',async t=>{
 const {engine,root}=await fixture(t);await engine.dispose();
 const state=JSON.parse(await readFile(join(root,'state.json'),'utf8'));state.runs=[{id:'test',game:'arknights',instance:'main',startedAt:new Date().toISOString(),status:'running',events:[]}];await writeFile(join(root,'state.json'),JSON.stringify(state));
 const restored=new Engine(root);await restored.init();t.after(()=>restored.dispose());assert.equal((restored.snapshot() as any).runs[0].status,'interrupted');assert.match((restored.snapshot() as any).runs[0].error,/not automatically retried/);
});
test('backend failure is explicit, not successful completion',async t=>{
 const {engine}=await fixture(t,plugin(async()=>{throw Error('actual failure');}));await engine.run('main',{});await finish(engine);assert.equal((engine.snapshot() as any).runs[0].status,'failed');assert.equal((engine.snapshot() as any).runs[0].error,'actual failure');
});
test('stop during initial persistence prevents any execution',async t=>{
 let calls=0;const {engine}=await fixture(t,plugin(async()=>{calls++;return {};}));const entered=deferred(),release=deferred();const preview=engine.preview.bind(engine);
 engine.preview=async(...args)=>{entered.done();await release.promise;return preview(...args);};
 const starting=engine.run('main',{});await entered.promise;const stopping=engine.stop('main');release.done();await starting;await stopping;assert.equal(calls,0);assert.equal((engine.snapshot() as any).runs[0].status,'stopped');
});
test('initial persistence failure never starts backend',async t=>{
 let calls=0;const {engine}=await fixture(t,plugin(async()=>{calls++;return {};}));engine.preview=async()=>{throw Error('disk failure');};
 await assert.rejects(engine.run('main',{}),/disk failure/);assert.equal(calls,0);assert.equal((engine.snapshot() as any).runs[0].status,'failed');assert.equal((await engine.stop('main') as any).status,'idle');
});
test('idle control locks device and disposal cancels active control',async t=>{
 const entered=deferred();const {engine}=await fixture(t,plugin(undefined,{control:async(_c,_a,s)=>{entered.done();await new Promise<void>(resolve=>s.addEventListener('abort',()=>resolve(),{once:true}));return {cancelled:s.aborted};}}));
 const controlling=engine.control('main',{type:'tap'},new AbortController().signal);await entered.promise;await assert.rejects(engine.run('main',{}),/busy/);await engine.dispose();assert.equal((await controlling as any).cancelled,true);await assert.rejects(engine.run('main',{}),/closing/);
});
test('unregister/dispose coalesce and wait for pending adapter disposal',async t=>{
 const {engine}=await fixture(t);const entered=deferred(),release=deferred();let count=0;const unregister=engine.register(plugin(undefined,{id:'minecraft',dispose:async()=>{count++;entered.done();await release.promise;}}));
 const first=unregister();assert.equal(first,unregister());await entered.promise;const disposing=engine.dispose();assert.equal(disposing,engine.dispose());let done=false;void disposing.then(()=>done=true);await new Promise(r=>setTimeout(r,15));assert.equal(done,false);release.done();await first;await disposing;assert.equal(count,1);assert.throws(()=>engine.register(plugin()),/closing/);
});

test('explicit screenshot selects instance without changing human preview',async t=>{
 const {engine}=await fixture(t,plugin(undefined,{screenshot:async c=>Buffer.from(String((c as any).address))}));
 await engine.configure('arknights','second',{address:'127.0.0.1:6666'});await engine.preview('main');
 assert.equal((await engine.screenshot(new AbortController().signal,'second')).toString(),'127.0.0.1:6666');
 assert.equal((engine.snapshot() as any).preview.instance,'main');
 await assert.rejects(engine.screenshot(new AbortController().signal,'missing'),/configure/);
});

test('privacy pause fences aliases, drops inflight captures and persists across restart',async t=>{
 const entered=deferred(),release=deferred();let reads=0;
 const {engine,root}=await fixture(t,plugin(undefined,{screenshot:async()=>{reads++;entered.done();await release.promise;return Buffer.from('fixture');},control:async()=>({ok:true})}));
 await engine.configure('arknights','alias',{address:'127.0.0.1:5555'});await engine.preview('main');
 const pending=engine.screenshot(new AbortController().signal,'alias');await entered.promise;
 await engine.preview('main',undefined,true);release.done();await assert.rejects(pending,/discarded/);
 await assert.rejects(engine.screenshot(new AbortController().signal,'alias'),/capture blocked/);assert.equal(reads,1);
 await assert.rejects(engine.control('alias',{type:'tap'},new AbortController().signal),/privacy/);
 await assert.rejects(engine.run('alias',{}),/privacy/);assert.equal((engine.snapshot() as any).preview.privacy,true);
 const restored=new Engine(root);await restored.init();restored.register(plugin(undefined,{screenshot:async()=>Buffer.from('fixture')}));t.after(()=>restored.dispose());
 await assert.rejects(restored.screenshot(new AbortController().signal,'alias'),/capture blocked/);
 await engine.preview('main',undefined,false);assert.equal((engine.snapshot() as any).preview.privacy,false);
 assert.equal((await engine.screenshot(new AbortController().signal,'alias')).toString(),'fixture');
});


test('localhost and zero-padded ADB ports share ownership and privacy',async t=>{
 const entered=deferred();
 const {engine}=await fixture(t,plugin(async(_c,_p,r)=>{entered.done();return abortWait(r);},{screenshot:async()=>Buffer.from('fixture'),control:async()=>({ok:true})}));
 await engine.configure('arknights','host-alias',{address:'localhost:05555'});
 await engine.run('main',{});await entered.promise;
 await assert.rejects(engine.run('host-alias',{}),/busy/);await engine.stop('main');
 await engine.preview('host-alias',undefined,true);
 await assert.rejects(engine.screenshot(new AbortController().signal,'main'),/capture blocked/);
 await assert.rejects(engine.control('main',{type:'tap'},new AbortController().signal),/privacy/);
 await engine.preview('main',undefined,false);
 assert.equal((await engine.screenshot(new AbortController().signal,'host-alias')).toString(),'fixture');
});

test('configuration persistence fences concurrent execution, captures and changes',async t=>{
 let calls=0;const {engine}=await fixture(t,plugin(async()=>{calls++;return {};},{screenshot:async()=>Buffer.from('fixture')}));
 const entered=deferred(),release=deferred();
 const save=(engine as any).save.bind(engine);let first=true;
 (engine as any).save=async()=>{if(first){first=false;entered.done();await release.promise;}return save();};
 const configuring=engine.configure('arknights','main',{address:'localhost:05555'});await entered.promise;
 await assert.rejects(engine.run('main',{}),/busy/);
 await assert.rejects(engine.configure('arknights','alias',{address:'127.0.0.1:5555'}),/busy/);
 await assert.rejects(engine.preview('main'),/busy/);
 await assert.rejects(engine.screenshot(new AbortController().signal,'main'),/transition/);
 assert.equal(calls,0);release.done();await configuring;
 await engine.run('main',{});await finish(engine);assert.equal(calls,1);
});

test('failed configuration persistence rolls back and releases transition locks',async t=>{
 const {engine}=await fixture(t);const save=(engine as any).save.bind(engine);
 (engine as any).save=async()=>{throw Error('disk failure');};
 await assert.rejects(engine.configure('arknights','main',{address:'127.0.0.1:6666'}),/disk failure/);
 assert.equal((engine.config('main').value as any).address,'127.0.0.1:5555');
 (engine as any).save=save;
 await engine.configure('arknights','main',{address:'127.0.0.1:6666'});
 await engine.run('main',{});await finish(engine);
 assert.equal((engine.snapshot() as any).runs[0].status,'completed');
});

test('legacy localhost privacy keys are canonicalized on restart',async t=>{
 const {engine,root}=await fixture(t);await engine.dispose();
 const state=JSON.parse(await readFile(join(root,'state.json'),'utf8'));
 state.privacyDevices=['adb:localhost:05555'];await writeFile(join(root,'state.json'),JSON.stringify(state));
 const restored=new Engine(root);await restored.init();restored.register(plugin(undefined,{screenshot:async()=>Buffer.from('fixture')}));t.after(()=>restored.dispose());
 await assert.rejects(restored.screenshot(new AbortController().signal,'main'),/capture blocked/);
});

const launcher=(startDevice:NonNullable<GamePlugin['startDevice']>)=>plugin(undefined,{
 deviceKeys:()=>['mumu:fixture:0'],deviceLaunch:()=>({executable:'D:/fixture/mumu-cli.exe',instanceIndex:0}),startDevice,
 screenshot:async()=>Buffer.from('fixture')
});
async function deviceSettled(engine:Engine){for(let i=0;i<200;i++){const status=(engine.snapshot() as any).devices[0]?.status;if(status&&status!=='starting')return status;await new Promise(r=>setTimeout(r,5));}throw Error('device did not settle');}
test('device request only selects preview; UI challenge not exposed to agent, confirmation single use',async t=>{
 let calls=0;const {engine,root}=await fixture(t,launcher(async c=>{calls++;return {config:{...c as object,address:'127.0.0.1:6666'},detail:{synthetic:true}};}));
 const request=await engine.requestDevice('main') as any;assert.equal(request.status,'confirmation-required');assert.equal(calls,0);assert(!('token' in request));assert.equal((engine.snapshot() as any).preview.instance,'main');
 const prompt=engine.devicePrompt('main') as any;assert(prompt.token);assert(!JSON.stringify(engine.snapshot()).includes(prompt.token));
 assert.equal((await engine.confirmDevice('main',prompt.token) as any).status,'starting');assert.equal(await deviceSettled(engine),'ready');assert.equal(calls,1);
 await assert.rejects(engine.confirmDevice('main',prompt.token),/失效/);assert.equal((engine.config('main').value as any).address,'127.0.0.1:6666');
 const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8'));assert.equal(saved.configs.main.value.address,'127.0.0.1:6666');assert(!JSON.stringify(saved).includes(prompt.token));
});
test('wrong, stale and expired startup challenges cannot execute, privacy blocks requests',async t=>{
 let calls=0;const {engine}=await fixture(t,launcher(async c=>{calls++;return {config:c,detail:{}};}));await engine.requestDevice('main');const token=(engine.devicePrompt('main') as any).token;
 await assert.rejects(engine.confirmDevice('main','wrong'),/失效/);
 await engine.configure('arknights','main',{address:'127.0.0.1:6666'});await assert.rejects(engine.confirmDevice('main',token),/失效/);
 await engine.requestDevice('main');const req=(engine as any).deviceRequests.get('main');req.expires=Date.now()-1;
 assert(!('token' in (engine.devicePrompt('main') as any)));await assert.rejects(engine.confirmDevice('main',req.token),/失效/);
 await engine.preview('main',undefined,true);await assert.rejects(engine.requestDevice('main'),/privacy/);assert.equal(calls,0);
});
test('startup owns stable MuMu identity across old addresses; stop waits cleanup and discards late result',async t=>{
 const entered=deferred(),cleanup=deferred();const {engine}=await fixture(t,launcher(async(c,s)=>{entered.done();await new Promise<void>(r=>s.addEventListener('abort',()=>r(),{once:true}));await cleanup.promise;return {config:{address:'127.0.0.1:9999'},detail:{}};}));
 await engine.configure('arknights','alias',{address:'127.0.0.1:7777'});await engine.requestDevice('main');await engine.confirmDevice('main',(engine.devicePrompt('main') as any).token);await entered.promise;
 await assert.rejects(engine.requestDevice('alias'),/busy/);await assert.rejects(engine.run('alias',{}),/busy/);await assert.rejects(engine.screenshot(new AbortController().signal,'alias'),/transition/);
 const stopping=engine.stop('main');let stopped=false;void stopping.then(()=>stopped=true);await new Promise(r=>setTimeout(r,10));assert.equal(stopped,false);
 await assert.rejects(engine.configure('arknights','alias',{address:'127.0.0.1:8888'}),/busy/);cleanup.done();await stopping;assert.equal(await deviceSettled(engine),'stopped');
 assert.equal((engine.config('main').value as any).address,'127.0.0.1:5555');await engine.requestDevice('alias');
});
test('discovered endpoint cannot take over an unrelated busy or privacy-paused alias',async t=>{
 const p=plugin(async(_c,_p,r)=>abortWait(r),{deviceLaunch:()=>({executable:'D:/fixture/mumu-cli.exe',instanceIndex:0}),startDevice:async()=>({config:{address:'127.0.0.1:7777'},detail:{}})});
 const {engine}=await fixture(t,p);await engine.configure('arknights','other',{address:'127.0.0.1:7777'});await engine.run('other',{});
 await engine.requestDevice('main');await engine.confirmDevice('main',(engine.devicePrompt('main') as any).token);assert.equal(await deviceSettled(engine),'failed');assert.equal((engine.config('main').value as any).address,'127.0.0.1:5555');
 await engine.stop('other');await engine.preview('other',undefined,true);await engine.requestDevice('main');await engine.confirmDevice('main',(engine.devicePrompt('main') as any).token);assert.equal(await deviceSettled(engine),'failed');
});
test('startup persistence failure rolls back address and releases device locks',async t=>{
 const {engine}=await fixture(t,launcher(async()=>({config:{address:'127.0.0.1:6666'},detail:{}})));await engine.requestDevice('main');const token=(engine.devicePrompt('main') as any).token;
 const save=(engine as any).save.bind(engine);(engine as any).save=async()=>{throw Error('disk failure');};await engine.confirmDevice('main',token);assert.equal(await deviceSettled(engine),'failed');assert.equal((engine.config('main').value as any).address,'127.0.0.1:5555');
 (engine as any).save=save;await engine.requestDevice('main');assert.equal((await engine.stop('main') as any).status,'idle');assert(!('token' in (engine.devicePrompt('main') as any)));
});
test('plugin unload cancels startup and waits adapter cleanup before removing ownership',async t=>{
 const {engine}=await fixture(t);const entered=deferred(),cleanup=deferred();let disposed=false;
 const unregister=engine.register(plugin(undefined,{id:'minecraft',deviceLaunch:()=>({executable:'D:/fixture/mumu-cli.exe',instanceIndex:0}),startDevice:async(c,s)=>{entered.done();await new Promise<void>(r=>s.addEventListener('abort',()=>r(),{once:true}));await cleanup.promise;return {config:c,detail:{}};},dispose:async()=>{disposed=true;}}));
 await engine.configure('minecraft','mc',{address:'fixture'});await engine.requestDevice('mc');await engine.confirmDevice('mc',(engine.devicePrompt('mc') as any).token);await entered.promise;
 const unloading=unregister();await new Promise(r=>setTimeout(r,10));assert.equal(disposed,false);cleanup.done();await unloading;assert.equal(disposed,true);assert.throws(()=>engine.devicePrompt('mc'),/not enabled/);
});


test('diagnosis owns device; stop waits cleanup and discards late result',async t=>{
 const entered=deferred(),cleanup=deferred();let signal:AbortSignal|undefined;
 const {engine}=await fixture(t,plugin(undefined,{diagnose:async(_c,s)=>{signal=s;entered.done();await new Promise<void>(r=>s!.addEventListener('abort',()=>r(),{once:true}));await cleanup.promise;return {ready:true};}}));
 const pending=engine.diagnose('arknights','main');const rejected=assert.rejects(pending,/stopped|abort/i);await entered.promise;
 await assert.rejects(engine.run('main',{}),/busy/);await assert.rejects(engine.configure('arknights','main',{address:'other'}),/busy/);
 let done=false;const stopping=engine.stop('main').then(()=>done=true);await new Promise(r=>setTimeout(r,10));assert.equal(done,false);assert.equal(signal?.aborted,true);
 cleanup.done();await stopping;await rejected;await engine.configure('arknights','main',{address:'other'});
});
test('pre-aborted and privacy-paused diagnoses do not call backend',async t=>{
 let count=0;const {engine}=await fixture(t,plugin(undefined,{diagnose:async()=>{count++;return {};}}));
 const a=new AbortController();a.abort(Error('cancelled'));await assert.rejects(engine.diagnose('arknights','main',a.signal),/cancelled/);
 await engine.preview('main',undefined,true);await assert.rejects(engine.diagnose('arknights','main'),/privacy/);assert.equal(count,0);
});
test('unregister cancels diagnosis and waits before disposing plugin',async t=>{
 const {engine}=await fixture(t);const entered=deferred(),cleanup=deferred();let disposed=false;
 const unregister=engine.register(plugin(undefined,{id:'minecraft',diagnose:async(_c,s)=>{entered.done();await new Promise<void>(r=>s!.addEventListener('abort',()=>r(),{once:true}));await cleanup.promise;return {};},dispose:async()=>{disposed=true;}}));
 await engine.configure('minecraft','mc',{address:'fixture'});const pending=engine.diagnose('minecraft','mc');const rejected=assert.rejects(pending,/abort|unavailable/i);await entered.promise;
 const unloading=unregister();await new Promise(r=>setTimeout(r,10));assert.equal(disposed,false);cleanup.done();await unloading;await rejected;assert.equal(disposed,true);
});
