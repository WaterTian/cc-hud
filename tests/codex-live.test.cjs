// Opt-in: real Codex, isolated config, no auth or model requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('real Codex config API preserves TOML and restores the owned field', { skip: process.env.CC_HUD_CODEX_LIVE_TEST !== '1', timeout: 30_000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hud-real-config-'));
  const cli = path.join(__dirname, '../dist/cli.js');
  const config = path.join(home, 'config.toml');
  const original = `# Keep this comment and every unrelated setting.
model = "native-config-test-model"
model_provider = "native-config-test"
developer_instructions = '''A multiline string, not a TOML table:
[tui]
status_line = ["decoy"]
'''

[model_providers.native-config-test]
name = "Offline config test"
base_url = "http://127.0.0.1:9/v1"
wire_api = "responses"
requires_openai_auth = false
http_headers = { "X-Test" = "PRIVATE_FIXTURE_VALUE" }

["tui"]
notifications = false
status_line = [
  "model", # This comment belongs to the field being changed.
]
`;
  fs.writeFileSync(config, original);
  const run = action => spawnSync(process.execPath, [cli, action, 'codex'], { env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', timeout: 15_000 });
  try {
    for (const action of ['setup', 'check', 'setup']) {
      const r = run(action);
      assert.equal(r.status, 0, r.stderr);
    }
    const configured = fs.readFileSync(config, 'utf8');
    assert.ok(configured.includes('# Keep this comment and every unrelated setting.'));
    assert.ok(configured.includes('notifications = false'));
    assert.ok(configured.includes('status_line = ["decoy"]'));
    const backup = fs.readFileSync(path.join(home, 'cc-hud-native.json'), 'utf8');
    assert.ok(!backup.includes('PRIVATE_FIXTURE_VALUE'));
    const first = run('restore');
    assert.equal(first.status, 0, first.stderr);
    const { withCodex } = await import('../dist/codex-rpc.js');
    await withCodex(home, async request => {
      const r = await request('config/read', { includeLayers: true });
      const user = r.layers.find(l => l.name.type === 'user');
      assert.deepEqual(user.config.tui.status_line, ['model']);
      assert.equal(user.config.tui.notifications, false);
      assert.equal(user.config.model_providers['native-config-test'].http_headers['X-Test'], 'PRIVATE_FIXTURE_VALUE');
      assert.ok(user.config.developer_instructions.includes('status_line = ["decoy"]'));
    });
    assert.equal(run('check').status, 1);
    assert.equal(run('restore').status, 0);
    assert.equal(run('theme').status, 0);
    assert.equal(run('theme').status, 0);
    assert.ok(fs.existsSync(path.join(home, 'themes', 'cc-hud.tmTheme')));
    assert.equal(run('restore-theme').status, 0);
    await withCodex(home, async request => {
      const r = await request('config/read', { includeLayers: true });
      const tui = r.layers.find(l => l.name.type === 'user').config.tui;
      assert.equal(tui.theme, undefined);
      assert.equal(tui.status_line_use_colors, undefined);
      assert.deepEqual(tui.status_line, ['model']);
      assert.equal(tui.notifications, false);
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
