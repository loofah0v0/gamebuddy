/** Read-only real installed-environment probe through the verified packaged plugin. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {Engine} from '@gameguy/core';
import {PluginManager} from '../packages/app-service/plugins.mjs';
const root=resolve(import.meta.dirname,'..'),temp=await mkdtemp(join(tmpdir(),'gameguy-discovery-'));
// Keep ESM package resolution within the workspace; never reuse user installs/state.
const installed=join(root,'product/installed','discovery-'+basename(temp));
const engine=new Engine(join(temp,'engine'));await engine.init();
try{
 const manager=await new PluginManager(root,installed,engine).init();await manager.install('arknights');
 const adapter=engine.adapter('arknights');assert.equal(typeof adapter.setup,'function');
 const result=await adapter.setup(adapter.defaults,{root,signal:AbortSignal.timeout(25000),configured:false});
 assert.equal(result.ready,false);assert.equal(result.deviceOnline,false);assert.equal(result.addressVerified,false);
 assert.equal(engine.snapshot().configs.length,0);
 const report={status:'passed',date:new Date().toISOString(),scope:'verified packaged MAA plugin; real read-only dependency/MuMu installation discovery',plugin:manager.list().find(p=>p.id==='arknights'),result,realModelRequests:0,realGameActions:0,deviceStartRequests:0,configWrites:0,schedulesCreated:0};
 await mkdir(join(root,'artifacts/verification'),{recursive:true});await writeFile(join(root,'artifacts/verification/product-discovery-v03.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
 await engine.dispose();
 if(resolve(dirname(installed))!==resolve(root,'product/installed')||!basename(installed).startsWith('discovery-gameguy-discovery-'))throw Error('Unsafe plugin probe cleanup');
 if(resolve(dirname(temp))!==resolve(tmpdir())||!basename(temp).startsWith('gameguy-discovery-'))throw Error('Unsafe discovery userdata cleanup');
 await rm(installed,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});
}
