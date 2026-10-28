import os,json
root=r'D:\Gameguy'
def put(p,s):
 p=os.path.join(root,p);os.makedirs(os.path.dirname(p),exist_ok=True);open(p,'w',encoding='utf8').write(s.lstrip('\n'))
put('.gitignore','node_modules/\n.runtime/\ndownloads/\nexternal/\npackages/*/lib/\npackages/*/*.tsbuildinfo\n*.log\n.env\nconfig/private*\ndsh/\n')
put('tsconfig.json',json.dumps({'compilerOptions':{'target':'ES2022','module':'NodeNext','moduleResolution':'NodeNext','strict':True,'esModuleInterop':True,'skipLibCheck':True,'declaration':True,'sourceMap':True,'outDir':'lib','types':['node']},'files':[],'references':[{'path':'packages/'+p} for p in ['core','plugin-clawclaw','plugin-minecraft','plugin-arknights']]},indent=2))
for p,n in [('core','core'),('plugin-clawclaw','clawclaw'),('plugin-minecraft','minecraft'),('plugin-arknights','arknights')]:
 deps={'@deepseek-ai/cordis':'4.0.5','@deepseek-ai/dsh-tools':'0.2.1-rc.2','zod':'4.3.6'}
 if p!='core':deps['@gameguy/core']='0.1.0'
 if p=='plugin-minecraft':deps.update({'mineflayer':'4.39.0','mineflayer-pathfinder':'2.4.5'})
 if p=='plugin-clawclaw':deps['@deepseek-ai/dsh-skill']='0.2.1-rc.2'
 manifest={'name':'@gameguy/'+n,'version':'0.1.0','type':'module','main':'lib/index.js','types':'lib/index.d.ts','engines':{'dsh':'0.2.1-rc.2'},'exports':{'.':'./lib/index.js','./package.json':'./package.json'},'files':['lib','cordis.patch.yml','skills','worker'],'dependencies':deps,'dsh':{'bundle':{'patch':'./cordis.patch.yml'}}}
 if p=='core':
  manifest['exports']['./client']='./lib/client.js';manifest['dsh']['client']={'inject':['@deepseek-ai/dsh-client-ui-sidebar-right','@deepseek-ai/dsh-client-ui-sidebar-browser'],'platform':'web'}
 put('packages/'+p+'/package.json',json.dumps(manifest,indent=2))
 put('packages/'+p+'/tsconfig.json',json.dumps({'extends':'../../tsconfig.json','compilerOptions':{'composite':True,'rootDir':'src','outDir':'lib'},'include':['src/**/*.ts'],'references':[] if p=='core' else [{'path':'../core'}]},indent=2))
 put('packages/'+p+'/cordis.patch.yml',f'- insert:\n    - id: gameguy-{n}\n      name: "@gameguy/{n}"\n'+('      config:\n        dataDir: D:/Gameguy/.runtime/gameguy\n        catalogRoot: D:/Gameguy/packages\n        autoInstallTrusted: true\n' if p=='core' else ''))
