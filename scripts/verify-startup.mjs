// Runs real Electron in temporary profiles. Never accesses a user's games or schedules.
import {resolveElectronRuntime} from './electron-runtime.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),executable=await resolveElectronRuntime();
for(const phase of ['success','error']){
 const dir=await mkdtemp(join(tmpdir(),'gameguy-desktop-smoke-startup-'));
 try{
  if(phase==='error')await writeFile(join(dir,'tasks.json'),'{invalid fixture json');
  const env={...process.env,GAMEGUY_NODE:process.execPath,GAMEGUY_TEST_DATA:dir,GAMEGUY_STARTUP_QA_PHASE:phase,GAMEGUY_TEST_LOG:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[join(root,'packages/desktop/main.mjs'),'--smoke-startup'],{cwd:root,env,windowsHide:true,stdio:'inherit'});
  const timer=setTimeout(()=>{console.error('Startup QA timed out');child.kill();},130000);
  const code=await new Promise((ok,bad)=>{child.once('error',bad);child.once('exit',ok);});clearTimeout(timer);if(code!==0)throw Error('Startup QA '+phase+' failed: '+code);
 }finally{
  if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-desktop-smoke-startup-'))throw Error('Unsafe startup QA cleanup');
  const installed=resolve(root,'product/installed',createHash('sha256').update(JSON.stringify(dir)).digest('hex').slice(0,20));
  if(!installed.startsWith(resolve(root,'product/installed')+sep))throw Error('Unsafe package cleanup');
  await rm(installed,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});
 }
}
