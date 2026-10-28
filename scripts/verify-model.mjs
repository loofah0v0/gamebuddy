import {resolveElectronRuntime} from './electron-runtime.mjs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'gameguy-desktop-smoke-'));
let phaseStarted,exitCode;
const attempt=async status=>{const dir=join(root,'artifacts/verification');await mkdir(dir,{recursive:true});await writeFile(join(dir,'product-model-url-latest-attempt.json'),JSON.stringify({status,date:new Date().toISOString(),command:'verify:model',phaseStarted,exitCode,totalLoopbackRequests:requests.length+probes.length,isolatedUserData:true,realModelRequests:0,realGameActions:0,...(status==='failed'?{note:'Model QA process failed; historical success report is not evidence for this attempt.'}:{})},null,2)+'\n');};
const requests=[],probes=[],errors=[];const key='gameguy-local-model-qa-not-a-real-secret';
const textOf=m=>typeof m.content==='string'?m.content:(m.content??[]).map(b=>b.text??'').join('\n');
const server=createServer(async(req,res)=>{try{
 assert.equal(req.headers.authorization,'Bearer '+key);
 if(req.method==='GET'){
  assert.ok(['/v1/models','/empty/v1/models','/missing/v1/models','/redirect/v1/models','/slow/v1/models'].includes(req.url),'Invalid catalog path: '+req.url);
  probes.push({kind:'catalog',path:req.url,authorizationMatched:true});
  if(req.url==='/slow/v1/models')await new Promise(r=>setTimeout(r,800));
  if(req.url==='/redirect/v1/models'){res.writeHead(302,{Location:'/must-not-follow'});res.end();return;}
  if(req.url==='/missing/v1/models'){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:key}));return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:req.url==='/empty/v1/models'?[]:[{id:'fixture-reject'},{id:'fixture-model'},{id:'fixture-model'},{id:key}]}));return;
 }
 assert.equal(req.method,'POST');assert.ok(['/v1/chat/completions','/custom/v1/chat/completions'].includes(req.url),'Invalid API path: '+req.url);
 let body='';for await(const b of req){body+=b;assert.ok(body.length<1000000);}
 const p=JSON.parse(body);assert.ok(['fixture-model','fixture-reject'].includes(p.model));
 if(p.stream===false){
  assert.equal(p.max_tokens,16);assert.equal(p.tools,undefined);assert.deepEqual(p.messages,[{role:'user',content:'Reply with OK only.'}]);
  probes.push({kind:'completion',path:req.url,model:p.model,authorizationMatched:true,stream:false});
  if(p.model==='fixture-reject'||probes.filter(item=>item.kind==='completion'&&item.model==='fixture-model').length===3){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:key}}));return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'probe',object:'chat.completion',model:p.model,choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]}));return;
 }
 assert.equal(p.stream,true);
 const label=/GGURLQA:([a-z]+)/.exec([...p.messages].reverse().map(textOf).join('\n'))?.[1];assert.ok(label);
 requests.push({path:req.url,model:p.model,label,authorizationMatched:true,stream:p.stream});
 if(p.model==='fixture-reject'){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'fixture unauthorized '+key,type:'authentication_error'}}));return;}
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'model-url-qa',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:p.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 chunk({role:'assistant'});chunk({content:'GGURLQA:'+label+' 模型 URL 请求验证通过。'});chunk({},'stop');res.end('data: [DONE]\n\n');
}catch(e){errors.push(e.message);if(!res.headersSent)res.writeHead(500);res.end('Fixture validation failed');}});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/v1';const electron=await resolveElectronRuntime();
 for(const phase of ['initial','restart']){phaseStarted=phase;
  const env={...process.env,GAMEGUY_NODE:process.execPath,GAMEGUY_TEST_DATA:dir,GAMEGUY_MODEL_FIXTURE_URL:url,GAMEGUY_MODEL_QA_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electron,[join(root,'packages/desktop/main.mjs'),'--smoke-model'],{cwd:root,env,windowsHide:true,stdio:'inherit'});
  let timer;try{const code=await new Promise((ok,bad)=>{timer=setTimeout(()=>{child.kill();bad(Error('Isolated model QA timed out'));},180000);child.once('error',bad);child.once('exit',ok);});exitCode=code;assert.equal(code,0,'Model QA '+phase+' failed');}finally{clearTimeout(timer);}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests.map(r=>r.label),['first','retained','unauthorized','custom','restart']);
 assert.equal(probes.filter(p=>p.kind==='catalog').length,7);assert.equal(probes.filter(p=>p.kind==='completion').length,7);assert.equal(probes.filter(p=>p.model==='fixture-reject').length,1);
 const reports=await Promise.all(['initial','restart'].map(p=>readFile(join(root,'artifacts/verification/model-url-v03',p+'.json'),'utf8').then(JSON.parse)));
 const report={status:'passed',date:new Date().toISOString(),checks:reports.flatMap(r=>r.checks),requests,probes,totalLoopbackRequests:requests.length+probes.length,screenshots:reports.flatMap(r=>r.screenshots),isolatedUserData:true,realModelRequests:0,realGameActions:0};
 await mkdir(join(root,'artifacts/verification'),{recursive:true});await writeFile(join(root,'artifacts/verification/product-model-url-v03.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 await attempt('passed');
}catch(e){await attempt('failed');console.error(e);process.exitCode=1;}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-desktop-smoke-'))throw Error('Unsafe QA cleanup');await rm(dir,{recursive:true,force:true});}
