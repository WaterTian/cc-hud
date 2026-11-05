// Optional native theme. It also colors Codex's syntax highlighting, so it is
// separate from footer setup: an existing theme is never changed implicitly.
//
// Touches `tui.theme` + `tui.status_line_use_colors` in the user layer and
// installs assets/cc-hud.tmTheme as $CODEX_HOME/themes/cc-hud.tmTheme. The
// previous two values — and the hash of the theme file we installed, so a
// later release can refresh it — live in $CODEX_HOME/cc-hud-theme.json. A
// user edit of either the settings or the file is detected and left alone.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexHome } from './codex.js';
import { readUserLayer, withCodex, writeUserLayer } from './codex-rpc.js';
const THEME = 'cc-hud';
const OWNED_THEMES = [THEME, 'cc-hud-mocha']; // names earlier releases applied
const applied = { theme: THEME, colors: true };
const same = (a, b) => a.theme === b.theme && a.colors === b.colors;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const say = (line) => { process.stdout.write(line + '\n'); };
const appearance = (tui) => ({
    theme: typeof tui.theme === 'string' ? tui.theme : null,
    colors: typeof tui.status_line_use_colors === 'boolean' ? tui.status_line_use_colors : null,
});
function readBackup(file) {
    if (!existsSync(file))
        return null;
    try {
        const b = JSON.parse(readFileSync(file, 'utf8'));
        const ok = b.schema === 1
            && (b.theme === null || typeof b.theme === 'string')
            && (b.colors === null || typeof b.colors === 'boolean')
            && (b.asset === undefined || typeof b.asset === 'string');
        if (!ok)
            throw new Error();
        return b;
    }
    catch {
        throw new Error('Invalid Codex theme backup; settings were left untouched.');
    }
}
const writeBackup = (file, backup, exclusive = false) => writeFileSync(file, JSON.stringify(backup) + '\n', { mode: 0o600, ...(exclusive ? { flag: 'wx' } : {}) });
// Install (or refresh) the theme file. A differing file is overwritten only
// when its hash is the one we recorded at install — anything else is a user
// edit. Returns the hash of the shipped asset.
function installAsset(home, previous) {
    const asset = readFileSync(new URL('../assets/cc-hud.tmTheme', import.meta.url), 'utf8');
    const target = join(home, 'themes', `${THEME}.tmTheme`);
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (existing !== null && existing !== asset && sha256(existing) !== previous?.asset) {
        throw new Error(`The cc-hud theme file was edited; it was left untouched (delete ${target} to reinstall it).`);
    }
    if (existing !== asset) {
        mkdirSync(join(home, 'themes'), { recursive: true });
        writeFileSync(target, asset);
    }
    return sha256(asset);
}
export async function codexTheme(restore) {
    const home = codexHome();
    const backupFile = join(home, 'cc-hud-theme.json');
    const previous = readBackup(backupFile);
    if (restore && !previous)
        return say('No cc-hud theme backup; nothing changed.');
    if (!restore)
        mkdirSync(home, { recursive: true, mode: 0o700 });
    await withCodex(home, async (request) => {
        const layer = await readUserLayer(request);
        const current = appearance(layer.tui);
        const owned = current.colors === true && OWNED_THEMES.includes(current.theme ?? '');
        if (previous && !owned && !same(current, previous))
            throw new Error('Theme settings were edited after setup; they were left untouched.');
        if (!restore) {
            const hash = installAsset(home, previous);
            if (!previous) {
                // Nothing to restore when the settings already match — no backup then.
                if (!same(current, applied))
                    writeBackup(backupFile, { schema: 1, ...current, asset: hash }, true);
            }
            else if (previous.asset !== hash) {
                writeBackup(backupFile, { ...previous, asset: hash });
            }
        }
        const desired = restore ? previous : applied;
        if (!same(current, desired)) {
            await writeUserLayer(request, layer, [
                { keyPath: 'tui.theme', value: desired.theme },
                { keyPath: 'tui.status_line_use_colors', value: desired.colors },
            ]);
        }
        const saved = await readUserLayer(request);
        if (!same(appearance(saved.tui), desired))
            throw new Error('Codex did not retain the requested theme; the backup is preserved.');
        if (!restore && !same(appearance(saved.effectiveTui), applied))
            throw new Error('Theme saved, but another Codex configuration layer overrides it.');
        if (restore)
            unlinkSync(backupFile);
        say(restore
            ? 'Previous Codex theme settings restored. Restart Codex to load them.'
            : 'CC-HUD theme saved. Select cc-hud in /theme, or restart Codex.');
    });
}
