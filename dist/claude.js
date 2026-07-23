import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CACHE_DIR = '.cache/cc-hud';
const TTL = 5 * 60 * 1000; // 5 min — same as balance.ts / mmx.ts / glm.ts
const REFRESH_COOLDOWN = 30 * 1000; // min gap between detached refresh spawns
const TIMEOUT_MS = 2000;
// Same endpoint the /usage panel reads; its `limits[]` array carries the
// top-tier-model weekly gauge that the statusline stdin JSON does not expose.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// Critical isolation: third-party backends (DeepSeek / GLM / MiniMax) skip the whole module
function isAnthropic() {
    const base = process.env.ANTHROPIC_BASE_URL;
    return !base || base.includes('api.anthropic.com');
}
function cacheFile() {
    return join(homedir(), CACHE_DIR, 'claude-plan.json');
}
function readCache() {
    try {
        return JSON.parse(readFileSync(cacheFile(), 'utf8'));
    }
    catch {
        return null;
    }
}
function writeCacheEntry(entry) {
    try {
        mkdirSync(join(homedir(), CACHE_DIR), { recursive: true });
        writeFileSync(cacheFile(), JSON.stringify(entry));
    }
    catch { /* best effort */ }
}
// Tier strings are undocumented ("default_claude_max_5x") — parse defensively,
// fall back to the coarser organizationType, hide the segment when unknown.
function normalizeTier(rateLimitTier, orgType) {
    if (typeof rateLimitTier === 'string') {
        const m = rateLimitTier.match(/max_(\d+)x/i);
        if (m)
            return `Max${m[1]}x`;
        if (/enterprise/i.test(rateLimitTier))
            return 'Enterprise';
        if (/team/i.test(rateLimitTier))
            return 'Team';
        if (/pro/i.test(rateLimitTier))
            return 'Pro';
        if (/free/i.test(rateLimitTier))
            return 'Free';
    }
    if (typeof orgType === 'string') {
        if (orgType.includes('enterprise'))
            return 'Enterprise';
        if (orgType.includes('team'))
            return 'Team';
        if (orgType.includes('max'))
            return 'Max';
        if (orgType.includes('pro'))
            return 'Pro';
    }
    return null;
}
function readTier() {
    try {
        const raw = readFileSync(join(homedir(), '.claude.json'), 'utf8');
        const acct = JSON.parse(raw).oauthAccount;
        if (!acct)
            return null;
        return normalizeTier(acct.organizationRateLimitTier ?? acct.userRateLimitTier, acct.organizationType);
    }
    catch {
        return null;
    }
}
function tokenFromCreds(raw) {
    const oauth = JSON.parse(raw).claudeAiOauth;
    if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken)
        return null;
    // Expired token → skip this cycle. Never refresh: rotation belongs to Claude Code.
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now())
        return null;
    return oauth.accessToken;
}
function readAccessToken() {
    // Credentials file (Windows / Linux). When present its verdict is final —
    // an expired file means the Keychain copy is the same account, same expiry.
    let fileRaw = null;
    try {
        fileRaw = readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8');
    }
    catch { /* no file — fall through */ }
    if (fileRaw !== null) {
        try {
            return tokenFromCreds(fileRaw);
        }
        catch {
            return null;
        }
    }
    // macOS stores credentials in the Keychain instead of a file
    if (process.platform === 'darwin') {
        try {
            const out = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
            return tokenFromCreds(out);
        }
        catch { /* entry missing or access denied */ }
    }
    return null;
}
// `limits[]` is the generic mechanism behind the /usage gauges: the entry with
// kind "weekly_scoped" + a model scope is the top-tier-model weekly meter
// (Opus for Opus plans, Fable for Fable plans — no hardcoded model names).
function extractTopModel(data) {
    const limits = data?.limits;
    if (!Array.isArray(limits))
        return null;
    const scoped = limits.filter(l => l?.kind === 'weekly_scoped' &&
        typeof l.percent === 'number' &&
        typeof l.scope?.model?.display_name === 'string' &&
        l.scope.model.display_name.length > 0);
    if (scoped.length === 0)
        return null;
    const pick = scoped.find(l => l.is_active) ?? scoped[0];
    const parsed = Date.parse(pick.resets_at ?? '');
    return {
        name: pick.scope.model.display_name,
        percent: pick.percent,
        resetsAt: Number.isFinite(parsed) ? parsed : null,
    };
}
async function fetchUsageNative(token) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const resp = await fetch(USAGE_URL, {
            headers: {
                Authorization: `Bearer ${token}`,
                'anthropic-beta': 'oauth-2025-04-20',
            },
            signal: ctrl.signal,
        });
        if (!resp.ok)
            return null;
        return await resp.json();
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
        timer.unref();
    }
}
// Cloudflare's WAF 403s Node's TLS fingerprint on /api/oauth/* while letting
// curl through (verified 2026-07-23). curl ships with macOS, Windows 10+, and
// Linux; the config goes via stdin so the token never appears in the argv list.
function fetchUsageCurl(token) {
    if (!/^[\w.\-~+/=]+$/.test(token))
        return Promise.resolve(null);
    return new Promise(resolve => {
        try {
            const child = execFile(process.env.CC_HUD_CURL || 'curl', ['--config', '-'], { timeout: TIMEOUT_MS + 500, windowsHide: true }, (err, stdout) => {
                if (err)
                    return resolve(null);
                try {
                    resolve(JSON.parse(stdout));
                }
                catch {
                    resolve(null);
                }
            });
            child.stdin?.on('error', () => { });
            child.stdin?.end([
                `url = "${USAGE_URL}"`,
                `header = "Authorization: Bearer ${token}"`,
                'header = "anthropic-beta: oauth-2025-04-20"',
                'silent',
                'fail',
                'max-time = 2',
            ].join('\n'));
        }
        catch {
            resolve(null);
        }
    });
}
async function fetchTopModel(token) {
    const data = (await fetchUsageNative(token)) ?? (await fetchUsageCurl(token));
    return extractTopModel(data);
}
// Full pipeline with network — runs in the DETACHED refresher (claude-refresh.ts),
// never inside a statusline tick. Writes the cache for the next tick to read.
export async function refreshClaudePlan() {
    if (!isAnthropic())
        return;
    const cached = readCache();
    const tier = readTier();
    const token = readAccessToken();
    const topModel = token ? await fetchTopModel(token) : null;
    writeCacheEntry({
        payload: {
            tier: tier ?? cached?.payload?.tier ?? null,
            topModel: topModel ?? cached?.payload?.topModel ?? null,
        },
        ts: Date.now(),
    });
}
function spawnRefresh() {
    if (process.env.CC_HUD_NO_REFRESH)
        return;
    try {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./claude-refresh.js', import.meta.url))], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
    }
    catch { /* refresh is best effort */ }
}
// Tick path — NO network, ever. Serves the cache (stale is fine: better a
// 5-min-old gauge than a blocked statusline) and delegates refreshing to a
// detached child so a slow fetch can never eat the 2s render deadline.
// hasRateLimits: stdin rate_limits presence — the subscription signal.
// API-key (pay-as-you-go) sessions have none and skip everything.
export async function getClaudePlan(hasRateLimits) {
    if (!isAnthropic() || !hasRateLimits)
        return null;
    const cached = readCache();
    const now = Date.now();
    if (cached && now - cached.ts < TTL) {
        return cached.payload ?? null;
    }
    // Stale or missing → kick off a background refresh, render with what we have.
    // The refreshTs stamp both rate-limits spawns and (via the placeholder entry)
    // keeps the heavy ~/.claude.json parse off the per-tick path.
    if (cached?.refreshTs == null || now - cached.refreshTs >= REFRESH_COOLDOWN) {
        const placeholder = cached
            ? { ...cached, refreshTs: now }
            : { payload: { tier: readTier(), topModel: null }, ts: 0, refreshTs: now };
        writeCacheEntry(placeholder);
        spawnRefresh();
        const p = placeholder.payload;
        return (p?.tier ?? null) === null && (p?.topModel ?? null) === null ? null : p;
    }
    const p = cached?.payload ?? null;
    return p === null || (p.tier === null && p.topModel === null) ? null : p;
}
