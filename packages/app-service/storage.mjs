import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
export async function load(file, fallback) {try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw e;}}
export class Store {
 constructor(dir,name,initial){this.dir=dir;this.file=join(dir,name);this.initial=initial;this.tail=Promise.resolve();}
 async init(){await mkdir(this.dir,{recursive:true});this.data=await load(this.file,this.initial);return this;}
 save(){const body=JSON.stringify(this.data,null,2);const next=this.tail.catch(()=>{}).then(async()=>{await writeFile(this.file+'.tmp',body,{mode:0o600});await rename(this.file+'.tmp',this.file);});this.tail=next;return next;}
}
