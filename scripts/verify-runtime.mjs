/** Real MaaCore initialization + loopback Mineflayer protocol fixtures. No game/account/model. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve,join} from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import protocol from 'minecraft-protocol';
import {adapter,execute} from '../packages/plugin-minecraft/lib/index.js';
const root=resolve(import.meta.dirname,'..');
const report={scope:'MAA DLL/resources and local protocol fixtures ONLY; no real game, model or accounts',checks:[]};
function pass(name,detail){report.checks.push({name,detail,status:'passed'});console.log('PASS '+name);}
async function maaProbe(){
 const child=spawn(process.env.GAMEGUY_PYTHON??'python',[join(root,'packages/plugin-arknights/worker/maa.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='',failure;const timer=setTimeout(()=>{failure=Error('MAA initialization deadline exceeded');child.kill();},30000);
 child.stdout.on('data',chunk=>{out+=chunk;if(out.length>1024*1024){failure=Error('MAA output budget exceeded');child.kill();}});
 child.stderr.on('data',chunk=>{err=(err+chunk).slice(-2000);});
 child.on('error',e=>{failure=e;});
 child.stdin.on('error',()=>{});
 child.stdin.end(JSON.stringify({type:'version',config:{maaDir:join(root,'external/maa')}})+'\n');
 const [code]=await once(child,'close').finally(()=>clearTimeout(timer));
 if(failure)throw failure;assert.equal(code,0,err);
 const result=out.trim().split(/\r?\n/).map(x=>JSON.parse(x)).find(x=>x.type==='result');
 assert(result?.data.resourceLoaded);assert.match(result.data.version,/^v?\d+\.\d+\.\d+/);
 pass('real MaaCore DLL / ABI / resource initialization',{...result.data,deviceConnected:false,tasksExecuted:false});
}
async function minecraftProbe(){
 const server=protocol.createServer({host:'127.0.0.1',port:0,version:'1.8.9','online-mode':false,hideErrors:true,motd:'GameGuy LOCAL TEST FIXTURE'});
 const errors=[];const timers=new Set();let mode='observe',joined=0;
 server.on('error',e=>errors.push(e.message));
 server.on('connection',client=>client.on('error',e=>errors.push(e.message)));
 server.on('playerJoin',client=>{
  joined++;
  client.write('login',{entityId:client.id,gameMode:0,dimension:0,difficulty:0,maxPlayers:3,levelType:'default',reducedDebugInfo:false});
  client.write('position',{x:8,y:64,z:8,yaw:0,pitch:0,flags:0});
  client.write('update_health',{health:20,food:20,foodSaturation:5});
  if(mode==='disconnect'){const t=setTimeout(()=>{timers.delete(t);client.end('deliberate local fixture disconnect');},250);timers.add(t);}
 });
 try{
  await once(server,'listening');const port=server.socketServer.address().port;
  assert.equal(server.socketServer.address().address,'127.0.0.1');
  const config={host:'127.0.0.1',port,version:'1.8.9',username:'GameGuyFixture'};
  assert.equal((await adapter.diagnose(config)).ready,true);
  const events=[],controller=new AbortController();
  const result=await execute(config,{action:'observe',seconds:1},{signal:controller.signal,event:(kind,data)=>events.push({kind,data}),preview:async()=>{},deliver:async()=>{}});
  assert.equal(result.outcome,'backend-completed');assert.equal(result.action,'observe');assert.equal(result.state.health,20);assert.equal(result.state.food,20);assert.deepEqual(result.state.position,{x:8,y:64,z:8});assert(events.some(x=>x.kind==='minecraft-state'));
  pass('Mineflayer real loopback login / spawn / state / observe',{version:'1.8.9',result,events:events.length,fixture:true});
  mode='disconnect';
  await assert.rejects(execute(config,{action:'observe',seconds:5},{signal:new AbortController().signal,event:()=>{},preview:async()=>{},deliver:async()=>{}}),/disconnected/);
  pass('Mineflayer disconnect fails instead of completed',{fixture:true});
  mode='observe';const stop=new AbortController();const timer=setTimeout(()=>stop.abort(),300);
  try{await assert.rejects(execute(config,{action:'observe',seconds:5},{signal:stop.signal,event:()=>{},preview:async()=>{},deliver:async()=>{}}),/stopped|cancelled/);}finally{clearTimeout(timer);}
  pass('Mineflayer stop rejects and closes connection',{fixture:true});
  const cancelled=new AbortController();cancelled.abort();const before=joined;
  await assert.rejects(execute(config,{action:'observe',seconds:1},{signal:cancelled.signal,event:()=>{},preview:async()=>{},deliver:async()=>{}}),/cancelled/);
  assert.equal(joined,before);assert.deepEqual(errors,[]);
  pass('Mineflayer pre-cancel makes no connection',{fixture:true});
 }finally{
  for(const timer of timers)clearTimeout(timer);
  const closed=once(server,'close');server.close();await closed;
 }
}
try{await maaProbe();await minecraftProbe();report.status='passed';console.log('RUNTIME_FIXTURES_OK (not game E2E)');}
catch(e){report.status='failed';report.error=e.message;process.exitCode=1;console.error('Runtime probe failed:',e.message);}
finally{report.recordedAt=new Date().toISOString();await mkdir(join(root,'artifacts/verification'),{recursive:true});await writeFile(join(root,'artifacts/verification/runtime-fixtures.json'),JSON.stringify(report,null,2));}
