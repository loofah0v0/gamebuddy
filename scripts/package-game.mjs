// npm run package:game -- descriptor.json source-directory ABSENT-output-directory
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildSkillPackage} from '../packages/app-service/game-package.mjs';
const [descriptor,source,output]=process.argv.slice(2);
if(!descriptor||!source||!output)throw Error('Usage: package:game descriptor.json source-directory absent-output-directory');
const item=await buildSkillPackage(JSON.parse(await readFile(resolve(descriptor),'utf8')),resolve(source),resolve(output));
await writeFile(resolve(output)+'.catalog.json',JSON.stringify(item,null,2)+'\n');
// catalog-entry is an authoring receipt, NOT part of the verified install tree. Keep it beside, not inside the package.
console.log(JSON.stringify(item,null,2));
