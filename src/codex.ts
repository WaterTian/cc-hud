// Configure Codex's own footer once. Codex keeps owning rendering, data and
// refresh; the Claude renderer and launcher remain independent of this module.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { withCodex } from './codex-rpc.js';
import type { Request } from './codex-rpc.js';

export const CODEX_ITEMS = [
  'model-with-reasoning', 'context-used', 'five-hour-limit',
  'weekly-limit', 'project-name', 'git-branch',
];
type Items = string[] | null;
interface Backup { schema: 1; previous: Items; applied: string[] }
interface Snapshot { local: Items; effective: Items; version: string; file: string }
const equal = (a: Items, b: Items) => JSON.stringify(a) === JSON.stringify(b);
const isItems = (value: unknown): value is Items => value === null || (Array.isArray(value) && value.every(v => typeof v === 'string'));

function backupAt(file: string): Backup | null {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Could not read the saved Codex footer backup.');
  }
  try {
    const b = JSON.parse(raw) as Backup;
    if (b.schema !== 1 || !isItems(b.previous) || !Array.isArray(b.applied) || !isItems(b.applied)) throw new Error();
    return b;
  } catch { throw new Error('Invalid Codex footer backup; configuration was left untouched.'); }
}

async function snapshot(request: Request): Promise<Snapshot> {
  const result = await request('config/read', { includeLayers: true }) as {
    config?: { tui?: { status_line?: unknown } };
    layers?: { name: { type: string; file?: string; profile?: string }; version: string; config?: { tui?: { status_line?: unknown } } }[];
  };
  const user = result.layers?.find(l => l.name.type === 'user' && !l.name.profile);
  const local = user?.config?.tui?.status_line ?? null;
  const effective = result.config?.tui?.status_line ?? null;
  if (!user?.name.file || !user.version || !isItems(local) || !isItems(effective)) {
    throw new Error('Codex did not return a supported user configuration layer.');
  }
  return { local, effective, version: user.version, file: user.name.file };
}

async function setItems(request: Request, before: Snapshot, value: Items): Promise<Snapshot> {
  // Codex owns TOML parsing and atomic writing, including removing a missing
  // original key (JSON null). The version guard prevents concurrent edits.
  await request('config/batchWrite', {
    filePath: before.file, expectedVersion: before.version,
    edits: [{ keyPath: 'tui.status_line', value, mergeStrategy: 'replace' }],
  });
  const after = await snapshot(request);
  if (!equal(after.local, value)) throw new Error('Codex did not retain the requested footer; the backup is preserved.');
  return after;
}

export async function codexCommand(action: 'setup' | 'check' | 'restore'): Promise<void> {
  const home = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const backupFile = join(home, 'cc-hud-native.json');
  const backup = backupAt(backupFile);
  if (action === 'restore' && !backup) {
    process.stdout.write('No cc-hud Codex footer backup; nothing changed.\n');
    return;
  }
  if (action === 'check' && !existsSync(home)) {
    process.stdout.write('Not configured: Codex native footer\n');
    process.exitCode = 1;
    return;
  }
  if (action === 'setup') mkdirSync(home, { recursive: true, mode: 0o700 });
  await withCodex(home, async (request, version) => {
    const before = await snapshot(request);
    if (action === 'check') {
      const configured = equal(before.local, CODEX_ITEMS) && equal(before.effective, CODEX_ITEMS);
      process.stdout.write(`${configured ? 'Configured' : 'Not configured'}: Codex native footer (${version})\n`);
      if (!configured) process.exitCode = 1;
      return;
    }
    if (action === 'restore') {
      if (!equal(before.local, backup!.previous)) {
        if (!equal(before.local, backup!.applied)) throw new Error('The footer was edited after setup; restore left it untouched.');
        await setItems(request, before, backup!.previous);
      }
      unlinkSync(backupFile);
      process.stdout.write('Previous Codex footer restored. Restart Codex to load it.\n');
      return;
    }
    if (equal(before.local, CODEX_ITEMS)) {
      if (!equal(before.effective, CODEX_ITEMS)) throw new Error('The saved footer is overridden by another Codex configuration layer.');
      process.stdout.write('Codex native footer already configured; nothing changed.\n');
      return;
    }
    if (backup && !equal(before.local, backup.applied) && !equal(before.local, backup.previous)) {
      throw new Error('The footer was edited after setup; setup left it untouched.');
    }
    if (!backup) {
      // Back up only the one field we own, never a full config or credentials.
      // A failed write leaves this backup available for retry or restoration.
      writeFileSync(backupFile, JSON.stringify({ schema: 1, previous: before.local, applied: CODEX_ITEMS }) + '\n', { flag: 'wx', mode: 0o600 });
    }
    const after = await setItems(request, before, CODEX_ITEMS);
    if (!equal(after.effective, CODEX_ITEMS)) throw new Error('Footer saved, but another Codex configuration layer overrides it.');
    process.stdout.write('Codex native footer configured. Restart Codex to load it.\n');
  });
}
