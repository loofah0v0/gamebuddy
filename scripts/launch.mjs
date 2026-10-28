import {spawn} from 'node:child_process';
import {access, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT, desktopLaunch, checkDesktopRuntime, assertGameguyStopped} from './desktop-config.mjs';

const plan = desktopLaunch(ROOT, process.argv.slice(2));
const runtime = checkDesktopRuntime(plan);
await access(join(plan.profile, 'node_modules', '@gameguy', 'core', 'lib', 'index.js')).catch(() => {
  throw Error('Desktop profile is not prepared. Run npm.cmd run build && npm.cmd run setup first.');
});
assertGameguyStopped();
await mkdir(plan.userData, {recursive: true});
const child = spawn(plan.exe, plan.args, {cwd: ROOT, env: plan.env, detached: true, stdio: 'ignore', windowsHide: false});
await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('spawn', resolve);
});
child.unref();
console.log(`Official DSH Desktop ${runtime.version} launch requested (PID ${child.pid}).`);
console.log('Desktop profile:', plan.profile);
console.log('Window/Host readiness must be verified in Desktop; launch alone is not plugin or game success.');
