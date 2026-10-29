import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

test('OTA guard rejects a native change without a runtime bump and accepts a synchronized bump', () => {
  const root = mkdtempSync(join(tmpdir(), 'pocketops-runtime-'));
  try {
    mkdirSync(join(root, 'mobile/scripts'), { recursive: true });
    mkdirSync(join(root, 'mobile/android/app/src/main/res/values'), { recursive: true });
    copyFileSync(new URL('../scripts/check-update-runtime.mjs', import.meta.url), join(root, 'mobile/scripts/check-update-runtime.mjs'));
    const config = { expo: { runtimeVersion: '1', extra: { eas: { projectId: 'fixture' } }, updates: { enabled: true, url: 'https://u.expo.dev/fixture' } } };
    const writeConfig = () => writeFileSync(join(root, 'mobile/app.json'), JSON.stringify(config));
    const writeRuntime = (value) => writeFileSync(join(root, 'mobile/android/app/src/main/res/values/strings.xml'), `<resources><string name="expo_runtime_version">${value}</string></resources>`);
    writeConfig(); writeRuntime('1');
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
    git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'baseline');
    const base = git('rev-parse', 'HEAD').toString().trim();
    const check = () => spawnSync(process.execPath, ['mobile/scripts/check-update-runtime.mjs'], { cwd: root, env: { ...process.env, UPDATE_BASE_SHA: base }, encoding: 'utf8' });
    assert.equal(check().status, 0);
    writeFileSync(join(root, 'mobile/android/native-input.txt'), 'changed');
    git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'native change');
    assert.match(check().stderr, /bump runtimeVersion/);
    config.expo.runtimeVersion = '2'; writeConfig();
    assert.match(check().stderr, /identical/);
    writeRuntime('2');
    git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'runtime bump');
    assert.equal(check().status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
