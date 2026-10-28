import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,unlink,symlink,lstat} from 'node:fs/promises';
import {join,resolve,dirname,basename,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareElectronRuntime} from '../scripts/electron-runtime.mjs';
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'gameguy-electron-cache-test-')),source=join(dir,'source'),cache=join(dir,'cache');
 t.after(async()=>{assert.equal(resolve(dirname(dir)),resolve(tmpdir()));assert(basename(dir).startsWith('gameguy-electron-cache-test-'));await rm(dir,{recursive:true,force:true});});
 await mkdir(join(source,'resources'),{recursive:true});
 for(const [name,bytes] of Object.entries({'version':'39.2.7','electron.exe':'fixture executable bytes - never executed','resources.pak':'fixture PAK','ffmpeg.dll':'fixture DLL','resources/default_app.asar':'fixture app archive'}))await writeFile(join(source,name),bytes);
 return {dir,source,cache,prepare:()=>prepareElectronRuntime(source,cache)};
}
const runtime=exe=>dirname(dirname(exe));
function assertInside(root,path){const r=relative(resolve(root),resolve(path));assert(r&&!r.startsWith('..')&&!isAbsolute(r));}
test('clean runtime is verified, cached and reused without generated logs in the manifest',async t=>{
 const f=await fixture(t);await writeFile(join(f.source,'debug.log'),'source startup log');const exe=await f.prepare(),manifest=JSON.parse(await readFile(join(runtime(exe),'manifest.json'),'utf8'));
 assertInside(f.cache,exe);assert.equal(await readFile(exe,'utf8'),'fixture executable bytes - never executed');assert(!manifest.files.some(x=>x.path==='debug.log'));assert.equal(await f.prepare(),exe);
 assert(!(await readdir(f.cache)).some(x=>x.startsWith('.staging-')));
});
test('ordinary root debug.log can appear and grow without invalidating executable/resource identity',async t=>{
 const f=await fixture(t),exe=await f.prepare();await writeFile(join(dirname(exe),'debug.log'),'Chromium log appended by runtime');assert.equal(await f.prepare(),exe);
 await writeFile(join(dirname(exe),'debug.log'),'more Chromium output');await writeFile(join(f.source,'debug.log'),'different source-local debugging output');assert.equal(await f.prepare(),exe);
});
test('tampered executable is never selected; rebuild retains the damaged generation',async t=>{
 const f=await fixture(t),old=await f.prepare();await writeFile(old,'corrupt cached executable');const repaired=await f.prepare();
 assert.notEqual(repaired,old);assert.match(runtime(repaired),/-recovery-/);assert.equal(await readFile(old,'utf8'),'corrupt cached executable');assert.equal(await readFile(repaired,'utf8'),'fixture executable bytes - never executed');assert.equal(await f.prepare(),repaired);
 assert(!(await readdir(f.cache)).some(x=>x.startsWith('.staging-')));
});
test('changed DLL and missing PAK also require a fully verified replacement',async t=>{
 const f=await fixture(t),old=await f.prepare();await writeFile(join(dirname(old),'ffmpeg.dll'),'bad DLL');await unlink(join(dirname(old),'resources.pak'));
 const repaired=await f.prepare();assert.notEqual(repaired,old);assert.equal(await readFile(join(dirname(repaired),'ffmpeg.dll'),'utf8'),'fixture DLL');assert.equal(await readFile(join(dirname(repaired),'resources.pak'),'utf8'),'fixture PAK');
});
test('unknown extra files and nested debug.log are not allowlisted',async t=>{
 const f=await fixture(t),old=await f.prepare();await writeFile(join(dirname(old),'resources/debug.log'),'not a known root generated log');await writeFile(join(dirname(old),'unexpected.dll'),'extra payload');
 const repaired=await f.prepare();assert.notEqual(repaired,old);assert(!(await readdir(dirname(repaired))).includes('unexpected.dll'));
});
test('missing, malformed or mismatched manifest is repaired rather than trusted',async t=>{
 const f=await fixture(t);let exe=await f.prepare();await unlink(join(runtime(exe),'manifest.json'));exe=await f.prepare();
 await writeFile(join(runtime(exe),'manifest.json'),'not json');const next=await f.prepare();assert.notEqual(next,exe);
 const m=JSON.parse(await readFile(join(runtime(next),'manifest.json'),'utf8'));m.sourceDigest='0'.repeat(64);await writeFile(join(runtime(next),'manifest.json'),JSON.stringify(m));assert.notEqual(await f.prepare(),next);
});
test('tampered recovered generation is verified again and replaced on the next launch',async t=>{
 const f=await fixture(t),primary=await f.prepare();await writeFile(primary,'broken primary');const recovered=await f.prepare();await writeFile(recovered,'broken recovery');
 const fresh=await f.prepare();assert.notEqual(fresh,recovered);assert.equal(await readFile(fresh,'utf8'),'fixture executable bytes - never executed');assert.equal(await readFile(recovered,'utf8'),'broken recovery');
});
test('recovery pointer cannot escape the cache or redirect to an arbitrary executable',async t=>{
 const f=await fixture(t),primary=await f.prepare(),name=basename(runtime(primary));await writeFile(primary,'broken primary');const manifest=JSON.parse(await readFile(join(runtime(primary),'manifest.json'),'utf8'));
 await writeFile(join(f.cache,name+'.active.json'),JSON.stringify({version:1,name:'../source',sourceDigest:manifest.sourceDigest}));
 const exe=await f.prepare();assertInside(f.cache,exe);assert.notEqual(exe,primary);assert.equal(await f.prepare(),exe);
});
test('unusable recovery pointer does not prevent returning freshly verified bytes',async t=>{
 const f=await fixture(t),primary=await f.prepare(),name=basename(runtime(primary));await writeFile(primary,'broken primary');await mkdir(join(f.cache,name+'.active.json'));
 const exe=await f.prepare();assertInside(f.cache,exe);assert.equal(await readFile(exe,'utf8'),'fixture executable bytes - never executed');
});
test('concurrent launches only return valid source-matching generations',async t=>{
 const f=await fixture(t),executables=await Promise.all(Array.from({length:6},()=>f.prepare()));
 for(const exe of executables){assertInside(f.cache,exe);assert.equal(await readFile(exe,'utf8'),'fixture executable bytes - never executed');}
 assert(!(await readdir(f.cache)).some(x=>x.startsWith('.staging-')));
});
test('a directory link named debug.log is not treated as an ignored ordinary log',async t=>{
 const f=await fixture(t),old=await f.prepare(),outside=join(f.dir,'outside');await mkdir(outside);await writeFile(join(outside,'keep.txt'),'unchanged');
 await symlink(outside,join(dirname(old),'debug.log'),process.platform==='win32'?'junction':'dir');assert((await lstat(join(dirname(old),'debug.log'))).isSymbolicLink());
 const exe=await f.prepare();assert.notEqual(exe,old);assert.equal(await readFile(join(outside,'keep.txt'),'utf8'),'unchanged');assertInside(f.cache,exe);
});
test('invalid source versions and source links fail closed without selecting cached bytes',async t=>{
 const f=await fixture(t);await f.prepare();await writeFile(join(f.source,'version'),'../untrusted');await assert.rejects(f.prepare(),/Invalid installed/);
 await writeFile(join(f.source,'version'),'39.2.7');const outside=join(f.dir,'outside');await mkdir(outside);await symlink(outside,join(f.source,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.prepare(),/links forbidden/);
});
