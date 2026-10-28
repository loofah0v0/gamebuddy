import {resolveElectronRuntime} from './electron-runtime.mjs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'gameguy-desktop-smoke-'));
const requests=[];const server=createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/page'){res.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'DENY'});res.end('<!doctype html><title>GameBuddy QA</title><h1>GameBuddy guest fixture</h1><p>Isolated loopback page</p>');return;}
 if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture-a'},{id:'fixture-b'}]}));return;}
 let body='';for await(const b of req)body+=b;const p=JSON.parse(body);requests.push({model:p.model});
 res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'native-fixture',object:'chat.completion.chunk',created:1,model:p.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');chunk({role:'assistant'});chunk({content:'NATIVE_FIXTURE **streaming** on '+p.model+'\n\n'});await new Promise(r=>setTimeout(r,1200));chunk({content:'```js\nconsole.log(\"GameBuddy\");\n```\n\n'});await new Promise(r=>setTimeout(r,1200));chunk({content:p.model+' complete'});chunk({},'stop');res.end('data: [DONE]\n\n');
});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/v1';
 await writeFile(join(dir,'model.json'),JSON.stringify({provider:'compatible',model:'fixture-a',baseURL:url,vision:false}));
 const electron=await resolveElectronRuntime(),env={...process.env,GAMEGUY_NODE:process.execPath,GAMEGUY_TEST_DATA:dir,GAMEGUY_MODEL_FIXTURE_URL:url,GAMEGUY_TEST_LOG:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electron,[join(root,'packages/desktop/main.mjs'),'--smoke-native'],{cwd:root,env,windowsHide:true,stdio:'inherit'});
 const timer=setTimeout(()=>{console.error('Native QA timed out');child.kill();},180000);
 const code=await new Promise((ok,bad)=>{child.once('error',bad);child.once('exit',ok);});clearTimeout(timer);if(code!==0)throw Error('Native desktop failed '+code);
 if(requests.length!==2||requests[0].model!=='fixture-a'||requests[1].model!=='fixture-b')throw Error('Unexpected inference or model routes: '+JSON.stringify(requests));console.log('Requests',requests);
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-desktop-smoke-'))throw Error('Unsafe cleanup');await rm(dir,{recursive:true,force:true});}
