// Node 22.6+ needs explicit type stripping; enumerate files for Windows too.
const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const root = join(__dirname, '..');
const files = readdirSync(join(root, 'tests')).filter(f => /\.test\.(ts|cjs)$/.test(f)).sort();
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files.map(f => join(root, 'tests', f))], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
