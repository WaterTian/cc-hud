import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFlag } from './env.js';
// One cache directory for every collector: ~/.cache/cc-hud/<name>.json,
// written atomically. Two disciplines share it:
//   • detached (serveCache + storeRefresh) — the tick only READS; refresh.ts
//     does the network and WRITES. Used by the Claude top-model gauge.
//   • inline (cachedInline) — a miss fetches inside the tick under a short
//     budget. Used by the third-party balance / quota collectors.
export const TTL = 5 * 60 * 1000; // payload considered current
export const REFRESH_COOLDOWN = 30 * 1000; // min gap between refresher spawns
export const STALE_MS = 30 * 60 * 1000; // no successful fetch for this long → stale
export const cacheDir = () => join(homedir(), '.cache', 'cc-hud');
const file = (name) => join(cacheDir(), `${name}.json`);
export function readCache(name) {
    try {
        return JSON.parse(readFileSync(file(name), 'utf8'));
    }
    catch {
        return null;
    }
}
// Write via a per-process temp file + rename so a reader (another tick, the
// refresher) never sees a half-written JSON file. Shared by every cache writer.
export function writeFileAtomic(path, data) {
    const tmp = `${path}.tmp-${process.pid}`;
    try {
        writeFileSync(tmp, data);
        renameSync(tmp, path);
    }
    catch {
        try {
            unlinkSync(tmp);
        }
        catch { /* already gone */ }
    }
}
export function writeCache(name, entry) {
    try {
        mkdirSync(cacheDir(), { recursive: true });
        writeFileAtomic(file(name), JSON.stringify(entry));
    }
    catch { /* best effort */ }
}
// Refresher side: record a fetch outcome. A failure (null) keeps the previous
// payload but does not advance okTs, so the gauge ages into the stale state.
export function storeRefresh(name, fresh) {
    const old = readCache(name);
    const now = Date.now();
    writeCache(name, {
        payload: fresh ?? old?.payload ?? null,
        ts: now,
        okTs: fresh ? now : old?.okTs,
    });
}
function spawnRefresh(kind) {
    if (envFlag('CC_HUD_NO_REFRESH'))
        return;
    try {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./refresh.js', import.meta.url)), kind], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
    }
    catch { /* refresh is best effort */ }
}
function serve(entry, now) {
    if (!entry?.payload)
        return null;
    return { payload: entry.payload, stale: entry.okTs == null || now - entry.okTs > STALE_MS };
}
// Tick side — NO network, ever. Serves the cache (stale is fine: better a
// 5-min-old figure than a blocked statusline) and, once the TTL has passed,
// delegates refreshing to a detached child throttled by REFRESH_COOLDOWN.
export function serveCache(name, kind) {
    const cached = readCache(name);
    const now = Date.now();
    if (cached && now - cached.ts < TTL)
        return serve(cached, now);
    if (cached?.refreshTs == null || now - cached.refreshTs >= REFRESH_COOLDOWN) {
        const placeholder = cached
            ? { ...cached, refreshTs: now }
            : { payload: null, ts: 0, refreshTs: now };
        writeCache(name, placeholder);
        spawnRefresh(kind);
        return serve(placeholder, now);
    }
    return serve(cached, now);
}
// Inline discipline (third-party balance / quota collectors): a fresh entry
// is served as is; a miss runs `fetcher` INSIDE the tick — it must keep its
// own budget (http.INLINE_TIMEOUT_MS) — and writes the cache; a failed fetch
// serves whatever was cached before, however old.
export async function cachedInline(name, fetcher) {
    const cached = readCache(name);
    if (cached?.payload != null && Date.now() - cached.ts < TTL)
        return cached.payload;
    let fresh = null;
    try {
        fresh = await fetcher();
    }
    catch { /* collector failure → stale */ }
    if (fresh == null)
        return cached?.payload ?? null;
    writeCache(name, { payload: fresh, ts: Date.now() });
    return fresh;
}
