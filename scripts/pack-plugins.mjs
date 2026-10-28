/** Package only the trusted GameGuy game and script packages. No publish or lifecycle scripts. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {PluginManager} from '../packages/app-service/plugins.mjs';
const root=resolve(import.meta.dirname,'..');
const out=join(root,'artifacts/product-plugins');
const npm=process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
await access(npm);await mkdir(out,{recursive:true});
const verifier=new PluginManager(root,out,null);
const catalog=JSON.parse(await readFile(join(root,'product/catalog.json'),'utf8'));
assert.equal(new Set(catalog.map(x=>x.id)).size,catalog.length);for(const id of ['arknights','clawclaw','minecraft'])assert(catalog.some(x=>x.id===id));
const packages=[],checksums=[];
for(const item of catalog){
 const dir=join(root,'product/plugins',item.id);
 const declared=await verifier.verify(dir,item);
 const name='@gameguy/plugin-'+item.id;
 const metadata=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
 assert.equal(metadata.name,name);assert.equal(metadata.version,item.version);
 const packed=spawnSync(process.execPath,[npm,'pack',dir,'--ignore-scripts','--json','--pack-destination',out],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 if(packed.error)throw packed.error;
 if(packed.status!==0)throw Error(`Pack failed for ${name}: ${packed.stderr}`);
 const rows=JSON.parse(packed.stdout);assert.equal(rows.length,1);
 const archive=rows[0];assert.equal(archive.name,name);assert.equal(archive.version,item.version);
 assert.equal(archive.filename,`${name.replace('@','').replace('/','-')}-${item.version}.tgz`);
 const paths=archive.files.map(f=>f.path);assert.equal(new Set(paths).size,paths.length);
 assert.deepEqual([...paths].sort(),['manifest.json',...declared.files.map(f=>f.path)].sort(),'Archive must exactly match verified plugin inventory');
 for(const path of paths){
  assert(!path.split('/').some(p=>['..','.runtime','node_modules','downloads','external'].includes(p)),`Unexpected package path: ${path}`);
  assert(path==='package.json'||path==='manifest.json'||path.startsWith('lib/')||path.startsWith('skills/')||path.startsWith('worker/')||path.startsWith('scripts/'),`Outside package allowlist: ${path}`);
 }
 assert(paths.includes(declared.entry));assert(paths.includes(`skills/${item.id}/SKILL.md`));
 if(item.id==='arknights')assert(paths.includes('worker/maa.py'));
 const bytes=await readFile(join(out,archive.filename));assert.equal(bytes.length,archive.size);
 assert.equal(createHash('sha1').update(bytes).digest('hex'),archive.shasum);
 assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),archive.integrity);
 packages.push(archive);checksums.push({id:item.id,name,version:item.version,file:archive.filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),manifestSha256:item.manifestSha256,permissions:item.permissions});
 console.log(`PASS ${name}: ${paths.length} entries; ${bytes.length} bytes; trusted manifest, file inventory and archive digests verified`);
}
await writeFile(join(out,'manifest.json'),JSON.stringify(packages,null,2)+'\n');
await writeFile(join(out,'checksums.json'),JSON.stringify(checksums,null,2)+'\n');
console.log('PACK_OK (trusted local game packages; integrity verified; no publication or remote download test)');
