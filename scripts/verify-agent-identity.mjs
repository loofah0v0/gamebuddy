// Verify real SDK/native prompt composition against a loopback model fixture; not a semantic evaluation of a live model.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {DshRuntime} from '../packages/runtime-dsh/index.mjs';
import {persona,productIdentity} from '../packages/runtime-dsh/persona.mjs';
const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'gameguy-identity-')),out=join(root,'artifacts/verification/agent-identity');await mkdir(out,{recursive:true});
const legacy='You are GameGuy (GG), an independent game-centered AI agent built on the complete DSH SDK. Answer in Chinese.';
const checks=[],requests=[],events=[],errors=[];let active;
const text=m=>typeof m.content==='string'?m.content:(m.content??[]).map(b=>b.text??'').join('\n');
const server=createServer(async(req,res)=>{try{
 assert.equal(req.url,'/v1/chat/completions');let bytes='';for await(const b of req)bytes+=b;const p=JSON.parse(bytes),system=p.messages.filter(m=>m.role==='system').map(text).join('\n');
 assert(system.includes(productIdentity),'Product identity must reach actual model input');assert(!system.includes('independent game-centered AI agent built on the complete DSH SDK'),'Legacy product prefix must not leak into actual model input');assert(system.includes('do not use a generic shell to circumvent'),'Execution safety must survive branding');
 requests.push({mode:active,identityPresent:true,legacyProductPrefixAbsent:true,safetyPresent:true});
 res.writeHead(200,{'Content-Type':'text/event-stream'});const response='我是 GameGuy，叫我 GG 就行。你可以把我当成游戏搭子，也可以让我帮你查资料、写脚本和排查问题。';
 res.end('data: '+JSON.stringify({id:'identity-fixture',object:'chat.completion.chunk',model:'identity-fixture',choices:[{index:0,delta:{role:'assistant',content:response},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
}catch(e){errors.push(e.message);res.writeHead(500);res.end('Identity fixture assertion failed');}});
const wait=async predicate=>{const end=Date.now()+20000;while(!predicate()){assert.equal(errors.length,0,errors.join('\n'));assert(Date.now()<end,'Identity fixture timeout');await new Promise(r=>setTimeout(r,50));}};
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const model={provider:'compatible',model:'identity-fixture',baseURL:'http://127.0.0.1:'+server.address().port+'/v1',vision:false,key:'nonsecret-loopback-fixture'};
 for(const mode of ['sdk','native-legacy-profile']){
  active=mode;const runtime=new DshRuntime({root,dataDir:join(dir,mode),nativeClient:mode!=='sdk',onTool:()=>{throw Error('No tools allowed in identity QA');},onApproval:()=>false,onQuestion:()=>({answers:[]}),onAdopt:()=>({taskId:mode}),onMergeAdoption:()=>({taskId:mode}),onCredential:()=>undefined});runtime.on('event',e=>events.push({mode,...e}));
  try{
   await runtime.start(model);
   if(mode!=='sdk'){
    await runtime.stop();const path=join(dir,mode,'profiles/web/cordis.patch.yml'),before=await readFile(path,'utf8');assert(before.includes(JSON.stringify(persona)),'Generated native preset fixture missing');
    const legacyProfile=before.replaceAll(JSON.stringify(persona),JSON.stringify(legacy));await writeFile(path,legacyProfile);await runtime.start(model);
    assert.equal(await readFile(path,'utf8'),legacyProfile,'Existing native profile must not be silently overwritten');checks.push('Saved legacy profile is preserved on disk while product-owned prompt migrates in memory');
   }
   await runtime.call('ensure',{taskId:mode});const count=requests.length;await runtime.call('send',{taskId:mode,text:'你是谁？'});await wait(()=>requests.length>count);await wait(()=>events.some(e=>e.mode===mode&&e.type==='assistant'));checks.push(mode+': actual model prompt has GameGuy identity, no legacy SDK introduction, and preserved safety policy');
  }finally{await runtime.stop();}
 }
 assert.equal(requests.length,2);await writeFile(join(out,'report.json'),JSON.stringify({status:'passed',checks,requests,errors,realRuntime:true,fixtureModel:true,semanticLiveModelEvaluation:false,externalModelRequests:0,gameActions:0,isolatedUserData:true},null,2));console.log('AGENT IDENTITY PASSED',checks);
}catch(e){await writeFile(join(out,'report.json'),JSON.stringify({status:'failed',checks,error:e.stack,requests,errors},null,2));throw e;}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-identity-'))throw Error('Unsafe identity fixture cleanup');await rm(dir,{recursive:true,force:true});}
