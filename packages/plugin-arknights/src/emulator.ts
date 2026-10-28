/** MuMu lifecycle via its official CLI. Shell-free, selected instance only, no guessed ADB port. */
import { type Json } from '@gameguy/core';
import {backendCommand as command} from './backend-process.js';
import { setTimeout as delay } from 'node:timers/promises';
import { configSchema } from './plan.js';
export interface EmulatorDependencies {
 command: typeof command;
 pause: (ms: number, signal: AbortSignal) => Promise<void>;
 deadlineMs: number;
 pollMs: number;
}
const defaults:EmulatorDependencies={command,pause:async(ms,signal)=>{await delay(ms,undefined,{signal});},deadlineMs:120000,pollMs:1500};
function decode(buffer:Buffer):unknown {
 const text=buffer.toString('utf8').replace(/^\uFEFF/,'').trim();
 let value:unknown;
 if(text.startsWith('{')||text.startsWith('[')){value=JSON.parse(text);checkErrors(value);return value;}
 return text;
}
function checkErrors(value:unknown):void {
 if(!value||typeof value!=='object')return;
 for(const [key,v] of Object.entries(value)){
  if(['errcode','error_code','errorCode','code'].includes(key)&&v!==0&&v!=='0')throw Error('MuMu CLI error: '+key+'='+String(v));
  if(v&&typeof v==='object')checkErrors(v);
 }
}
export function selectedInfo(value:unknown,index:number):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('MuMu instance info unavailable');
 const obj=value as Record<string,unknown>;
 const row=obj[String(index)]??(String(obj.index)===String(index)?obj:undefined);
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Selected MuMu instance not found: '+index);
 const result=row as Record<string,unknown>;
 if(String(result.index)!==String(index))throw Error('MuMu instance identity mismatch');
 checkErrors(result);return result;
}
/** Accept only an actual official CLI connection response, not arbitrary numbers/first adb device. */
export function connectedAddress(value:unknown):string {
 const strings:string[]=[];
 const walk=(v:unknown):void=>{if(typeof v==='string')strings.push(v);else if(v&&typeof v==='object')for(const x of Object.values(v))walk(x);};walk(value);
 const endpoints=new Set<string>();
 for(const text of strings)for(const line of text.split(/\r?\n/)){
  const m=/^(?:already )?connected to (localhost|127\.0\.0\.1):(\d{1,5})$/.exec(line.trim());
  if(m&&Number(m[2])>=1&&Number(m[2])<=65535)endpoints.add('127.0.0.1:'+Number(m[2]));
 }
 if(endpoints.size!==1)throw Error('MuMu did not report one verified local ADB endpoint; no default port will be guessed');
 return [...endpoints][0]!;
}
export async function startMuMu(input:Json,signal:AbortSignal,progress:(message:string)=>void,deps:Partial<EmulatorDependencies>={}):Promise<{config:Json;detail:Json}>{
 const c=configSchema.parse(input),e=c.emulator;if(!e)throw Error('Configure emulator.cliPath and instanceIndex first');
 const d={...defaults,...deps},deadline=AbortSignal.timeout(d.deadlineMs),combined=AbortSignal.any([signal,deadline]);
 const cli=async(args:string[])=>decode(await d.command(e.cliPath,args,combined,15000,256*1024));
 try {
  const info=async()=>selectedInfo(await cli(['info','--vmindex',String(e.instanceIndex)]),e.instanceIndex);
  let row=await info();
  if(row.is_android_started!==true){progress('正在启动 MuMu 实例 '+e.instanceIndex);await cli(['control','--vmindex',String(e.instanceIndex),'launch']);}
  progress('等待 Android 就绪');
  while(row.is_android_started!==true){await d.pause(d.pollMs,combined);row=await info();}
  progress('从 MuMu 官方接口获取实际 ADB 地址');
  let address='';
  while(!address){
   try{
    const candidate=connectedAddress(await cli(['adb','--vmindex',String(e.instanceIndex),'--cmd','connect']));
    await d.command(c.adbPath,['connect',candidate],combined,15000,256*1024);
    const state=(await d.command(c.adbPath,['-s',candidate,'get-state'],combined,15000,256*1024)).toString().trim();
    if(state!=='device')throw Error('Selected MuMu ADB not ready: '+state);
    address=candidate;
   }catch(error){combined.throwIfAborted();progress('等待选定实例的 ADB：'+(error instanceof Error?error.message:'not ready'));await d.pause(d.pollMs,combined);}
  }
  combined.throwIfAborted();progress('设备已连接：'+address+'；尚未验证游戏登录或 MAA 任务');
  return {config:configSchema.parse({...c,address}),detail:{instanceIndex:e.instanceIndex,address,androidVersion:String(row.android_version??'unknown'),verification:'official MuMu endpoint + adb get-state=device; not game/MAA verification'}};
 }catch(error){if(signal.aborted)throw Error('启动已停止；已启动的 MuMu 可能仍在运行，不自动关闭');if(deadline.aborted)throw Error('等待 MuMu/ADB 超时；未确认连接，不执行游戏任务');throw error;}
}
