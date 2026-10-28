from pathlib import Path
p=Path('packages/plugin-arknights/src');p.mkdir(parents=True,exist_ok=True)
(p/'plan.ts').write_text('''/** Validated resource policy; arbitrary MAA task JSON is never accepted. */
import { z } from 'zod';
export const configSchema=z.object({
 maaDir:z.string().default('D:/Gameguy/external/maa'),python:z.string().default('python'),
 adbPath:z.string().default('D:/Gameguy/external/maa/adb.exe'),
 address:z.string().regex(/^(127\\.0\\.0\\.1|localhost):[0-9]{2,5}$/).default('127.0.0.1:16384'),
 connection:z.enum(['General','MuMuEmulator12','MuMuEmulator']).default('General'),
 clientType:z.enum(['Official','Bilibili']).default('Official'),
 basePlan:z.string().default(''),basePlanIndex:z.number().int().min(0).max(50).default(0),
 medicineLimit:z.number().int().min(0).max(10).default(0),
 expiringMedicineLimit:z.number().int().min(0).max(10).default(0),
 creditShopping:z.boolean().default(false),creditBlacklist:z.array(z.string().max(100)).max(30).default([]),
 onlyDiscount:z.boolean().default(true),maxFightTimes:z.number().int().min(1).max(50).default(5),
}).strict();
export type ArknightsConfig=z.infer<typeof configSchema>;
export const planSchema=z.object({
 startup:z.boolean().default(true),daily:z.boolean().default(true),friends:z.boolean().default(true),
 base:z.boolean().default(false),shopping:z.boolean().default(false),
 fight:z.object({stage:z.string().regex(/^[A-Za-z0-9-]{1,30}$/),times:z.number().int().min(1).max(50),medicine:z.number().int().min(0).max(10).default(0),expiringMedicine:z.number().int().min(0).max(10).default(0)}).strict().optional(),
 roguelike:z.object({theme:z.enum(['Phantom','Mizuki','Sami','Sarkaz','JieGarden']),runs:z.number().int().min(1).max(3).default(1),difficulty:z.number().int().min(0).max(18).default(0)}).strict().optional(),
}).strict();
export interface MaaTask { type:string;params:Record<string,string|number|boolean|string[]> }
export function compileTasks(c:ArknightsConfig,input:unknown):MaaTask[]{
 const p=planSchema.parse(input),tasks:MaaTask[]=[];
 if(p.startup)tasks.push({type:'StartUp',params:{client_type:c.clientType,start_game_enabled:true}});
 if(p.base){if(!c.basePlan)throw Error('请先配置并确认已有基建换班方案 basePlan');tasks.push({type:'Infrast',params:{mode:10000,facility:['Mfg','Trade','Power','Control','Reception','Office','Dorm'],drones:'NotUse',replenish:false,filename:c.basePlan,plan_index:c.basePlanIndex}});}
 if(p.fight){const f=p.fight;if(f.times>c.maxFightTimes||f.medicine>c.medicineLimit||f.expiringMedicine>c.expiringMedicineLimit)throw Error('刷取或用药超过已授权策略');tasks.push({type:'Fight',params:{stage:f.stage,times:f.times,medicine:f.medicine,expiring_medicine:f.expiringMedicine,stone:0,client_type:c.clientType,report_to_penguin:false,report_to_yituliu:false}});}
 if(p.shopping&&!c.creditShopping)throw Error('信用购物尚未授权');
 if(p.friends||p.shopping)tasks.push({type:'Mall',params:{visit_friends:p.friends,shopping:p.shopping,buy_first:[],blacklist:c.creditBlacklist,force_shopping_if_credit_full:false,only_buy_discount:c.onlyDiscount,credit_fight:false}});
 if(p.daily)tasks.push({type:'Award',params:{award:true,mail:true,recruit:false,orundum:false,mining:false,specialaccess:false}});
 if(p.roguelike)tasks.push({type:'Roguelike',params:{theme:p.roguelike.theme,mode:0,starts_count:p.roguelike.runs,difficulty:p.roguelike.difficulty,investment_enabled:false,use_support:false}});
 if(!tasks.length)throw Error('计划没有可执行步骤');return tasks;
}
''',encoding='utf-8')
(p/'index.ts').write_text('''/** MAA isolated worker plus real ADB screenshots and bounded login assistance. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-skill';
import { command, type GamePlugin, type Json, type GameRuntime } from '@gameguy/core';
import { access,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { configSchema,compileTasks,type ArknightsConfig } from './plan.js';
export const name='gameguy-arknights';export const inject=['gameguy','skills'];
const root=fileURLToPath(new URL('../',import.meta.url));
const get=(c:Json)=>configSchema.parse(c);
async function adb(c:ArknightsConfig,args:string[],signal?:AbortSignal):Promise<Buffer>{return command(c.adbPath,['-s',c.address,...args],signal);}
export function worker(c:ArknightsConfig,tasks:ReturnType<typeof compileTasks>,runtime:GameRuntime,mode='run'):Promise<Json>{
 return new Promise((resolve,reject)=>{
  if(runtime.signal.aborted){reject(Error('cancelled'));return;}
  const child=spawn(c.python,[join(root,'../worker/maa.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let failure:Error|undefined,result:Json|undefined,bytes=0,stderr='',killTimer:NodeJS.Timeout|undefined;
  const stop=()=>{child.stdin.write(JSON.stringify({type:'stop'})+'\\n');killTimer=setTimeout(()=>child.kill(),5000);};
  runtime.signal.addEventListener('abort',stop,{once:true});
  child.stdin.on('error',()=>{/* Child close supplies outcome. */});
  child.stderr.on('data',(b:Buffer)=>{stderr=(stderr+b.toString()).slice(-1000);});
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{bytes+=Buffer.byteLength(line);if(bytes>4*1024*1024){failure=Error('MAA event budget exceeded');child.kill();return;}
   try{const msg=z.object({type:z.string(),data:z.json()}).strict().parse(JSON.parse(line));
    if(msg.type==='result')result=msg.data;else if(msg.type==='error')failure=Error(typeof msg.data==='string'?msg.data:'MAA failed');else runtime.event(msg.type,msg.data);
   }catch{failure=Error('invalid MAA worker message');child.kill();}
  });
  child.on('error',e=>{failure=e;});
  child.on('close',code=>{lines.close();if(killTimer)clearTimeout(killTimer);runtime.signal.removeEventListener('abort',stop);
   if(runtime.signal.aborted)reject(Error('MAA stopped; current action may have taken effect'));else if(failure)reject(failure);else if(code!==0||result===undefined)reject(Error('MAA worker failed: '+code+' '+stderr));else resolve(result);
  });
  child.stdin.write(JSON.stringify({type:mode,config:c,tasks})+'\\n');
 });
}
export const adapter:GamePlugin={
 id:'arknights',title:'明日方舟 · MAA',defaults:configSchema.parse({}),parseConfig:input=>configSchema.parse(input),
 questions:()=>[],
 diagnose:async config=>{const c=get(config),checks:{name:string;ok:boolean;detail:string}[]=[];
  for(const [name,path] of [['MAA',join(c.maaDir,'MaaCore.dll')],['资源',join(c.maaDir,'resource')],['ADB',c.adbPath],...(c.basePlan?[['基建方案',c.basePlan]]:[])]){try{await access(path!);checks.push({name:name!,ok:true,detail:path!});}catch{checks.push({name:name!,ok:false,detail:'不存在: '+path});}}
  try{await command(c.python,['--version']);checks.push({name:'Python',ok:true,detail:'可用'});}catch{checks.push({name:'Python',ok:false,detail:'需要 64-bit Python 3'});}
  try{await command(c.adbPath,['connect',c.address]);const state=(await adb(c,['get-state'])).toString().trim();checks.push({name:'设备',ok:state==='device',detail:state});}catch(e){checks.push({name:'设备',ok:false,detail:String(e)});}
  return {ready:checks.every(x=>x.ok),checks,login:'MAA 不能首次登录；用户在模拟器内输入密码/验证码，Agent 可导航并截图。'};
 },
 execute:async(config,plan,runtime)=>{const c=get(config),tasks=compileTasks(c,plan);if(c.basePlan)await access(c.basePlan);runtime.event('plan',tasks as Json);return worker(c,tasks,runtime);},
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
export async function apply(ctx:Context):Promise<void>{ctx.effect(()=>ctx.gameguy.register(adapter));const path=join(root,'../skills/arknights/SKILL.md');ctx.effect(()=>ctx.skills.register({name:'gameguy-arknights',description:'明日方舟收菜、刷理智、基建、信用、日常、肉鸽与首次配置。',content:readFileSyncPlaceholder,source:'bundled',provider:name}));}
'''.replace("export async function apply(ctx:Context):Promise<void>{ctx.effect(()=>ctx.gameguy.register(adapter));const path=join(root,'../skills/arknights/SKILL.md');ctx.effect(()=>ctx.skills.register({name:'gameguy-arknights',description:'明日方舟收菜、刷理智、基建、信用、日常、肉鸽与首次配置。',content:readFileSyncPlaceholder,source:'bundled',provider:name}));}","export async function apply(ctx:Context):Promise<void>{ctx.effect(()=>ctx.gameguy.register(adapter));const path=join(root,'../skills/arknights/SKILL.md'),content=await readFile(path,'utf8');ctx.effect(()=>ctx.skills.register({name:'gameguy-arknights',description:'明日方舟收菜、刷理智、基建、信用、日常、肉鸽与首次配置。',content,source:'bundled',provider:name,resourceBase:{kind:'directory',path:join(root,'../skills/arknights')}}));}"),encoding='utf-8')
p=Path('packages/plugin-arknights/worker');p.mkdir(parents=True,exist_ok=True)
(p/'maa.py').write_text('''"""Isolated MAA ABI owner. JSON lines only on stdout; no credentials accepted."""
import ctypes as C
import json, os, sys, threading, time
from pathlib import Path
lock=threading.Lock()
def emit(kind,data):
 with lock:
  print(json.dumps({"type":kind,"data":data},ensure_ascii=False),flush=True)
stop=threading.Event()
def controls():
 for line in sys.stdin:
  try:
   if json.loads(line).get("type")=="stop":stop.set()
  except Exception:stop.set()
 stop.set()
def main():
 request=json.loads(sys.stdin.readline());config=request["config"]
 root=Path(config["maaDir"]).resolve()
 if not root.is_dir():raise RuntimeError("MAA directory missing")
 os.chdir(root)
 dll_directory=os.add_dll_directory(str(root)) if os.name=="nt" else None
 lib=C.CDLL(str(root/"MaaCore.dll"))
 cbtype=C.CFUNCTYPE(None,C.c_int32,C.c_char_p,C.c_void_p)
 done=threading.Event();failed=[];finished=[]
 def callback(msg,payload,_):
  try:
   data=json.loads(payload.decode("utf-8")) if payload else {}
   # Allowlisted progress; exclude account names, UUID, raw adb and OCR payloads.
   safe={k:data[k] for k in ("taskchain","taskid","what","subtask") if k in data}
   safe["msg"]=msg
   if msg in (0,1,10000):failed.append(msg)
   if msg==3:
    finished.extend(data.get("finished_tasks",[]));done.set()
   emit("maa",safe)
  except Exception:
   failed.append(-1)
 cb=cbtype(callback)
 signatures={
  "AsstLoadResource":([C.c_char_p],C.c_uint8),"AsstSetUserDir":([C.c_char_p],C.c_uint8),
  "AsstCreateEx":([cbtype,C.c_void_p],C.c_void_p),"AsstDestroy":([C.c_void_p],None),
  "AsstAsyncConnect":([C.c_void_p,C.c_char_p,C.c_char_p,C.c_char_p,C.c_uint8],C.c_int32),
  "AsstConnected":([C.c_void_p],C.c_uint8),"AsstAppendTask":([C.c_void_p,C.c_char_p,C.c_char_p],C.c_int32),
  "AsstStart":([C.c_void_p],C.c_uint8),"AsstStop":([C.c_void_p],C.c_uint8),"AsstRunning":([C.c_void_p],C.c_uint8),
  "AsstGetVersion":([],C.c_char_p)}
 for name,(args,ret) in signatures.items():
  f=getattr(lib,name);f.argtypes=args;f.restype=ret
 if not lib.AsstSetUserDir(str(root).encode()):raise RuntimeError("MAA user directory rejected")
 if not lib.AsstLoadResource(str(root).encode()):raise RuntimeError("MAA resources rejected")
 emit("backend",{"version":lib.AsstGetVersion().decode()})
 if request["type"]=="version":emit("result",{"version":lib.AsstGetVersion().decode(),"resourceLoaded":True});return
 threading.Thread(target=controls,daemon=True).start()
 handle=lib.AsstCreateEx(cb,None)
 if not handle:raise RuntimeError("MAA instance initialization failed")
 try:
  lib.AsstAsyncConnect(handle,config["adbPath"].encode(),config["address"].encode(),config["connection"].encode(),1)
  if stop.is_set():raise RuntimeError("stopped before start")
  if not lib.AsstConnected(handle):raise RuntimeError("MAA device connection failed; run diagnosis")
  ids=[]
  for task in request["tasks"]:
   tid=lib.AsstAppendTask(handle,task["type"].encode(),json.dumps(task["params"]).encode())
   if tid<=0:raise RuntimeError("MAA task rejected: "+task["type"])
   ids.append(tid)
  if not lib.AsstStart(handle):raise RuntimeError("MAA start failed")
  while not done.wait(0.1):
   if stop.is_set():lib.AsstStop(handle);raise RuntimeError("MAA stopped; last action outcome unknown")
   if not lib.AsstRunning(handle):
    if not done.wait(2):raise RuntimeError("MAA ended without completion receipt")
  if failed:raise RuntimeError("MAA reported task chain/internal failure; partial progress retained")
  if any(tid not in finished for tid in ids):raise RuntimeError("MAA completion receipt missing planned task IDs")
  emit("result",{"status":"backend-completed","finishedTaskIds":finished,"rewardsIndependentlyVerified":False})
 finally:
  lib.AsstStop(handle);lib.AsstDestroy(handle)
if __name__=="__main__":
 try:main()
 except Exception as error:
  emit("error",str(error));sys.exit(1)
''',encoding='utf-8')
