/** Optional isolated browser renderer. Uses no existing browser profile or credentials on disk. */
import {createRequire} from 'node:module';
import {isAbsolute} from 'node:path';
const require=createRequire(import.meta.url);
export async function openVerificationBrowser(){
 const modulePath=process.env.GAMEGUY_PLAYWRIGHT_MODULE??'playwright';
 const pw=require(modulePath);
 const executablePath=process.env.GAMEGUY_BROWSER_EXE;
 if(executablePath&&!isAbsolute(executablePath))throw Error('GAMEGUY_BROWSER_EXE must be absolute');
 return pw.chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
}
