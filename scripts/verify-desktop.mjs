import {resolveElectronRuntime} from './electron-runtime.mjs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const dataDir=await mkdtemp(join(tmpdir(),'gameguy-desktop-smoke-'));
const env={...process.env,GAMEGUY_NODE:process.execPath,GAMEGUY_TEST_DATA:dataDir};delete env.ELECTRON_RUN_AS_NODE;
let exitCode;
const attempt=async status=>{const dir=join(root,'artifacts/verification');await mkdir(dir,{recursive:true});await writeFile(join(dir,'product-desktop-latest-attempt.json'),JSON.stringify({status,date:new Date().toISOString(),command:'verify:desktop',exitCode,expectedChecks:24,validatedDesktopChecks:status==='passed'?24:0,isolatedUserData:true,realModelRequests:0,realGameActions:0,...(status==='failed'?{note:'Desktop QA process failed; historical success report is not evidence for this attempt.'}:{})},null,2)+'\n');};
try{
 const electron=await resolveElectronRuntime();
 const child=spawn(electron,[join(root,'packages/desktop/main.mjs'),'--smoke-product'],{cwd:root,env,windowsHide:true,stdio:'inherit'});
 const timer=setTimeout(()=>{console.error('Desktop smoke timed out');child.kill('SIGKILL');},120000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
 exitCode=code;if(code!==0)throw Error('Independent desktop smoke failed: '+code);
 await attempt('passed');
}catch(error){await attempt('failed');throw error;}finally{if(resolve(dirname(dataDir))!==resolve(tmpdir())||!basename(dataDir).startsWith('gameguy-desktop-smoke-'))throw Error('Unsafe desktop QA cleanup');await rm(dataDir,{recursive:true,force:true});}