put('packages/core/src/contracts.ts',r'''
/** Shared contract: game adapters supply capabilities, not an agent loop. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface GameRuntime {
  signal: AbortSignal;
  event: (kind: string, data: Json) => void;
}
export interface GamePlugin {
  id: string;
  title: string;
  defaults: Json;
  parseConfig: (input: unknown) => Json;
  questions: (config: Json) => string[];
  diagnose: (config: Json) => Promise<Json>;
  execute: (config: Json, plan: Json, runtime: GameRuntime) => Promise<Json>;
  screenshot?: (config: Json, signal: AbortSignal) => Promise<Buffer>;
  control?: (config: Json, action: Json, signal: AbortSignal) => Promise<Json>;
  dispose?: () => Promise<void>;
}
export interface RunRecord {
  id: string; game: string; instance: string; occurrence?: string;
  startedAt: string; endedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted';
  events: { at: string; kind: string; data: Json }[];
  result?: Json; error?: string;
}
export const catalog = [
  { id: 'arknights', title: '明日方舟 · MAA', package: '@gameguy/arknights', folder: 'plugin-arknights', kind: 'native-library' },
  { id: 'minecraft', title: 'Minecraft · Mineflayer', package: '@gameguy/minecraft', folder: 'plugin-minecraft', kind: 'protocol' },
  { id: 'clawclaw', title: '龙虾杀 · 官方 Skill', package: '@gameguy/clawclaw', folder: 'plugin-clawclaw', kind: 'skill' },
] as const;
''')
put('packages/core/src/process.ts',r'''
/** Run bounded subprocesses without a shell and without retaining command arguments. */
import { spawn } from 'node:child_process';
export function command(file: string, args: string[], signal?: AbortSignal, timeoutMs = 20000, maxBytes = 8 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('cancelled')); return; }
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let bytes = 0; let err = ''; let failure: Error | undefined;
    const stop = (reason: string): void => { failure ??= new Error(reason); child.kill(); };
    const cancel = (): void => stop('cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop('process deadline exceeded'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) stop('output limit exceeded'); else chunks.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-2000); });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure); else if (code !== 0) reject(new Error(`process exit ${code}: ${err}`)); else resolve(Buffer.concat(chunks));
    });
  });
}
''')
put('packages/core/src/engine.ts',r'''
/** Persistent runs, per-instance locks, bounded events and crash-aware deduplication. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catalog, type GamePlugin, type Json, type RunRecord } from './contracts.js';
interface State { configs: Record<string, { game: string; value: Json }>; runs: RunRecord[]; preview: { revision: number; game?: string; instance?: string; url?: string } }
const validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
export function checkId(id: string): void { if (!validId.test(id)) throw new Error('invalid instance identifier'); }
export class Engine {
  readonly plugins = new Map<string, GamePlugin>();
  private state: State = { configs: {}, runs: [], preview: { revision: 0 } };
  private active = new Map<string, { run: RunRecord; abort: AbortController; done: Promise<void> }>();
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly dataDir: string) {}
  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    try { this.state = JSON.parse(await readFile(join(this.dataDir, 'state.json'), 'utf8')) as State; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    for (const run of this.state.runs) if (run.status === 'running') { run.status = 'interrupted'; run.error = 'host stopped; execution outcome unknown; not automatically retried'; run.endedAt = new Date().toISOString(); }
    await this.save();
  }
  private save(): Promise<void> {
    const body = JSON.stringify(this.state, null, 2);
    this.writes = this.writes.then(async () => {
      const file = join(this.dataDir, 'state.json'), tmp = file + '.tmp';
      await writeFile(tmp, body, { mode: 0o600 }); await rename(tmp, file);
    });
    return this.writes;
  }
  register(plugin: GamePlugin): () => void {
    if (this.plugins.has(plugin.id)) throw new Error('duplicate game plugin');
    this.plugins.set(plugin.id, plugin);
    return () => { this.plugins.delete(plugin.id); for (const job of this.active.values()) if (job.run.game === plugin.id) job.abort.abort(); };
  }
  list(): Json { return catalog.map(item => ({ ...item, enabled: this.plugins.has(item.id) })); }
  adapter(game: string): GamePlugin { const p = this.plugins.get(game); if (!p) throw new Error(`plugin not enabled: ${game}; use gameguy_install first`); return p; }
  async configure(game: string, instance: string, input: unknown): Promise<Json> {
    checkId(instance); if (this.active.has(instance)) throw new Error('stop the running instance before configuration changes');
    const plugin = this.adapter(game); const existing = this.state.configs[instance];
    if (existing && existing.game !== game) throw new Error('instance belongs to another game');
    const value = plugin.parseConfig(input); this.state.configs[instance] = { game, value };
    await this.save(); return { instance, game, config: value, missing: plugin.questions(value) };
  }
  config(instance: string): { game: string; value: Json } {
    checkId(instance); const c = this.state.configs[instance]; if (!c) throw new Error('configure instance first'); return c;
  }
  async diagnose(game: string, instance?: string): Promise<Json> {
    const p = this.adapter(game); return p.diagnose(instance ? this.config(instance).value : p.defaults);
  }
  async preview(instance: string, url?: string): Promise<Json> {
    const c = this.config(instance);
    if (url) { const u = new URL(url); if (c.game !== 'clawclaw' || u.protocol !== 'https:' || !(u.hostname === 'myclaw.163.com' || u.hostname.endsWith('.myclaw.163.com'))) throw new Error('only official ClawClaw spectator HTTPS URLs allowed'); }
    this.state.preview = { revision: this.state.preview.revision + 1, instance, game: c.game, ...(url ? { url } : {}) }; await this.save();
    return { status: 'requested', preview: '/gameguy/preview', instance };
  }
  snapshot(): Json { return JSON.parse(JSON.stringify({ catalog: this.list(), ...this.state, configs: Object.entries(this.state.configs).map(([id,c]) => ({ id, game: c.game })) })) as Json; }
  async run(instance: string, plan: Json, options: { maxSeconds?: number; occurrence?: string; dueAt?: string } = {}): Promise<Json> {
    const c = this.config(instance), p = this.adapter(c.game);
    const maxSeconds = options.maxSeconds ?? 900;
    if (!Number.isInteger(maxSeconds) || maxSeconds < 10 || maxSeconds > 7200) throw new Error('maxSeconds must be 10..7200');
    if (options.occurrence !== undefined) {
      if (!options.dueAt) throw new Error('scheduled runs require dueAt and occurrence');
      const due = Date.parse(options.dueAt); if (!Number.isFinite(due)) throw new Error('invalid dueAt');
      if (due > Date.now() + 60000) throw new Error('scheduled occurrence is in future');
      if (Date.now() - due > 30 * 60 * 1000) return { status: 'skipped-late', instance };
      const old = this.state.runs.find(r => r.instance === instance && r.occurrence === options.occurrence);
      if (old) return { status: 'duplicate', run: old as unknown as Json };
    }
    if (this.active.has(instance)) throw new Error('instance is busy');
    if (p.questions(c.value).length) throw new Error(`missing configuration: ${p.questions(c.value).join('; ')}`);
    // One MAA device may not run two profiles concurrently.
    for (const job of this.active.values()) {
      const other = this.config(job.run.instance);
      if (other.game === c.game && c.game === 'arknights' && (other.value as Record<string,Json>).address === (c.value as Record<string,Json>).address) throw new Error('game device is busy');
    }
    const abort = new AbortController();
    const run: RunRecord = { id: randomUUID(), game: c.game, instance, ...(options.occurrence ? { occurrence: options.occurrence } : {}), startedAt: new Date().toISOString(), status: 'running', events: [] };
    this.state.runs.unshift(run);
    const finished = this.state.runs.filter(r => r.status !== 'running');
    if (finished.length > 1000) this.state.runs = this.state.runs.filter(r => r.status === 'running' || finished.indexOf(r) < 1000);
    const job = { run, abort, done: Promise.resolve() };
    this.active.set(instance, job);
    try { await this.save(); } catch (e) { this.active.delete(instance); throw e; }
    await this.preview(instance);
    const timer = setTimeout(() => abort.abort(new Error('run deadline exceeded')), maxSeconds * 1000);
    job.done = (async () => {
      try {
        run.result = await p.execute(c.value, plan, { signal: abort.signal, event: (kind,data) => { run.events.push({ at: new Date().toISOString(), kind, data }); if (run.events.length > 200) run.events.shift(); } });
        run.status = abort.signal.aborted ? 'stopped' : 'completed';
      } catch (e) { run.status = abort.signal.aborted ? 'stopped' : 'failed'; run.error = e instanceof Error ? e.message.slice(0,2000) : 'execution failed'; }
      finally { clearTimeout(timer); run.endedAt = new Date().toISOString(); this.active.delete(instance); await this.save(); }
    })();
    // Retain completion failures as diagnostics rather than an unhandled rejection.
    job.done.catch(e => console.error('GameGuy run persistence failure', e));
    return { status: 'started', runId: run.id, instance, preview: '/gameguy/preview' };
  }
  async stop(instance: string): Promise<Json> {
    checkId(instance); const job = this.active.get(instance); if (!job) return { status: 'idle', instance };
    job.abort.abort(new Error('user stopped')); await job.done; return { status: job.run.status, runId: job.run.id };
  }
  async screenshot(signal: AbortSignal): Promise<Buffer> {
    const instance = this.state.preview.instance; if (!instance) throw new Error('no preview selected');
    const c = this.config(instance), p = this.adapter(c.game); if (!p.screenshot) throw new Error('this game provides structured state or spectator preview, not an image stream');
    return p.screenshot(c.value, signal);
  }
  async control(instance: string, action: Json, signal: AbortSignal): Promise<Json> {
    if (this.active.has(instance)) throw new Error('stop automation before manual takeover');
    const c = this.config(instance), p = this.adapter(c.game); if (!p.control) throw new Error('manual control unavailable');
    return p.control(c.value, action, signal);
  }
  async dispose(): Promise<void> { for (const job of this.active.values()) job.abort.abort(); await Promise.all([...this.active.values()].map(j=>j.done)); await this.writes; }
}
''')
put('packages/core/src/preview.ts',r'''
/** Same-origin, authenticated actual-image preview; no dummy game video. */
export const previewHtml = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GameGuy · 游戏现场</title>
<style>body{margin:0;background:#10131a;color:#e7edf5;font:14px system-ui}header{padding:16px;display:flex;justify-content:space-between;border-bottom:1px solid #303848}h2{margin:0;color:#70e0b2}section{padding:16px}img{width:100%;object-fit:contain;max-height:58vh;background:#080b10}button,a{background:#274653;border:1px solid #446575;color:white;padding:8px;border-radius:6px}pre{white-space:pre-wrap;font:12px monospace;max-height:28vh;overflow:auto}small{color:#a8b2c0}.error{color:#ffbb82}</style>
<header><h2>GameGuy</h2><button id="stop">停止 / 接管</button></header><section><p id="info">等待选择游戏实例</p><img id="screen" hidden><p id="notice"></p><small id="time"></small><pre id="events"></pre></section>
<script>
let current,refreshing=false;
const el=id=>document.getElementById(id);
async function refresh(){if(refreshing)return;refreshing=true;try{
 const r=await fetch('/gameguy/state',{cache:'no-store'});if(!r.ok)throw Error('需要登录 DSH，或 GameGuy 未启用');const s=await r.json();current=s.preview.instance;
 const run=s.runs.find(x=>x.instance===current);el('info').textContent=current?current+' · '+s.preview.game+' · '+(run?.status||'idle'):'等待通过对话配置并选择实例';
 el('events').textContent=run?JSON.stringify({result:run.result,error:run.error,events:run.events.slice(-8)},null,2):'插件：'+s.catalog.map(x=>x.title+(x.enabled?' ✓':' · 未安装/启用')).join('\n');
 if(s.preview.url){el('screen').hidden=true;el('notice').replaceChildren();const a=document.createElement('a');a.href=s.preview.url;a.target='_blank';a.rel='noopener';a.textContent='官方观战页面（若嵌入受限，可在新窗口打开）';el('notice').append(a);}
 else if(s.preview.game==='arknights'){
  const img=await fetch('/gameguy/image',{cache:'no-store'});if(!img.ok)throw Error(await img.text());const blob=await img.blob();const prev=el('screen').src;el('screen').src=URL.createObjectURL(blob);if(prev.startsWith('blob:'))URL.revokeObjectURL(prev);el('screen').hidden=false;el('notice').textContent='真实 ADB 截图 · 非视频直播';el('time').textContent='更新于 '+new Date().toLocaleTimeString();
 }else{el('screen').hidden=true;el('notice').textContent=s.preview.game==='minecraft'?'Mineflayer 结构化状态（本版不自研 3D 渲染器）':'';}
}catch(e){el('notice').textContent=e.message;el('notice').className='error';el('screen').hidden=true;}finally{refreshing=false;}}
el('stop').onclick=async()=>{if(current){await fetch('/gameguy/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instance:current})});await refresh();}};
refresh();setInterval(refresh,2000);
</script></html>`;
''')
put('packages/core/src/client.ts',r'''
/** Open the existing DSH browser sidebar when the host selects a game preview. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client';
export const inject = ['sidebarRight', 'sidebarRightTabs'];
export function apply(ctx: Context): void {
  let revision = -1, running = false, disposed = false;
  const poll = async (): Promise<void> => {
    if (running || disposed) return; running = true;
    try {
      const res = await fetch('/gameguy/state', { cache: 'no-store' }); if (!res.ok || disposed) return;
      const state = await res.json() as { preview: { revision: number; instance?: string; url?: string } };
      if (!state.preview.instance || state.preview.revision === revision || disposed) return;
      const url = state.preview.url ?? new URL('/gameguy/preview', location.origin).href;
      const opened = ctx.sidebarRight.openTab('browser', { params: { url } });
      if (opened) revision = state.preview.revision;
    } catch { /* Session not mounted or transport unavailable: retry, without a fake success. */ }
    finally { running = false; }
  };
  ctx.effect(() => { const timer = setInterval(() => { void poll(); }, 2000); void poll(); return () => { disposed = true; clearInterval(timer); }; });
}
''')
put('packages/core/src/index.ts',r'''
/** GameGuy platform Cordis plugin: tools, lifecycle and fenced preview routes. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-plugin-manager';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { Engine } from './engine.js';
import { catalog, type Json } from './contracts.js';
import { previewHtml } from './preview.js';
export * from './contracts.js';
export { Engine } from './engine.js';
export { command } from './process.js';
export const name = 'gameguy-core';
export const inject = ['tools', 'webServer', 'connection', 'pluginManager'];
export interface Config { dataDir: string; catalogRoot: string; autoInstallTrusted?: boolean }
declare module '@deepseek-ai/cordis' { interface Context { gameguy: Engine } }
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const record = z.record(z.string(), z.json());
export async function apply(ctx: Context, config: Config): Promise<void> {
  const engine = new Engine(config.dataDir); await engine.init(); ctx.set('gameguy', engine);
  ctx.effect(() => () => engine.dispose());
  const register = (toolName: string, description: string, execute: (input: unknown, signal: AbortSignal) => Promise<Json>): void => {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: toolName, description,
      parameters: { input: { type: 'json', required: true, description: 'Strict JSON object; allowed keys are documented in the tool description.' } },
      output: { schema: { type: 'json' }, render: (_args,value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args,exec) => execute(args.input, exec.signal),
    })));
  };
  register('gameguy_catalog','Discover trusted game plugins. input: {}. Install missing plugin before configuration.',async input=>{z.object({}).strict().parse(input);return engine.list();});
  register('gameguy_install','Install/enable one trusted packaged plugin using the native DSH plugin manager. input: {game:arknights|minecraft|clawclaw,confirmed?:boolean}. Arbitrary URLs and shell installers not allowed. Never approve dependency builds silently.',async input=>{
    const a=z.object({game:z.enum(['arknights','minecraft','clawclaw']),confirmed:z.boolean().optional()}).strict().parse(input);
    if(!config.autoInstallTrusted && !a.confirmed) return {status:'confirmation-required'};
    if(engine.plugins.has(a.game)) return {status:'enabled',game:a.game};
    const item=catalog.find(x=>x.id===a.game)!;
    const result=await ctx.pluginManager.installBundle('link:'+join(config.catalogRoot,item.folder),{enabled:true});
    return JSON.parse(JSON.stringify(result)) as Json;
  });
  register('gameguy_setup','Get defaults and missing configuration questions. input: {game,instance?}. Ask only missing values; never ask for passwords or verification codes in chat.',async input=>{
    const a=z.object({game:z.string(),instance:id.optional()}).strict().parse(input),p=engine.adapter(a.game);
    const value=a.instance?engine.config(a.instance).value:p.defaults; return {game:a.game,config:value,questions:p.questions(value)};
  });
  register('gameguy_configure','Save complete validated game configuration after conversation. input: {game,instance,config:{...}}. Inspect setup defaults/schema first. Resource-spending options require explicit user consent. Passwords/OTP rejected.',async input=>{
    const a=z.object({game:z.string(),instance:id,config:record}).strict().parse(input);return engine.configure(a.game,a.instance,a.config);
  });
  register('gameguy_diagnose','Check backend, device/server and required dependencies. input: {game,instance?}. Failure is not successful connection.',async input=>{const a=z.object({game:z.string(),instance:id.optional()}).strict().parse(input);return engine.diagnose(a.game,a.instance);});
  register('gameguy_run','Start a bounded task and return runId. input: {instance,plan:{...},maxSeconds?:10..7200,occurrence?:string,dueAt?:ISO}. Plan keys depend on the game Skill. Completion means backend finished, not independently verified game rewards. For schedules use instance + canonical occurrence date key and dueAt; missed >30min skip. Do not retry interrupted spending operations automatically.',async input=>{
    const a=z.object({instance:id,plan:record,maxSeconds:z.number().int().min(10).max(7200).optional(),occurrence:z.string().max(128).optional(),dueAt:z.string().optional()}).strict().parse(input);
    return engine.run(a.instance,a.plan,a);
  });
  register('gameguy_status','Get active runs, bounded events and result history. input: {}.',async input=>{z.object({}).strict().parse(input);return engine.snapshot();});
  register('gameguy_stop','Stop automation and release its device before takeover. input: {instance}.',async input=>{const a=z.object({instance:id}).strict().parse(input);return engine.stop(a.instance);});
  register('gameguy_preview','Open actual screenshot dashboard or official ClawClaw watch page in DSH right browser. input: {instance,url?:official spectator HTTPS URL}. No fabricated game frames.',async input=>{const a=z.object({instance:id,url:z.string().optional()}).strict().parse(input);return engine.preview(a.instance,a.url);});
  register('gameguy_control','Bounded device login assistance/takeover only while automation is stopped. input: {instance,action:{type:tap|swipe|back|launch,x?,y?,x2?,y2?,durationMs?}}. Cannot input or store passwords/OTP. User handles captcha and secret entry. See game preview before acting.',async(input,signal)=>{const a=z.object({instance:id,action:record}).strict().parse(input);return engine.control(a.instance,a.action,signal);});
  const connection=ctx.get('connection') as {requestRejection:(req:{headers:IncomingMessage['headers']})=>401|403|undefined};
  for (const path of ['/gameguy/state','/gameguy/preview','/gameguy/image','/gameguy/stop']) ctx.effect(()=>ctx.webServer.register({kind:'exact',path,handler:async(req,res)=>{
    const reject=connection.requestRejection(req);if(reject){res.statusCode=reject;res.end();return;}
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
    try {
      if(path==='/gameguy/stop'){
        if(req.method!=='POST'){res.statusCode=405;res.end();return;}
        if(!req.headers['content-type']?.startsWith('application/json')){res.statusCode=415;res.end();return;}
        let body='';for await(const chunk of req){body+=String(chunk);if(body.length>1024)throw Error('body too large');}
        const a=z.object({instance:id}).strict().parse(JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify(await engine.stop(a.instance)));return;
      }
      if(req.method!=='GET'){res.statusCode=405;res.end();return;}
      if(path==='/gameguy/image'){const abort=new AbortController();res.on('close',()=>abort.abort());const img=await engine.screenshot(abort.signal);res.setHeader('content-type','image/png');res.end(img);}
      else if(path==='/gameguy/preview'){res.setHeader('content-type','text/html; charset=utf-8');res.end(previewHtml);}
      else{res.setHeader('content-type','application/json');res.end(JSON.stringify(engine.snapshot()));}
    }catch(e){res.statusCode=409;res.setHeader('content-type','text/plain; charset=utf-8');res.end(e instanceof Error?e.message:'request failed');}
  }}));
}
''')
# Package shared helper exports must be explicitly usable.
p=os.path.join(root,'packages/core/package.json');m=json.load(open(p,encoding='utf8'));m['exports']['./process']='./lib/process.js';open(p,'w',encoding='utf8').write(json.dumps(m,indent=2))
print('Created GameGuy core + manifests')
