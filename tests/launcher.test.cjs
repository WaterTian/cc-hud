const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { findCcHudEntry, defaultConfigDir, NOT_FOUND } = require('../scripts/launcher.cjs');

const LAUNCHER = path.join(__dirname, '..', 'scripts', 'launcher.cjs');

// A fake HOME whose <home>/.claude is the Claude config dir
function makeFakeHome(installs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hud-launcher-test-'));
  const pluginsDir = path.join(root, '.claude', 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  const data = { version: 2, plugins: {} };
  for (const inst of installs) {
    const installDir = path.join(
      root, '.claude', 'plugins', 'cache', 'cc-hud', 'cc-hud', inst.version,
    );
    fs.mkdirSync(installDir, { recursive: true });
    if (inst.hasDist !== false) {
      fs.mkdirSync(path.join(installDir, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(installDir, 'dist', 'index.js'), '');
    }
    const key = inst.key || 'cc-hud@cc-hud';
    if (!data.plugins[key]) data.plugins[key] = [];
    data.plugins[key].push({
      scope: inst.scope || 'user',
      installPath: installDir,
      version: inst.version,
      installedAt: inst.lastUpdated,
      lastUpdated: inst.lastUpdated,
    });
  }
  fs.writeFileSync(path.join(pluginsDir, 'installed_plugins.json'), JSON.stringify(data));
  return root;
}
const cfgOf = (home) => path.join(home, '.claude');

// Run the launcher as Claude Code would, with its config dir pinned
function runLauncher(configDir, stdin) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  return spawnSync(process.execPath, [LAUNCHER], { input: stdin, encoding: 'utf8', env, timeout: 10_000 });
}

describe('findCcHudEntry', () => {
  it('returns null when installed_plugins.json is missing', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hud-launcher-test-'));
    assert.equal(findCcHudEntry(cfgOf(home)), null);
  });

  it('returns null when installed_plugins.json is malformed JSON', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hud-launcher-test-'));
    const dir = path.join(home, '.claude', 'plugins');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'installed_plugins.json'), '{garbage');
    assert.equal(findCcHudEntry(cfgOf(home)), null);
  });

  it('returns null when no cc-hud@* entries are present', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hud-launcher-test-'));
    const dir = path.join(home, '.claude', 'plugins');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'other-plugin@market': [{ scope: 'user', installPath: '/x' }] },
    }));
    assert.equal(findCcHudEntry(cfgOf(home)), null);
  });

  it('resolves dist/index.js for a single install', () => {
    const home = makeFakeHome([
      { version: '0.5.0', lastUpdated: '2026-06-18T00:00:00.000Z' },
    ]);
    const got = findCcHudEntry(cfgOf(home));
    assert.ok(got, 'expected non-null');
    assert.ok(
      got.endsWith(path.join('0.5.0', 'dist', 'index.js')),
      `got: ${got}`,
    );
  });

  it('picks the most recently updated install when multiple versions exist', () => {
    const home = makeFakeHome([
      { version: '0.4.5', lastUpdated: '2026-04-01T00:00:00.000Z' },
      { version: '0.5.0', lastUpdated: '2026-06-18T00:00:00.000Z' },
      { version: '0.4.8', lastUpdated: '2026-05-10T00:00:00.000Z' },
    ]);
    const got = findCcHudEntry(cfgOf(home));
    assert.ok(got && got.includes(path.join('0.5.0', 'dist', 'index.js')));
  });

  it('falls back to the next candidate when the latest install has no dist/index.js', () => {
    const home = makeFakeHome([
      { version: '0.5.0', lastUpdated: '2026-06-18T00:00:00.000Z', hasDist: false },
      { version: '0.4.5', lastUpdated: '2026-04-01T00:00:00.000Z' },
    ]);
    const got = findCcHudEntry(cfgOf(home));
    assert.ok(got && got.includes(path.join('0.4.5', 'dist', 'index.js')));
  });

  it('handles cc-hud entries from multiple marketplaces', () => {
    const home = makeFakeHome([
      { version: '0.5.0', lastUpdated: '2026-06-18T00:00:00.000Z', key: 'cc-hud@WaterTian-cc-hud' },
      { version: '0.4.5', lastUpdated: '2026-04-01T00:00:00.000Z', key: 'cc-hud@cc-hud' },
    ]);
    const got = findCcHudEntry(cfgOf(home));
    assert.ok(got && got.includes(path.join('0.5.0', 'dist', 'index.js')));
  });

  it('ranks installs without lastUpdated after dated ones', () => {
    const home = makeFakeHome([
      { version: '0.9.0', lastUpdated: undefined },
      { version: '0.8.0', lastUpdated: '2026-10-16T00:00:00Z' },
    ]);
    assert.match(findCcHudEntry(cfgOf(home)), /0\.8\.0[\\/]dist[\\/]index\.js$/);
  });

  it('tolerates an unparsable lastUpdated and a non-array plugin entry', () => {
    const home = makeFakeHome([
      { version: '0.9.0', lastUpdated: 'not-a-date' },
    ]);
    const file = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.plugins['cc-hud@broken'] = { installPath: '/nope' };
    fs.writeFileSync(file, JSON.stringify(data));
    assert.match(findCcHudEntry(cfgOf(home)), /0\.9\.0[\\/]dist[\\/]index\.js$/);
  });

  describe('config dir resolution', () => {
    const saved = process.env.CLAUDE_CONFIG_DIR;
    afterEach(() => {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = saved;
    });

    it('defaults to ~/.claude', () => {
      delete process.env.CLAUDE_CONFIG_DIR;
      assert.equal(defaultConfigDir(), path.join(os.homedir(), '.claude'));
    });

    it('honors CLAUDE_CONFIG_DIR when no argument is given', () => {
      const home = makeFakeHome([{ version: '0.9.0', lastUpdated: '2026-10-16T00:00:00Z' }]);
      process.env.CLAUDE_CONFIG_DIR = cfgOf(home);
      assert.equal(defaultConfigDir(), cfgOf(home));
      assert.match(findCcHudEntry(), /0\.9\.0[\\/]dist[\\/]index\.js$/);
    });
  });
});

describe('launcher main()', () => {
  it('prints a visible hint instead of nothing when no cc-hud install resolves', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hud-launcher-test-'));
    const res = runLauncher(cfgOf(home), '{}');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, NOT_FOUND + '\n');
    assert.match(NOT_FOUND, /run \/cc-hud:setup/);
  });

  it('relays stdin to the resolved dist/index.js and its stdout back', () => {
    const home = makeFakeHome([{ version: '0.9.0', lastUpdated: '2026-10-16T00:00:00Z' }]);
    const entry = findCcHudEntry(cfgOf(home));
    fs.writeFileSync(entry, `process.stdout.write('relayed:' + require('fs').readFileSync(0, 'utf8'));\n`);
    const res = runLauncher(cfgOf(home), '{"a":1}');
    assert.equal(res.status, 0);
    assert.equal(res.stdout, 'relayed:{"a":1}');
  });
});
