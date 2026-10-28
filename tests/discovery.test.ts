import test from 'node:test';
import assert from 'node:assert/strict';
import {win32} from 'node:path';
import {discoverEnvironment,type DiscoveryDependencies} from '../packages/plugin-arknights/src/discovery.js';
import {configSchema} from '../packages/plugin-arknights/src/plan.js';
const norm=(p:string)=>win32.normalize(p).toLowerCase();
function fixture(options:{instances?:Record<string,unknown>;registered?:string[];files?:string[];online?:boolean;packages?:string;pythonBits?:number}={}){
 const calls:{exe:string;args:string[]}[]=[],cli='D:/MuMuPlayer/nx_main/mumu-cli.exe';
 const files=new Set((options.files??['D:/Gameguy/external/maa/MaaCore.dll','D:/Gameguy/external/maa/resource','D:/Gameguy/external/platform-tools/adb.exe',cli]).map(norm));
 const deps:Partial<DiscoveryDependencies>={platform:'win32',env:{},exists:async p=>files.has(norm(p)),registryRoots:async()=>options.registered??[],command:async(exe,args,signal)=>{
  signal?.throwIfAborted();calls.push({exe,args});
  if(args[0]==='-c')return Buffer.from(JSON.stringify({path:'C:/Python312/python.exe',bits:options.pythonBits??64,major:3}));
  if(args[0]==='info')return Buffer.from(JSON.stringify(options.instances??{'0':{index:0,name:'测试实例',is_android_started:false}}));
  if(args.includes('get-state'))return Buffer.from(options.online?'device':'offline');
  if(args.includes('packages'))return Buffer.from(options.packages??'');
  throw Error('Unexpected side-effect command: '+args.join(' '));
 }};
 const context={root:'D:/Gameguy',signal:new AbortController().signal,configured:false};return {deps,context,calls,cli};
}
test('MAA discovery resolves unique stopped MuMu and dependencies, asks only channel',async()=>{
 const f=fixture(),r:any=await discoverEnvironment({},f.context,f.deps);
 assert.equal(r.suggestedConfig.emulator.cliPath,f.cli.replaceAll('/','\\'));assert.equal(r.instances[0].instanceIndex,0);
 assert.equal(r.dependenciesReady,true);assert.equal(r.requiresDeviceStart,true);assert.equal(r.ready,false);assert.equal(r.addressVerified,false);
 assert.equal(r.questions.length,1);assert.match(r.questions[0],/官服/);assert.equal(r.suggestedConfig.python,'C:/Python312/python.exe');
 assert(f.calls.every(c=>c.args[0]==='info'||c.args[0]==='-c'));assert(!f.calls.some(c=>c.args.includes('connect')));
});
test('MAA discovery preserves all resource and base-plan choices without asking for a run plan',async()=>{
 const f=fixture(),c=configSchema.parse({medicineLimit:2,expiringMedicineLimit:1,creditShopping:true,onlyDiscount:false,maxFightTimes:3,basePlan:'D:/approved/base.json',basePlanIndex:2,creditBlacklist:['test']});
 const r:any=await discoverEnvironment(c,f.context,f.deps);
 for(const k of ['medicineLimit','expiringMedicineLimit','creditShopping','onlyDiscount','maxFightTimes','basePlan','basePlanIndex','creditBlacklist'])assert.deepEqual(r.suggestedConfig[k],(c as any)[k]);
 assert.equal(r.questions.length,1);assert.match(r.questions[0],/官服/);assert.equal(c.python,'python');
});
test('MAA multiple instances require explicit selection, never first-device selection',async()=>{
 const f=fixture({instances:{'0':{index:0,name:'one'},'2':{index:2,name:'two'}}}),r:any=await discoverEnvironment({},f.context,f.deps);
 assert.equal(r.instances.length,2);assert.equal(r.suggestedConfig.emulator,undefined);assert(r.questions.some((q:string)=>q.includes('多个')));
});
test('MAA configured selection is validated and does not inspect adb for invalid identity',async()=>{
 const f=fixture(),r:any=await discoverEnvironment({emulator:{type:'mumu',cliPath:f.cli,instanceIndex:9}},{...f.context,configured:true},f.deps);
 assert(r.questions.some((q:string)=>q.includes('未通过')));assert.equal(r.deviceOnline,false);assert(!f.calls.some(c=>c.args.includes('get-state')));
});
test('MAA registered Unicode install paths are discovered without recursive scanning',async()=>{
 const install='E:/游戏/木木',cli=install+'/nx_main/mumu-cli.exe';
 const f=fixture({registered:[install],files:[cli,'D:/Gameguy/external/maa/MaaCore.dll','D:/Gameguy/external/maa/resource','D:/Gameguy/external/platform-tools/adb.exe']});
 const r:any=await discoverEnvironment({},f.context,f.deps);assert.equal(norm(r.suggestedConfig.emulator.cliPath),norm(cli));
});
test('MAA missing dependencies and wrong Python architecture fail readiness',async()=>{
 const f=fixture({files:[],pythonBits:32}),r:any=await discoverEnvironment({},f.context,f.deps);
 assert.equal(r.dependenciesReady,false);assert(r.questions.some((q:string)=>q.includes('64 位')));assert(r.questions.some((q:string)=>q.includes('MAA')));assert.equal(r.ready,false);
});
test('MAA only configured online device can identify client channel without connecting',async()=>{
 const f=fixture({online:true,packages:'package:com.hypergryph.arknights.bilibili\n'});
 const r:any=await discoverEnvironment({emulator:{type:'mumu',cliPath:f.cli,instanceIndex:0}},{...f.context,configured:true},f.deps);
 assert.equal(r.suggestedConfig.clientType,'Bilibili');assert.equal(r.channelDetected,true);assert.equal(r.deviceOnline,true);assert.equal(r.questions.length,0);
 assert.equal(r.ready,false);assert(!f.calls.some(c=>c.args.includes('connect')||c.args.includes('control')||c.args.includes('launch')));
 const unconfigured=fixture({online:true});await discoverEnvironment({},unconfigured.context,unconfigured.deps);assert(!unconfigured.calls.some(c=>c.args.includes('get-state')));
});
test('MAA ambiguous installed channels never overwrite an approved selection',async()=>{
 const f=fixture({online:true,packages:'package:com.hypergryph.arknights\npackage:com.hypergryph.arknights.bilibili\n'});
 const r:any=await discoverEnvironment({clientType:'Bilibili'},{...f.context,configured:true},f.deps);assert.equal(r.channelDetected,false);assert.equal(r.suggestedConfig.clientType,'Bilibili');
});
test('MAA pre-cancel discovery does not execute any command',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort(Error('cancelled'));
 await assert.rejects(discoverEnvironment({}, {...f.context,signal:abort.signal},f.deps),/cancelled/);assert.equal(f.calls.length,0);
});
test('MAA late cancellation discards an apparently successful backend result',async()=>{
 const f=fixture(),abort=new AbortController(),command=f.deps.command!;
 f.deps.command=async(...args)=>{const result=await command(...args);if(args[1][0]==='-c')abort.abort(Error('late cancelled'));return result;};
 await assert.rejects(discoverEnvironment({}, {...f.context,signal:abort.signal},f.deps),/late cancelled/);
});

