/** MAA isolated worker plus real ADB screenshots. Product model tools do not expose visual login control. */
import { type GamePlugin, type Json, type GameRuntime } from '@gameguy/core';
import {backendCommand as command,backendEnvironment} from './backend-process.js';
import { access,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { configSchema,planSchema,compileTasks,type ArknightsConfig } from './plan.js';
import { startMuMu,selectedInfo } from './emulator.js';
import { discoverEnvironment } from './discovery.js';
import { requestSchema,preparePlan } from './prepare.js';
import { win32 } from 'node:path';
export const name='gameguy-arknights';
const root=fileURLToPath(new URL('../',import.meta.url));
const get=(c:Json)=>configSchema.parse(c);
async function adb(c:ArknightsConfig,args:string[],signal?:AbortSignal):Promise<Buffer>{return command(c.adbPath,['-s',c.address,...args],signal);}
export async function worker(c:ArknightsConfig,tasks:ReturnType<typeof compileTasks>,runtime:GameRuntime,mode='run'):Promise<Json>{
 runtime.signal.throwIfAborted();const environment=await backendEnvironment();
 return new Promise((resolve,reject)=>{
  if(runtime.signal.aborted){reject(Error('cancelled'));return;}
  const child=spawn(c.python,[join(root,'worker/maa.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:environment});
  let failure:Error|undefined,result:Json|undefined,bytes=0,stderr='',buffer='',stopping=false,killTimer:NodeJS.Timeout|undefined;
  const stop=()=>{if(stopping)return;stopping=true;child.stdin.write(JSON.stringify({type:'stop'})+'\n');killTimer=setTimeout(()=>child.kill(),5000);};
  runtime.signal.addEventListener('abort',stop,{once:true});
  child.stdin.on('error',()=>{/* Child close supplies outcome. */});
  child.stderr.on('data',(b:Buffer)=>{stderr=(stderr+b.toString()).slice(-1000);});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>{
   bytes+=Buffer.byteLength(chunk);
   if(bytes>4*1024*1024){failure=Error('MAA event budget exceeded');child.kill();return;}
   buffer+=chunk;
   for(let end=buffer.indexOf('\n');end!==-1;end=buffer.indexOf('\n')){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    if(Buffer.byteLength(line)>256*1024){failure=Error('MAA line budget exceeded');child.kill();return;}
    try{const msg=z.object({type:z.string(),data:z.json()}).strict().parse(JSON.parse(line));
     if(msg.type==='result')result=msg.data;else if(msg.type==='error')failure=Error(typeof msg.data==='string'?msg.data:'MAA failed');else runtime.event(msg.type,msg.data);
    }catch{failure=Error('invalid MAA worker message');child.kill();return;}
   }
   if(Buffer.byteLength(buffer)>256*1024){failure=Error('MAA line budget exceeded');child.kill();}
  });
  child.on('error',e=>{failure=e;});
  child.on('close',code=>{if(buffer.trim()&&!failure)failure=Error('incomplete MAA worker message');if(killTimer)clearTimeout(killTimer);runtime.signal.removeEventListener('abort',stop);
   if(runtime.signal.aborted)reject(Error('MAA stopped; current action may have taken effect'));else if(failure)reject(failure);else if(code!==0||result===undefined)reject(Error('MAA worker failed: '+code+' '+stderr));else resolve(result);
  });
  child.stdin.write(JSON.stringify({type:mode,config:c,tasks})+'\n');
 });
}
export const adapter:GamePlugin={
 id:'arknights',title:'明日方舟 · MAA',defaults:configSchema.parse({}),parseConfig:input=>configSchema.parse(input),
 configSchema:z.toJSONSchema(configSchema) as Json,planSchema:z.toJSONSchema(planSchema) as Json,
 requestSchema:z.toJSONSchema(requestSchema) as Json,prepare:(config,request)=>JSON.parse(JSON.stringify(preparePlan(config,request))) as Json,
 capabilities:{schedule:true},
 validatePlan:(config,plan)=>{const p=planSchema.parse(plan);compileTasks(get(config),p);return p;},
 setup:discoverEnvironment,
 questions:()=>[],
 deviceKeys:config=>{const e=get(config).emulator;return e?['mumu:'+win32.resolve(e.cliPath).toLowerCase()+':'+e.instanceIndex]:[];},
 deviceLaunch:config=>{const e=get(config).emulator;return e?{executable:e.cliPath,instanceIndex:e.instanceIndex}:undefined;},
 startDevice:startMuMu,
 diagnose:async(config,signal=AbortSignal.timeout(25000))=>{signal.throwIfAborted();const c=get(config),checks:{name:string;ok:boolean;detail:string}[]=[];
  for(const [name,path] of [['MAA',join(c.maaDir,'MaaCore.dll')],['资源',join(c.maaDir,'resource')],['ADB',c.adbPath],...(c.baseMode==='custom'&&c.basePlan?[['基建方案',c.basePlan]]:[])]){try{signal.throwIfAborted();await access(path!);checks.push({name:name!,ok:true,detail:path!});}catch{signal.throwIfAborted();checks.push({name:name!,ok:false,detail:'不存在: '+path});}}
  try{await command(c.python,['--version'],signal,5000,4096);checks.push({name:'Python',ok:true,detail:'可用'});}catch{signal.throwIfAborted();checks.push({name:'Python',ok:false,detail:'需要 64-bit Python 3'});}
  try{const state=(await adb(c,['get-state'],signal)).toString().trim();checks.push({name:'设备',ok:state==='device',detail:state});}catch(e){signal.throwIfAborted();checks.push({name:'设备',ok:false,detail:String(e)});}
  let emulator:Json={state:'not-configured',androidStarted:null};
  if(c.emulator)try{const row=selectedInfo(JSON.parse((await command(c.emulator.cliPath,['info','--vmindex',String(c.emulator.instanceIndex)],signal,5000,256*1024)).toString('utf8').replace(/^\uFEFF/,'').trim()),c.emulator.instanceIndex);emulator={state:row.is_android_started===true?'running':'stopped',androidStarted:row.is_android_started===true,instanceIndex:c.emulator.instanceIndex,source:'official MuMu info; independent from ADB connectivity'};}catch{signal.throwIfAborted();emulator={state:'unknown',androidStarted:null,source:'official MuMu info unavailable; not proof of stopped Android'};}
  signal.throwIfAborted();return {ready:checks.every(x=>x.ok),checks,emulator,deviceOnline:checks.some(x=>x.name==='设备'&&x.ok),connection:'No adb connect issued; use approved device_start to establish connection',login:'首次登录由用户在模拟器完成；密码/验证码不得发到聊天。GameGuy 预览仅供用户观看，不是 Agent 视觉控制。'};
 },
 execute:async(config,plan,runtime)=>{const c=get(config),tasks=compileTasks(c,plan);if(c.baseMode==='custom'&&tasks.some(t=>t.type==='Infrast'))await access(c.basePlan);runtime.event('plan',tasks.map(t=>({type:t.type,params:t.params})));return worker(c,tasks,runtime);},
 screenshot:async(config,signal)=>{const c=get(config),png=await adb(c,['exec-out','screencap','-p'],signal);if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('设备没有返回 PNG 截图');return png;},
 control:async(config,input,signal)=>{const c=get(config);const coord=z.number().int().min(0).max(4095);
  const action=z.discriminatedUnion('type',[
   z.object({type:z.literal('tap'),x:coord,y:coord}).strict(),
   z.object({type:z.literal('swipe'),x:coord,y:coord,x2:coord,y2:coord,durationMs:z.number().int().min(100).max(3000).default(500)}).strict(),
   z.object({type:z.literal('back')}).strict(),z.object({type:z.literal('launch')}).strict(),
  ]).parse(input);
  if(action.type==='launch'){const pkg=c.clientType==='Official'?'com.hypergryph.arknights':'com.hypergryph.arknights.bilibili';await adb(c,['shell','monkey','-p',pkg,'-c','android.intent.category.LAUNCHER','1'],signal);}
  else if(action.type==='back')await adb(c,['shell','input','keyevent','4'],signal);
  else{const args=action.type==='tap'?['tap',String(action.x),String(action.y)]:['swipe',String(action.x),String(action.y),String(action.x2),String(action.y2),String(action.durationMs)];await adb(c,['shell','input',...args],signal);}
  return {status:'sent',action:action.type,verification:'inspect next real screenshot; secret text entry unsupported'};
 },
};
