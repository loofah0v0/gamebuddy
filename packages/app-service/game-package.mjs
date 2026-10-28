import {homeMetadataSchema} from './home-metadata.mjs';
/** Build execution-free Skill/script packages. Adding to the trusted catalog is an explicit review step. */
import {mkdir,readFile,readdir,cp,writeFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const gamePackageSchema=z.object({
 id:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),kind:z.enum(['skill','script']),version:z.string().regex(/^\d+\.\d+\.\d+$/),
 title:z.string().min(1).max(100),description:z.string().max(1000),permissions:z.array(z.string().min(1).max(100)).max(30),
 dependencies:z.record(z.string().regex(/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/),z.string().regex(/^\d+\.\d+\.\d+$/)).default({}),
 home:homeMetadataSchema.optional(),
 tags:z.array(z.string().max(50)).max(10).default([]),requirements:z.array(z.string().max(300)).max(20).default([]),prompt:z.string().max(4000).optional()
}).strict();
export async function buildSkillPackage(input,source,output){
 const item=gamePackageSchema.parse(input);source=resolve(source);output=resolve(output);
 if(output===source||output.startsWith(source+'/')||output.startsWith(source+'\\'))throw Error('Package output must be outside source');
 const files=[];
 async function walk(path,base=''){for(const e of await readdir(path,{withFileTypes:true})){const p=base?base+'/'+e.name:e.name;if(e.isSymbolicLink()||(!e.isFile()&&!e.isDirectory()))throw Error('Package symlinks or special files forbidden');if(e.isDirectory())await walk(join(path,e.name),p);else files.push({path:p,sha256:hash(await readFile(join(path,e.name)))});}}
 if((await lstat(source)).isSymbolicLink())throw Error('Package source symlink forbidden');
 await walk(source);if(!files.some(f=>f.path===`skills/${item.id}/SKILL.md`))throw Error('Package requires its own SKILL.md');
 if(files.some(f=>!f.path.startsWith('skills/')&&!f.path.startsWith('scripts/')))throw Error('Only skills/ and scripts/ are packaged; no install lifecycle scripts');
 if(item.kind==='script'&&!files.some(f=>f.path.startsWith('scripts/')))throw Error('Script package requires scripts/');
 await mkdir(output);await cp(source,output,{recursive:true});
 await writeFile(join(output,'package.json'),JSON.stringify({name:'@gameguy/plugin-'+item.id,version:item.version,type:'module'}));
 files.push({path:'package.json',sha256:hash(await readFile(join(output,'package.json')))});files.sort((a,b)=>a.path.localeCompare(b.path));
 const manifest={...(item.home?{home:item.home}:{}),id:item.id,version:item.version,apiVersion:1,kind:item.kind,entry:`skills/${item.id}/SKILL.md`,permissions:item.permissions,dependencies:item.dependencies,files};
 const raw=JSON.stringify(manifest,null,2);await writeFile(join(output,'manifest.json'),raw);
 return {...item,manifestSha256:hash(raw)};
}
