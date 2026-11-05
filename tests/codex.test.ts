import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CODEX_ITEMS } from '../dist/codex.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const fake = fileURLToPath(new URL('./fixtures/fake-codex.cjs', import.meta.url));
function fixture(initial: string[] | null = ['model'], overridden = false) {
  const home = mkdtempSync(join(tmpdir(), 'cc-hud-native-'));
  const file = join(home, 'fixture.json');
  const backup = join(home, 'cc-hud-native.json');
  writeFileSync(file, JSON.stringify({ local: initial, other: 'KEEP_PRIVATE', overridden }));
  const run = (action: string, extra: Record<string, string> = {}, entry = cli) => spawnSync(process.execPath, [entry, action, 'codex'], {
    env: { ...process.env, CODEX_HOME: home, CC_HUD_CODEX: fake, ...extra }, encoding: 'utf8', timeout: 15_000,
  });
  return { home, file, backup, run, data: () => JSON.parse(readFileSync(file, 'utf8')), clean: () => rmSync(home, { recursive: true, force: true }) };
}

describe('Codex native footer commands', () => {
  it('saves one field, is idempotent, checks it, and restores the previous value', () => {
    const f = fixture();
    try {
      assert.equal(f.run('setup').status, 0);
      assert.deepEqual(f.data().local, CODEX_ITEMS);
      assert.equal(f.data().other, 'KEEP_PRIVATE');
      const originalBackup = readFileSync(f.backup, 'utf8');
      assert.ok(!originalBackup.includes('KEEP_PRIVATE'));
      if (process.platform !== 'win32') assert.equal(statSync(f.backup).mode & 0o777, 0o600);
      assert.equal(f.run('setup').status, 0);
      assert.equal(readFileSync(f.backup, 'utf8'), originalBackup);
      assert.equal(f.run('check').status, 0);
      const methods = readFileSync(join(f.home, 'methods.log'), 'utf8').trim().split('\n');
      assert.ok(methods.every(m => ['initialize', 'config/read', 'config/batchWrite'].includes(m)));
      assert.equal(methods.filter(m => m === 'config/batchWrite').length, 1);
      writeFileSync(f.file, JSON.stringify({ ...f.data(), other: 'LATER_USER_EDIT' }));
      assert.equal(f.run('restore').status, 0);
      assert.deepEqual(f.data().local, ['model']);
      assert.equal(f.data().other, 'LATER_USER_EDIT');
      assert.ok(!existsSync(f.backup));
      assert.equal(f.run('restore').status, 0);
    } finally { f.clean(); }
  });

  it('restores a missing original key and a disabled footer distinctly', () => {
    for (const value of [null, []]) {
      const f = fixture(value);
      try {
        assert.equal(f.run('setup').status, 0);
        assert.equal(f.run('restore').status, 0);
        assert.deepEqual(f.data().local, value);
      } finally { f.clean(); }
    }
  });

  it('does not take ownership of an already matching preset', () => {
    const f = fixture(CODEX_ITEMS);
    try {
      assert.equal(f.run('setup').status, 0);
      assert.ok(!existsSync(f.backup));
      assert.equal(f.run('restore').status, 0);
      assert.deepEqual(f.data().local, CODEX_ITEMS);
    } finally { f.clean(); }
  });

  it('leaves later user edits untouched on setup and restore', () => {
    const f = fixture();
    try {
      assert.equal(f.run('setup').status, 0);
      writeFileSync(f.file, JSON.stringify({ ...f.data(), local: ['reasoning'] }));
      assert.equal(f.run('restore').status, 1);
      assert.equal(f.run('setup').status, 1);
      assert.deepEqual(f.data().local, ['reasoning']);
      assert.ok(existsSync(f.backup));
    } finally { f.clean(); }
  });

  it('restores the original footer after a release changed the preset', () => {
    const f = fixture(['older-preset']);
    try {
      writeFileSync(f.backup, JSON.stringify({ schema: 1, previous: ['model'], applied: ['older-preset'] }));
      assert.equal(f.run('setup').status, 0);
      assert.deepEqual(f.data().local, CODEX_ITEMS);
      assert.deepEqual(JSON.parse(readFileSync(f.backup, 'utf8')).applied, CODEX_ITEMS);
      assert.equal(f.run('restore').status, 0);
      assert.deepEqual(f.data().local, ['model']);
      assert.ok(!existsSync(f.backup));
    } finally { f.clean(); }
  });

  it('rejects a corrupt backup before spawning Codex', () => {
    const f = fixture();
    try {
      writeFileSync(f.backup, '{}');
      assert.equal(f.run('setup').status, 1);
      assert.deepEqual(f.data().local, ['model']);
      assert.ok(!existsSync(join(f.home, 'child.pid')));
    } finally { f.clean(); }
  });

  it('retains a usable backup when a write fails, and keeps private server errors off stdout/stderr', () => {
    const f = fixture();
    try {
      const r = f.run('setup', { FAKE_CODEX_WRITE_ERROR: '1' });
      assert.equal(r.status, 1);
      assert.ok(!(r.stdout + r.stderr).includes('PRIVATE_CONFIG_VALUE'));
      assert.deepEqual(f.data().local, ['model']);
      assert.ok(existsSync(f.backup));
      assert.equal(f.run('setup').status, 0);
      assert.equal(f.run('restore').status, 0);
      assert.deepEqual(f.data().local, ['model']);
    } finally { f.clean(); }
  });

  it('does not overwrite a concurrent configuration edit', () => {
    const f = fixture();
    try {
      assert.equal(f.run('setup', { FAKE_CODEX_RACE: '1' }).status, 1);
      assert.equal(f.data().other, 'concurrent edit');
      assert.deepEqual(f.data().local, ['model']);
      assert.equal(f.run('restore').status, 0);
      assert.equal(f.data().other, 'concurrent edit');
    } finally { f.clean(); }
  });

  it('reports configuration overrides instead of claiming success', () => {
    const f = fixture(['model'], true);
    try {
      assert.equal(f.run('setup').status, 1);
      assert.equal(f.run('check').status, 1);
      assert.ok(existsSync(f.backup));
      assert.equal(f.run('restore').status, 0);
    } finally { f.clean(); }
  });

  it('rejects an older CLI without changing the configuration', () => {
    const f = fixture();
    try {
      assert.equal(f.run('setup', { FAKE_CODEX_VERSION: '0.165.0' }).status, 1);
      assert.deepEqual(f.data().local, ['model']);
      assert.ok(!existsSync(f.backup));
    } finally { f.clean(); }
  });

  it('bounds a hung service and terminates a child that ignores SIGTERM', { timeout: 15_000 }, () => {
    const f = fixture();
    try {
      const r = f.run('setup', { FAKE_CODEX_HANG: '1' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /timed out/);
      assert.deepEqual(f.data().local, ['model']);
      const pid = Number(readFileSync(join(f.home, 'child.pid'), 'utf8'));
      assert.throws(() => process.kill(pid, 0));
    } finally { f.clean(); }
  });
});

describe('npm entry compatibility', () => {
  it('keeps the Claude stdin renderer and one-line output', () => {
    const r = spawnSync(process.execPath, [cli], { input: '{"model":{"id":"claude-fable-5-1"},"context_window":{"used_percentage":13}}', encoding: 'utf8', env: { ...process.env, CC_HUD_NO_REFRESH: '1' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Fable 5.1/);
    assert.equal(r.stdout.trim().split('\n').length, 1);
  });
  it('shows help without waiting for stdin and rejects invalid commands', () => {
    assert.match(spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 2000 }).stdout, /setup codex/);
    assert.match(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', timeout: 2000 }).stdout, /^\d+\.\d+\.\d+/);
    const r = spawnSync(process.execPath, [cli, 'setup', 'claude'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage:/);
  });
});

describe('optional native theme', () => {
  it('can upgrade an asset installed when the theme settings already matched', () => {
    const f = fixture();
    try {
      writeFileSync(f.file, JSON.stringify({ ...f.data(), theme: 'cc-hud', colors: true }));
      assert.equal(f.run('theme').status, 0);
      const target = join(f.home, 'themes', 'cc-hud.tmTheme');
      const original = readFileSync(target, 'utf8');
      // A separate package simulates the next release without editing this checkout.
      const release = join(f.home, 'release');
      cpSync(fileURLToPath(new URL('../dist/', import.meta.url)), join(release, 'dist'), { recursive: true });
      cpSync(fileURLToPath(new URL('../assets/', import.meta.url)), join(release, 'assets'), { recursive: true });
      writeFileSync(join(release, 'package.json'), '{"type":"module"}');
      const updated = original.replace('</plist>', '<!-- next release -->\n</plist>');
      writeFileSync(join(release, 'assets', 'cc-hud.tmTheme'), updated);
      const r = f.run('theme', {}, join(release, 'dist', 'cli.js'));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(target, 'utf8'), updated);
      assert.equal(f.run('restore-theme').status, 0);
      assert.equal(f.data().theme, 'cc-hud');
      assert.equal(f.data().colors, true);
    } finally { f.clean(); }
  });

  it('migrates the old theme name while retaining the original restore point', () => {
    const f = fixture();
    try {
      writeFileSync(f.file, JSON.stringify({ ...f.data(), theme: 'cc-hud-mocha', colors: true }));
      writeFileSync(join(f.home, 'cc-hud-theme.json'), JSON.stringify({ schema: 1, theme: 'original-theme', colors: false }));
      assert.equal(f.run('theme').status, 0);
      assert.equal(f.data().theme, 'cc-hud');
      assert.equal(f.run('restore-theme').status, 0);
      assert.equal(f.data().theme, 'original-theme');
      assert.equal(f.data().colors, false);
    } finally { f.clean(); }
  });

  it('applies the palette, preserves footer settings, and restores theme and color preferences', () => {
    const f = fixture();
    try {
      writeFileSync(f.file, JSON.stringify({ ...f.data(), theme: 'old-theme', colors: false }));
      assert.equal(f.run('theme').status, 0);
      assert.equal(f.data().theme, 'cc-hud');
      assert.equal(f.data().colors, true);
      assert.deepEqual(f.data().local, ['model']);
      const backup = join(f.home, 'cc-hud-theme.json');
      const original = readFileSync(backup, 'utf8');
      assert.equal(f.run('theme').status, 0);
      assert.equal(readFileSync(backup, 'utf8'), original);
      assert.ok(existsSync(join(f.home, 'themes', 'cc-hud.tmTheme')));
      assert.equal(f.run('restore-theme').status, 0);
      assert.equal(f.data().theme, 'old-theme');
      assert.equal(f.data().colors, false);
      assert.deepEqual(f.data().local, ['model']);
      assert.ok(!existsSync(backup));
      assert.equal(f.run('restore-theme').status, 0);
    } finally { f.clean(); }
  });

  it('restores unset preferences after a failed write and retry', () => {
    const f = fixture();
    try {
      const r = f.run('theme', { FAKE_CODEX_WRITE_ERROR: '1' });
      assert.equal(r.status, 1);
      assert.ok(!r.stderr.includes('PRIVATE_CONFIG_VALUE'));
      assert.equal(f.data().theme, undefined);
      assert.equal(f.run('theme').status, 0);
      assert.equal(f.run('restore-theme').status, 0);
      assert.equal(f.data().theme, undefined);
      assert.equal(f.data().colors, undefined);
    } finally { f.clean(); }
  });

  it('refreshes a theme file it installed earlier, by recorded hash', () => {
    const f = fixture();
    try {
      assert.equal(f.run('theme').status, 0);
      const target = join(f.home, 'themes', 'cc-hud.tmTheme');
      const backup = join(f.home, 'cc-hud-theme.json');
      const asset = readFileSync(target, 'utf8');
      const record = JSON.parse(readFileSync(backup, 'utf8'));
      assert.equal(record.asset, createHash('sha256').update(asset).digest('hex'));
      // Simulate an older release's file still on disk
      writeFileSync(target, 'older shipped asset');
      writeFileSync(backup, JSON.stringify({ ...record, asset: createHash('sha256').update('older shipped asset').digest('hex') }));
      assert.equal(f.run('theme').status, 0);
      assert.equal(readFileSync(target, 'utf8'), asset);
      assert.equal(JSON.parse(readFileSync(backup, 'utf8')).asset, record.asset);
    } finally { f.clean(); }
  });

  it('preserves later theme choices and edited theme assets', () => {
    const f = fixture();
    try {
      assert.equal(f.run('theme').status, 0);
      writeFileSync(f.file, JSON.stringify({ ...f.data(), theme: 'user-choice' }));
      assert.equal(f.run('restore-theme').status, 1);
      assert.equal(f.run('theme').status, 1);
      assert.equal(f.data().theme, 'user-choice');
      writeFileSync(f.file, JSON.stringify({ ...f.data(), theme: 'cc-hud' }));
      writeFileSync(join(f.home, 'themes', 'cc-hud.tmTheme'), 'user-edited asset');
      assert.equal(f.run('theme').status, 1);
      assert.equal(readFileSync(join(f.home, 'themes', 'cc-hud.tmTheme'), 'utf8'), 'user-edited asset');
    } finally { f.clean(); }
  });
});
