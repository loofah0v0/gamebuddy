import {resolveElectronRuntime} from './electron-runtime.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'gameguy-desktop-smoke-market-'));
try{
 await writeFile(join(dir,'model.json'),JSON.stringify({provider:'compatible',model:'market-fixture',baseURL:'http://127.0.0.1:1/v1',vision:false}));
 const executable=await resolveElectronRuntime(),env={...process.env,GAMEGUY_NODE:process.execPath,GAMEGUY_TEST_DATA:dir,GAMEGUY_TEST_LOG:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(executable,[join(root,'packages/desktop/main.mjs'),'--smoke-market'],{cwd:root,env,windowsHide:true,stdio:'inherit'});const timer=setTimeout(()=>child.kill(),130000);
 const code=await new Promise((ok,bad)=>{child.once('error',bad);child.once('exit',ok);});clearTimeout(timer);if(code!==0)throw Error('Native game market verification failed: '+code);
}finally{
 if(resolve(dirname(dir))!==resolve(tmpdir())||!basename(dir).startsWith('gameguy-desktop-smoke-market-'))throw Error('Unsafe market QA cleanup');
 const installed=resolve(root,'product/installed',createHash('sha256').update(JSON.stringify(dir)).digest('hex').slice(0,20));if(!installed.startsWith(resolve(root,'product/installed')+sep))throw Error('Unsafe package cleanup');await rm(installed,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});
}
