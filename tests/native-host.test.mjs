import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {CredentialVault,validateRecord,validateRef,validateKey} from '../packages/desktop/credential-vault.mjs';
import {commitModelCredential} from '../packages/desktop/model-credential-commit.mjs';
// Ephemeral encryption fixture: no OS vault or user credentials are read.
function cryptoFixture(){const key=randomBytes(32);return {
 isEncryptionAvailable:()=>true,
 encryptString(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]);},
 decryptString(bytes){const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8');}
};}
async function temp(t){const dir=await mkdtemp(join(tmpdir(),'gameguy-vault-test-'));t.after(async()=>{assert.equal(resolve(dirname(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('gameguy-vault-test-'));await rm(dir,{recursive:true,force:true});});return dir;}
test('native credential schemas admit upstream API records and bounded opaque grants',()=>{
 assert.equal(validateRef('GAMEGUY_MODEL_KEY'),'GAMEGUY_MODEL_KEY');assert.equal(validateKey('llm/test'),'llm/test');
 for(const v of [{kind:'api-key'},{kind:'api-key',key:'fixture'},{kind:'api-key',env:{OPENAI_API_KEY:'fixture'}},{kind:'grant',payload:{token:'fixture',expires:42,scopes:['a']}}])assert.deepEqual(validateRecord(v),v);
 const cyclic={};cyclic.self=cyclic;
 for(const v of [null,[],{kind:'wrong'},{kind:'api-key',key:''},{kind:'api-key',key:22},{kind:'api-key',env:{'not valid':'a'}},{kind:'api-key',secret:'unexpected'},{kind:'grant'},{kind:'grant',payload:cyclic},{kind:'grant',payload:NaN},{kind:'grant',payload:()=>1},{kind:'grant',payload:JSON.parse('{"__proto__":"unsafe"}')},{kind:'grant',payload:'x'.repeat(1048576)}])assert.throws(()=>validateRecord(v));
 for(const ref of ['','a b',42])assert.throws(()=>validateRef(ref));
 for(const key of ['',42,'missing-colon'])assert.throws(()=>validateKey(key));
});
test('encrypted native vault serializes writes, persists records and never stores plaintext',async t=>{
 const dir=await temp(t),crypto=cryptoFixture(),v=new CredentialVault(dir,crypto);
 await Promise.all(Array.from({length:12},(_,i)=>v.request('set',{ref:'KEY_'+i,value:'secret-value-'+i})));
 await v.request('write-record',{key:'llm/test',value:{kind:'grant',payload:{token:'fixture'}}});
 const bytes=await readFile(v.path);assert.ok(!bytes.includes(Buffer.from('secret-value')));
 const restored=new CredentialVault(dir,crypto);for(let i=0;i<12;i++)assert.equal(await restored.request('get',{ref:'KEY_'+i}),'secret-value-'+i);
 assert.deepEqual(await restored.request('list-records'),[{key:'llm/test',kind:'grant'}]);
 const record=await restored.request('read-record',{key:'llm/test'});record.payload.token='mutated';assert.equal((await restored.request('read-record',{key:'llm/test'})).payload.token,'fixture');
 await restored.request('unset',{ref:'KEY_0'});assert.equal(await restored.request('get',{ref:'KEY_0'}),undefined);
 await restored.request('write-record',{key:'llm/test'});assert.deepEqual(await restored.request('list-records'),[]);
 await assert.rejects(restored.request('write-record',{key:'llm/test',value:{kind:'api-key',key:42}}));
 await restored.request('set',{ref:'AFTER_ERROR',value:'still works'});assert.equal(await restored.request('get',{ref:'AFTER_ERROR'}),'still works');
});
test('vault rejects unavailable encryption, tampering and malformed decrypted content',async t=>{
 const dir=await temp(t),c=cryptoFixture(),v=new CredentialVault(dir,c);
 await assert.rejects(new CredentialVault(dir,{isEncryptionAvailable:()=>false}).request('set',{ref:'KEY',value:'secret'}),/unavailable/);
 await v.request('set',{ref:'KEY',value:'secret'});const bytes=await readFile(v.path);bytes[28]^=1;await writeFile(v.path,bytes);await assert.rejects(v.read());
 await writeFile(v.path,c.encryptString(JSON.stringify({version:1,refs:{KEY:'secret'},records:{},unexpected:true})));await assert.rejects(v.read(),/Invalid credential vault/);
});
function commitFixture(){const calls=[];return {calls,files:{mkdir:async()=>calls.push('mkdir'),writeFile:async()=>calls.push('write'),rename:async()=>calls.push('rename'),unlink:async()=>calls.push('unlink')},crypto:{isEncryptionAvailable:()=>true,encryptString:()=>Buffer.from('encrypted')}};}
test('credential commit never restarts a second time after rejected admission',async()=>{
 const f=commitFixture();await assert.rejects(commitModelCredential({...f,path:'test.bin',key:'fixture',save:async()=>{f.calls.push('save');throw Error('active tasks');},restore:async()=>f.calls.push('restore')}),/active tasks/);
 assert.deepEqual(f.calls,['mkdir','write','save','unlink']);
});
test('accepted model update rolls back only when encrypted file commit fails',async()=>{
 const f=commitFixture();f.files.rename=async()=>{f.calls.push('rename');throw Error('disk commit');};
 await assert.rejects(commitModelCredential({...f,path:'test.bin',key:'fixture',save:async()=>f.calls.push('save'),restore:async()=>f.calls.push('restore')}),/disk commit/);
 assert.deepEqual(f.calls,['mkdir','write','save','rename','restore','unlink']);
});
test('successful credential commit is atomic and returns the accepted configuration',async()=>{
 const f=commitFixture();assert.deepEqual(await commitModelCredential({...f,path:'test.bin',key:'fixture',save:async()=>{f.calls.push('save');return {model:'a'};},restore:async()=>assert.fail('unexpected restore')}),{model:'a'});assert.deepEqual(f.calls,['mkdir','write','save','rename','unlink']);
});
test('encryption failures do not mutate runtime settings; rollback errors remain explicit',async()=>{
 const f=commitFixture();await assert.rejects(commitModelCredential({...f,path:'test.bin',key:'fixture',crypto:{isEncryptionAvailable:()=>false},save:async()=>assert.fail('save'),restore:async()=>assert.fail('restore')}),/明文/);assert.deepEqual(f.calls,[]);
 f.files.rename=async()=>{throw Error('rename');};await assert.rejects(commitModelCredential({...f,path:'test.bin',key:'fixture',save:async()=>1,restore:async()=>{throw Error('restore');}}),e=>e instanceof AggregateError&&e.errors.length===2&&e.message.includes('恢复未确认'));
});

import {externalBrowserURL} from '../packages/desktop/external-links.mjs';
import {runInNewContext} from 'node:vm';
test('external browser URLs cannot invoke local, custom, app or credential handlers',()=>{
 const origin='http://127.0.0.1:12345';
 assert.equal(externalBrowserURL('https://example.com/a?q=1',origin),'https://example.com/a?q=1');
 assert.equal(externalBrowserURL('http://127.0.0.1:6789/page',origin),'http://127.0.0.1:6789/page');
 for(const v of [null,'file:///C:/private','javascript:alert(1)','data:text/html,hello','mumu://start','https://user:secret@example.com',origin+'/private','http://localhost/\n','not a url'])assert.equal(externalBrowserURL(v,origin),null);
});
test('primary preload exposes DSH host bridges with bounded channels and removable listeners',async()=>{
 const source=await readFile(new URL('../packages/desktop/preload.cjs',import.meta.url),'utf8'),world={},handlers=new Map(),calls=[];
 const ipc={on:(name,fn)=>{handlers.set(name,fn);},removeListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);},invoke:async(...args)=>{calls.push(args);return {lease:'fixture'};},send:(...args)=>calls.push(args)};
 runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{world[name]=value;}},ipcRenderer:ipc,webUtils:{getPathForFile:()=> 'fixture.txt'}}),process:{isMainFrame:true,platform:'win32'},document:{addEventListener:()=>{}},console});
 assert.equal(world.dshDesktop.protocolVersion,1);
 await world.__DSH_DIRECTORY_PICKER__.pick();assert.deepEqual(calls.at(-1),['gameguy:directory-pick']);
 assert.equal(world.__DSH_HOST_PATHS__.pathFor({}),'fixture.txt');
 await world.dshDesktop.browser.acquire('workspace');assert.deepEqual(calls.at(-1),['gameguy:browser-acquire','workspace']);
 let received;const off=world.dshDesktop.browser.onOpenRequested('fixture',url=>{received=url;});
 handlers.get('gameguy:browser-open-requested')({}, {lease:'other',url:'https://example.com'});assert.equal(received,undefined);
 handlers.get('gameguy:browser-open-requested')({}, {lease:'fixture',url:'https://example.com'});assert.equal(received,'https://example.com');off();received=undefined;
 handlers.get('gameguy:browser-open-requested')({}, {lease:'fixture',url:'https://example.com'});assert.equal(received,undefined);
 assert.throws(()=>world.dshDesktop.shortcuts.subscribe(null),/Listener/);const unsub=world.dshDesktop.shortcuts.subscribe(()=>{});assert.ok(handlers.has('gameguy:shortcutsChanged'));unsub();assert.ok(!handlers.has('gameguy:shortcutsChanged'));
});
import {sessionCompression} from '../packages/runtime-dsh/session-compression.mjs';
test('native session encoding preserves legacy JSONL, compressed history and empty defaults',async t=>{
 const dir=await temp(t),nested=join(dir,'sessions','workspace','session');await (await import('node:fs/promises')).mkdir(nested,{recursive:true});
 assert.equal(await sessionCompression(join(dir,'absent')),'none');
 assert.equal(await sessionCompression(join(dir,'sessions')),'none');
 await writeFile(join(nested,'session.v4.jsonl'),'fixture');assert.equal(await sessionCompression(join(dir,'sessions')),'none');
 await writeFile(join(nested,'session.v4.jsonl.zstd'),'fixture');await assert.rejects(sessionCompression(join(dir,'sessions')),/未改动历史/);
 assert.equal(await readFile(join(nested,'session.v4.jsonl'),'utf8'),'fixture');
 await (await import('node:fs/promises')).unlink(join(nested,'session.v4.jsonl'));assert.equal(await sessionCompression(join(dir,'sessions')),'zstd');
});
