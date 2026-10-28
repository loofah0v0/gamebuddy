/** Actual DSH tool execution, with a deterministic loopback model, never live gameplay. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {DshRuntime} from '../packages/runtime-dsh/index.mjs';
const root=resolve(import.meta.dirname,'..'),reports=join(root,'artifacts/verification');
await mkdir(reports,{recursive:true});
const data=await mkdtemp(join(tmpdir(),'gameguy-agent-data-'));
const work=await mkdtemp(join(reports,'agent-fixture-'));
const script=join(work,'maa-callback-fixture.cjs'),childFile=join(work,'child.txt');
const text=m=>typeof m.content==='string'?m.content:(m.content??[]).map(b=>b.text??'').join('\n');
const read=file_path=>({name:'read',args:{file_path}});
const buggy=`const assert = require('node:assert/strict');
// Synthetic callback rows only; no DLL, device, credentials or network.
const callbacks = [{what: 10002, details: {count: 2}}, {what: 10002, details: {count: 4}}];
const total = callbacks.reduce((n, row) => n - row.details.count, 0);
assert.equal(total, 6, 'GG_EXPECTED_FIXTURE_FAILURE');
console.log('GG_AGENT_REPAIR_OK:' + total);
`;
const run={name:'pwsh',args:{description:'Only run synthetic offline MAA callback parser tests',command:`& ${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,timeoutMs:20000}};
const question={name:'ask_user_question',args:{questions:[{id:'channel',question:'Fixture channel only',options:[{label:'Official'},{label:'Bilibili'}]}]}};
const review={name:'exit_plan_mode',args:{plan:'# Offline repair plan\nTest synthetic callbacks only; no device actions.'}};
const steps={
 repair:[{name:'todo_write',args:{todos:[{content:'Test and repair offline callback parser',status:'in_progress'}]}},read(script),{name:'write',args:{file_path:script,content:buggy}},run,read(script),{name:'edit',args:{file_path:script,old_string:'n - row.details.count',new_string:'n + row.details.count'}},run,{name:'todo_write',args:{todos:[{content:'Test and repair offline callback parser',status:'completed'}]}}],
 question:[question],planskip:[review],planapprove:[review],
 delegate:[{name:'subagent',args:{description:'Offline game fixture check',prompt:'GGAGENT:child Read then write the designated synthetic fixture file. Attempting gameguy_skill is a guard test and must be denied. No game or device actions.',cwd:work}}],
 child:[read(childFile),{name:'write',args:{file_path:childFile,content:'GG_CHILD_NATIVE_OK'}},{name:'gameguy_skill',args:{input:{game:'arknights'}}}],
 cancel:[question],resume:[]
};
let runtime,cancelSignal;
const checks=[],events=[],requests=[],results={},questions=[],errors=[],approvals=[];
const check=(label,ok)=>{assert.ok(ok,label);checks.push(label);};
const wait=async(fn,label)=>{const end=Date.now()+60000;while(!fn()){assert.equal(errors.length,0,errors.join('\n'));assert.ok(Date.now()<end,'timeout '+label+' '+JSON.stringify(events.slice(-10)));await new Promise(r=>setTimeout(r,50));}};
const server=createServer(async(req,res)=>{try{
 assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);
 // Each test uses a separate session. Spawned children have a fresh prompt.
 const tagged=[...p.messages].reverse().find(m=>m.role==='user'&&/GGAGENT:([a-z]+)/.test(text(m)));
 const label=/GGAGENT:([a-z]+)/.exec(text(tagged??{}))?.[1];assert.ok(Object.hasOwn(steps,label),'Unknown fixture request');
 const returned=p.messages.filter(m=>m.role==='tool');results[label]=returned.map(text);
 const next=steps[label][returned.length];requests.push({label,toolResults:returned.length});
 if(next)assert.ok(p.tools.some(t=>t.function.name===next.name),'Model-visible tool '+next.name);
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'agent-fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
 chunk({role:'assistant'});
 if(next){chunk({tool_calls:[{index:0,id:'fixture-'+label+'-'+returned.length,type:'function',function:{name:next.name,arguments:JSON.stringify(next.args)}}]});chunk({},'tool_calls');}
 else {chunk({content:'GGAGENT_DONE:'+label});chunk({},'stop');}
 res.end('data: [DONE]\n\n');
 }catch(e){errors.push(e.message);if(!res.headersSent)res.writeHead(500);res.end();}});
async function ensure(label){return runtime.call('ensure',{taskId:label,game:null});}
async function send(label){const offset=events.length;await runtime.call('send',{taskId:label,text:'GGAGENT:'+label+' Game-centered general agent QA: synthetic offline fixtures only, not gameplay.'});await wait(()=>events.slice(offset).some(e=>e.taskId===label&&e.type==='assistant'&&e.text.includes('GGAGENT_DONE:'+label)),'reply '+label);await wait(()=>events.slice(offset).some(e=>e.taskId===label&&e.type==='agent-status'&&e.status==='idle'),'idle '+label);}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const model={provider:'compatible',model:'fixture-model',key:'local-agent-fixture-not-a-real-key',baseURL:'http://127.0.0.1:'+server.address().port+'/v1'};
 runtime=new DshRuntime({root,dataDir:data,onTool:()=>{throw Error('Host game actions forbidden in agent QA');},onApproval:async(...args)=>{approvals.push(args[0]);return false;},onQuestion:async(taskId,input,{signal})=>{
  questions.push({taskId,input});
  if(taskId==='cancel'){cancelSignal=signal;return new Promise(r=>{signal.addEventListener('abort',()=>r({answers:[]}),{once:true});if(signal.aborted)r({answers:[]});});}
  if(taskId==='planskip')return {answers:[]};
  return {answers:input.questions.map(q=>({id:q.id,selected:[q.intent?.approve??'Official']}))};
 }});runtime.on('event',e=>events.push(e));
 const boot=await runtime.start(model);check('full sdk profile',boot.capabilities.profile==='sdk');
 for(const service of ['agents','tools','sessions','fs','shell','jobs','skills','commands','subagents','userQuestions','planMode','goals','sessionPersistence'])check('service '+service,boot.capabilities.services[service]);
 const session=await ensure('repair');
 for(const name of ['read','write','edit','pwsh','glob','grep','web_fetch','todo_write','subagent','subagent_fork','ask_user_question','exit_plan_mode'])check('unbound native tool '+name,session.capabilities.tools.includes(name));
 await send('repair');
 check('real first test fails',results.repair[3]?.includes('GG_EXPECTED_FIXTURE_FAILURE'));
 check('agent edits then real test succeeds',results.repair[6]?.includes('GG_AGENT_REPAIR_OK:6'));
 check('fixed script persisted',(await readFile(script,'utf8')).includes('n + row.details.count'));
 check('native todo completes',!events.some(e=>e.taskId==='repair'&&e.type==='tool-status'&&e.name==='todo_write'&&e.phase==='failed'));
 const native=await runtime.call('command',{taskId:'repair',text:'/goal'});
 check('native goal command available',session.capabilities.commands.some(c=>c.name==='goal')&&native.execution.result.kind!=='error');
 const count=requests.length;const unknown=await runtime.call('command',{taskId:'repair',text:'/not-a-command'});
 check('unknown command never sent to model',unknown.execution.result.kind==='error'&&requests.length===count);
 await ensure('question');await send('question');check('native question roundtrip',results.question[0]?.includes('Official'));
 for(const label of ['planskip','planapprove']){
  await ensure(label);const before=requests.length;
  const on=await runtime.call('command',{taskId:label,text:'/plan'});check(label+' bare /plan has no model turn',on.capabilities.planMode.active&&before===requests.length);
  await send(label);const caps=await runtime.call('capabilities',{taskId:label});
  check(label+' review state accurate',caps.planMode.active===(label==='planskip'));
  if(label==='planskip'){const off=await runtime.call('command',{taskId:label,text:'/plan off'});check('native /plan off',!off.capabilities.planMode.active);}
 }
 check('plan-review intent reaches host',questions.filter(q=>q.taskId.startsWith('plan')).every(q=>q.input.questions[0].intent.kind==='plan-review'));
 await ensure('delegate');await send('delegate');
 await wait(()=>events.some(e=>e.taskId==='delegate'&&e.type==='child-status'&&e.status==='idle')&&results.child?.length===3,'child complete');
 check('child native write succeeds',await readFile(childFile,'utf8')==='GG_CHILD_NATIVE_OK');
 check('child game guard denies before host',/root owns game effects and approvals/.test(results.child[2]??''));
 check('child lifecycle attributed separately',events.some(e=>e.taskId==='delegate'&&e.type==='tool-status'&&e.name==='write'&&e.phase==='completed')&&events.some(e=>e.taskId==='delegate'&&e.type==='child-status'));
 await ensure('cancel');await runtime.call('send',{taskId:'cancel',text:'GGAGENT:cancel'});await wait(()=>!!cancelSignal,'pending question');await runtime.call('cancel',{taskId:'cancel'});await wait(()=>cancelSignal.aborted&&!runtime.hostControllers.size,'question cancellation');check('cancel aborts native question',cancelSignal.aborted);
 await runtime.stop();await runtime.start(model);const restored=await runtime.call('ensure',{taskId:'resume',sessionId:session.sessionId,game:null});check('native session resumes',restored.sessionId===session.sessionId);await send('resume');
 check('no unrequested native approval',approvals.length===0);assert.deepEqual(errors,[]);
 const report={status:'passed',date:new Date().toISOString(),checks,requests,questions:questions.map(q=>({taskId:q.taskId,ids:q.input.questions.map(x=>x.id)})),toolResults:results,realModelRequests:0,realGameActions:0,isolatedUserData:true,limitations:['Deterministic local model supplies tool choices: capability-chain proof, not real-model autonomous reasoning quality.','Synthetic callback parser does not connect to MAA, an emulator or a game.','Generated code still uses native DSH permissions; no managed arbitrary-script game runner is claimed.','No UI click, real login, rewards or schedule acceptance is claimed.']};
 await writeFile(join(reports,'product-agent-v03.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks,modelRequests:requests.length},null,2));
}catch(e){console.error(e);console.error(JSON.stringify({errors,results,events:events.slice(-20)},null,2));process.exitCode=1;}
finally{
 await runtime?.stop();server.closeAllConnections();await new Promise(r=>server.close(r));
 for(const [dir,parent,prefix] of [[data,tmpdir(),'gameguy-agent-data-'],[work,reports,'agent-fixture-']]){
  if(resolve(dirname(dir))!==resolve(parent)||!basename(dir).startsWith(prefix))throw Error('Unsafe agent QA cleanup');await rm(dir,{recursive:true,force:true});
 }
}