test('running MuMu with disconnected ADB requires connection, never a false stopped claim',async()=>{
 const f=fixture({instances:{'0':{index:'0',is_android_started:true}}});
 const r:any=await discoverEnvironment({emulator:{type:'mumu',cliPath:f.cli,instanceIndex:0}},{...f.context,configured:true},f.deps);
 assert.equal(r.emulatorRunning,true);assert.equal(r.deviceOnline,false);
 assert.equal(r.requiresDeviceStart,false);assert.equal(r.requiresDeviceConnection,true);
 assert.equal(r.instances[0].androidStarted,true);assert(!f.calls.some(c=>c.args.includes('launch')||c.args.includes('connect')));
});
test('ADB startup error does not override official running Android evidence',async()=>{
 const f=fixture({instances:{'0':{index:'0',is_android_started:true}}}),underlying=f.deps.command!;
 f.deps.command=async(...args)=>{if(args[1].includes('get-state'))throw Error('cannot open adb.log: Permission denied');return underlying(...args);};
 const r:any=await discoverEnvironment({emulator:{type:'mumu',cliPath:f.cli,instanceIndex:0}},{...f.context,configured:true},f.deps);
 assert.equal(r.emulatorRunning,true);assert.equal(r.requiresDeviceStart,false);assert.equal(r.requiresDeviceConnection,true);
 assert(r.warnings.some((w:string)=>w.includes('Android 已在运行')));
});
