const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
if (process.argv[2] === '--version') {
  process.stdout.write(`codex-cli ${process.env.FAKE_CODEX_VERSION || '0.166.0'}\n`);
  return;
}
const file = path.join(process.env.CODEX_HOME, 'fixture.json');
fs.writeFileSync(path.join(process.env.CODEX_HOME, 'child.pid'), String(process.pid));
const version = d => createHash('sha256').update(JSON.stringify(d)).digest('hex');
const send = x => process.stdout.write(JSON.stringify(x) + '\n');
if (process.env.FAKE_CODEX_HANG) process.on('SIGTERM', () => {});
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const r = JSON.parse(line);
  if (!r.id || process.env.FAKE_CODEX_HANG) return;
  const d = JSON.parse(fs.readFileSync(file));
  fs.appendFileSync(path.join(process.env.CODEX_HOME, 'methods.log'), r.method + '\n');
  if (r.method === 'initialize') {
    process.stdout.write('not json\nnull\n');
    return send({ id: r.id, result: {} });
  }
  if (r.method === 'config/read') return send({ id: r.id, result: {
    config: { ...d, tui: { status_line: d.overridden ? ['model'] : d.local, theme: d.theme, status_line_use_colors: d.colors } },
    layers: [{ name: { type: 'user', file: path.join(process.env.CODEX_HOME, 'config.toml') }, config: { tui: { status_line: d.local, theme: d.theme, status_line_use_colors: d.colors } }, version: version(d) }],
  } });
  if (r.method === 'config/batchWrite') {
    if (process.env.FAKE_CODEX_RACE) {
      d.other = 'concurrent edit';
      fs.writeFileSync(file, JSON.stringify(d));
    }
    if (process.env.FAKE_CODEX_WRITE_ERROR || r.params.expectedVersion !== version(d)) return send({ id: r.id, error: { code: -1, message: 'PRIVATE_CONFIG_VALUE must not be printed' } });
    for (const edit of r.params.edits) {
      const key = { 'tui.status_line': 'local', 'tui.theme': 'theme', 'tui.status_line_use_colors': 'colors' }[edit.keyPath];
      if (edit.value === null && key !== 'local') delete d[key]; else d[key] = edit.value;
    }
    fs.writeFileSync(file, JSON.stringify(d));
    return send({ id: r.id, result: { status: 'ok' } });
  }
  send({ id: r.id, error: { code: -1, message: 'unexpected method' } });
});
