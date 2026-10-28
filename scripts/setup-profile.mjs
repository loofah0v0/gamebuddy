import yaml from 'js-yaml';
import {initProfile, PROFILE_TEMPLATES} from '@deepseek-ai/dsh-app-boot';
import {readFile, writeFile, mkdir, open, unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {ROOT, desktopLaunch, checkDesktopRuntime, assertGameguyStopped, withGameguyBundle} from './desktop-config.mjs';

const args = process.argv.slice(2);
if (args.some(x => x !== '--web') || args.length > 1) throw Error('Usage: setup-profile.mjs [--web]');
const web = args.includes('--web');
if (!web) checkDesktopRuntime();
assertGameguyStopped();
const home = join(ROOT, '.runtime', 'dsh');
const dir = web ? join(home, 'profiles', 'gameguy') : desktopLaunch().profile;
await mkdir(dir, {recursive: true});
const lockPath = join(dir, 'lock');
const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw Error('Profile operation lock exists; close Desktop and inspect the lock before retrying.'); });
try {
  await lock.writeFile(String(process.pid)+'\n');
  initProfile(dir, [...PROFILE_TEMPLATES.web.bundles, '@gameguy/core']);
  const file = join(dir, 'package.json');
  const pkg = withGameguyBundle(JSON.parse(await readFile(file, 'utf8')));
  await writeFile(file, JSON.stringify(pkg, null, 2)+'\n');
  const patch = join(dir, 'cordis.patch.yml');
  const entries = yaml.load(await readFile(patch, 'utf8')) ?? [];
  if (!Array.isArray(entries)) throw Error('Invalid profile patch');
  const browser = entries.find(e => e.id === 'ui-sidebar-browser');
  if (browser) browser.disabled = false;
  else entries.push({id: 'ui-sidebar-browser', disabled: false});
  await writeFile(patch, yaml.dump(entries));
  const child = spawn(process.execPath, [join(ROOT, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'), 'install', '--ignore-scripts'], {
    cwd: dir, stdio: 'inherit', windowsHide: true,
    env: {...process.env, DSH_HOME: home, PATH: join(ROOT, 'node_modules', '.bin')+';'+process.env.PATH},
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error('Profile dependency install failed: '+code)));
  });
  console.log(`${web ? 'Web debug' : 'Official Desktop'} profile ready:`, dir);
} finally {
  await lock.close();
  await unlink(lockPath);
}
