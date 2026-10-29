// Actual Electron startup/recovery QA. Uses only an isolated user-data directory.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const checks=[];
const check=(label,value)=>{assert.ok(value,label);checks.push(label);};
const wait=async(win,expression)=>{for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript(expression,true))return;await new Promise(r=>setTimeout(r,100));}throw Error('Startup QA timeout: '+expression);};
const dir=root=>join(root,'artifacts/verification/startup');
const capture=async(win,root,name)=>{await mkdir(dir(root),{recursive:true});await writeFile(join(dir(root),name+'.png'),(await win.webContents.capturePage()).toPNG());};
export async function runStartupLoadingSmoke(win,root,startupURL){
 await wait(win,"document.body?.dataset.stage==='loading' && !!window.gameguy");
 check('Startup initially displays only the new loading screen',win.webContents.getURL()===startupURL&&await win.webContents.executeJavaScript("document.body.innerText.includes('正在启动 GameBuddy') && !document.querySelector('.sidebar,#composer,.preview') && getComputedStyle(document.querySelector('#actions')).display==='none'"));
 await capture(win,root,process.env.GAMEGUY_STARTUP_QA_PHASE+'-loading');
}
export async function runStartupSmoke(win,service,root,loadNative,{startupURL,ready,initError}){
 const phase=process.env.GAMEGUY_STARTUP_QA_PHASE;
 assert.ok(['success','error'].includes(phase));
 const evalJS=code=>win.webContents.executeJavaScript(code,true);
 try{
  if(phase==='error'){
   check('An initialization failure is detected',!ready&&!!initError);
   await wait(win,"document.body.dataset.stage==='error'");
   check('Initialization errors stay on the new recovery page',win.webContents.getURL()===startupURL&&await evalJS("document.body.innerText.includes('GameBuddy 未能启动') && !document.querySelector('.sidebar,#composer,.preview')"));
   check('Failed initialization offers restart without pretending a retry is ready',await evalJS("!document.querySelector('#restart').hidden && document.querySelector('#retry').hidden && document.querySelector('#model-recovery').hidden"));
   await capture(win,root,'initialization-error');
  }else{
   check('Native workspace replaces the loading screen on success',ready&&!initError&&new URL(win.webContents.getURL()).origin===new URL(service.runtimeBoot.nativeURL).origin);
   const original=service.runtimeBoot.nativeURL;
   try{
    service.runtimeBoot.nativeURL='http://127.0.0.1:1/';
    await assert.rejects(loadNative());
    await wait(win,"document.body.dataset.stage==='error'");
    check('Workspace load failure returns to the new recovery page, not legacy UI',win.webContents.getURL()===startupURL&&await evalJS("!document.querySelector('.sidebar,#composer,.preview')"));
    check('Recovery keeps retry, restart and model settings available',await evalJS("!document.querySelector('#retry').hidden && !document.querySelector('#restart').hidden && !document.querySelector('#model-recovery').hidden"));
    check('Error details are hidden by default',await evalJS("!document.querySelector('#diagnostic').open && document.querySelector('#error').textContent.length>0"));
    await capture(win,root,'workspace-error');
    service.runtimeBoot.nativeURL=original;
    await evalJS("document.querySelector('#retry').click()");
    await wait(win,"!!document.querySelector('[contenteditable=true],textarea')");
    check('Retry opens the actual native workspace',new URL(win.webContents.getURL()).origin===new URL(original).origin);
    check('Retry clears the stale startup error',!(await evalJS("window.gameguy.invoke('state')")).startupError);
    // Exercise the recovery form with an isolated loopback draft; saving sends no model request.
    service.runtimeBoot.nativeURL='http://127.0.0.1:1/';await assert.rejects(loadNative());await wait(win,"document.body.dataset.stage==='error'");service.runtimeBoot.nativeURL=original;
    await evalJS("(()=>{document.querySelector('#model-recovery').open=true;const p=document.querySelector('#provider');p.value='compatible';p.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#base-url').value='http://127.0.0.1:1/v1';document.querySelector('#model-id').value='fixture-startup';document.querySelector('#api-key').value='local-startup-fixture';document.querySelector('#model-form').requestSubmit();})()");
    await wait(win,"!!document.querySelector('[contenteditable=true],textarea')");
    check('Recovery model form saves an isolated configuration and opens the workspace',service.snapshot().model.provider==='compatible'&&service.snapshot().model.model==='fixture-startup'&&new URL(win.webContents.getURL()).origin===new URL(original).origin);
   }finally{service.runtimeBoot.nativeURL=original;}
   check('No games or schedules were executed',service.snapshot().runs.length===0&&service.scheduler.list().schedules.length===0);
  }
  const result={status:'passed',phase,checks,isolatedUserData:true,realModelRequests:0,realGameActions:0};
  await mkdir(dir(root),{recursive:true});await writeFile(join(dir(root),phase+'.json'),JSON.stringify(result,null,2));console.log('STARTUP QA',JSON.stringify(result));
 }catch(e){await capture(win,root,phase+'-failure');throw e;}
}
