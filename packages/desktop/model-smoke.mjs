// Explicit isolated QA. Only an owned loopback fixture endpoint; never user's model settings.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
export async function runModelSmoke(win,service,root,dataDir,loadKey){
 const endpoint=process.env.GAMEGUY_MODEL_FIXTURE_URL;
 const u=new URL(endpoint);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.protocol,'http:');assert.equal(u.pathname,'/v1');
 const phase=process.env.GAMEGUY_MODEL_QA_PHASE;assert.ok(['initial','restart'].includes(phase));
 const key='gameguy-local-model-qa-not-a-real-secret',checks=[],shots=[];
 const evaluate=code=>win.webContents.executeJavaScript(code,true);
 const wait=async(fn,label)=>{const until=Date.now()+30000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('Model QA timed out: '+label);};
 const check=(label,ok)=>{assert.ok(ok,label);checks.push(label);};
 const field=(id,value)=>evaluate('(()=>{const n=document.getElementById('+JSON.stringify(id)+');n.value='+JSON.stringify(value)+';n.dispatchEvent(new Event('+JSON.stringify('input')+',{bubbles:true}));if(n.tagName==="SELECT")n.dispatchEvent(new Event("change",{bubbles:true}));})()');
 const click=id=>evaluate('document.getElementById('+JSON.stringify(id)+').click()');
 const model=()=>service.snapshot().model;
 await wait(()=>evaluate('document.getElementById("kernel").textContent.includes("就绪")'),'kernel ready');
 async function open(){await click('settings');await wait(()=>evaluate('document.getElementById("model-dialog").open'),'settings open');}
 async function save(url,id,newKey='',valid=true){
  await field('provider','compatible');await field('base-url',url);await field('model-id',id);await field('api-key',newKey);
  await evaluate('document.getElementById("model-result").textContent="";document.getElementById("model-form").requestSubmit(document.querySelector("#model-form button[type=submit]"))');
  await wait(()=>evaluate('!document.querySelector("#model-form button[type=submit]").disabled && !!document.getElementById("model-result").textContent'),'save result');
  if(valid)assert.notEqual(await evaluate('document.getElementById("model-result").dataset.status'),'error','Save rejected unexpectedly');
  return evaluate('document.getElementById("model-result").textContent');
 }
 async function chat(label,success=true){
  await click('close-model');await click('new-task');await wait(()=>evaluate('document.querySelectorAll(".game-card").length===3'),'new task');
  const count=service.snapshot().tasks.length;
  await field('prompt','GGURLQA:'+label+' Only return fixture reply. No games, no tools.');
  await evaluate('document.getElementById("composer").requestSubmit()');
  await wait(()=>{const t=service.snapshot().tasks[0];return service.snapshot().tasks.length===count+1 && (success?t.messages.some(m=>m.role==='assistant'&&m.text.includes('GGURLQA:'+label)):t.status==='failed');},label+' response');
  await wait(()=>service.snapshot().tasks.every(t=>!['thinking','stopping'].includes(t.status)),label+' idle');
  if(!success){const t=service.snapshot().tasks[0];check('Unauthorized API response is a failed task, not a successful save/response',t.status==='failed');check('Endpoint error payload cannot leak key to UI/history',!JSON.stringify(t.messages).includes(key));}
  else check('Actual DSH request and renderer reply: '+label,await evaluate('document.getElementById("content").textContent.includes('+JSON.stringify('GGURLQA:'+label)+')'));
  await open();
 }
 async function probe(button,result){await click(button);await wait(()=>evaluate('!document.getElementById('+JSON.stringify(button)+').disabled && document.getElementById('+JSON.stringify(result)+').dataset.status!=="loading"'),'probe '+button);return evaluate('document.getElementById('+JSON.stringify(result)+').textContent');}
 const dir=join(root,'artifacts/verification/model-url-v03');await mkdir(dir,{recursive:true});
 async function shot(name){await new Promise(r=>setTimeout(r,250));const file=join(dir,name+'.png');await writeFile(file,(await win.webContents.capturePage()).toPNG());shots.push(file);}
 async function savedFiles(){const out={};for(const name of ['model.json','credentials.bin'])try{out[name]=(await readFile(join(dataDir,name))).toString('base64');}catch(error){if(error.code!=='ENOENT')throw error;out[name]=null;}return JSON.stringify(out);}
 await open();
 if(phase==='initial'){
  const before=JSON.stringify(model()),files=await savedFiles(),pid=service.runtime.child.pid;
  check('Missing draft key fails before requesting models',(await probe('discover-models','catalog-result')).includes('请填写 API Key'));
  check('Missing draft key fails before verifying API',(await probe('verify-model','api-result')).includes('请填写 API Key'));
  await field('provider','compatible');await field('base-url','  '+endpoint+'///  ');await field('api-key',key);await field('model-id','');
  check('Draft discovers models without requiring a model ID',(await probe('discover-models','catalog-result')).includes('2 个模型'));
  check('Directory dropdown de-duplicates and filters reflected credential',await evaluate('document.getElementById("model-select").options.length===3 && !document.getElementById("model-select").textContent.includes('+JSON.stringify(key)+')'));
  await field('model-select','fixture-model');check('Dropdown selection fills model ID',await evaluate('document.getElementById("model-id").value==="fixture-model"'));
  check('Verify button performs selected-model inference',(await probe('verify-model','api-result')).includes('API 验证通过'));
  check('Draft probes do not persist model/key, restart kernel or create tasks',before===JSON.stringify(model())&&files===await savedFiles()&&pid===service.runtime.child.pid&&service.snapshot().tasks.length===0);
  await shot('draft-api-validated');
  win.setSize(1080,720);await wait(()=>evaluate('window.innerWidth<=1080'),'minimum model viewport');
  await evaluate('document.getElementById("verify-model").scrollIntoView({block:"center"})');await new Promise(r=>setTimeout(r,250));
  check('Model dialog fits minimum desktop viewport without horizontal overflow',await evaluate('(()=>{const d=document.getElementById("model-dialog"),r=d.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth+2})()'));
  await evaluate('document.querySelector("#model-form button[type=submit]").scrollIntoView({block:"center"})');
  check('Save remains reachable by scrolling minimum-height dialog',await evaluate('(()=>{const r=document.querySelector("#model-form button[type=submit]").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()'));
  await shot('model-settings-1080');win.setSize(1450,930);
  await field('model-id','fixture-reject');check('Editing selected model invalidates previous validation',await evaluate('document.getElementById("api-result").dataset.status==="idle"'));
  check('Unauthorized verification is failure without leaking response key',!(await probe('verify-model','api-result')).includes(key)&&await evaluate('document.getElementById("api-result").dataset.status==="error"'));
  for(const [prefix,pattern] of [['empty','目录为空'],['missing','手动填写'],['redirect','不跟随重定向']]){
   await field('base-url',endpoint.replace('/v1','/'+prefix+'/v1'));const text=await probe('discover-models','catalog-result');check('Catalog '+prefix+' has explicit fallback and no stale models',text.includes(pattern)&&await evaluate('document.getElementById("model-select").disabled && document.getElementById("model-select").options.length===1'));
  }
  await field('base-url',endpoint.replace('/v1','/slow/v1'));await click('discover-models');await new Promise(r=>setTimeout(r,250));await field('base-url',endpoint);
  await wait(()=>evaluate('!document.getElementById("discover-models").disabled'),'stale catalog settled');
  check('Late catalog response cannot populate a changed endpoint',await evaluate('document.getElementById("model-select").options.length===1 && document.getElementById("catalog-result").dataset.status!=="success"'));
 }
 if(phase==='initial'){
  check('Initial isolated app has no model key',!model().hasKey);
  const text=await save('  '+endpoint+'///  ','  fixture-model  ',key);
  check('UI saves and canonicalizes URL/model ID',model().baseURL===endpoint&&model().model==='fixture-model'&&model().hasKey);
  check('Save does not pretend API connectivity was verified',text.includes('尚未验证 API'));
  check('Password input cleared after save',await evaluate('document.getElementById("api-key").value===""'));
  const config=await readFile(join(dataDir,'model.json'),'utf8');const encrypted=await readFile(join(dataDir,'credentials.bin'));
  check('Key absent from model JSON and encrypted bytes',!config.includes(key)&&!encrypted.includes(Buffer.from(key))&&(await loadKey())===key);
  await chat('first');
  const stable=await savedFiles(),stableModel=JSON.stringify(model()),pid=service.runtime.child.pid;
  check('Directory fetch can reuse encrypted same-route key without revealing it',(await probe('discover-models','catalog-result')).includes('2 个模型')&&await evaluate('document.getElementById("api-key").value===""'));
  check('API verification can reuse encrypted same-route key',(await probe('verify-model','api-result')).includes('API 验证通过'));
  check('Saved-key probes leave persisted settings and DSH process unchanged',stable===await savedFiles()&&stableModel===JSON.stringify(model())&&pid===service.runtime.child.pid);
  check('Repeated same-draft API validation reflects a new authentication failure',!(await probe('verify-model','api-result')).includes(key)&&await evaluate('document.getElementById("api-result").dataset.status==="error"'));
  await evaluate('document.getElementById("model-result").textContent="";document.getElementById("model-form").requestSubmit(document.querySelector("#model-form button[type=submit]"))');
  await wait(()=>evaluate('!document.querySelector("#model-form button[type=submit]").disabled && !!document.getElementById("model-result").textContent'),'save after failed revalidation');
  check('Saving after failed revalidation does not reuse an earlier success',await evaluate('document.getElementById("model-result").textContent.includes("尚未验证 API")'));
  check('A later explicit successful validation can restore readiness',(await probe('verify-model','api-result')).includes('API 验证通过'));
  await evaluate('document.getElementById("model-form").requestSubmit(document.querySelector("#model-form button[type=submit]"))');
  await wait(()=>evaluate('!document.querySelector("#model-form button[type=submit]").disabled'),'verified save');
  check('Verified draft save is distinguished from an unverified save',await evaluate('document.getElementById("model-result").textContent.includes("已通过本次 API 验证") && !document.getElementById("api-result").textContent.includes("尚未保存")'));
  await field('base-url',endpoint.replace('/v1','/other/v1'));
  check('Endpoint change clears model directory and prior validation',await evaluate('document.getElementById("model-select").options.length===1 && document.getElementById("api-result").dataset.status==="idle"'));
  check('Changed endpoint never receives saved key during catalog discovery',(await probe('discover-models','catalog-result')).includes('请填写 API Key'));
  check('Changed endpoint never receives saved key during verification',(await probe('verify-model','api-result')).includes('请填写 API Key'));
  await field('base-url',endpoint);

  for(const [label,url] of [['malformed','not a url'],['remote HTTP','http://example.com/v1'],['credentials','https://user:password@example.com/v1'],['query','https://example.com/v1?api_key=private'],['fragment','https://example.com/v1#private'],['completion endpoint',endpoint+'/chat/completions'],['models endpoint',endpoint+'/models']]){
   const before=JSON.stringify(model()),bytes=await readFile(join(dataDir,'credentials.bin'));
   const error=await save(url,'fixture-model','should-not-be-saved',false);
   check('Reject '+label+' without replacing config/key',!error.includes('内核已就绪')&&JSON.stringify(model())===before&&(await readFile(join(dataDir,'credentials.bin'))).equals(bytes));
  }
  await save(endpoint+'/','fixture-model','');check('Blank key retains key on equivalent canonical URL',(await loadKey())===key&&model().hasKey);await chat('retained');
  await save(endpoint,'fixture-reject','');await chat('unauthorized',false);
  const alternate=endpoint.replace('/v1','/custom/v1');await save(alternate,'fixture-model','');
  check('Changing API route never reuses previous key',!model().hasKey&&(await loadKey())==='');
  await save(alternate,'fixture-model',key);await chat('custom');
  await save(endpoint,'fixture-model',key);
  check('Final initial settings can be explicitly verified again',(await probe('verify-model','api-result')).includes('API 验证通过'));
 }else{
  check('Independent app restart restores canonical model URL and model ID',model().baseURL===endpoint&&model().model==='fixture-model');
  check('Independent app restart decrypts persisted key',model().hasKey&&(await loadKey())===key);
  check('Model dialog restores URL but never reveals key',await evaluate('document.getElementById("base-url").value === '+JSON.stringify(endpoint)+' && document.getElementById("api-key").value === ""'));
  await chat('restart');
  check('Restart supports catalog discovery with restored encrypted key',(await probe('discover-models','catalog-result')).includes('2 个模型'));
  check('Restart supports explicit selected-model API validation',(await probe('verify-model','api-result')).includes('API 验证通过'));

 }
 check('QA never installed game plugins or created game runs/schedules',service.snapshot().runs.length===0&&service.store.data.enabled.length===0&&service.snapshot().schedules.schedules.length===0);
 await shot(phase);
 const report={status:'passed',date:new Date().toISOString(),phase,checks,screenshots:shots,isolatedUserData:true,realModelRequests:0,realGameActions:0};
 await writeFile(join(dir,phase+'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
