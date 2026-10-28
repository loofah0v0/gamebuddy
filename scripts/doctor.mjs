import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, desktopLaunch, checkDesktopRuntime, gameguyProcesses} from './desktop-config.mjs';
const checks = [['node', process.execPath, ['--version']], ['python', 'python', ['--version']],
  ['ADB', join(ROOT, 'external/platform-tools/adb.exe'), ['version']],
  ['MAA DLL', join(ROOT, 'external/maa/MaaCore.dll')], ['Core build', join(ROOT, 'packages/core/lib/index.js')],
  ['Desktop profile', join(desktopLaunch().profile, 'package.json')]];
for (const [name, path, args] of checks) {
  if (!args) { const ok = existsSync(path); console.log(name, ok ? 'OK' : 'MISSING', path); if (!ok) process.exitCode = 1; continue; }
  const r = spawnSync(path, args, {encoding: 'utf8', windowsHide: true});
  console.log(name, r.status === 0 ? 'OK' : 'FAIL', (r.stdout || r.stderr || r.error?.message || '').trim());
  if (r.status !== 0) process.exitCode = 1;
}
try { console.log('Official Desktop:', checkDesktopRuntime()); console.log('GameGuy host process IDs:', gameguyProcesses()); }
catch (error) { console.error(error.message); process.exitCode = 1; }
const adb = spawnSync(join(ROOT, 'external/platform-tools/adb.exe'), ['devices', '-l'], {encoding: 'utf8', windowsHide: true});
console.log('Devices (read-only listing):', adb.stdout || adb.stderr || 'ADB unavailable');
console.log('MuMu CLI:', existsSync('D:/MuMuPlayer/nx_main/mumu-cli.exe') ? 'PRESENT' : 'MISSING');
console.log('No emulator/game is launched by doctor; no game task success is asserted.');
