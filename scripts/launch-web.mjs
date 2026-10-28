import {spawn} from 'node:child_process';import {join,resolve} from 'node:path';import {access} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'..');await access(join(root,'.runtime/dsh/profiles/gameguy/package.json')).catch(()=>{throw Error('Run npm.cmd run build && npm.cmd run setup first');});
const child=spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','gameguy',...process.argv.slice(2)],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,DSH_HOME:join(root,'.runtime/dsh'),PATH:join(root,'node_modules/.bin')+';'+process.env.PATH}});
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>child.kill(s));child.on('error',e=>{console.error(e);process.exitCode=1;});child.on('exit',c=>{process.exitCode=c??1;});
