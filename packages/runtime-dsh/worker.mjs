import {setCredentialBridge} from '@gameguy/native-client/credentials';
import {prepareNativeProfile} from './native-profile.mjs';
import {installModelSelection} from '@deepseek-ai/dsh-agent';
import {appendPluginRecord} from '@deepseek-ai/dsh-session';
import {SessionProjectionRegistry} from '@deepseek-ai/dsh-session-projection';
import {selectionSchema,modelIdsSchema,routeId,providerId,descriptor,sameSelection,selectionProjection} from './model-selection.mjs';
import {allowedTools} from './policy.mjs';
import {permissionRows} from './permissions.mjs';
import {taskOwner,runtimeCapabilities} from './capabilities.mjs';
import {persona} from './persona.mjs';
import {installProductIdentity} from './product-identity.mjs';
import {gamePermissionSnapshot} from './game-permission.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runProfile,prepareProfile} from '@deepseek-ai/dsh/profile-boot';
import {createLaunchEnvironmentSnapshot} from '@deepseek-ai/dsh-launch-environment';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {deriveEventMessage} from '@deepseek-ai/dsh-session/surface';
const pluginSkills=new Map(),pluginKinds=new Map();
let kernel,root,model,nativeClient=false,configured=false;const handles=new Map(),ensureJobs=new Map(),agents=new Map(),hostCalls=new Map(),commandCalls=new Map();
const emit=event=>process.send?.({kind:'event',event});
const host=(kind,taskId,name,input,signal)=>new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(Error('Request cancelled'));return;}
 const id=randomUUID(),cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);hostCalls.delete(id);};
 const abort=()=>{cleanup();process.send?.({kind:'host-cancel',id});reject(Error('Request cancelled'));};
 const timer=setTimeout(()=>{cleanup();process.send?.({kind:'host-cancel',id});reject(Error('GameGuy host request/approval expired'));},300000);
 hostCalls.set(id,{resolve:v=>{cleanup();resolve(v);},reject:e=>{cleanup();reject(e);},timer});
 signal?.addEventListener('abort',abort,{once:true});process.send?.({kind,id,taskId,name,input});
});
const user=text=>createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
const specs={
 Monitor:'input {command:original ccl start/join command,description?:short display label (max 200 chars),timeout_ms?:1000..1800000}. Official Skill foreground runtime. Never use pwsh to start/join a long CLI stream. Host owns one account stream, persists NDJSON before steering this task. Monitor returns running; events arrive asynchronously. Read references/STREAM.md first.',
 gameguy_catalog:'input {}. Discover the game market: trusted Arknights, Minecraft and ClawClaw packages, installation and activation status. Sources are local bundled packages, not remote downloads.',
 gameguy_install:'input {game:trusted-package-id}. Activate a bundled integrity-checked GameGuy plugin. Not a DSH plugin manager.',
 gameguy_skill:'input {game:trusted-package-id,path?:relative-reference-path}. Read original trusted Skill/schema/reference before playing. Never invent CLI or model parameters.',
 gameguy_setup:'input {game,instance?}. Run the installed game plugin’s bounded environment discovery; return defaults, full config/plan schemas, suggestedConfig, verified installation evidence and unresolved questions. For MAA discover MuMu CLI/instances, MAA, ADB and Python automatically before asking users for paths. Discovery does not launch/connect devices or write config. Never request passwords/OTP in chat.',
 gameguy_prepare:'input {game,config?:candidate-full-config,request:{...plugin-owned-request-schema}}. Pure plugin intent compiler: returns proposed config, bounded plan, task preview, Chinese summary, unresolved questions and warnings. No save, launch, run or schedule. Read plugin Skill/references and setup requestSchema first. Use for player goals instead of asking users for MAA JSON; then configure/run via separate approvals.',
 gameguy_configure:'input {game,instance,config:{...}}. Save validated full configuration; host requests user confirmation and binds this task to instance.',
 gameguy_diagnose:'input {}. Check the bound device/server and backend. Diagnostics do not prove game login.',
 gameguy_run:'input {plan:{...},maxSeconds?:10..7200}. Start bounded run on THIS task instance only; host validates plan and follows the live session permission (full-access + never: no approval card; otherwise confirm). Source stones/gacha/payment always forbidden. Result initially only started; inspect status.',
 gameguy_status:'input {}. Read only this task, its saved device startup operations, runs and results; no cross-task control or confirmation tokens. Empty devices[] is NOT evidence that MuMu/game is stopped: use gameguy_setup or diagnose official CLI state; sandbox process lists can be incomplete. After device_start poll devices for ready/failed/stopped; ready does not prove game login or MAA readiness.',
 gameguy_stop:'input {}. Stop this task automation, not confirmed game quit. Remote participation exit remains unknown until formal CLI confirms.',
 gameguy_device_start:'input {}. Request selected emulator launch; UI confirms executable and instance. Does not silently download software.',
 gameguy_preview:'input {url:official ClawClaw spectator HTTPS URL}. Show spectator only to human. No hidden spectator information is delivered to Agent.',
 gameguy_schedule_manage:'input {action:list|pause|resume|delete|update,id?:schedule-id,patch?:{time?,timeZone?,plan?,maxSeconds?}}. Manage only THIS task daily MAA schedules; edits/resume require confirmation and validated resource limits.',
 gameguy_schedule:'input {time:HH:mm,timeZone:IANA,plan:{...},maxSeconds?:10..7200}. Create explicitly confirmed daily MAA template. Requires bound instance; skips offline/missed/conflict, no automatic spending retry.',
};
const bootTrace=stage=>{if(process.env.GAMEGUY_TEST_LOG==='1')console.error('[GameGuy boot]',stage);};
async function boot(a){bootTrace('worker imports ready');nativeClient=a.nativeClient===true;setCredentialBridge((name,input)=>host('credential',null,name,input));root=a.root;model=a.model;configured=Boolean(process.env[model.provider==='compatible'?'GAMEGUY_MODEL_KEY':'DEEPSEEK_API_KEY']);await mkdir(a.dataDir,{recursive:true});
 const rows=['sdk-app-startup','sdk-jsonrpc-server'].map(id=>({id,disabled:true}));
 rows.push({id:'system-prompt',config:{includeHarnessIdentity:false,includeRuntimeContext:true,personaPrefix:persona}});
 rows.push({insert:[{id:'gameguy-ask-user',name:'@deepseek-ai/dsh-tool-ask-user',config:{mode:'legacy'}}]});
 rows.push(...permissionRows(root,process.env.DSH_PERMISSION_MODE??'workspace-write',model.provider!=='compatible'));
 if(model.provider==='compatible'){rows.push({id:'llm-deepseek',disabled:true},{id:'llm-pi-ai',config:{providers:{gameguy:{api:'openai-completions',apiKeyEnv:'GAMEGUY_MODEL_KEY',baseURL:model.baseURL,models:modelIdsSchema.parse([model.model,...(model.models??[])]).map(id=>descriptor(id,model)),timeoutMs:60000,streamIdleTimeoutMs:30000}}}});}
 // Application-owned editable profile layer, not a command-line override. Native volatile settings can hot-update it.
 if(nativeClient){bootTrace('preparing native profile');const p=await prepareNativeProfile(root,model,a.dataDir);bootTrace('loading DSH profile');kernel=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:process.env}]),profile:'web',resolvedProfile:{profile:p.profile,installAnchor:join(root,'package.json')},patchFiles:[p.overlay],args:[]});}else{const profile=prepareProfile('sdk');await writeFile(profile.patchPath,JSON.stringify(rows));kernel=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:process.env}]),profile:'sdk',patchFiles:[],args:[]});}
 bootTrace('DSH profile loaded');const ctx=kernel.ctx;
 installProductIdentity(ctx);
 if(!ctx.sessionProjections)new SessionProjectionRegistry(ctx);
 if(!nativeClient)ctx.sessionProjections.register(selectionProjection);
 if(nativeClient)ctx.on('agent/created',async({agent})=>{if(taskOf(agent))return;const value=await host('adopt',null,'session',{sessionId:agent.session.id});agents.set(agent.id,value.taskId);handles.set(value.taskId,{handle:{agent},scope:agent.ctx,game:value.game});});
 if((!nativeClient&&(ctx.fs?.sandboxMode===undefined||ctx.shell?.sandboxMode===undefined))||!ctx.sandboxPolicy||!ctx.permissionPresets)throw Error('GameGuy requires DSH native filesystem, shell and permission services');
 const taskOf=agent=>taskOwner(ctx.agents,agents,agent);
 const isRoot=agent=>!!agent&&agents.has(agent.id)&&ctx.agents.get(agent.id)===agent;
 ctx.tools.guard(exec=>{const t=taskOf(exec.agent);if(!t)return 'No bound GameGuy task';if(!isRoot(exec.agent)&&Object.hasOwn(specs,exec.name)&&!['gameguy_catalog','gameguy_status'].includes(exec.name))return 'Delegated agents may research/code/test; root owns game effects and approvals';const h=handles.get(t);if(h?.game&&['gameguy_preview','Monitor'].includes(exec.name)&&h.game!=='clawclaw')return 'Not a ClawClaw task';if(h?.game&&['gameguy_schedule','gameguy_schedule_manage'].includes(exec.name)&&h.game!=='arknights')return 'Not an Arknights task';return undefined;});
 // Native DSH owns ask/decide audit records, one-shot grants and policy semantics.
 ctx.on('approval/request',async(req,next)=>{
  const taskId=taskOf(req.agent);if(nativeClient||!taskId||!isRoot(req.agent))return next();
  try{const allowed=await host('approval',taskId,'dsh-approval',{toolName:req.toolName,callId:req.callId,reason:req.reason,arguments:approvalArguments.get(req.callId)?.arguments},req.signal);return req.signal?.aborted?'cancelled':allowed?'allowed-once':'rejected';}
  catch{return req.signal?.aborted?'cancelled':'unavailable';}
 });
 ctx.on('user-questions/request',async(req,next)=>{
  const taskId=taskOf(req.agent);if(nativeClient||!taskId||!isRoot(req.agent))return next();
  return host('question',taskId,'dsh-question',{questions:req.questions},req.signal);
 });
 const approvalArguments=new Map();
 const forgetArguments=callId=>{const entry=approvalArguments.get(callId);entry?.dispose();approvalArguments.delete(callId);};
 ctx.on('tools/pre-execute',async(exec,next)=>{
  const taskId=taskOf(exec.agent);if(taskId)emit({type:'tool-status',taskId,agentId:exec.agent.id,name:exec.name,phase:'started'});
  if(exec.callId){const cleanup=()=>forgetArguments(exec.callId);exec.signal?.addEventListener('abort',cleanup,{once:true});approvalArguments.set(exec.callId,{arguments:exec.arguments,dispose:()=>exec.signal?.removeEventListener('abort',cleanup)});}
  try{return await next();}catch(error){forgetArguments(exec.callId);throw error;}
 });
 ctx.on('tools/post-execute',async(exec,_result,next)=>{try{return await next();}finally{forgetArguments(exec.callId);}});
 // Denied calls may skip post-execute; the final result observer covers every settled outcome.
 ctx.on('tools/result',(exec,result)=>{forgetArguments(exec.callId);const taskId=taskOf(exec.agent);if(taskId)emit({type:'tool-status',taskId,agentId:exec.agent.id,name:exec.name,phase:result.isError?'failed':'completed'});});
 for(const [name,description] of Object.entries(specs))ctx.tools.register(defineTool({name,description,parameters:{input:{type:'json',required:true,description:'Strict JSON input object. '+description}},output:{schema:{type:'json'},render:(_args,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async(args,exec)=>{const taskId=taskOf(exec.agent);if(!taskId)throw Error('task not bound');return host('tool',taskId,name,args.input,exec.signal);}}));
 ctx.on('agent/status',({agent,status})=>emit({type:isRoot(agent)?'agent-status':'child-status',taskId:taskOf(agent),agentId:agent.id,status,...(isRoot(agent)&&status==='idle'?{capabilities:runtimeCapabilities(ctx,agent)}:{})}));
 ctx.on('agent/error',({agent,error})=>emit({type:isRoot(agent)?'agent-error':'child-error',taskId:taskOf(agent),message:'Model/Agent execution failed; inspect model endpoint and credentials. No secret-bearing model error detail is exposed.'}));
 ctx.on('session/event',(session,event)=>{const entry=[...handles].find(([,h])=>h.handle.agent.session===session);if(!entry)return;if(event.type==='request/header')emit({type:'session-model',taskId:entry[0],sessionModel:modelState(ctx,entry[1])});const msg=deriveEventMessage(event);if(nativeClient&&event.type==='user/message'&&event.surfaceOp==='append'&&msg?.role==='user'&&msg.source?.kind==='user'){const text=(msg.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');emit({type:'native-user',taskId:entry[0],text});}if(msg?.role==='assistant'){const text=(msg.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');if(text)emit({type:'assistant',taskId:entry[0],text});}});
 return {...(nativeClient?{nativeURL:ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()),client:'native'}:{}),capabilities:runtimeCapabilities(ctx),agent:Boolean(ctx.agents),tools:Boolean(ctx.tools),sessions:Boolean(ctx.sessions),configured,provider:model.provider==='compatible'?'gameguy':'deepseek-official'};
}
function modelState(ctx,h){
 if(nativeClient)return ctx.sessionProjections.stateOf(h.handle.agent.session,'modelSelection')??{};
 const last=ctx.sessionProjections.stateOf(h.handle.agent.session,'gameguyModel')?.lastUsed??null;
 return {next:h.unavailable??h.selection.current,lastUsed:last,pending:!sameSelection(h.selection.current,last),unavailable:!!h.routeUnavailable,routeId:routeId(model)};
}
async function ensureSession(ctx,a){
 if(nativeClient){let sessionId=a.sessionId;if(!sessionId){const result=await ctx.sessionController.create({sessionId:'gameguy-'+a.taskId,cwd:root});sessionId=result.sessionId;}const r=await ctx.sessionController.resolveAgent(sessionId);if(r.error)throw Error('Native session unavailable');const existing=agents.get(r.agent.id);if(existing&&existing!==a.taskId){await host('merge-adoption',a.taskId,'session',{adoptedTaskId:existing,sessionId});handles.delete(existing);}agents.set(r.agent.id,a.taskId);const h={handle:{agent:r.agent},scope:r.agent.ctx,game:a.game};handles.set(a.taskId,h);return {sessionId,permission:ctx.permissionPresets.current(r.agent.session),permissionCatalog:ctx.permissionPresets.catalog(),capabilities:runtimeCapabilities(ctx,r.agent),sessionModel:modelState(ctx,h)};}
  const restriction=scope=>scope.tools.restrict({deny:Object.keys(specs).filter(name=>!allowedTools(a.game,pluginKinds.get(a.game)).includes(name))});
  if(handles.has(a.taskId)){const h=handles.get(a.taskId);h.game=a.game;h.release?.();h.release=restriction(h.scope);return {sessionId:h.handle.agent.session.id,permission:ctx.permissionPresets.current(h.handle.agent.session),permissionCatalog:ctx.permissionPresets.catalog(),capabilities:runtimeCapabilities(ctx,h.handle.agent),sessionModel:modelState(ctx,h)};}
  const options={provider:model.provider==='compatible'?'gameguy':'deepseek-official',model:model.model||'deepseek-flash',maxTokens:4096};let scopeRef,release,selection={current:{provider:providerId(model),model:model.model||'deepseek-flash'}};
  const setup=(scope,agent)=>{agents.set(agent.id,a.taskId);scopeRef=scope;release=restriction(scope);installModelSelection(agent.ctx,selection);};
  const handle=a.sessionId?await ctx.agents.resume({resumeSessionId:a.sessionId,agentOptions:options,setup}):await ctx.agents.create({sessionId:'gameguy-'+a.taskId,meta:{cwd:root},agentOptions:options,setup});
  const projected=ctx.sessionProjections.stateOf(handle.agent.session,'gameguyModel');
  if(projected?.routeId&&projected.routeId!==routeId(model))selection.current=undefined;
  else if(projected?.routeId===routeId(model))selection.current=projected.pending??projected.lastUsed??selection.current;
  if(!projected?.routeId){appendPluginRecord(handle.agent.session,'plugin:gameguy/model-route',{routeId:routeId(model),selection:selection.current});await ctx.sessions.flush(handle.agent.session);}
  const h={handle,scope:scopeRef,release,game:a.game,selection,routeUnavailable:!!projected?.routeId&&projected.routeId!==routeId(model),unavailable:projected?.routeId&&projected.routeId!==routeId(model)?projected.pending??projected.lastUsed:null};handles.set(a.taskId,h);
  return {sessionId:handle.agent.session.id,permission:ctx.permissionPresets.current(handle.agent.session),permissionCatalog:ctx.permissionPresets.catalog(),capabilities:runtimeCapabilities(ctx,handle.agent),sessionModel:modelState(ctx,h)};
 }
