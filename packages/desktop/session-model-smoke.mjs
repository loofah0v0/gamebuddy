import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function runSessionModelSmoke(win,service,root){
 const endpoint=process.env.GAMEGUY_MODEL_FIXTURE_URL,u=new URL(endpoint);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.protocol,'http:');assert.equal(u.pathname,'/v1');
 const phase=process.env.GAMEGUY_MODEL_QA_PHASE;assert.ok(['initial','restart'].includes(phase));const checks=[],screenshots=[],errors=[];
 win.webContents.on('console-message',(_e,details,message)=>{if(typeof details==='object'&&details?.level==='error')errors.push(details.message);else if(details===3)errors.push(message);});
 const evaluate=code=>win.webContents.executeJavaScript(code,true);
 const wait=async(fn,label)=>{const end=Date.now()+45000;while(!await fn()){assert.ok(Date.now()<end,'Session model UI timeout: '+label);await new Promise(r=>setTimeout(r,70));}};
 const check=(label,value)=>{assert.ok(value,label);checks.push(label);};
 const field=(id,value)=>evaluate(`(()=>{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
 const submit=()=>evaluate('document.getElementById("composer").requestSubmit()');
 const choose=async model=>{await wait(()=>evaluate('!document.getElementById("session-model").disabled'),'picker available');await field('session-model',JSON.stringify(['gameguy',model]));await wait(()=>evaluate('!document.getElementById("session-model").disabled && !document.getElementById("session-model-status").textContent.includes("正在保存")'),'choice saved');};
 const openTask=async id=>{const title=service.task(id).title;await evaluate(`(()=>{const n=[...document.querySelectorAll('#tasks button')].find(n=>n.textContent.includes(${JSON.stringify(title)}));if(!n)throw Error('Task row missing');n.click()})()`);await wait(()=>evaluate('!document.getElementById("session-model").disabled'),'reopened directory');};
 const chat=async(id,label)=>{await field('prompt','GGSEATUI:'+label+' Only reply with fixture text. No tools or game actions.');await submit();await wait(()=>service.task(id).messages.some(m=>m.role==='assistant'&&m.text.includes('GGSEATUI:'+label)),label+' response');await wait(()=>service.task(id).status==='idle',label+' idle');await wait(()=>evaluate(`document.getElementById('content').textContent.includes(${JSON.stringify('GGSEATUI:'+label+' response')})`),label+' displayed');};
 await wait(()=>evaluate('document.getElementById("kernel").textContent.includes("就绪")'),'ready');
 let id;
 if(phase==='initial'){
  await click('settings');await wait(()=>evaluate('document.getElementById("model-dialog").open'),'settings open');
  await field('provider','compatible');await field('base-url',endpoint);await field('model-id','fixture-a');await field('api-key','local-session-ui-not-real');
  await evaluate('document.getElementById("model-form").requestSubmit(document.querySelector("#model-form button[type=submit]"))');
  await wait(()=>service.snapshot().model.baseURL===endpoint&&service.snapshot().model.hasKey,'model saved');await wait(()=>evaluate('!document.querySelector("#model-form button[type=submit]").disabled'),'save settled');await click('close-model');
  await field('prompt','GGSEATUI:first Only reply with fixture text. No tools or game actions.');await submit();
  await wait(()=>service.snapshot().tasks.length===1,'first task');id=service.snapshot().tasks[0].id;
  await wait(()=>service.task(id).status==='idle'&&service.task(id).messages.some(m=>m.role==='assistant'&&m.text.includes('GGSEATUI:first response')),'first response');
  await wait(()=>evaluate('document.getElementById("content").textContent.includes("GGSEATUI:first response")'),'first displayed');
  await wait(()=>evaluate('!document.getElementById("session-model").disabled'),'initial directory');
  check('Composer displays the existing session default model',await evaluate('document.getElementById("session-model").value===\'["gameguy","fixture-a"]\''));
  const pid=service.runtime.child.pid,session=service.task(id).sessionId,before=service.task(id).messages.length;
  await click('refresh-session-models');await wait(()=>evaluate('!document.getElementById("refresh-session-models").disabled && document.getElementById("session-model").options.length===3'),'remote directory');
  check('Composer refresh loads saved-endpoint provider-grouped models',await evaluate('document.querySelectorAll("#session-model optgroup").length===1 && document.getElementById("session-model").textContent.includes("fixture-b")'));
  check('Compatible adapter hides arbitrary reasoning input',await evaluate('document.getElementById("session-effort").hidden'));
  await choose('fixture-b');
  check('Composer selection is per-session pending state',service.task(id).sessionModel.next.model==='fixture-b'&&service.task(id).sessionModel.pending);
  check('Switch does not restart kernel, send chat or change global default',service.runtime.child.pid===pid&&service.task(id).sessionId===session&&service.task(id).messages.length===before&&service.snapshot().model.model==='fixture-a');
  await field('prompt','/model');await submit();await wait(()=>evaluate('document.activeElement.id==="session-model"'),'slash focus');
  check('/model focuses the same selection without a model/chat request',service.task(id).messages.length===before&&await evaluate('document.getElementById("session-model").value===\'["gameguy","fixture-b"]\''));
  await chat(id,'second');check('Desktop displays chosen-model response and preserved prior history',service.task(id).sessionModel.lastUsed.model==='fixture-b'&&!service.task(id).sessionModel.pending&&service.task(id).messages.some(m=>m.text.includes('GGSEATUI:first')));
  // Hold an owned service reply to exercise a real renderer navigation race.
  const original=service.sessionModels.bind(service);let release,entered=false;
  service.sessionModels=async(...args)=>{const value=await original(...args);entered=true;await new Promise(r=>{release=r;});return value;};
  await click('refresh-session-models');await wait(()=>entered,'delayed response');await click('new-task');await wait(()=>evaluate('document.querySelectorAll(".game-card").length===3'),'navigate away');release();service.sessionModels=original;await new Promise(r=>setTimeout(r,150));await openTask(id);
  check('Directory response settles while away; revisiting is not stuck loading',await evaluate('!document.getElementById("session-model").disabled && document.getElementById("session-model").options.length===3'));
  service.sessionModels=async()=>{throw Error('QA directory unavailable');};await click('refresh-session-models');await wait(()=>evaluate('document.getElementById("session-model-status").textContent.includes("QA directory unavailable")'),'failure displayed');service.sessionModels=original;
  check('Failed directory refresh retains displayed groups/selection',await evaluate('!document.getElementById("session-model").disabled && document.getElementById("session-model").value===\'["gameguy","fixture-b"]\''));
  await service.stop(id);await choose('fixture-a');
  check('Selecting a stopped task never resumes or submits it',service.task(id).status==='stopped'&&service.task(id).cancelled&&service.task(id).sessionModel.next.model==='fixture-a'&&service.task(id).messages.filter(m=>m.role==='user').length===2);
  await click('new-task');await wait(()=>evaluate('document.querySelectorAll(".game-card").length===3 && document.getElementById("session-model").disabled'),'new draft rendered');check('New draft still shows global default, not the previous session choice',await evaluate('document.getElementById("session-model").disabled && document.getElementById("session-model").textContent.includes("fixture-a")'));
  await openTask(id);await click('refresh-session-models');await wait(()=>evaluate('!document.getElementById("refresh-session-models").disabled && !document.getElementById("session-model-status").textContent.includes("QA directory unavailable")'),'directory recovery');
  check('Successful refresh clears a prior directory error without losing pending choice',service.task(id).sessionModel.next.model==='fixture-a'&&await evaluate(`document.getElementById('session-model').value==='["gameguy","fixture-a"]'`));
 }else{
  check('Restart restores endpoint inventory without exposing credentials',service.snapshot().model.baseURL===endpoint&&service.snapshot().model.hasKey&&service.inventory().includes('fixture-b'));
  id=service.snapshot().tasks[0].id;await openTask(id);
  check('Restart restores unconsumed native session choice and stopped state',service.task(id).sessionModel.next.model==='fixture-a'&&service.task(id).sessionModel.lastUsed.model==='fixture-b'&&service.task(id).sessionModel.pending&&service.task(id).status==='stopped');
  await chat(id,'restart');check('Restored session model routes a real request while retaining history',service.task(id).sessionModel.lastUsed.model==='fixture-a'&&service.task(id).messages.some(m=>m.text.includes('GGSEATUI:second response')));
 }
 win.setSize(1080,720);await new Promise(r=>setTimeout(r,350));
 check('Model picker remains reachable at minimum desktop viewport',await evaluate('(()=>{const r=document.getElementById("session-model").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'));
 check('Isolated UI QA performs no game actions',service.snapshot().runs.length===0&&service.snapshot().schedules.schedules.length===0&&service.store.data.enabled.length===0);
 const dir=join(root,'artifacts/verification/session-model-desktop-v03');await mkdir(dir,{recursive:true});const image=join(dir,phase+'.png');await writeFile(image,(await win.webContents.capturePage()).toPNG());screenshots.push(image);
 check('No renderer console errors',errors.length===0);
 const report={status:'passed',date:new Date().toISOString(),phase,checks,screenshots,isolatedUserData:true,realModelRequests:0,realGameActions:0};await writeFile(join(dir,phase+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
