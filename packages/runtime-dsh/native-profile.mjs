import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareProfile} from '@deepseek-ai/dsh/profile-boot';
import {permissionRows} from './permissions.mjs';
import {descriptor,modelIdsSchema} from './model-selection.mjs';
import {persona} from './persona.mjs';
import {sessionCompression} from './session-compression.mjs';
export async function prepareNativeProfile(root,model,dataDir){
 const sessions=join(dataDir,'sessions'),compression=await sessionCompression(sessions);
 let profile=prepareProfile('web');
 let initialized=false;try{const existing=await readFile(profile.patchPath,'utf8');initialized=existing.trim().endsWith('[]');}catch(e){if(e.code!=='ENOENT')throw e;initialized=true;}
 if(initialized){
  const rows=[{id:'ui-settings',config:{enabled:true}},...permissionRows(root,'workspace-write',model.provider!=='compatible'),{id:'agent-default-model',config:{provider:model.provider==='compatible'?'gameguy':'deepseek-official',model:model.model||'deepseek-flash'}}];
  if(model.provider==='compatible')rows.push({id:'llm-pi-ai',config:{providers:{gameguy:{displayName:'GameGuy API',api:'openai-completions',apiKeyEnv:'GAMEGUY_MODEL_KEY',baseURL:model.baseURL,models:modelIdsSchema.parse([model.model,...(model.models??[])]).map(id=>descriptor(id,model)),timeoutMs:60000,streamIdleTimeoutMs:30000}}}});
  // Native settings owns this editable file after the first bootstrap; never overwrite it on restart.
  let yaml=rows.map(row=>'- '+JSON.stringify(row)).join('\n')+'\n';
  for(const name of ['standard','ptc','minimal','cordis']){
   const text=await readFile(join(root,'node_modules/@deepseek-ai/dsh-web-app/presets',name+'.patch.yml'),'utf8');
   const body=text.slice(text.indexOf('- insert:')+10).trimStart().split('\n');
   yaml+=body.map((line,i)=>i===0?line:line.replace(/^ {4}/,'')).join('\n').replace(/prefix: You are a coding agent powered by the \{\{model\}\} model\./g,'prefix: '+JSON.stringify(persona))+'\n';
  }
  await writeFile(profile.patchPath,yaml);
 }
 profile=prepareProfile('web'); // Reload the editable bootstrap before composing the native client.
 const overlay=join(profile.dir,'gameguy-deployment.json');
 await writeFile(overlay,JSON.stringify([
  {id:'web-startup',disabled:true},{id:'webserver',inject:[],config:{host:'127.0.0.1',port:0,compression:'gzip'}},
  {id:'web-runtime',inject:[],config:{openBrowser:false,printUrl:false,surfaceContext:false}},
  {id:'connection',inject:[],config:{trustedHosts:[]}},
  {id:'credentials',name:'@gameguy/native-client/credentials'},
  {id:'system-prompt',config:{includeHarnessIdentity:false,includeRuntimeContext:true,personaPrefix:persona}},
  {id:'session-title-llm',disabled:true},{id:'desktop-product-telemetry',disabled:true},{id:'product-analytics',disabled:true},
  {id:'ui-settings-account',disabled:true},{id:'account-controller',disabled:true},{id:'deepseek-account',disabled:true},
  {id:'session-log-deepseek',disabled:true},{id:'session-telemetry-otel',disabled:true},{id:'ui-settings-session-log',disabled:true},
  {id:'session-persistence-jsonl',config:{root:sessions,compression}},
  {id:'workspace-controller',config:{documentsDirectory:join(dataDir,'workspaces')}},
  {id:'ui-plugin-manager',disabled:true},
  {id:'ui-brand-official',disabled:true},{id:'ui-sidebar-browser',disabled:false},
  {id:'session-query-sqlite',config:{path:':memory:',openAt:'first-search'}},
  {insert:[{id:'gameguy-agent-extensions',name:'@gameguy/agent-extensions'},{id:'gameguy-native-client',name:'@gameguy/native-client'}]}
 ]));return {profile,overlay};
}