async function dispatch(method,a){if(method==='boot')return boot(a);if(!kernel)throw Error('kernel offline');const ctx=kernel.ctx;
 if(method==='plugins-sync'){
  const rows=a.skills??[],names=new Set(rows.map(x=>x.name));
  const prepared=await Promise.all(rows.map(async row=>({...row,content:await readFile(join(row.directory,'SKILL.md'),'utf8')})));
  pluginKinds.clear();for(const row of a.packages??[])pluginKinds.set(row.id,row.kind);
  for(const [name,record] of pluginSkills)if(!names.has(name)||prepared.find(x=>x.name===name)?.directory!==record.directory){record.dispose();pluginSkills.delete(name);}
  for(const row of prepared)if(!pluginSkills.has(row.name)){const dispose=ctx.skills.register({name:row.name,description:row.description,content:row.content,source:'bundled',provider:'gameguy-market',resourceBase:{kind:'directory',path:row.directory}});pluginSkills.set(row.name,{directory:row.directory,dispose});}
  return {skills:[...pluginSkills.keys()]};
 }

 if(method==='native-api'){if(!nativeClient)throw Error('Native client unavailable');const allow=['create','list','inspect','rename','search','fork','selectModel','modelCatalog','prompt','cancel','page'];if(!allow.includes(a.method)||typeof ctx.sessionController[a.method]!=='function')throw Error('Unsupported native method');return ctx.sessionController[a.method](a.input,new AbortController().signal);}
 if(method==='ensure'){
  const existing=ensureJobs.get(a.taskId);if(existing){await existing;return dispatch('ensure',a);}
  const job=ensureSession(ctx,a);ensureJobs.set(a.taskId,job);try{return await job;}finally{if(ensureJobs.get(a.taskId)===job)ensureJobs.delete(a.taskId);}
 }
 if(method==='update-model'){
  if(!nativeClient)throw Error('Native model update only');
  const next=a.model,ref=next.provider==='compatible'?'GAMEGUY_MODEL_KEY':'DEEPSEEK_API_KEY';
  // Credential values stay on the host seam, never in composition YAML.
  if(a.key)await ctx.credentials.set(ref,a.key);else await ctx.credentials.unset(ref);
  process.env[ref]=a.key??'';
  if(next.provider==='compatible'){
   const setting=ctx.settings.describe({redactSecrets:true}).find(s=>s.ns==='llm-pi-ai');
   await ctx.settings.mutate('llm-pi-ai',[{op:'set',path:['providers','gameguy'],value:{displayName:'GameGuy API',api:'openai-completions',apiKeyEnv:ref,baseURL:next.baseURL,models:modelIdsSchema.parse([next.model,...(next.models??[])]).map(id=>descriptor(id,next)),timeoutMs:60000,streamIdleTimeoutMs:30000}}],setting.revision);
  }
  await ctx.agentDefaultModel.saveSelection({provider:providerId(next),model:next.model});
  model=next;configured=!!a.key;return {status:'ready'};
 }
 if(method==='model-catalog'){
  const models=[];for(const p of ctx.llm.listProviders())for(const item of await ctx.llm.listModels(p.id)){
   const info=await ctx.llm.resolveModelInfo(p.id,item.id);models.push({provider:p.id,model:item.id,name:item.name,providerName:p.name,reasoning:info.reasoning??null});
  }return {models,default:{provider:providerId(model),model:model.model},routeId:routeId(model)};
 }
 if(method==='model-inventory'){
  if(model.provider!=='compatible')return dispatch('model-catalog',{});
  const ids=modelIdsSchema.parse([model.model,...(model.models??[]),...modelIdsSchema.parse(a.models)]);
  const settings=ctx.settings.describe({redactSecrets:true}).find(s=>s.ns==='llm-pi-ai');if(!settings)throw Error('Native model settings unavailable');
  await ctx.settings.mutate('llm-pi-ai',[{op:'set',path:['providers','gameguy','models'],value:ids.map(id=>descriptor(id,model))}],settings.revision);
  model={...model,models:ids};return dispatch('model-catalog',{});
 }
 if(method==='select-model'){
  const h=handles.get(a.taskId);if(!h)throw Error('session missing');const selected=selectionSchema.parse(a.selection);if(nativeClient)return ctx.sessionController.selectModel({sessionId:h.handle.agent.session.id,...selected});
  const directory=await dispatch('model-catalog',{});if(!directory.models.some(m=>m.provider===selected.provider&&m.model===selected.model))throw Error('模型不在当前连接目录中，请刷新目录或配置连接');
  const info=directory.models.find(m=>m.provider===selected.provider&&m.model===selected.model);
  if(selected.reasoningEffort&&!info.reasoning?.efforts?.some(e=>e.id===selected.reasoningEffort))throw Error('此模型未提供所选推理强度');
  const resolved=await ctx.llm.resolveCallConfig(selected);const next=selectionSchema.parse({provider:resolved.provider,model:resolved.model,...(resolved.reasoningEffort===undefined?{}:{reasoningEffort:resolved.reasoningEffort})});
  appendPluginRecord(h.handle.agent.session,'plugin:gameguy/model-route',{routeId:routeId(model)});
  h.handle.agent.session.append('model/selection',next);h.selection.current=next;h.unavailable=null;h.routeUnavailable=false;
  await ctx.sessions.flush(h.handle.agent.session);return modelState(ctx,h);
 }
 if(method==='capabilities'){const h=a.taskId?handles.get(a.taskId):undefined;return runtimeCapabilities(ctx,h?.handle.agent);}
 if(method==='permission-state'){
  const h=handles.get(a.taskId),agent=h?.handle.agent;
  if(!agent||agents.get(agent.id)!==a.taskId||ctx.agents.get(agent.id)!==agent||a.sessionId!==agent.session.id)throw Error('Live task session permission unavailable');
  return gamePermissionSnapshot(ctx,agent); // Native service context owns injection; exact session supplies effective policy.
 }
 if(method==='permissions')return ctx.permissionPresets.catalog();
 if(method==='set-permission'){
  const h=handles.get(a.taskId);if(!h)throw Error('session missing');
  return h.handle.agent.runMaintenance(async()=>{ctx.permissionPresets.set(h.handle.agent.session,a.preset);return {permission:ctx.permissionPresets.current(h.handle.agent.session)};});
 }
 if(method==='command'){
  const h=handles.get(a.taskId);if(!h)throw Error('session missing');if(typeof a.text!=='string'||!a.text.startsWith('/'))throw Error('expected native slash command');
  if(commandCalls.has(a.taskId))throw Error('此任务的命令仍在执行');
  const controller=new AbortController();commandCalls.set(a.taskId,controller);
  try{const execution=await ctx.commands.execute(h.handle.agent,a.text,[],controller.signal);
   return {execution:execution??{result:{kind:'error',text:'未知命令。可用命令：'+ctx.commands.list(h.handle.agent).map(c=>'/'+c.name).join('、')}},agentStatus:h.handle.agent.status,capabilities:runtimeCapabilities(ctx,h.handle.agent)};
  }finally{if(commandCalls.get(a.taskId)===controller)commandCalls.delete(a.taskId);}
 }
 if(method==='send'||method==='wake'){if(nativeClient){const h=handles.get(a.taskId);if(!h)throw Error('session missing');return ctx.sessionController.prompt({requestId:randomUUID(),sessionId:h.handle.agent.session.id,mode:method==='wake'?'steer':'queue',content:[{type:'text',text:a.text}]},new AbortController().signal);}if(!configured)throw Error('请先在 GameGuy 模型设置中保存 API Key');const h=handles.get(a.taskId);if(!h)throw Error('session missing');if(h.routeUnavailable)throw Error('此会话的模型连接已改变，请在对话框重新选择模型');await ctx.llm.resolveCallConfig(h.selection.current);method==='wake'?h.handle.agent.steer(user(a.text)):h.handle.agent.followup(user(a.text));return {status:'queued'};}
 if(method==='cancel'){commandCalls.get(a.taskId)?.abort();const h=handles.get(a.taskId);for(const agent of ctx.agents.list())if(taskOwner(ctx.agents,agents,agent)===a.taskId)agent.cancel({kind:'user'});h?.handle.agent.cancel({kind:'user'});return {status:'cancel-requested',remoteParticipation:'unknown'};}
 if(method==='health'){return {kernel:'ready',configured,route:model.provider==='compatible'?'gameguy':'deepseek-official',model:model.model||'deepseek-flash'};}
 if(method==='shutdown'){for(const controller of commandCalls.values())controller.abort();for(const agent of ctx.agents.list())agent.cancel({kind:'user'});for(const c of hostCalls.values()){clearTimeout(c.timer);c.reject(Error('runtime stopping'));}hostCalls.clear();await kernel.shutdown.shutdown(0);return {status:'stopped'};}
 throw Error('unknown runtime method');
}
process.on('message',async m=>{if(m.kind==='host-result'){const p=hostCalls.get(m.id);if(p){clearTimeout(p.timer);hostCalls.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.value);}return;}if(m.kind!=='request')return;try{const value=await dispatch(m.method,m.input);process.send?.({id:m.id,value});}catch(e){if(process.env.GAMEGUY_TEST_LOG==='1')console.error(e.stack);process.send?.({id:m.id,error:e.message});}});
process.on('disconnect',()=>process.exit(0));




