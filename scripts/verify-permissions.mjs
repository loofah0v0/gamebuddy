// Real DSH permission QA. Loopback fixture only: no real key, emulator or game.
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import assert from 'node:assert/strict';
import {DshRuntime} from '../packages/runtime-dsh/index.mjs';
const root=resolve(import.meta.dirname,'..'),verification=join(root,'artifacts/verification');
await mkdir(verification,{recursive:true});
const data=await mkdtemp(join(tmpdir(),'gameguy-permission-data-'));
const inside=await mkdtemp(join(verification,'permission-fixture-'));
// OS temp is intentionally writable in workspace-write, so test a sibling directory instead.
const outside=await mkdtemp(join(dirname(root),'gameguy-permission-outside-'));
const paths={readOnly:join(inside,'readonly.txt'),work:join(inside,'work.txt'),outside:join(outside,'blocked.txt'),oneShot:join(outside,'one-shot.txt'),afterGrant:join(outside,'after-grant.txt'),rejected:join(outside,'rejected.txt'),cancelled:join(outside,'cancelled.txt'),full:join(outside,'full.txt'),seed:join(inside,'seed.txt'),readEscalate:join(inside,'read-escalate.txt'),shellReadOnly:join(inside,'shell-readonly.txt'),shellInside:join(inside,'shell-inside.txt'),shellOutside:join(outside,'shell-outside.txt')};
const read=file_path=>({name:'read',args:{file_path}}),write=(file_path,content='fixture',extra={})=>({name:'write',args:{file_path,content,...extra}});
const shellWrite=(file_path,content)=>({name:'pwsh',args:{description:'本地权限夹具：只写指定随机测试文件',command: `$ErrorActionPreference = 'Stop'; Set-Content -LiteralPath ${JSON.stringify(file_path)} -Value ${JSON.stringify(content)}`,timeoutMs:20000}});
const escalation={sandbox_permissions:'danger-full-access',justification:'仅验证随机测试目录的单次写入授权。'};
const cases={
 readonly:[read(paths.readOnly),write(paths.readOnly)],
 shellreadonly:[shellWrite(paths.shellReadOnly,'shell-readonly-forbidden')],
 shellworkspace:[shellWrite(paths.shellInside,'shell-inside-ok'),shellWrite(paths.shellOutside,'shell-outside-forbidden')],
 workspace:[read(paths.work),write(paths.work,'workspace-ok'),{name:'edit',args:{file_path:paths.work,old_string:'workspace-ok',new_string:'workspace-edited'}},read(paths.outside),write(paths.outside)],
 accept:[read(paths.oneShot),write(paths.oneShot,'one-shot-ok',escalation),read(paths.afterGrant),write(paths.afterGrant)],
 reject:[read(paths.rejected),write(paths.rejected,'never',escalation)],
 cancel:[read(paths.cancelled),write(paths.cancelled,'never',escalation)],
 readonlygrant:[read(paths.readEscalate),write(paths.readEscalate,'read-only-granted',{sandbox_permissions:'workspace-write',justification:'只读会话对此随机工作区文件的一次写入验证。'})],
 full:[read(paths.full),write(paths.full,'full-ok'),{name:'pwsh',args:{description:'权限测试：仅输出固定文本',command:"Write-Output 'GG_PERMISSIONS_SHELL_OK'",timeoutMs:10000}}],
 discover:[{name:'glob',args:{pattern:'*.txt',path:inside}},{name:'grep',args:{pattern:'GG_PERMISSIONS_SEED',path:paths.seed}},read(paths.seed),{name:'web_search',args:{queries:['GameGuy permission fixture search provider unavailable']}}],
 resumed:[],rebound:[],
};
const events=[],requests=[],approvals=[],checks=[],results={};let runtime,cancelSignal;
const content=m=>typeof m.content==='string'?m.content:(m.content??[]).map(x=>x.text??'').join('\n');
const server=createServer(async(req,res)=>{try{
 assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);
 const label=/GGPERM:([a-z]+)/.exec([...p.messages].reverse().filter(m=>m.role==='user').map(content).find(s=>s.includes('GGPERM:'))??'')?.[1];assert.ok(Object.hasOwn(cases,label));
 const returned=p.messages.filter(m=>m.role==='tool');results[label]=returned.map(content);requests.push({label,n:returned.length});
 const next=cases[label][returned.length];if(next)assert.ok(p.tools.some(t=>t.function.name===next.name),'actual model-visible tool '+next.name+'; catalog='+p.tools.map(t=>t.function.name).join(','));
 res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'permission-fixture',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
 chunk({role:'assistant'});
 if(next){chunk({tool_calls:[{index:0,id:'fixture-'+label+'-'+returned.length,type:'function',function:{name:next.name,arguments:JSON.stringify(next.args)}}]});chunk({},'tool_calls');}
 else{chunk({content:'GGPERM_DONE:'+label});chunk({},'stop');}res.end('data: [DONE]\n\n');
 }catch(e){console.error('Fixture:',e.message);if(!res.headersSent)res.writeHead(500);res.end();}});
