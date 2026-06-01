import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const CACHE_DIR = '.cache/cc-hud';
const TTL = 5 * 60 * 1000; // 5 min — same as balance.ts
const TIMEOUT_MS = 2000;
function cacheFile() {
    return join(homedir(), CACHE_DIR, 'mmx-quota.json');
}
const HOST_CN = 'https://api.minimaxi.com';
const HOST_GLOBAL = 'https://api.minimax.io';
// Critical isolation: non-MiniMax backends skip the whole module
function isMmx() {
    const base = process.env.ANTHROPIC_BASE_URL;
    return !!base?.includes('minimax');
}
function host() {
    return process.env.ANTHROPIC_BASE_URL?.includes('minimaxi.com') ? HOST_CN : HOST_GLOBAL;
}
function readCache() {
    try {
        return JSON.parse(readFileSync(cacheFile(), 'utf8'));
    }
    catch {
        return null;
    }
}
function writeCache(payload) {
    try {
        mkdirSync(join(homedir(), CACHE_DIR), { recursive: true });
        writeFileSync(cacheFile(), JSON.stringify({ payload, ts: Date.now() }));
    }
    catch { /* best effort */ }
}
// API populates *_remaining_percent with the real value; *_usage_count is 0.
// Pick the active entry (status 1) and compute used% as 100 - remaining%.
function aggregatePlan(remains) {
    if (remains.length === 0)
        return null;
    const active = remains.find(m => m.current_interval_status === 1) ?? remains[0];
    const now = Date.now();
    return {
        fiveHourUsedPct: Math.max(0, 100 - active.current_interval_remaining_percent),
        fiveHourResetsAt: now + active.remains_time,
        sevenDayUsedPct: Math.max(0, 100 - active.current_weekly_remaining_percent),
        sevenDayResetsAt: now + active.weekly_remains_time,
    };
}
async function fetchQuota(apiKey) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const resp = await fetch(`${host()}/v1/token_plan/remains`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: ctrl.signal,
        });
        if (!resp.ok)
            return null;
        const data = (await resp.json());
        return aggregatePlan(data.model_remains ?? []);
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
        timer.unref();
    }
}
export async function getMmxQuota() {
    if (!isMmx())
        return null;
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey)
        return null;
    const cached = readCache();
    if (cached && Date.now() - cached.ts < TTL) {
        return cached.payload;
    }
    const quota = await fetchQuota(apiKey);
    if (quota) {
        writeCache(quota);
        return quota;
    }
    return cached?.payload ?? null;
}
