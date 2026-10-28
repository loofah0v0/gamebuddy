import {resolveElectronRuntime} from './electron-runtime.mjs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'gameguy-desktop-smoke-'));
const requests=[],errors=[];let phaseStarted,exitCode;
const server=createServer(async(req,res)=>{try{
 assert.equal(req.headers.authorization,'Bearer local-session-ui-not-real');
 if(req.method==='GET'){assert.equal(req.url,'/v1/models');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture-a'},{id:'fixture-b'}]}));return;}
 assert.equal(req.method,'POST');assert.equal(req.url,'/v1/chat/completions');let body='';for await(const b of req)body+=b;const p=JSON.parse(body);
 const texts=p.messages.map(m=>typeof m.content==='string'?m.content:(m.content??[]).map(b=>b.text??'').join('\n'));
 const label=/GGSEATUI:([a-z]+)/.exec([...texts].reverse().join('\n'))?.[1];assert.ok(label);requests.push({label,model:p.model});
 assert.equal(p.model,label==='second'?'fixture-b':'fixture-a');if(label==='second')assert.ok(texts.some(t=>t.includes('[model changed:')));if(label==='restart')assert.ok(texts.some(t=>t.includes('GGSEATUI:second response')));
 res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'session-ui',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:p.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');chunk({role:'assistant'});chunk({content:'GGSEATUI:'+label+' response on '+p.model});chunk({},'stop');res.end('data: [DONE]\n\n');
 }catch(e){errors.push(e.message);if(!res.headersSent)res.writeHead(500);res.end('Local fixture failed');}
});
const reportDir=join(root,'artifacts/verification');
async function attempt(status){await mkdir(reportDir,{recursive:true});await writeFile(join(reportDir,'session-model-latest-attempt.json'),JSON.stringify({status,date:new Date().toISOString(),phaseStarted,exitCode,requests,isolatedUserData:true,realModelRequests:0,realGameActions:0},null,2)+'\n');}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+server.address().port+'/v1',electron=await resolveElectronRuntime();
 for(const phase of ['initial','restart']){phaseStarted=phase;const env={...process.env,GAMEGUY_NODE:process.execPath,GAMEGUY_TEST_DATA:dir,GAMEGUY_MODEL_FIXTURE_URL:endpoint,GAMEGUY_MODEL_QA_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electron,[join(root,'packages/desktop/main.mjs'),'--smoke-session-model'],{cwd:root,env,windowsHide:true,stdio:'inherit'});let timer;
  try{exitCode=await new Promise((ok,bad)=>{timer=setTimeout(()=>{child.kill();bad(Error('Session model desktop QA timed out'));},180000);child.once('error',bad);child.once('exit',ok);});assert.equal(exitCode,0,'Desktop '+phase+' failed');}finally{clearTimeout(timer);}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests.map(r=>r.label),['first','second','restart']);
 const reports=await Promise.all(['initial','restart'].map(p=>readFile(join(reportDir,'session-model-desktop-v03',p+'.json'),'utf8').then(JSON.parse)));
 const report={status:'passed',date:new Date().toISOString(),checks:reports.flatMap(r=>r.checks),requests,screenshots:reports.flatMap(r=>r.screenshots),isolatedUserData:true,realModelRequests:0,realGameActions:0};await writeFile(join(reportDir,'session-model-desktop-v03.json'),JSON.stringify(report,null,2)+'\n');await attempt('passed');console.log(JSON.stringify(report,null,2));
}catch(e){await attempt('failed');console.error(e);process.exitCode=1;}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-desktop-smoke-'))throw Error('Unsafe QA cleanup');await rm(dir,{recursive:true,force:true});}
