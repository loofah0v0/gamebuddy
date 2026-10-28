import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {startMuMu,connectedAddress,selectedInfo,type EmulatorDependencies} from '../packages/plugin-arknights/src/emulator.js';
import {configSchema} from '../packages/plugin-arknights/src/plan.js';
const config={emulator:{type:'mumu',cliPath:'D:/MuMuPlayer/nx_main/mumu-cli.exe',instanceIndex:0}};
const info=(ready:boolean)=>Buffer.from(JSON.stringify({'0':{index:'0',is_android_started:ready,android_version:'15.0',error_code:0}}));
const cancelled=new AbortController().signal;
function mock(handler:(exe:string,args:string[],signal?:AbortSignal)=>Promise<Buffer>|Buffer){
 const calls:{exe:string;args:string[]}[]=[];
 const deps:Partial<EmulatorDependencies>={command:async(exe,args,signal)=>{signal?.throwIfAborted();calls.push({exe,args});return handler(exe,args,signal);},pause:async()=>{},deadlineMs:500,pollMs:1};
 return {calls,deps};
}
test('MuMu executable and selected index validated; no arbitrary launcher',()=>{
 assert(configSchema.parse(config).emulator);
 for(const cliPath of ['cmd.exe','D:/evil.exe','\\\\host\\mumu-cli.exe','D:/a/../mumu-cli.exe','D:/mumu-cli.exe" & echo hi'])assert.throws(()=>configSchema.parse({emulator:{...config.emulator,cliPath}}));
 for(const instanceIndex of [-1,10000,0.1])assert.throws(()=>configSchema.parse({emulator:{...config.emulator,instanceIndex}}));
 assert.throws(()=>configSchema.parse({emulator:{...config.emulator,args:['launch']}}));
});
test('official MuMu connection parser rejects guessed, remote, ambiguous and invalid endpoints',()=>{
 assert.equal(connectedAddress('connected to localhost:01234\r\n'),'127.0.0.1:1234');
 assert.equal(connectedAddress({output:'already connected to 127.0.0.1:17520'}),'127.0.0.1:17520');
 for(const s of ['127.0.0.1:16384','daemon 58780','connected to 192.168.1.1:5555','connected to 127.0.0.1:0','connected to 127.0.0.1:65536','connected to 127.0.0.1:1\nconnected to localhost:2','untrusted connected to localhost:5555'])assert.throws(()=>connectedAddress(s));
});
test('MuMu selected info identity and structured error preserved',()=>{
 assert.equal(selectedInfo({'0':{index:'0',is_android_started:false}},0).is_android_started,false);
 assert.throws(()=>selectedInfo({'1':{index:'1'}},0),/not found/);
 assert.throws(()=>selectedInfo({'0':{index:'1'}},0),/mismatch/);
 assert.throws(()=>selectedInfo({'0':{index:'0',error_code:7}},0),/error_code=7/);
});
test('startup launches only selected instance, waits Android and verifies actual ADB before updating config',async()=>{
 let reads=0;const progress:string[]=[];
 const {calls,deps}=mock((_exe,args)=>args[0]==='info'?info(++reads>1):args[0]==='adb'?Buffer.from('connected to localhost:17520'):args.includes('get-state')?Buffer.from('device\r\n'):Buffer.from(''));
 const result=await startMuMu(config,cancelled,m=>progress.push(m),deps);
 assert.equal((result.config as any).address,'127.0.0.1:17520');
 assert.deepEqual(calls.map(c=>c.args),[['info','--vmindex','0'],['control','--vmindex','0','launch'],['info','--vmindex','0'],['adb','--vmindex','0','--cmd','connect'],['connect','127.0.0.1:17520'],['-s','127.0.0.1:17520','get-state']]);
 assert(progress.at(-1)?.includes('尚未验证'));assert(!calls.some(c=>c.args.includes('shell')));
});
test('already ready Android skips native launch; ADB offline retried, no default device fallback',async()=>{
 let states=0;const {calls,deps}=mock((_exe,args)=>args[0]==='info'?info(true):args[0]==='adb'?Buffer.from('{"result":"already connected to 127.0.0.1:18720","error_code":0}'):args.includes('get-state')?Buffer.from(++states===1?'offline':'device'):Buffer.from(''));
 const result=await startMuMu(config,cancelled,()=>{},deps);assert.equal((result.config as any).address,'127.0.0.1:18720');
 assert.equal(states,2);assert(!calls.some(c=>c.args[0]==='control'||c.args[0]==='devices'));
});
test('exit-zero JSON CLI failure is not successful launch',async()=>{
 const {deps}=mock((_exe,args)=>args[0]==='info'?info(false):Buffer.from('{"error_code":12,"message":"launch denied"}'));
 await assert.rejects(startMuMu(config,cancelled,()=>{},deps),/error_code=12/);
});
test('startup deadline and cancellation stop waiting but do not claim emulator shutdown',async()=>{
 const {deps,calls}=mock(()=>info(false));deps.deadlineMs=25;deps.pause=async(ms,signal)=>{await delay(ms,undefined,{signal});};deps.pollMs=10;
 await assert.rejects(startMuMu(config,cancelled,()=>{},deps),/超时/);
 assert(!calls.some(c=>c.args.includes('shutdown')));
 const ac=new AbortController();const other=mock(()=>info(false));other.deps.pause=async(_ms,signal)=>{ac.abort();signal.throwIfAborted();};
 await assert.rejects(startMuMu(config,ac.signal,()=>{},other.deps),/可能仍在运行/);
});
test('missing emulator config and pre-cancelled request never call executable',async()=>{
 const {deps,calls}=mock(()=>info(true));await assert.rejects(startMuMu({},cancelled,()=>{},deps),/Configure emulator/);
 const ac=new AbortController();ac.abort();await assert.rejects(startMuMu(config,ac.signal,()=>{},deps),/启动已停止/);assert.equal(calls.length,0);
});

