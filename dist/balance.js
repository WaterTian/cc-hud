import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from './cache.js';
const cacheDir = () => join(homedir(), '.cache', 'cc-hud');
const cacheFile = () => join(cacheDir(), 'ds-balance.json');
const TTL = 5 * 60 * 1000; // 5 min
// Inline fetch budget — must end well before the 2s hard exit in index.ts
// (which started earlier), or a hanging endpoint blanks the whole bar.
const TIMEOUT_MS = 1200;
function readCache() {
    try {
        return JSON.parse(readFileSync(cacheFile(), 'utf8'));
    }
    catch {
        return null;
    }
}
function writeCache(balance) {
    try {
        mkdirSync(cacheDir(), { recursive: true });
        writeFileAtomic(cacheFile(), JSON.stringify({ balance, ts: Date.now() }));
    }
    catch { }
}
async function fetchBalance(apiKey) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const resp = await fetch('https://api.deepseek.com/user/balance', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: ctrl.signal,
        });
        if (!resp.ok)
            return null;
        const data = (await resp.json());
        const total = data?.balance_infos?.[0]?.total_balance;
        return total ? `¥${total}` : null;
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
        timer.unref();
    }
}
export async function getExtra() {
    // Only activate for DeepSeek backends — Claude users skip everything
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    if (!baseUrl?.includes('deepseek'))
        return null;
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey)
        return null;
    const cached = readCache();
    // Fresh cache — instant return (99.9% of calls)
    if (cached && Date.now() - cached.ts < TTL) {
        return cached.balance;
    }
    // Cache miss — fetch balance, fall back to stale cache on failure
    const balance = await fetchBalance(apiKey);
    if (balance) {
        writeCache(balance);
        return balance;
    }
    return cached?.balance ?? null;
}
