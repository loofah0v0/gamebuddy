import test from 'node:test';
import assert from 'node:assert/strict';
import {command} from '../packages/core/src/process.js';
const run=(source:string,signal?:AbortSignal,ms=2000,bytes?:number)=>command(process.execPath,['-e',source],signal,ms,bytes);
test('subprocess captures output without shell interpretation',async()=>{assert.equal((await run("process.stdout.write('hello')")).toString(),'hello');});
test('subprocess nonzero exit is not success',async()=>{await assert.rejects(run("process.stderr.write('backend error');process.exit(2)"),/process exit 2: backend error/);});
test('subprocess missing executable rejects',async()=>{await assert.rejects(command('gameguy-nonexistent-executable',[]),/ENOENT/);});
test('subprocess bounded deadline kills and waits process close',async()=>{await assert.rejects(run('setInterval(()=>{},1000)',undefined,100),/deadline/);});
test('subprocess pre-abort never starts, runtime abort kills',async()=>{
 const a=new AbortController();a.abort();await assert.rejects(run('process.exit(0)',a.signal),/cancelled/);
 const b=new AbortController();const task=run('setInterval(()=>{},1000)',b.signal);setTimeout(()=>b.abort(),100);await assert.rejects(task,/cancelled/);
});
test('subprocess output budget rejects instead of returning truncated success',async()=>{await assert.rejects(run("process.stdout.write('x'.repeat(10000))",undefined,2000,128),/output limit/);});

test('subprocess temporary environment is scoped, retaining parent values without mutating them',async()=>{
 const before=process.env.TEMP;
 const result=await command(process.execPath,['-e','process.stdout.write(JSON.stringify({temp:process.env.TEMP,marker:process.env.GAMEGUY_PROCESS_MARKER,path:!!process.env.PATH}))'],undefined,2000,4096,{TEMP:'gameguy-owned-temp',GAMEGUY_PROCESS_MARKER:'test'});
 assert.deepEqual(JSON.parse(result.toString()),{temp:'gameguy-owned-temp',marker:'test',path:true});assert.equal(process.env.TEMP,before);
});
test('MAA backend logs use their own directory, not the inherited shared adb.log location',async()=>{
 const {backendEnvironment}=await import('../packages/plugin-arknights/src/backend-process.js');
 const {mkdtemp,rm,stat,writeFile,readFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join,resolve,dirname,basename}=await import('node:path');
 const base=await mkdtemp(join(tmpdir(),'gameguy-adb-env-test-'));
 try{
  const inherited=join(base,'shared-adb.log');await writeFile(inherited,'unchanged');
  const original={APPDATA:base,TEMP:inherited,TMP:inherited,PATH:process.env.PATH};
  const environment=await backendEnvironment(original);
  assert.equal(environment.TEMP,join(base,'GameGuy-v03','runtime','arknights-adb'));
  assert.equal(environment.TMP,environment.TEMP);assert.equal(environment.TMPDIR,environment.TEMP);
  assert((await stat(environment.TEMP!)).isDirectory());assert.equal(original.TEMP,inherited);
  assert.equal(await readFile(inherited,'utf8'),'unchanged');
 }finally{assert.equal(resolve(dirname(base)),resolve(tmpdir()));assert(basename(base).startsWith('gameguy-adb-env-test-'));await rm(base,{recursive:true,force:true});}
});