const check=(label,ok)=>{assert.ok(ok,label);checks.push(label);};
const exists=async path=>{try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const wait=async(fn,label)=>{const end=Date.now()+45000;while(!fn()){assert.ok(Date.now()<end,'timed out: '+label+' '+JSON.stringify(events.slice(-8)));await new Promise(r=>setTimeout(r,50));}};
async function send(label){const offset=events.length;await runtime.call('send',{taskId:label,text:'GGPERM:'+label+' 本地权限夹具，禁止真实游戏操作。'});await wait(()=>events.slice(offset).some(e=>e.taskId===label&&e.type==='assistant'&&e.text.includes('GGPERM_DONE:'+label)),'send '+label);await wait(()=>events.slice(offset).some(e=>e.taskId===label&&e.type==='agent-status'&&e.status==='idle'),'idle '+label);}
async function create(label,preset){const r=await runtime.call('ensure',{taskId:label,game:'arknights'});check(label+' uses DSH default workspace-write',r.permission==='workspace-write');if(preset)await runtime.call('set-permission',{taskId:label,preset});return r;}
try{
 await writeFile(paths.seed,'GG_PERMISSIONS_SEED\n');await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const model={provider:'compatible',model:'fixture-model',key:'local-permission-fixture-not-a-real-key',baseURL:'http://127.0.0.1:'+server.address().port+'/v1'};
 runtime=new DshRuntime({root,dataDir:data,onTool:()=>{throw Error('Game operations forbidden in permission QA');},onApproval:async(taskId,kind,details,{signal})=>{
  assert.equal(kind,'dsh-approval');approvals.push({taskId,details});assert.equal(details.toolName,'write');assert.ok(details.arguments?.file_path);assert.ok(details.arguments.justification);
  if(taskId==='cancel'){cancelSignal=signal;return new Promise(resolve=>{signal.addEventListener('abort',()=>resolve(false),{once:true});if(signal.aborted)resolve(false);});}
  return taskId==='accept'||taskId==='readonlygrant';
 }});runtime.on('event',e=>events.push(e));await runtime.start(model);
 const catalog=await runtime.call('permissions');check('native three-preset catalog',JSON.stringify(catalog.options.map(x=>x.value).sort())===JSON.stringify(['read-only','workspace-write','danger-full-access'].sort()));check('native default matches DSH base',catalog.defaultPreset==='workspace-write');
 await create('readonly','read-only');await send('readonly');check('read-only mutation denied',!await exists(paths.readOnly)&&results.readonly.some(x=>/sandbox.*read-only/is.test(x)));
 await create('workspace');await send('workspace');check('workspace write and edit succeed',await readFile(paths.work,'utf8')==='workspace-edited');check('workspace outside mutation denied',!await exists(paths.outside)&&results.workspace.some(x=>/sandbox.*workspace-write/is.test(x)));
 await create('shellreadonly','read-only');await send('shellreadonly');check('native read-only shell mutation blocked',!await exists(paths.shellReadOnly)&&/denied|unavailable/i.test(results.shellreadonly[0]??''));
 await create('shellworkspace');await send('shellworkspace');check('native workspace shell writes inside workspace',(await readFile(paths.shellInside,'utf8')).trim()==='shell-inside-ok');check('native workspace shell outside mutation blocked',!await exists(paths.shellOutside)&&/denied/i.test(results.shellworkspace[1]??''));
 await create('accept');await send('accept');check('single approved escalation writes exact file',await readFile(paths.oneShot,'utf8')==='one-shot-ok');check('grant does not authorize next call',!await exists(paths.afterGrant));check('single grant does not change session preset',(await runtime.call('ensure',{taskId:'accept',game:'arknights'})).permission==='workspace-write');
 await create('reject');await send('reject');check('native denied approval never executes',!await exists(paths.rejected));
 await create('readonlygrant','read-only');await send('readonlygrant');check('read-only one-shot workspace grant succeeds',await readFile(paths.readEscalate,'utf8')==='read-only-granted');check('read-only standing preset unchanged',(await runtime.call('ensure',{taskId:'readonlygrant',game:'arknights'})).permission==='read-only');
 await create('cancel');await runtime.call('send',{taskId:'cancel',text:'GGPERM:cancel'});await wait(()=>!!cancelSignal,'cancel approval');
 await assert.rejects(runtime.call('set-permission',{taskId:'cancel',preset:'danger-full-access'}));checks.push('native maintenance rejects changing a running Agent');
 await runtime.call('cancel',{taskId:'cancel'});await wait(()=>cancelSignal.aborted,'native approval abort');await wait(()=>!runtime.hostControllers.size,'host abort cleanup');check('cancel pending escalation never writes',!await exists(paths.cancelled));
 const fullSession=await create('full','danger-full-access'),n=approvals.length;await send('full');
 const gamePermission=await runtime.call('permission-state',{taskId:'full',sessionId:fullSession.sessionId});
 check('SDK exposes live managed-game authorization from exact session',gamePermission.sessionId===fullSession.sessionId&&gamePermission.sandboxMode==='danger-full-access'&&gamePermission.approvalPolicy==='never');
 await assert.rejects(runtime.call('permission-state',{taskId:'full',sessionId:'wrong-session'}));check('SDK refuses mismatched managed-game permission identity',true);
check('full access writes outside workspace',await readFile(paths.full,'utf8')==='full-ok');check('full access executes native shell',results.full.some(x=>x.includes('GG_PERMISSIONS_SHELL_OK')));check('full access has no per-command approval',approvals.length===n);
 await assert.rejects(runtime.call('set-permission',{taskId:'full',preset:'invalid-preset'}));check('invalid preset preserves standing permission',(await runtime.call('ensure',{taskId:'full',game:'arknights'})).permission==='danger-full-access');
 await create('discover');await send('discover');check('actual glob search works',results.discover[0]?.includes('seed.txt'));check('actual grep search works',results.discover[1]?.includes('GG_PERMISSIONS_SEED'));check('actual read works',results.discover[2]?.includes('GG_PERMISSIONS_SEED'));check('compatible search fails accurately without a provider',/provider|unavailable/i.test(results.discover[3]??''));
 const rebound=await runtime.call('ensure',{taskId:'full',game:'minecraft'});check('game rebind preserves native permission',rebound.permission==='danger-full-access');
 await runtime.stop();await runtime.start(model);const restored=await runtime.call('ensure',{taskId:'resumed',sessionId:fullSession.sessionId,game:'minecraft'});check('restart/resume preserves native preset',restored.permission==='danger-full-access');await send('resumed');
 check('only four explicit escalation approvals',approvals.length===4&&approvals.every(x=>['accept','reject','cancel','readonlygrant'].includes(x.taskId)));
 const report={status:'passed',date:new Date().toISOString(),checks,modelRequests:requests.length,approvals,toolResults:results,realModelRequests:0,realGameActions:0,isolatedUserData:true};
 await writeFile(join(verification,'product-permissions-v03.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks,modelRequests:requests.length,approvals:approvals.length},null,2));
}catch(e){console.error(e);console.error(JSON.stringify({results,approvals,events:events.slice(-15)},null,2));process.exitCode=1;}
finally{
 await runtime?.stop();server.closeAllConnections();await new Promise(r=>server.close(r));
 for(const [dir,parent,prefix] of [[data,tmpdir(),'gameguy-permission-data-'],[inside,verification,'permission-fixture-'],[outside,dirname(root),'gameguy-permission-outside-']]){
  if(resolve(dirname(dir))!==resolve(parent)||!basename(dir).startsWith(prefix))throw Error('Unsafe permission QA cleanup');await rm(dir,{recursive:true,force:true});
 }
}
