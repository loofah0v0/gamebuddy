import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {DshRuntime} from '../packages/runtime-dsh/index.mjs';
const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'gameguy-session-model-'));
const events=[],requests=[],checks=[],errors=[];let runtime,releaseHeld;
const textOf=m=>typeof m.content==='string'?m.content:(m.content??[]).map(b=>b.text??'').join('\n');
const wait=async(fn,label)=>{const end=Date.now()+45000;while(!fn()){assert.ok(Date.now()<end,'Timed out: '+label);await new Promise(r=>setTimeout(r,40));}};
const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);};
const server=createServer(async(req,res)=>{try{
 assert.equal(req.method,'POST');assert.ok(['/v1/chat/completions','/other/v1/chat/completions'].includes(req.url));
 let body='';for await(const b of req)body+=b;const p=JSON.parse(body);
 assert.ok(['fixture-a','fixture-b'].includes(p.model));assert.equal(p.stream,true);
 const label=/GGSEAT:([a-z]+)/.exec([...p.messages].reverse().map(textOf).join('\n'))?.[1];assert.ok(label);
 requests.push({label,path:req.url,payload:p});
 if(label==='held')await new Promise(r=>{releaseHeld=r;});
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'session-model-fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:p.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 chunk({role:'assistant'});chunk({content:'GGSEAT:'+label+' response on '+p.model});chunk({},'stop');res.end('data: [DONE]\n\n');
 }catch(e){errors.push(e.message);if(!res.headersSent)res.writeHead(500);res.end('Local fixture failed');}
});
async function send(id,label,held=false){const offset=events.length;await runtime.call('send',{taskId:id,text:'GGSEAT:'+label+' Text-only local QA. No tools or game actions.'});
 const done=async()=>{await wait(()=>events.slice(offset).some(e=>e.type==='assistant'&&e.text.includes('GGSEAT:'+label)),label+' assistant');await wait(()=>events.slice(offset).some(e=>e.type==='agent-status'&&e.taskId===id&&e.status==='idle'),label+' idle');};
 if(held){await wait(()=>requests.some(r=>r.label===label)&&releaseHeld,label+' arrived');return done;}await done();return requests.find(r=>r.label===label).payload;
}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseURL='http://127.0.0.1:'+server.address().port+'/v1';
 const model={provider:'compatible',baseURL,model:'fixture-a',key:'local-session-model-not-real'};
 runtime=new DshRuntime({root,dataDir:dir,onTool:()=>{throw Error('No tools allowed by this fixture');},onApproval:()=>false});runtime.on('event',e=>events.push(e));
 await runtime.start(model);const pid=runtime.child.pid;
 const parallel=await Promise.all(Array.from({length:8},()=>runtime.call('ensure',{taskId:'main',game:null})));
 check('Concurrent composer/Agent ensure creates one native session',new Set(parallel.map(s=>s.sessionId)).size===1);
 const session=parallel[0];const first=await send('main','first');check('Default request uses configured model',first.model==='fixture-a');
 const catalog=await runtime.call('model-inventory',{models:['fixture-a','fixture-b','fixture-b']});
 check('Hot directory exposes de-duplicated provider/model IDs',catalog.models.length===2&&catalog.models.every(m=>m.provider==='gameguy'));
 check('Text-only compatible adapters do not invent reasoning levels',catalog.models.every(m=>!m.reasoning));
 await assert.rejects(runtime.call('select-model',{taskId:'main',selection:{provider:'gameguy',model:'missing'}}),/目录/);checks.push('Unknown model rejected before mutation');
 await assert.rejects(runtime.call('select-model',{taskId:'main',selection:{provider:'gameguy',model:'fixture-b',reasoningEffort:'high'}}),/推理强度/);checks.push('Unadvertised reasoning effort rejected');
 const selected=await runtime.call('select-model',{taskId:'main',selection:{provider:'gameguy',model:'fixture-b'}});
 check('Selection retains last-used attribution until next request',selected.next.model==='fixture-b'&&selected.lastUsed.model==='fixture-a'&&selected.pending);
 const second=await send('main','second');check('Next real request uses chosen model without restarting kernel',second.model==='fixture-b'&&runtime.child.pid===pid);
 check('Same session retains prior user and assistant history',second.messages.some(m=>textOf(m).includes('GGSEAT:first response'))&&second.messages.some(m=>textOf(m).includes('GGSEAT:first Text-only')));
 check('DSH appends native model-change attribution notice',second.messages.some(m=>m.role==='user'&&textOf(m).includes('[model changed:')&&textOf(m).includes('fixture-a')&&textOf(m).includes('fixture-b')));
 const consumed=await runtime.call('ensure',{taskId:'main'});check('Request header consumes pending choice and updates last-used',consumed.sessionId===session.sessionId&&!consumed.sessionModel.pending&&consumed.sessionModel.lastUsed.model==='fixture-b');
 await runtime.call('ensure',{taskId:'other'});check('Independent session keeps global default',(await send('other','independent')).model==='fixture-a');
 const done=await send('main','held',true);await runtime.call('select-model',{taskId:'main',selection:{provider:'gameguy',model:'fixture-a'}});
 check('Switch during a running request does not change its model',requests.find(r=>r.label==='held').payload.model==='fixture-b');releaseHeld();await done();
 const pending=await runtime.call('ensure',{taskId:'main'});check('In-flight completion does not consume a newer pending selection',pending.sessionModel.pending&&pending.sessionModel.next.model==='fixture-a'&&pending.sessionModel.lastUsed.model==='fixture-b');
 await runtime.stop();await runtime.start({...model,models:['fixture-a','fixture-b']});
 const restored=await runtime.call('ensure',{taskId:'main',sessionId:session.sessionId});check('Unconsumed choice survives native shutdown/resume',restored.sessionModel.next.model==='fixture-a'&&restored.sessionModel.pending);
 check('Restored selection drives next request',(await send('main','restored')).model==='fixture-a');
 const fresh=await runtime.call('ensure',{taskId:'unused'});
 await runtime.stop();await runtime.start({...model,baseURL:baseURL.replace('/v1','/other/v1'),models:['fixture-a','fixture-b']});
 const mismatch=await runtime.call('ensure',{taskId:'main',sessionId:session.sessionId});check('Changed endpoint preserves unavailable choice instead of silent fallback',mismatch.sessionModel.unavailable&&mismatch.sessionModel.next.model==='fixture-a');
 const unused=await runtime.call('ensure',{taskId:'unused',sessionId:fresh.sessionId});check('Even a never-used default session is route-bound',unused.sessionModel.unavailable);
 const count=requests.length;await assert.rejects(runtime.call('send',{taskId:'main',text:'must not send'}),/连接已改变/);check('Unavailable route cannot send to a replacement endpoint',requests.length===count);
 await runtime.call('select-model',{taskId:'main',selection:{provider:'gameguy',model:'fixture-b'}});
 const adopted=await send('main','adopted');check('Explicit reselect admits new endpoint with original session history',adopted.model==='fixture-b'&&requests.at(-1).path==='/other/v1/chat/completions'&&adopted.messages.some(m=>textOf(m).includes('GGSEAT:first response')));
 assert.deepEqual(errors,[]);
 const report={status:'passed',date:new Date().toISOString(),checks,requests:requests.map(r=>({label:r.label,path:r.path,model:r.payload.model})),isolatedRuntime:true,realModelRequests:0,realGameActions:0};
 await mkdir(join(root,'artifacts/verification'),{recursive:true});await writeFile(join(root,'artifacts/verification/session-model-runtime-v03.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){console.error(e);console.error(JSON.stringify({errors,requests:requests.map(r=>({label:r.label,model:r.payload.model})),events},null,2));process.exitCode=1;}
finally{releaseHeld?.();await runtime?.stop();server.closeAllConnections();await new Promise(r=>server.close(r));if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-session-model-'))throw Error('Unsafe QA cleanup');await rm(dir,{recursive:true,force:true});}
