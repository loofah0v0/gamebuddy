import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp,lstat,mkdir,mkdtemp,readdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,dirname,basename,relative,isAbsolute} from 'node:path';

// Chromium can append this root-level log after launch. Never ignore DLLs, PAKs,
// executables, unknown extra files, nested logs, or symlinks named debug.log.
const generatedLog=p=>p==='debug.log';
function inside(cache,path){const rel=relative(resolve(cache),resolve(path));if(!rel||rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(rel))throw Error('Unsafe Electron cache path');return resolve(path);}
async function regularDirectory(path){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Electron runtime directory must not be a link: '+path);}
async function digest(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
async function inventory(root,base=''){
 const rows=[];
 for(const e of await readdir(join(root,base),{withFileTypes:true})){
  const path=base?base+'/'+e.name:e.name;
  if(e.isSymbolicLink())throw Error('Electron runtime links forbidden: '+path);
  if(e.isDirectory())rows.push(...await inventory(root,path));
  else if(e.isFile()){if(!generatedLog(path))rows.push({path,sha256:await digest(join(root,path))});}
  else throw Error('Electron runtime must contain regular files/directories only: '+path);
 }
 return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
async function jsonFile(file,maxBytes=1024*1024){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>maxBytes)throw Error('Invalid Electron cache metadata');return JSON.parse(await readFile(file,'utf8'));}
async function verify(dir,expected,identity){
 await regularDirectory(dir);await regularDirectory(join(dir,'dist'));
 const manifest=await jsonFile(join(dir,'manifest.json'));
 if(JSON.stringify(Object.keys(manifest).sort())!==JSON.stringify(['files','sourceDigest','version'])||manifest.version!==identity.version||manifest.sourceDigest!==identity.sourceDigest||JSON.stringify(manifest.files)!==JSON.stringify(expected))throw Error('Electron runtime cache manifest integrity mismatch: '+dir);
 const actual=await inventory(join(dir,'dist'));
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Electron runtime cache failed integrity verification: '+dir);
}
async function valid(dir,files,identity){try{await verify(dir,files,identity);return true;}catch{return false;}}
async function publishPointer(cache,file,name,sourceDigest){
 const temp=inside(cache,join(cache,'.active-'+randomUUID()+'.tmp'));let owned=false;
 try{await writeFile(temp,JSON.stringify({version:1,name,sourceDigest})+'\n',{flag:'wx'});owned=true;await rename(temp,file);}
 finally{if(owned)await rm(temp,{force:true});}
}
/** Source is the installed Electron distribution, never bytes from the broken cache.
 * Retain old generations: another process may still be executing/locking them.
 * Explicit directories are for isolated byte fixtures; no untrusted UI input uses them.
 */
export async function prepareElectronRuntime(sourceDirectory,cacheDirectory){
 const sourceDir=resolve(sourceDirectory),cache=resolve(cacheDirectory);await regularDirectory(sourceDir);
 const version=(await readFile(join(sourceDir,'version'),'utf8')).trim();
 if(!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(version))throw Error('Invalid installed Electron version');
 const files=await inventory(sourceDir);
 if(!files.some(f=>f.path==='electron.exe'))throw Error('Installed Electron executable missing');
 const sourceDigest=createHash('sha256').update(JSON.stringify(files)).digest('hex'),identity={version,sourceDigest};
 await mkdir(cache,{recursive:true});await regularDirectory(cache);
 const name='electron-'+version+'-'+sourceDigest.slice(0,16),target=inside(cache,join(cache,name));
 const pointer=inside(cache,join(cache,name+'.active.json'));
 if(await valid(target,files,identity))return join(target,'dist','electron.exe');
 try{
  const ref=await jsonFile(pointer,4096),suffix=typeof ref.name==='string'?ref.name.slice((name+'-recovery-').length):'';
  if(ref.version===1&&ref.sourceDigest===sourceDigest&&ref.name.startsWith(name+'-recovery-')&&/^[a-f0-9-]{36}$/.test(suffix)){
   const recovered=inside(cache,join(cache,ref.name));if(await valid(recovered,files,identity))return join(recovered,'dist','electron.exe');
  }
 }catch{/* Invalid/missing pointers are not authority; rebuild and verify source bytes. */}
 const staging=inside(cache,await mkdtemp(join(cache,'.staging-')));
 try{
  // Copy regular bytes, not source ACL/mandatory labels; Chromium sandbox stays on.
  await cp(sourceDir,join(staging,'dist'),{recursive:true,errorOnExist:true,force:false,filter:p=>!generatedLog(relative(sourceDir,p).replaceAll('\\','/'))});
  await writeFile(join(staging,'manifest.json'),JSON.stringify({...identity,files},null,2)+'\n',{flag:'wx'});
  await verify(staging,files,identity);
  const recover=async()=>{
   const recoveryName=name+'-recovery-'+randomUUID(),recovered=inside(cache,join(cache,recoveryName));
   await rename(staging,recovered);await verify(recovered,files,identity);
   // A pointer write failure must not discard a freshly verified runtime.
   try{await publishPointer(cache,pointer,recoveryName,sourceDigest);}catch{}
   return join(recovered,'dist','electron.exe');
  };
  let occupied=false;try{await lstat(target);occupied=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(occupied)return await valid(target,files,identity)?join(target,'dist','electron.exe'):await recover();
  try{await rename(staging,target);return join(target,'dist','electron.exe');}
  catch(error){
   if(!['EEXIST','ENOTEMPTY','EPERM','EACCES','ENOTDIR','EISDIR'].includes(error.code))throw error;
   // Another launcher may have published a valid primary while this copy ran.
   if(await valid(target,files,identity))return join(target,'dist','electron.exe');
   return await recover();
  }
 }finally{
  inside(cache,staging);if(dirname(staging)!==cache||!basename(staging).startsWith('.staging-'))throw Error('Unsafe Electron staging cleanup');
  await rm(staging,{recursive:true,force:true});
 }
}
/** Keep Chromium sandbox enabled and validate the complete immutable distribution. */
export async function resolveElectronRuntime(){
 const source=(await import('electron')).default;
 if(process.platform!=='win32')return source;
 const cache=resolve(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'GameGuy','runtimes');
 return prepareElectronRuntime(dirname(source),cache);
}
