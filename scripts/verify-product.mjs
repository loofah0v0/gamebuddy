import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {DshRuntime} from '../packages/runtime-dsh/index.mjs';
import {allowedTools} from '../packages/runtime-dsh/policy.mjs';

const root=resolve(import.meta.dirname,'..');
const dir=await mkdtemp(join(tmpdir(),'gameguy-loop-'));
const requests=[],events=[],tools=[],scopes=[],fixtureErrors=[];
const cases={loop:'arknights',mc:'minecraft',claw:'clawclaw',unbound:null,bound:'arknights',rebound:'minecraft',resume:'arknights'};
let runtime;
const textOf=m=>typeof m.content==='string'?m.content:(m.content??[]).map(b=>b.text??'').join('\n');
const server=createServer(async(req,res)=>{
 try{
  let body='';for await(const b of req)body+=b;const payload=JSON.parse(body);
  const labeled=[...payload.messages].reverse().map(textOf).find(s=>/GGTEST:([a-z]+)/.test(s));
  const label=/GGTEST:([a-z]+)/.exec(labeled??'')?.[1];
  if(!label)fixtureErrors.push({payload});
  assert.ok(Object.hasOwn(cases,label),'Each fixture request must be tied to a declared test');
  const visible=(payload.tools??[]).map(t=>t.function.name).sort();
  assert.deepEqual(visible.filter(n=>n.startsWith('gameguy_')||n==='Monitor'),allowedTools(cases[label]).sort(),'Business scope differs for '+label);
  for(const name of ['pwsh','read','read_image','write','edit','glob','grep','web_fetch','web_search'])assert.ok(visible.includes(name),'Native DSH tool missing: '+name+' / '+label);
  requests.push({label,payload});scopes.push({label,game:cases[label],visible});
  const hasResult=payload.messages.some(m=>m.role==='tool');
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'gameguy-local-fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'fixture-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  chunk({role:'assistant'});
  if(label==='loop'&&!hasResult){chunk({tool_calls:[{index:0,id:'fixture-tool-1',type:'function',function:{name:'gameguy_catalog',arguments:'{"input":{}}'}}]});chunk({},'tool_calls');}
  else {chunk({content:'GGTEST:'+label+' 独立 GameGuy 内核闭环与工具范围验证通过。'});chunk({},'stop');}
  res.end('data: [DONE]\n\n');
 }catch(e){fixtureErrors.push({message:e.message});res.writeHead(500);res.end(e.message);}
});
async function send(taskId,label){
 const offset=events.length;await runtime.call('send',{taskId,text:'GGTEST:'+label+' 请验证当前能力范围。此为本地测试，禁止真实游戏操作。'});
 const deadline=Date.now()+45000;
 while(!events.slice(offset).some(e=>e.type==='assistant'&&e.text.includes('GGTEST:'+label))&&!events.slice(offset).some(e=>e.type==='agent-error')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 assert.ok(events.slice(offset).some(e=>e.type==='assistant'&&e.text.includes('GGTEST:'+label)),JSON.stringify(events.slice(offset)));
}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 runtime=new DshRuntime({root,dataDir:dir,onTool:async(taskId,name,input)=>{assert.equal(taskId,'fixture');assert.equal(name,'gameguy_catalog');assert.deepEqual(input,{});tools.push({taskId,name,input});return {plugins:[{id:'arknights'},{id:'minecraft'}],skills:[{id:'clawclaw',plugin:false}]};},onApproval:()=>false});
 runtime.on('event',e=>events.push(e));
 const model={provider:'compatible',model:'fixture-model',key:'local-fixture-not-a-real-key',baseURL:'http://127.0.0.1:'+server.address().port+'/v1'};
 const health=await runtime.start(model);
 assert.equal(health.agent,true);assert.equal(health.tools,true);assert.equal(health.sessions,true);
 const session=await runtime.call('ensure',{taskId:'fixture',game:'arknights'});
 await send('fixture','loop');
 assert.equal(tools.length,1,'DSH must dispatch exactly one real host tool');
 assert.ok(requests.some(({payload:p})=>p.messages.some(m=>m.role==='tool')),'tool result must return to model');
 for(const label of ['mc','claw','unbound']){await runtime.call('ensure',{taskId:label,game:cases[label],});await send(label,label);}
 const fresh=await runtime.call('ensure',{taskId:'binding',game:null});
 const bound=await runtime.call('ensure',{taskId:'binding',game:'arknights'});assert.equal(bound.sessionId,fresh.sessionId);await send('binding','bound');
 const rebound=await runtime.call('ensure',{taskId:'binding',game:'minecraft'});assert.equal(rebound.sessionId,fresh.sessionId);await send('binding','rebound');
 await runtime.stop();await runtime.start(model);
 const restored=await runtime.call('ensure',{taskId:'fixture',game:'arknights',sessionId:session.sessionId});assert.equal(restored.sessionId,session.sessionId);await send('fixture','resume');
 assert.equal(tools.length,1);
 const report={status:'passed',date:new Date().toISOString(),kernel:'DSH 0.2.1-rc.2',checks:['kernel boot','session creation','model -> tool -> host -> model -> UI event','real model-visible tool scopes for all three games and unbound tasks','existing session rebind removes old game business tools','session restart/resume and model request'],modelRequests:requests.length,toolCalls:tools.length,scopes,realGameActions:0};
 await mkdir(join(root,'artifacts/verification'),{recursive:true});await writeFile(join(root,'artifacts/verification/product-runtime-v03.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){console.error(e);console.error(JSON.stringify({fixtureErrors,requests:requests.map(({label,payload:p})=>({label,model:p.model,roles:p.messages?.map(m=>m.role),tools:p.tools?.map(t=>t.function?.name)})),events,tools},null,2));process.exitCode=1;}
finally{await runtime?.stop();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
