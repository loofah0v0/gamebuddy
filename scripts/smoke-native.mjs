/** Native DSH integration smoke. No LLM, emulator or paid game operation. */
import {runProfile} from '@deepseek-ai/dsh/profile-boot';
import {createLaunchEnvironmentSnapshot} from '@deepseek-ai/dsh-launch-environment';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';

// Native DSH prints a private launch URL. Never retain that credential in logs.
for (const stream of [process.stdout,process.stderr]) {
  const write=stream.write.bind(stream);
  stream.write=(chunk,...args)=>write(typeof chunk==='string'?chunk.replace(/([?&]token=)[^&\s]+/g,'$1[redacted]'):chunk,...args);
}
const root=resolve(import.meta.dirname,'..');
process.env.DSH_HOME=join(root,'.runtime/dsh');
process.env.PATH=join(root,'node_modules/.bin')+';'+process.env.PATH;
// Never write synthetic instance configuration into the user's GameGuy state.
const fixtureDir=await mkdtemp(join(tmpdir(),'gameguy-native-smoke-'));
const overlay=join(fixtureDir,'cordis.patch.json');
await writeFile(overlay,JSON.stringify([{id:'gameguy-core',config:{dataDir:join(fixtureDir,'state'),catalogRoot:join(root,'packages'),autoInstallTrusted:true}}]));
const {ctx,shutdown}=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:process.env}]),profile:'gameguy',patchFiles:[overlay],args:['--no-open','--port','18765']});
try {
  assert(ctx.gameguy,'GameGuy provider missing');
  assert.equal(resolve(ctx.gameguy.dataDir),resolve(fixtureDir,'state'),'Smoke fixture must have isolated GameGuy state');
  const tools=ctx.tools.schemas().filter(t=>t.name.startsWith('gameguy_')).map(t=>t.name);
  assert.equal(tools.length,12);console.log('PASS provider + 12 tools');
  for (const game of ['arknights','minecraft','clawclaw']) {
    const result=await ctx.tools.get('gameguy_install').execute({input:{game}},{signal:new AbortController().signal});
    assert.equal(result.activated,true,'Install activation result missing: '+game);
    const again=await ctx.tools.get('gameguy_install').execute({input:{game}},{signal:new AbortController().signal});
    assert.equal(again.activated,true,'Idempotent install must report activation');
    assert(ctx.gameguy.plugins.has(game),'Native plugin not activated: '+game);
    console.log('PASS native install/enable '+game);
  }
  const names=(await ctx.skills.list()).map(s=>s.name);
  for (const name of ['gameguy','gameguy-arknights','gameguy-minecraft','gameguy-clawclaw','clawclaw']) {
    assert(names.includes(name),'Missing Skill: '+name);
    const skill=await ctx.skills.get(name);assert(skill?.content.length>100,'Skill has no body: '+name);
  }
  console.log('PASS 5 Skills, including dependency-owned official ClawClaw');
  // Synthetic fixture ONLY: exercise real native durable storage; no model/device call.
  const {captureGameScreenshot,screenshotContent}=await import('../packages/core/lib/capture.js');
  const attachments=ctx.get('attachments');assert(attachments,'Native attachment provider missing');
  const fixturePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const fixtureCtx={get:key=>key==='llm'?{resolveModelInfo:async()=>({inputModalities:['text','image']})}:ctx.get(key)};
  const value=await captureGameScreenshot(fixtureCtx,{screenshot:async()=>fixturePng},'smoke-fixture',{signal:new AbortController().signal,agent:{options:{provider:'fixture-only',model:'synthetic-vision-route'},session:{requestHeader:()=>undefined}}});
  const stored=await attachments.readImage(value.image);assert(stored.data.length>0);assert.equal(value.deviceDimensions.width,1);assert.equal(value.deviceDimensions.height,1);
  assert.equal(screenshotContent(value)[1].type,'image');assert(attachments.imageHostPath(value.image));
  console.log('PASS real native attachment save/read + image content (synthetic PNG, not model/game E2E)');

  const base='http://127.0.0.1:18765/';
  const request=(path,options={})=>fetch(new URL(path,base),{signal:AbortSignal.timeout(10000),...options});
  for(const path of ['gameguy/state','gameguy/preview','gameguy/image','gameguy/stop','gameguy/device','gameguy/device/start']) {
    assert.equal((await request(path)).status,401,'Unauthenticated route '+path);
  }
  // Exchange native launch token, keep cookie in memory only.
  const auth=await fetch(ctx.connection.authenticatedUrl(base),{redirect:'manual',signal:AbortSignal.timeout(10000)});
  assert([302,303,307].includes(auth.status),'Native token exchange did not redirect');
  const cookie=auth.headers.getSetCookie().map(h=>h.split(';',1)[0]).join('; ');
  assert(cookie,'Native cookie missing');
  const headers={cookie};
  const stateResponse=await request('gameguy/state',{headers});assert.equal(stateResponse.status,200);
  const state=await stateResponse.json();assert.equal(state.catalog.filter(x=>x.enabled).length,3);
  assert.equal((await request('gameguy/state',{headers:{...headers,origin:'https://invalid.example'}})).status,403);
  assert.equal((await request('gameguy/state',{method:'POST',headers})).status,405);
  assert.equal((await request('gameguy/stop',{headers})).status,405);
  assert.equal((await request('gameguy/stop',{method:'POST',headers,body:'{}'})).status,415);
  assert.equal((await request('gameguy/stop',{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}'})).status,409);
  assert.equal((await request('gameguy/stop',{method:'POST',headers:{...headers,'content-type':'application/jsonfoo'},body:'{}'})).status,415);
  console.log('PASS native cookie auth + cross-origin rejection + method/body guards');
  for(const path of ['gameguy/device','gameguy/device/start']){
    assert.equal((await request(path,{method:'POST',headers})).status,415);
    assert.equal((await request(path,{method:'POST',headers:{...headers,'content-type':'application/json',origin:'https://invalid.example'},body:'{}'})).status,403);
    assert.equal((await request(path,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}'})).status,409);
  }
  assert.equal((await request('gameguy/device/start',{headers})).status,405);
  // Replace ONLY the isolated smoke adapter's launcher/screenshot with synthetic callbacks.
  // Never run the real installed emulator as part of a host/HTTP smoke.
  const adapter=ctx.gameguy.adapter('arknights'),startDevice=adapter.startDevice,screenshot=adapter.screenshot;
  let starts=0;
  try{
    adapter.startDevice=async(c,_signal,progress)=>{starts++;progress('SYNTHETIC startup');return {config:{...c,address:'127.0.0.1:19999'},detail:{synthetic:true}};};
    adapter.screenshot=async()=>fixturePng;
    await ctx.gameguy.configure('arknights','device-fixture',{emulator:{type:'mumu',cliPath:'D:/fixture/mumu-cli.exe',instanceIndex:0}});
    const requested=await ctx.tools.get('gameguy_device').execute({input:{instance:'device-fixture'}},{signal:new AbortController().signal});
    assert.equal(requested.status,'confirmation-required');assert(!('token' in requested));assert.equal(starts,0);
    const prompt=await (await request('gameguy/device?instance=device-fixture',{headers})).json();assert(prompt.token);
    assert(!(await (await request('gameguy/state',{headers})).text()).includes(prompt.token));
    const start=await request('gameguy/device/start',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({instance:'device-fixture',token:prompt.token})});assert.equal(start.status,200);
    // Endpoint persistence may temporarily hide a config-fingerprint-bound status.
    let deviceStatus;
    for(let i=0;i<200;i++){deviceStatus=ctx.gameguy.snapshot().devices.find(d=>d.instance==='device-fixture');if(deviceStatus&&deviceStatus.status!=='starting')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(deviceStatus?.status,'ready', 'Synthetic startup did not settle: '+JSON.stringify(deviceStatus));assert.equal(starts,1);assert.equal(ctx.gameguy.config('device-fixture').value.address,'127.0.0.1:19999');
    const image=await request('gameguy/image',{headers});assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),fixturePng);
    assert.equal((await request('gameguy/device/start',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({instance:'device-fixture',token:prompt.token})})).status,409);
    console.log('PASS native MuMu request/confirmation/endpoint persistence + screenshot route (SYNTHETIC; no emulator launch)');
  }finally{
    // Select an idle non-ADB fixture before restoring real handlers or opening a browser.
    try{await ctx.gameguy.configure('minecraft','smoke-idle-fixture',{});await ctx.gameguy.preview('smoke-idle-fixture');}
    finally{adapter.startDevice=startDevice;adapter.screenshot=screenshot;}
  }

  const previewResponse=await request('gameguy/preview',{headers});assert.equal(previewResponse.status,200);
  assert.match(previewResponse.headers.get('content-type'),/^text\/html/);
  assert.equal(previewResponse.headers.get('cache-control'),'no-store');
  assert.equal(previewResponse.headers.get('x-frame-options'),'SAMEORIGIN');
  assert.equal(previewResponse.headers.get('content-security-policy'),"frame-ancestors 'self'");
  const preview=await previewResponse.text();assert(preview.includes('停止 / 接管'));
  new Script(preview.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const rootResponse=await request('',{headers});assert.equal(rootResponse.status,200);
  assert((await rootResponse.text()).includes('__DSH_BOOT__'),'Native web boot manifest missing');
  const graph=ctx.clientModules.graph();
  for(const id of ['@gameguy/core','@deepseek-ai/dsh-client-ui-sidebar-browser']) {
    const entry=graph.entries.find(e=>e.id===id);assert(entry,'Missing native client entry: '+id);
    const response=await request(entry.url,{headers});assert.equal(response.status,200,'Client asset unavailable: '+id);
    const script=await response.text();new Script(script);assert(script.includes('__ModuleLoader__'));
  }
  console.log('PASS preview HTML + native web boot + GameGuy/browser client assets');
  if(process.env.GAMEGUY_VERIFY_BROWSER==='1'){
    const {verifyNativeBrowser}=await import('./verify-native-browser.mjs');
    const workspace=await ctx.workspaceRegistry.create(fixtureDir,'GameGuy UI verification '+Date.now());
    try { await verifyNativeBrowser(base,cookie,ctx.gameguy,{id:workspace.id,title:workspace.title}); }
    finally { await ctx.workspaceRegistry.delete(workspace.id); }
  }
  console.log('SMOKE_OK (native integration only; no model/game end-to-end claim)');
} finally { await shutdown.shutdown(0); }

