import {DshRuntime} from '../packages/runtime-dsh/index.mjs';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dataDir=await mkdtemp(join(tmpdir(),'gg-native-'));process.env.GAMEGUY_TEST_LOG='1';
const r=new DshRuntime({root:process.cwd(),dataDir,nativeClient:true,onCredential:async()=>undefined,onAdopt:async()=>({taskId:'test'})});
try{const result=await r.start({provider:'compatible',baseURL:'http://127.0.0.1:18111/v1',model:'test',key:'fake'});console.log(JSON.stringify({...result,nativeURL:result.nativeURL?'[local authenticated]':null}));const s=await r.call('native-api',{method:'create',input:{cwd:process.cwd()}});console.log(s);console.log(await r.call('capabilities',{taskId:'test'}));}finally{await r.stop();}
