/** Durable task history with device locks and explicit interrupted outcomes. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { catalog, type GamePlugin, type Json, type RunRecord } from './contracts.js';
const runSchema=z.object({id:z.string(),game:z.string(),instance:z.string(),occurrence:z.string().optional(),startedAt:z.string(),endedAt:z.string().optional(),status:z.enum(['running','completed','failed','stopped','interrupted']),events:z.array(z.object({at:z.string(),kind:z.string(),data:z.json()})).max(200),result:z.json().optional(),error:z.string().optional()}).strict();
const stateSchema=z.object({configs:z.record(z.string(),z.object({game:z.string(),value:z.json()}).strict()),runs:z.array(runSchema),preview:z.object({revision:z.number().int().nonnegative(),game:z.string().optional(),instance:z.string().optional(),url:z.string().optional()}).strict(),privacyDevices:z.array(z.string()).default([])}).strict();
type State=z.infer<typeof stateSchema>;
const validId=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
export function checkId(id:string):void{if(!validId.test(id))throw Error('invalid instance identifier');}
/** localhost and zero-padded ports cannot bypass device ownership/privacy. */
function canonicalDeviceKey(key:string):string {
 const match=/^adb:(?:localhost|127\.0\.0\.1):(\d{1,5})$/.exec(key);
 return match?'adb:127.0.0.1:'+Number(match[1]):key;
}
function device(config:{game:string;value:Json}):string{const value=z.record(z.string(),z.json()).parse(config.value);return canonicalDeviceKey(typeof value.address==='string'&&/^(?:localhost|127\.0\.0\.1):\d{1,5}$/.test(value.address)?'adb:'+value.address:config.game);}
export class Engine {
 readonly plugins=new Map<string,GamePlugin>();
 private state:State={configs:{},runs:[],preview:{revision:0},privacyDevices:[]};
 private active=new Map<string,{run:RunRecord;abort:AbortController;done:Promise<void>;device:string;keys:string[]}>();
 private transitions=new Set<string>();
 private controls=new Map<string,{game:string;instance:string;abort:AbortController;done:Promise<void>}>();
 private deviceRequests=new Map<string,{token:string;expires:number;fingerprint:string}>();
 private deviceStates=new Map<string,{status:string;message:string;fingerprint:string;detail?:Json}>();private writes:Promise<void>=Promise.resolve();private closing=false;private disposing:Promise<void>|undefined;private teardowns=new WeakMap<GamePlugin,Promise<void>>();private pendingTeardowns=new Set<Promise<void>>();
 constructor(readonly dataDir:string){}
 async init():Promise<void>{await mkdir(this.dataDir,{recursive:true});try{this.state=stateSchema.parse(JSON.parse(await readFile(join(this.dataDir,'state.json'),'utf8')));}catch(e){if(!(e instanceof Error&&'code' in e&&e.code==='ENOENT'))throw e;}this.state.privacyDevices=[...new Set(this.state.privacyDevices.map(canonicalDeviceKey))];for(const run of this.state.runs)if(run.status==='running'){run.status='interrupted';run.error='host stopped; outcome unknown; not automatically retried';run.endedAt=new Date().toISOString();}await this.save();}
 private save():Promise<void>{const body=JSON.stringify(this.state,null,2);const next=this.writes.catch(()=>{/* Previous caller received its write failure; later writes may recover. */}).then(async()=>{const file=join(this.dataDir,'state.json');await writeFile(file+'.tmp',body,{mode:0o600});await rename(file+'.tmp',file);});this.writes=next;return next;}
 register(plugin:GamePlugin):()=>Promise<void>{if(this.closing)throw Error('host is closing');if(this.plugins.has(plugin.id))throw Error('duplicate game plugin');this.plugins.set(plugin.id,plugin);return ()=>this.unregister(plugin);}
 private unregister(plugin:GamePlugin):Promise<void>{const previous=this.teardowns.get(plugin);if(previous)return previous;if(this.plugins.get(plugin.id)!==plugin)return Promise.resolve();for(const [id,c] of Object.entries(this.state.configs))if(c.game===plugin.id){this.deviceRequests.delete(id);this.deviceStates.delete(id);}this.plugins.delete(plugin.id);const jobs=[...this.active.values()].filter(j=>j.run.game===plugin.id),controls=[...this.controls.values()].filter(j=>j.game===plugin.id);for(const j of [...jobs,...controls])j.abort.abort();const done=(async()=>{await Promise.all([...jobs,...controls].map(j=>j.done));await plugin.dispose?.();})();this.teardowns.set(plugin,done);this.pendingTeardowns.add(done);void done.finally(()=>this.pendingTeardowns.delete(done)).catch(()=>{});return done;}
 list():Json{return catalog.map(item=>({...item,enabled:this.plugins.has(item.id)}));}
 adapter(game:string):GamePlugin{const p=this.plugins.get(game);if(!p)throw Error(`plugin not enabled: ${game}; use gameguy_install`);return p;}
 private keys(c:{game:string;value:Json}):string[]{return [...new Set([device(c),...(this.plugins.get(c.game)?.deviceKeys?.(c.value)??[])])];}
 assertReadable(game:string,value:Json):void{if(this.closing)throw Error('host is closing');if(this.privateDevice({game,value}))throw Error('privacy pause active; device inspection blocked');}
 private privateDevice(c:{game:string;value:Json}):boolean{return this.keys(c).some(key=>this.state.privacyDevices.includes(key));}
 private assertIdle(instance:string,c:{game:string;value:Json}):void{const keys=this.keys(c);if(keys.some(key=>this.transitions.has(key)||this.controls.has(key))||this.active.has(instance)||[...this.active.values()].some(j=>j.keys.some(key=>keys.includes(key))))throw Error('game instance/device is busy; stop before takeover or configuration changes');}
 async configure(game:string,instance:string,input:unknown):Promise<Json>{
  if(this.closing)throw Error('host is closing');checkId(instance);
  const p=this.adapter(game),existing=this.state.configs[instance];
  if(existing&&existing.game!==game)throw Error('instance belongs to another game');
  const value=p.parseConfig(input),next={game,value};
  if(existing)this.assertIdle(instance,existing);this.assertIdle(instance,next);
  const keys=new Set([...this.keys(next),...(existing?this.keys(existing):[])]);
  for(const key of keys)this.transitions.add(key);
  this.state.configs[instance]=next;
  try{await this.save();return{instance,game,config:value,missing:p.questions(value)};}
  catch(e){if(existing)this.state.configs[instance]=existing;else delete this.state.configs[instance];throw e;}
  finally{for(const key of keys)this.transitions.delete(key);}
 }
 config(instance:string,game?:string):{game:string;value:Json}{checkId(instance);const c=this.state.configs[instance];if(!c)throw Error('configure instance first');if(game&&c.game!==game)throw Error('instance belongs to another game');return {game:c.game,value:this.adapter(c.game).parseConfig(c.value)};}
 async diagnose(game:string,instance?:string,signal?:AbortSignal):Promise<Json>{
  const p=this.adapter(game),value=instance?this.config(instance,game).value:p.defaults,c={game,value};
  this.assertReadable(game,value);this.assertIdle(instance??'diagnose',c);
  const keys=this.keys(c),abort=new AbortController(),combined=AbortSignal.any([abort.signal,AbortSignal.timeout(25000),...(signal?[signal]:[])]);combined.throwIfAborted();
  let settle!:()=>void;const job={game,instance:instance??'diagnose',abort,done:new Promise<void>(r=>{settle=r;})};
  for(const key of keys)this.controls.set(key,job);
  try{const result=await p.diagnose(value,combined);combined.throwIfAborted();if(this.plugins.get(game)!==p)throw Error('plugin unavailable');this.assertReadable(game,value);return result;}
  finally{for(const key of keys)if(this.controls.get(key)===job)this.controls.delete(key);settle();}
 }
 async preview(instance:string,url?:string,privacy?:boolean):Promise<Json>{const c=this.config(instance);if(this.keys(c).some(key=>this.transitions.has(key)))throw Error('device configuration/privacy transition is busy');if(privacy!==undefined)this.assertIdle(instance,c);if(url){const u=new URL(url);if(c.game!=='clawclaw'||u.protocol!=='https:'||u.username||u.password||!(u.hostname==='myclaw.163.com'||u.hostname.endsWith('.myclaw.163.com')))throw Error('only official ClawClaw spectator HTTPS URLs allowed');}const previous=this.state.preview,previousPrivacy=[...this.state.privacyDevices];if(privacy!==undefined)for(const key of this.keys(c))this.transitions.add(key);if(privacy!==undefined){const keys=this.keys(c);this.state.privacyDevices=this.state.privacyDevices.filter(d=>!keys.includes(d));if(privacy)this.state.privacyDevices.push(...keys);}this.state.preview={revision:this.state.preview.revision+1,instance,game:c.game,...(url?{url}:{})};try{await this.save();}catch(e){this.state.preview=previous;this.state.privacyDevices=previousPrivacy;throw e;}finally{if(privacy!==undefined)for(const key of this.keys(c))this.transitions.delete(key);}return{status:'requested',preview:'/gameguy/preview',instance,privacy:this.privateDevice(c)};}
 snapshot():Json{return structuredClone({catalog:this.list(),runs:this.state.runs,preview:{...this.state.preview,privacy:this.state.preview.instance?this.privateDevice(this.state.configs[this.state.preview.instance]!):false},devices:[...this.deviceStates].filter(([id,s])=>this.state.configs[id]&&s.fingerprint===JSON.stringify(this.state.configs[id])).map(([instance,{fingerprint,...s}])=>({instance,...s})),configs:Object.entries(this.state.configs).map(([id,c])=>({id,game:c.game}))});}
 async run(instance:string,plan:Json,options:{maxSeconds?:number;occurrence?:string;dueAt?:string;onFinish?:(run:RunRecord)=>void;onEvent?:(kind:string,data:Json)=>void}={}):Promise<Json>{
  if(this.closing)throw Error('host is closing');const c=this.config(instance),p=this.adapter(c.game),max=options.maxSeconds??900;
  if(!Number.isInteger(max)||max<10||max>7200)throw Error('maxSeconds must be 10..7200');
  if(options.occurrence!==undefined){if(!options.dueAt)throw Error('scheduled runs require dueAt');const due=Date.parse(options.dueAt);if(!Number.isFinite(due))throw Error('invalid dueAt');if(due>Date.now()+60000)throw Error('scheduled occurrence is in future');if(Date.now()-due>1800000)return{status:'skipped-late',instance};const old=this.state.runs.find(r=>r.instance===instance&&r.occurrence===options.occurrence);if(old)return{status:'duplicate',run:structuredClone(old)};}
  this.assertIdle(instance,c);if(this.privateDevice(c))throw Error('privacy pause active; user must finish secret entry before resuming');if(p.questions(c.value).length)throw Error('missing configuration: '+p.questions(c.value).join('; '));
  const abort=new AbortController(),run:RunRecord={id:randomUUID(),game:c.game,instance,...(options.occurrence?{occurrence:options.occurrence}:{}),startedAt:new Date().toISOString(),status:'running',events:[]};this.state.runs.unshift(run);
  const finished=this.state.runs.filter(r=>r.status!=='running');if(finished.length>1000)this.state.runs=this.state.runs.filter(r=>r.status==='running'||finished.indexOf(r)<1000);
  let settle!:()=>void;const job={run,abort,done:new Promise<void>(r=>{settle=r;}),device:device(c),keys:this.keys(c)};this.active.set(instance,job);
  try{await this.preview(instance);}catch(e){this.active.delete(instance);run.status='failed';run.endedAt=new Date().toISOString();run.error='initial persistence failed; execution never started';try{await this.save();}catch{/* Persistence unavailable: never start game execution. */}settle();throw e;}
  const timer=setTimeout(()=>abort.abort(Error('run deadline exceeded')),max*1000);let dirty=false;
  const checkpoint=setInterval(()=>{if(dirty){dirty=false;void this.save().catch(e=>console.error('GameGuy checkpoint failure',e));}},3000);
  const record=(kind:string,data:Json):void=>{run.events.push({at:new Date().toISOString(),kind,data:structuredClone(data)});if(run.events.length>200)run.events.shift();dirty=true;};
  void (async()=>{try{if(abort.signal.aborted)throw Error('stopped before execution');run.result=structuredClone(await p.execute(c.value,plan,{signal:abort.signal,event:(kind,data)=>{record(kind,data);if(!this.closing&&!abort.signal.aborted)options.onEvent?.(kind,data);},preview:async url=>{await this.preview(instance,url);},deliver:async(kind,data)=>{record(kind,data);await this.save();if(!this.closing&&!abort.signal.aborted)try{options.onEvent?.(kind,data);}catch(e){console.error('GameGuy notification failed',e);}}}));run.status=abort.signal.aborted?'stopped':'completed';}catch(e){run.status=abort.signal.aborted?'stopped':'failed';run.error=e instanceof Error?e.message.slice(0,2000):'execution failed';}finally{clearTimeout(timer);clearInterval(checkpoint);run.endedAt=new Date().toISOString();try{await this.save();if(!this.closing)options.onFinish?.(structuredClone(run));}catch(e){console.error('GameGuy completion persistence/notification failure',e);}finally{this.active.delete(instance);settle();}}})();
  return{status:'started',runId:run.id,instance,preview:'/gameguy/preview'};
 }

