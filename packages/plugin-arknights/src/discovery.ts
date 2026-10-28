/** Read-only MAA environment discovery. Never launches/connects/controls a device. */
import { access, stat } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { type Json } from '@gameguy/core';
import {backendCommand as command} from './backend-process.js';
import { configSchema } from './plan.js';
import { selectedInfo } from './emulator.js';
export interface DiscoveryDependencies {
 exists: (path:string, kind?:'file'|'directory')=>Promise<boolean>;
 command: typeof command;
 platform: string;
 registryRoots: (signal:AbortSignal)=>Promise<string[]>;
 env: NodeJS.ProcessEnv;
}
const exists:DiscoveryDependencies['exists']=async(path,kind)=>{try{await access(path);const s=await stat(path);return kind==='directory'?s.isDirectory():kind==='file'?s.isFile():true;}catch{return false;}};
const registryRoots=async(signal:AbortSignal):Promise<string[]>=>{
 const script=`$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $r=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); @(Get-ItemProperty $r | Where-Object { $_.DisplayName -match 'MuMu|木木|明日方舟|MAA' } | ForEach-Object { if($_.InstallLocation){ $_.InstallLocation } }) | ConvertTo-Json -Compress`;
 const bytes=await command('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],signal,7000,128*1024);
 const text=bytes.toString('utf8').replace(/^\uFEFF/,'').trim();if(!text)return [];
 const rows:unknown=JSON.parse(text);return (Array.isArray(rows)?rows:[rows]).filter((s):s is string=>typeof s==='string'&&s.length<1024);
};
const unique=(rows:string[])=>[...new Map(rows.filter(Boolean).map(p=>[win32.normalize(p).toLowerCase(),p])).values()].slice(0,96);
export async function discoverEnvironment(input:Json,context:{root:string;signal:AbortSignal;configured?:boolean},override:Partial<DiscoveryDependencies>={}):Promise<Json>{
 const d:DiscoveryDependencies={exists,command,platform:process.platform,registryRoots,env:process.env,...override};
 const signal=AbortSignal.any([context.signal,AbortSignal.timeout(25000)]),c=configSchema.parse(input);
 const evidence:{kind:string;path?:string;detail:string}[]=[],questions:string[]=[],warnings:string[]=[];
 const check=async(path:string,kind?:'file'|'directory')=>{signal.throwIfAborted();return d.exists(path,kind);};
 let registered:string[]=[];
 if(d.platform==='win32')try{registered=await d.registryRoots(signal);evidence.push({kind:'registry',detail:'Read installation locations for MuMu/MAA only'});}catch{signal.throwIfAborted();warnings.push('安装注册表读取不可用，已继续检查有限常见位置。');}
 const maaCandidates:string[]=[];
 for(const path of unique([c.maaDir,join(context.root,'external/maa'),join(context.root,'MAA'),...registered]))if(await check(join(path,'MaaCore.dll'),'file')&&await check(join(path,'resource'),'directory'))maaCandidates.push(path);
 if(maaCandidates.length){c.maaDir=maaCandidates[0]!;evidence.push({kind:'maa',path:c.maaDir,detail:'MaaCore.dll + resource directory exist; library not loaded'});}else questions.push('没有找到 MAA 库与资源，请选择安装位置或安装可信 MAA 发布包。');
 // Fixed candidates + registered installs; no recursive disk enumeration and no user-file reads.
 const installRoots=unique([...registered,...['C:','D:','E:'].flatMap(drive=>[drive+'/MuMuPlayer',drive+'/Program Files/Netease/MuMuPlayer-12.0',drive+'/Program Files/Netease/MuMuPlayer']),...(d.env.ProgramFiles?[join(d.env.ProgramFiles,'Netease/MuMuPlayer'),join(d.env.ProgramFiles,'Netease/MuMuPlayer-12.0')]:[])]);
 const cliCandidates=unique([...(c.emulator?[c.emulator.cliPath]:[]),...installRoots.flatMap(p=>[join(p,'nx_main/mumu-cli.exe'),join(p,'shell/mumu-cli.exe'),join(p,'nx_device/12.0/shell/mumu-cli.exe'),join(p,'mumu-cli.exe')])]);
 const instances:{cliPath:string;instanceIndex:number;name:string;androidStarted:boolean}[]=[];
 for(const path of cliCandidates){if(!await check(path,'file'))continue;
  try{const bytes=await d.command(path,['info','--vmindex','all'],signal,5000,256*1024);const rows:unknown=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'').trim());
   if(!rows||Array.isArray(rows)||typeof rows!=='object')throw Error('Invalid MuMu info');
   for(const key of Object.keys(rows).slice(0,64)){if(!/^\d{1,4}$/.test(key))continue;const i=Number(key),row=selectedInfo(rows,i);instances.push({cliPath:path,instanceIndex:i,name:String(row.name??'MuMu').slice(0,100),androidStarted:row.is_android_started===true});}
   evidence.push({kind:'mumu',path,detail:'Official CLI info --vmindex all; no launch/adb connect issued'});
  }catch{signal.throwIfAborted();warnings.push('发现 MuMu CLI 但读取实例失败：'+path);}
 }
 const selected=c.emulator?instances.find(i=>win32.normalize(i.cliPath).toLowerCase()===win32.normalize(c.emulator!.cliPath).toLowerCase()&&i.instanceIndex===c.emulator!.instanceIndex):instances.length===1?instances[0]:undefined;
 if(selected)c.emulator={type:'mumu',cliPath:selected.cliPath,instanceIndex:selected.instanceIndex};
 else if(c.emulator)questions.push('已配置 MuMu 实例未通过发现校验，请从有效 instances 中重新选择或修复安装。');
 else if(instances.length>1)questions.push('发现多个 MuMu 实例，请从 instances 中选择要使用的实例（名称/索引），无需寻找程序路径。');
 else if(!instances.length&&!context.configured)questions.push('没有发现可读取的 MuMu 实例；请选择模拟器安装位置或提供已运行的本机 ADB 地址。');
 const adbCandidates=unique([c.adbPath,join(context.root,'external/platform-tools/adb.exe'),...installRoots.map(p=>join(p,'nx_device/12.0/shell/adb.exe'))]);
 const adbFound:string[]=[];for(const path of adbCandidates)if(await check(path,'file'))adbFound.push(path);
 if(adbFound.length){c.adbPath=adbFound[0]!;evidence.push({kind:'adb',path:c.adbPath,detail:'Executable exists; no connection requested'});}else questions.push('没有找到 ADB，请选择 Android platform-tools 的 adb.exe。');
 let pythonOK=false;
 try{const bytes=await d.command(c.python,['-c','import sys,struct,json; print(json.dumps({"path":sys.executable,"bits":struct.calcsize("P")*8,"major":sys.version_info.major}))'],signal,5000,128*1024);const info=JSON.parse(bytes.toString('utf8'));if(info.bits!==64||info.major!==3||typeof info.path!=='string')throw Error('64-bit Python 3 required');c.python=info.path;pythonOK=true;evidence.push({kind:'python',path:info.path,detail:'Executed interpreter self-inspection: 64-bit Python 3'});}catch{signal.throwIfAborted();questions.push('需要可用的 64 位 Python 3，请指定解释器或安装后重试。');}
 // Only inspect an already-online explicitly configured device. Privacy-paused setups are blocked by host.
 let deviceOnline=false,channelDetected=false;
 if(context.configured&&adbFound.length&&(!c.emulator||!!selected))try{
  const state=(await d.command(c.adbPath,['-s',c.address,'get-state'],signal,3000,4096)).toString().trim();deviceOnline=state==='device';
  if(deviceOnline){const text=(await d.command(c.adbPath,['-s',c.address,'shell','pm','list','packages','com.hypergryph.arknights'],signal,3000,16384)).toString();const pkgs=new Set(text.split(/\r?\n/).map(l=>l.trim()));const official=pkgs.has('package:com.hypergryph.arknights'),bilibili=pkgs.has('package:com.hypergryph.arknights.bilibili');if(official!==bilibili){c.clientType=official?'Official':'Bilibili';channelDetected=true;evidence.push({kind:'channel',detail:'Installed Android package identifies '+c.clientType+'; login unknown'});}}
 }catch{signal.throwIfAborted();warnings.push(selected?.androidStarted?'MuMu Android 已在运行，但所选实例的 ADB 尚未连通；不能据此判断模拟器未启动。请经批准的 device_start 复用实例并恢复连接，不重装/重启/关闭它。':'所选实例的 ADB 尚未连通；这不证明模拟器未启动。未连接、未启动、未猜测新的 ADB 端口。');}
 if(!channelDetected&&!context.configured)questions.push('游戏账号使用官服还是 B服？未启动的设备无法自动识别；连接本身不需要刷关或换班方案。');
 signal.throwIfAborted();
 return {suggestedConfig:configSchema.parse(c),instances,questions,warnings,evidence,dependenciesReady:maaCandidates.length>0&&adbFound.length>0&&pythonOK,deviceOnline,channelDetected,emulatorRunning:selected?selected.androidStarted:null,requiresDeviceStart:!!selected&&!selected.androidStarted&&!deviceOnline,requiresDeviceConnection:!!selected&&!deviceOnline,addressVerified:deviceOnline,ready:false,sideEffects:'read installation facts + official info only; no launch/connect/login/game task/config write',next:'Ask only unresolved instance/channel/dependency questions, then gameguy_configure with suggestedConfig; If requiresDeviceConnection, confirm device_start: it reuses already-running Android and only restores ADB; requiresDeviceStart is only true for stopped Android. Never interpret empty stored startup records or sandbox process enumeration as emulator stopped. Diagnose separately. Resource policy is preserved; farming plan is not needed for connection.'};
}
