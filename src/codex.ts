// Configure Codex's own footer once. Codex keeps owning rendering, data and
// refresh; the Claude renderer and launcher are independent of this module.
//
// Only `tui.status_line` in the user config layer is touched, through Codex's
// config API (read → version-guarded write → re-read). The previous value and
// the preset applied are kept in $CODEX_HOME/cc-hud-native.json so `restore`
// can put the exact field back; a later user edit of the field is detected
// and left alone by both setup and restore.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readUserLayer, withCodex, writeUserLayer } from './codex-rpc.js';
import type { Request, UserLayer } from './codex-rpc.js';

// Codex's own item names, in display order: model + effort, context used,
// primary / secondary limits, project, branch.
export const CODEX_ITEMS = [
  'model-with-reasoning', 'context-used', 'five-hour-limit',
  'weekly-limit', 'project-name', 'git-branch',
];
export type CodexAction = 'setup' | 'check' | 'restore';

type Items = string[] | null; // null = key absent
interface Backup { schema: 1; previous: Items; applied: string[] }
interface Snapshot { layer: UserLayer; local: Items; effective: Items }

const equal = (a: Items, b: Items) => JSON.stringify(a) === JSON.stringify(b);
const isItems = (v: unknown): v is Items => v === null || (Array.isArray(v) && v.every(s => typeof s === 'string'));
const say = (line: string): void => { process.stdout.write(line + '\n'); };
const sayColorNote = (): void => say('Limit colors follow the active Codex theme, not remaining quota. Optional `theme codex` uses neutral teal and also changes syntax highlighting.');

export const codexHome = () => resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));

function readBackup(file: string): Backup | null {
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

// Back up only the one field we own, never a full config or credentials.
function writeBackup(file: string, backup: Backup, exclusive = false): void {
  writeFileSync(file, JSON.stringify(backup) + '\n', { mode: 0o600, ...(exclusive ? { flag: 'wx' } : {}) });
}

async function snapshot(request: Request): Promise<Snapshot> {
  const layer = await readUserLayer(request);
  const local = layer.tui.status_line ?? null;
  const effective = layer.effectiveTui.status_line ?? null;
  if (!isItems(local) || !isItems(effective)) throw new Error('Codex reported an unsupported tui.status_line value; nothing changed.');
  return { layer, local, effective };
}

async function setItems(request: Request, before: Snapshot, value: Items): Promise<Snapshot> {
  await writeUserLayer(request, before.layer, [{ keyPath: 'tui.status_line', value }]);
  const after = await snapshot(request);
  if (!equal(after.local, value)) throw new Error('Codex did not retain the requested footer; the backup is preserved.');
  return after;
}

export async function codexCommand(action: CodexAction): Promise<void> {
  const home = codexHome();
  const backupFile = join(home, 'cc-hud-native.json');
  const backup = readBackup(backupFile);

  if (action === 'restore' && !backup) return say('No cc-hud Codex footer backup; nothing changed.');
  if (action === 'check' && !existsSync(home)) {
    say('Not configured: Codex native footer');
    process.exitCode = 1;
    return;
  }
  if (action === 'setup') mkdirSync(home, { recursive: true, mode: 0o700 });

  await withCodex(home, async (request, version) => {
    const before = await snapshot(request);
    // A value is "ours" when it is the current preset or the one an earlier
    // setup applied (a release may change the preset between the two).
    const ours = (v: Items) => equal(v, CODEX_ITEMS) || (backup !== null && equal(v, backup.applied));

    if (action === 'check') {
      const configured = equal(before.local, CODEX_ITEMS) && equal(before.effective, CODEX_ITEMS);
      say(`${configured ? 'Configured' : 'Not configured'}: Codex native footer (${version})`);
      if (!configured) process.exitCode = 1;
      else sayColorNote();
      return;
    }

    if (action === 'restore') {
      if (!equal(before.local, backup!.previous)) {
        if (!ours(before.local)) throw new Error('The footer was edited after setup; restore left it untouched.');
        await setItems(request, before, backup!.previous);
      }
      unlinkSync(backupFile);
      return say('Previous Codex footer restored. Restart Codex to load it.');
    }

    // setup
    if (equal(before.local, CODEX_ITEMS)) {
      if (!equal(before.effective, CODEX_ITEMS)) throw new Error('The saved footer is overridden by another Codex configuration layer.');
      if (backup && !equal(backup.applied, CODEX_ITEMS)) writeBackup(backupFile, { ...backup, applied: CODEX_ITEMS });
      say('Codex native footer already configured; nothing changed.');
      return sayColorNote();
    }
    if (backup && !ours(before.local) && !equal(before.local, backup.previous)) {
      throw new Error('The footer was edited after setup; setup left it untouched.');
    }
    // A failed write leaves this backup in place for a retry or a restore.
    if (!backup) writeBackup(backupFile, { schema: 1, previous: before.local, applied: CODEX_ITEMS }, true);
    const after = await setItems(request, before, CODEX_ITEMS);
    if (backup && !equal(backup.applied, CODEX_ITEMS)) writeBackup(backupFile, { ...backup, applied: CODEX_ITEMS });
    if (!equal(after.effective, CODEX_ITEMS)) throw new Error('Footer saved, but another Codex configuration layer overrides it.');
    say('Codex native footer configured. Restart Codex to load it.');
    sayColorNote();
  });
}
