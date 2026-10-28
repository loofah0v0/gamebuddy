/** Plugin-owned temporary logs; never change ACLs or delete another ADB server's log. */
import {command} from '@gameguy/core';
import {mkdir,lstat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
export async function backendEnvironment(base:NodeJS.ProcessEnv=process.env):Promise<NodeJS.ProcessEnv>{
 const directory=join(base.APPDATA||tmpdir(),'GameGuy-v03','runtime','arknights-adb');
 await mkdir(directory,{recursive:true});
 const info=await lstat(directory);
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('MAA backend temporary directory must be a regular directory');
 await access(directory,constants.W_OK);
 return {...base,TEMP:directory,TMP:directory,TMPDIR:directory};
}
export const backendCommand:typeof command=async(file,args,signal,timeoutMs,maxBytes)=>{
 signal?.throwIfAborted();const environment=await backendEnvironment();signal?.throwIfAborted();
 return command(file,args,signal,timeoutMs,maxBytes,environment);
};