 /** Agent requests do not launch software. Confirmation is consumed only by the preview UI. */
 async requestDevice(instance:string):Promise<Json>{
  if(this.closing)throw Error('host is closing');const c=this.config(instance),p=this.adapter(c.game);
  this.assertIdle(instance,c);if(this.privateDevice(c))throw Error('privacy pause active');
  const launch=p.deviceLaunch?.(c.value);if(!p.startDevice||!launch)throw Error('Configure a supported emulator executable and instanceIndex first');
  await this.preview(instance);
  if(this.closing||this.plugins.get(c.game)!==p)throw Error('host/plugin unavailable');
  // Recheck after persistence: a concurrent config/task must not receive a stale challenge.
  this.assertIdle(instance,this.config(instance));if(JSON.stringify(c)!==JSON.stringify(this.config(instance)))throw Error('configuration changed; request again');
  if(this.privateDevice(c))throw Error('privacy pause active');
  const fingerprint=JSON.stringify(c);
  this.deviceRequests.set(instance,{token:randomUUID(),expires:Date.now()+300000,fingerprint});
  this.deviceStates.set(instance,{status:'confirmation-required',message:'请在 GameGuy 预览中确认启动所选 MuMu 实例',fingerprint});
  return {status:'confirmation-required',instance,launch,preview:'/gameguy/preview'};
 }
 /** UI-only challenge view: token deliberately absent from Agent status/tool responses. */
 devicePrompt(instance:string):Json{
  const c=this.config(instance),request=this.deviceRequests.get(instance),launch=this.adapter(c.game).deviceLaunch?.(c.value);
  if(!launch||!request||request.expires<Date.now()||request.fingerprint!==JSON.stringify(c)||this.privateDevice(c))return {instance,available:!!launch};
  return {instance,available:!!launch,token:request.token,expiresAt:new Date(request.expires).toISOString(),launch};
 }
 async confirmDevice(instance:string,token:string):Promise<Json>{
  if(this.closing)throw Error('host is closing');const request=this.deviceRequests.get(instance),c=this.config(instance),p=this.adapter(c.game);
  if(!request||request.token!==token||request.expires<Date.now()||request.fingerprint!==JSON.stringify(c))throw Error('启动确认已失效，请重新请求');
  this.assertIdle(instance,c);if(this.privateDevice(c))throw Error('privacy pause active');
  if(!p.startDevice||!p.deviceLaunch?.(c.value))throw Error('device startup unavailable');
  this.deviceRequests.delete(instance);const keys=new Set(this.keys(c)),abort=new AbortController();let settle!:()=>void;
  const job={game:c.game,instance,abort,done:new Promise<void>(r=>{settle=r;})};
  for(const key of keys){this.controls.set(key,job);this.transitions.add(key);}
  const status={status:'starting',message:'准备启动设备',fingerprint:JSON.stringify(c),detail:undefined as Json|undefined};this.deviceStates.set(instance,status);
  void (async()=>{try{
   const result=await p.startDevice!(c.value,abort.signal,message=>{status.message=message.slice(0,1000);});abort.signal.throwIfAborted();
   const next={game:c.game,value:p.parseConfig(result.config)};
   // Fence new observed endpoint before persisting it; never take over a busy/private alias.
   for(const key of this.keys(next))if(!keys.has(key)){
    if(this.transitions.has(key)||this.controls.has(key)||[...this.active.values()].some(j=>j.keys.includes(key))||this.state.privacyDevices.includes(key))throw Error('discovered device is busy or privacy paused');
   }
   for(const key of this.keys(next)){keys.add(key);this.controls.set(key,job);this.transitions.add(key);}
   const previous=this.state.configs[instance]!;this.state.configs[instance]=next;
   try{await this.save();}catch(error){this.state.configs[instance]=previous;throw error;}
   status.fingerprint=JSON.stringify(next);status.detail=result.detail;
   status.status=abort.signal.aborted?'stopped':'ready';status.message=abort.signal.aborted?'启动已停止；模拟器可能仍在运行':'MuMu / ADB 已连接；尚未验证游戏登录或收菜结果';
  }catch(error){status.status=abort.signal.aborted?'stopped':'failed';status.message=error instanceof Error?error.message.slice(0,1000):'device startup failed';}
  finally{for(const key of keys){if(this.controls.get(key)===job)this.controls.delete(key);this.transitions.delete(key);}settle();}})();
  return {status:'starting',instance};
 }
 async stop(instance:string):Promise<Json>{
  checkId(instance);this.deviceRequests.delete(instance);const pending=this.deviceStates.get(instance);if(pending?.status==='confirmation-required'){pending.status='stopped';pending.message='启动请求已取消';}
  const job=this.active.get(instance),controls=[...new Set([...this.controls.values()].filter(j=>j.instance===instance))];
  for(const control of controls)control.abort.abort(Error('user stopped'));job?.abort.abort(Error('user stopped'));
  await Promise.all([...(job?[job.done]:[]),...controls.map(j=>j.done)]);
  return job?{status:job.run.status,runId:job.run.id}:{status:controls.length?'stopped':'idle',instance};
 }
 async screenshot(signal:AbortSignal,selectedInstance?:string):Promise<Buffer>{const instance=selectedInstance??this.state.preview.instance;if(!instance)throw Error('no preview selected');const c=this.config(instance),p=this.adapter(c.game);if(!p.screenshot)throw Error('game supplies structured state/spectator preview, not image stream');const keys=this.keys(c),fingerprint=JSON.stringify(c);if(keys.some(key=>this.transitions.has(key)))throw Error('device configuration/privacy transition pending; capture blocked');if(this.privateDevice(c))throw Error('privacy pause active; capture blocked');const data=await p.screenshot(c.value,signal);if(keys.some(key=>this.transitions.has(key))||JSON.stringify(this.config(instance))!==fingerprint)throw Error('device configuration changed during capture; image discarded');if(this.privateDevice(this.config(instance)))throw Error('privacy pause enabled during capture; image discarded');return data;}
 async control(instance:string,action:Json,signal:AbortSignal):Promise<Json>{if(this.closing)throw Error('host is closing');const c=this.config(instance),p=this.adapter(c.game);this.assertIdle(instance,c);if(this.privateDevice(c))throw Error('privacy pause active; user controls secret entry');if(!p.control)throw Error('manual control unavailable');const keys=this.keys(c),abort=new AbortController();let settle!:()=>void;const job={game:c.game,instance,abort,done:new Promise<void>(r=>{settle=r;})};for(const key of keys)this.controls.set(key,job);try{return await p.control(c.value,action,AbortSignal.any([signal,abort.signal]));}finally{for(const key of keys)this.controls.delete(key);settle();}}
 dispose():Promise<void>{if(this.disposing)return this.disposing;this.closing=true;this.disposing=(async()=>{const jobs=[...this.active.values()],controls=[...this.controls.values()];for(const j of [...jobs,...controls])j.abort.abort();await Promise.all([...jobs,...controls].map(j=>j.done));await Promise.all([...this.plugins.values()].map(p=>this.unregister(p)));await Promise.all([...this.pendingTeardowns]);await this.writes;})();return this.disposing;}
}

