import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

export const ROOT = resolve(import.meta.dirname, '..');
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh'];
export const DESKTOP_EXE = join(ROOT, 'external', `dsh-desktop-${VERSION}`, 'DeepSeek Harness.exe');

/** Default entry is the official shell; Web CLI flags cannot silently change it. */
export function desktopLaunch(root = ROOT, args = [], inherited = process.env) {
  if (args.length) throw Error('Desktop does not accept Web CLI options. Use npm.cmd run start:web -- <options> for explicit Web debugging.');
  const env = {...inherited, DSH_HOME: join(root, '.runtime', 'dsh')};
  // An npm/Electron caller must not accidentally turn the official shell into Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const userData = join(root, '.runtime', 'desktop-user-data');
  return {exe: join(root, 'external', `dsh-desktop-${VERSION}`, 'DeepSeek Harness.exe'),
    args: [`--user-data-dir=${userData}`], env, userData,
    profile: join(root, '.runtime', 'dsh', 'profiles', 'desktop')};
}

function powershell(command, env = {}) {
  const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 20000, env: {...process.env, ...env},
  });
  if (result.error || result.status !== 0) throw Error('Desktop prerequisite check failed: ' + (result.error?.message ?? result.stderr.trim()));
  return result.stdout.trim();
}

export function checkDesktopRuntime(plan = desktopLaunch()) {
  if (process.platform !== 'win32') throw Error('This GameGuy Desktop deployment requires Windows x64.');
  for (const path of [plan.exe, join(resolve(plan.exe, '..'), 'resources', 'app.asar'),
    join(resolve(plan.exe, '..'), 'resources', 'runtime', 'bin')]) {
    if (!existsSync(path)) throw Error('Official Desktop runtime missing: ' + path);
  }
  const version = powershell("$ErrorActionPreference='Stop'; (Get-Item -LiteralPath $env:GAMEGUY_CHECK_EXE).VersionInfo.FileVersion", {GAMEGUY_CHECK_EXE: plan.exe});
  if (version !== VERSION) throw Error(`Desktop ${version} does not match GameGuy DSH ${VERSION}; no Web fallback.`);
  return {version, exe: plan.exe};
}

/** Return only matching PIDs, never private Host arguments or URLs. */
export function gameguyProcesses(root = ROOT) {
  const text = powershell(`$ErrorActionPreference='Stop'; $root=$env:GAMEGUY_CHECK_ROOT;
    Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -ne [int]$env:GAMEGUY_CHECK_PID -and (
        ($_.Name -eq 'DeepSeek Harness.exe' -and $_.ExecutablePath -like ($root+'\\external\\dsh-desktop-*\\DeepSeek Harness.exe')) -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -and ($_.CommandLine.Contains($root+'\\scripts\\launch-web.mjs') -or $_.CommandLine.Contains($root+'\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js')))
      )
    } | ForEach-Object { $_.ProcessId }`, {GAMEGUY_CHECK_ROOT: root, GAMEGUY_CHECK_PID: String(process.pid)});
  return text ? text.split(/\s+/).map(Number) : [];
}

export function assertGameguyStopped() {
  if (gameguyProcesses().length) throw Error('Close the running GameGuy Desktop/Web host before setup or switching hosts; shared state must have one owner.');
}

/** Preserve existing bundles, profile metadata, and other dependencies. */
export function withGameguyBundle(pkg, root = ROOT) {
  const bundles = pkg.dsh?.profile?.bundles;
  if (!Array.isArray(bundles) || bundles.some(x => typeof x !== 'string')) throw Error('Invalid DSH profile bundle list; refusing to replace it.');
  return {...pkg, dependencies: {...pkg.dependencies, '@gameguy/core': 'link:' + join(root, 'packages', 'core').replaceAll('\\', '/')},
    dsh: {...pkg.dsh, profile: {...pkg.dsh.profile, bundles: [...new Set([...bundles, '@gameguy/core'])]}}};
}
