// Optional native theme. This also colors Codex's syntax highlighting; it is
// separate from footer setup so existing themes are never changed implicitly.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { withCodex } from './codex-rpc.js';
const THEME = 'cc-hud';
const same = (a, b) => a.theme === b.theme && a.colors === b.colors;
const applied = { theme: THEME, colors: true };
export async function codexTheme(restore) {
    const home = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
    const backupFile = join(home, 'cc-hud-theme.json');
    let previous = null;
    if (existsSync(backupFile)) {
        try {
            const b = JSON.parse(readFileSync(backupFile, 'utf8'));
            if (b.schema !== 1 || !(b.theme === null || typeof b.theme === 'string') || !(b.colors === null || typeof b.colors === 'boolean'))
                throw new Error();
            previous = { theme: b.theme, colors: b.colors };
        }
        catch {
            throw new Error('Invalid Codex theme backup; settings were left untouched.');
        }
    }
    if (restore && !previous) {
        process.stdout.write('No cc-hud theme backup; nothing changed.\n');
        return;
    }
    if (!restore)
        mkdirSync(home, { recursive: true, mode: 0o700 });
    await withCodex(home, async (request) => {
        const result = await request('config/read', { includeLayers: true });
        const user = result.layers?.find(l => l.name.type === 'user' && !l.name.profile);
        if (!user)
            throw new Error('Codex did not return a supported user configuration layer.');
        const current = { theme: user.config.tui?.theme ?? null, colors: user.config.tui?.status_line_use_colors ?? null };
        const owned = current.colors === true && [THEME, 'cc-hud-mocha'].includes(current.theme ?? '');
        if (previous && !owned && !same(current, previous))
            throw new Error('Theme settings were edited after setup; they were left untouched.');
        if (!restore) {
            const asset = readFileSync(new URL('../assets/cc-hud.tmTheme', import.meta.url), 'utf8');
            const target = join(home, 'themes', `${THEME}.tmTheme`);
            if (existsSync(target) && readFileSync(target, 'utf8') !== asset)
                throw new Error('The cc-hud theme file was edited; it was left untouched.');
            if (!previous && !same(current, applied))
                writeFileSync(backupFile, JSON.stringify({ schema: 1, ...current }) + '\n', { flag: 'wx', mode: 0o600 });
            mkdirSync(join(home, 'themes'), { recursive: true });
            if (!existsSync(target))
                writeFileSync(target, asset, { flag: 'wx' });
        }
        const desired = restore ? previous : applied;
        if (!same(current, desired))
            await request('config/batchWrite', {
                filePath: user.name.file, expectedVersion: user.version,
                edits: [
                    { keyPath: 'tui.theme', value: desired.theme, mergeStrategy: 'replace' },
                    { keyPath: 'tui.status_line_use_colors', value: desired.colors, mergeStrategy: 'replace' },
                ],
            });
        const saved = await request('config/read', { includeLayers: true });
        const local = saved.layers?.find(l => l.name.type === 'user' && !l.name.profile)?.config.tui;
        if (!same({ theme: local?.theme ?? null, colors: local?.status_line_use_colors ?? null }, desired)) {
            throw new Error('Codex did not retain the requested theme; the backup is preserved.');
        }
        if (!restore && (saved.config?.tui?.theme !== THEME || saved.config.tui.status_line_use_colors !== true)) {
            throw new Error('Theme saved, but another Codex configuration layer overrides it.');
        }
        if (restore)
            unlinkSync(backupFile);
        process.stdout.write(restore
            ? 'Previous Codex theme settings restored. Restart Codex to load them.\n'
            : 'CC-HUD theme saved. Select cc-hud in /theme, or restart Codex.\n');
    });
}
