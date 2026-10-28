import test from 'node:test';
import assert from 'node:assert/strict';
// Deployment scripts are JavaScript, loaded through the declared tsx test runner.
// @ts-ignore -- no declaration file needed for a local deployment script.
import {desktopLaunch, withGameguyBundle, VERSION} from '../scripts/desktop-config.mjs';

test('default startup selects official Desktop with isolated Harness home', () => {
  const plan = desktopLaunch('D:/fixture', [], {PATH: 'original', DSH_HOME: 'ordinary-home'});
  assert(plan.exe.endsWith(`dsh-desktop-${VERSION}\\DeepSeek Harness.exe`));
  assert.equal(plan.env.DSH_HOME, 'D:\\fixture\\.runtime\\dsh');
  assert.equal(plan.env.PATH, 'original');
  assert.equal(plan.profile, 'D:\\fixture\\.runtime\\dsh\\profiles\\desktop');
});
test('Desktop supplies a separate Chromium data directory and removes Node mode', () => {
  const plan = desktopLaunch('D:/fixture', [], {ELECTRON_RUN_AS_NODE: '1'});
  assert.equal(plan.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.deepEqual(plan.args, ['--user-data-dir=D:\\fixture\\.runtime\\desktop-user-data']);
});
test('Web and debugging flags do not turn default startup into another host', () => {
  for (const args of [['--port', '18765'], ['--profile', 'gameguy'], ['--web'], ['--remote-debugging-port=9222']]) {
    assert.throws(() => desktopLaunch('D:/fixture', args, {}), /explicit Web debugging/);
  }
});
test('setup adds GameGuy to an existing Desktop profile without replacing settings', () => {
  const input = {name: 'desktop', dependencies: {custom: '1'}, dsh: {custom: true, profile: {bundles: ['base'], custom: 1}}};
  const out = withGameguyBundle(input, 'D:/fixture');
  assert.deepEqual(out.dsh.profile.bundles, ['base', '@gameguy/core']);
  assert.equal(out.dsh.custom, true); assert.equal(out.dsh.profile.custom, 1);
  assert.equal(out.dependencies.custom, '1');
  assert.deepEqual(input.dsh.profile.bundles, ['base']);
});
test('setup is idempotent and retains the local plugin dependency', () => {
  const input = {dsh: {profile: {bundles: ['base', '@gameguy/core']}}};
  const out = withGameguyBundle(input, 'D:/fixture');
  assert.deepEqual(withGameguyBundle(out, 'D:/fixture'), out);
  assert.equal(out.dependencies['@gameguy/core'], 'link:D:/fixture/packages/core');
});
test('invalid profile is not overwritten with a guessed bundle list', () => {
  for (const pkg of [{}, {dsh: {profile: {bundles: 'invalid'}}}, {dsh: {profile: {bundles: [42]}}}]) {
    assert.throws(() => withGameguyBundle(pkg), /Invalid DSH profile/);
  }
});
