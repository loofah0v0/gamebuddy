import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
// DSH's JSONL backend rejects an entire listing on a compression mismatch.
// Keep the existing on-disk encoding; never rewrite or drop user session logs.
export async function sessionCompression(root){
 const encodings=new Set();
 async function scan(dir){
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const entry of entries){
   if(entry.isDirectory())await scan(join(dir,entry.name));
   else if(entry.isFile()&&/^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(entry.name))encodings.add(entry.name.endsWith('.zstd')?'zstd':'none');
  }
 }
 await scan(root);
 if(encodings.size>1)throw Error('会话历史同时包含 JSONL 与 ZSTD；未改动历史文件。请先分库迁移，再启动 GameGuy 工作区。');
 return [...encodings][0]??'none';
}
