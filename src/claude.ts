import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TopModelUsage } from './types.js';

const CACHE_DIR = '.cache/cc-hud';
const TTL = 5 * 60 * 1000; // 5 min — same as balance.ts / mmx.ts / glm.ts
const REFRESH_COOLDOWN = 30 * 1000; // min gap between detached refresh spawns
const STALE_MS = 30 * 60 * 1000; // no successful fetch for this long → gauge flagged stale
const TIMEOUT_MS = 2000;

// Same endpoint the /usage panel reads; its `limits[]` array carries the
// top-tier-model weekly gauge that the statusline stdin JSON does not expose.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export interface ClaudePlan {
  topModel: TopModelUsage | null;
  // "couldn't fetch" must never look like "fresh": true when the last
  // successful fetch is older than STALE_MS (or there has never been one).
  stale: boolean;
}

interface CacheEntry {
  payload: { topModel: TopModelUsage | null };
  ts: number;        // last refresh attempt (TTL gate)
  okTs?: number;      // last refresh that actually got data (stale gate)
  refreshTs?: number; // last detached-refresh spawn (spawn cooldown)
}

function toPlan(entry: CacheEntry | null, now: number): ClaudePlan | null {
  const topModel = entry?.payload?.topModel;
  if (!topModel) return null;
  return { topModel, stale: entry!.okTs == null || now - entry!.okTs > STALE_MS };
}

// Critical isolation: third-party backends (DeepSeek / GLM / MiniMax) skip the whole module
function isAnthropic(): boolean {
  const base = process.env.ANTHROPIC_BASE_URL;
  return !base || base.includes('api.anthropic.com');
}

function cacheFile(): string {
  return join(homedir(), CACHE_DIR, 'claude-plan.json');
}

function readCache(): CacheEntry | null {
  try {
    return JSON.parse(readFileSync(cacheFile(), 'utf8')) as CacheEntry;
  } catch { return null; }
}

function writeCacheEntry(entry: CacheEntry): void {
  try {
    mkdirSync(join(homedir(), CACHE_DIR), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify(entry));
  } catch { /* best effort */ }
}

function tokenFromCreds(raw: string): string | null {
  const oauth = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }).claudeAiOauth;
  if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) return null;
  // Expired token → skip this cycle. Never refresh: rotation belongs to Claude Code.
  if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) return null;
  return oauth.accessToken;
}

function readAccessToken(): string | null {
  // Credentials file (Windows / Linux). When present its verdict is final —
  // an expired file means the Keychain copy is the same account, same expiry.
  let fileRaw: string | null = null;
  try {
    fileRaw = readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8');
  } catch { /* no file — fall through */ }
  if (fileRaw !== null) {
    try { return tokenFromCreds(fileRaw); } catch { return null; }
  }

  // macOS stores credentials in the Keychain instead of a file
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return tokenFromCreds(out);
    } catch { /* entry missing or access denied */ }
  }
  return null;
}

interface UsageLimitEntry {
  kind?: string;
  percent?: number;
  resets_at?: string;
  is_active?: boolean;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

// `limits[]` is the generic mechanism behind the /usage gauges: the entry with
// kind "weekly_scoped" + a model scope is the top-tier-model weekly meter
// (Opus for Opus plans, Fable for Fable plans — no hardcoded model names).
function extractTopModel(data: unknown): TopModelUsage | null {
  const limits = (data as { limits?: unknown } | null)?.limits;
  if (!Array.isArray(limits)) return null;
  const scoped = (limits as UsageLimitEntry[]).filter(l =>
    l?.kind === 'weekly_scoped' &&
    typeof l.percent === 'number' &&
    typeof l.scope?.model?.display_name === 'string' &&
    l.scope.model.display_name.length > 0,
  );
  if (scoped.length === 0) return null;
  const pick = scoped.find(l => l.is_active) ?? scoped[0];
  const parsed = Date.parse(pick.resets_at ?? '');
  return {
    name: pick.scope!.model!.display_name as string,
    percent: pick.percent as number,
    resetsAt: Number.isFinite(parsed) ? parsed : null,
  };
}

async function fetchUsageNative(token: string): Promise<unknown | null> {
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
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    timer.unref();
  }
}

// Cloudflare's WAF 403s Node's TLS fingerprint on /api/oauth/* while letting
// curl through (verified 2026-07-23). curl ships with macOS, Windows 10+, and
// Linux; the config goes via stdin so the token never appears in the argv list.
function fetchUsageCurl(token: string): Promise<unknown | null> {
  if (!/^[\w.\-~+/=]+$/.test(token)) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const child = execFile(
        process.env.CC_HUD_CURL || 'curl',
        ['--config', '-'],
        { timeout: TIMEOUT_MS + 500, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(null);
          try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
        },
      );
      child.stdin?.on('error', () => { /* curl may exit before stdin flushes */ });
      child.stdin?.end([
        `url = "${USAGE_URL}"`,
        `header = "Authorization: Bearer ${token}"`,
        'header = "anthropic-beta: oauth-2025-04-20"',
        'silent',
        'fail',
        'max-time = 2',
      ].join('\n'));
    } catch {
      resolve(null);
    }
  });
}

async function fetchTopModel(token: string): Promise<TopModelUsage | null> {
  const data = (await fetchUsageNative(token)) ?? (await fetchUsageCurl(token));
  return extractTopModel(data);
}

// Full pipeline with network — runs in the DETACHED refresher (claude-refresh.ts),
// never inside a statusline tick. Writes the cache for the next tick to read.
export async function refreshClaudePlan(): Promise<void> {
  if (!isAnthropic()) return;
  const cached = readCache();
  const token = readAccessToken();
  const topModel = token ? await fetchTopModel(token) : null;
  const now = Date.now();
  writeCacheEntry({
    payload: {
      topModel: topModel ?? cached?.payload?.topModel ?? null,
    },
    ts: now,
    // Only a successful fetch advances okTs — a failure keeps the old gauge
    // but lets it age into the stale state.
    okTs: topModel ? now : cached?.okTs,
  });
}

function spawnRefresh(): void {
  if (process.env.CC_HUD_NO_REFRESH) return;
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./claude-refresh.js', import.meta.url))],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
  } catch { /* refresh is best effort */ }
}

// Tick path — NO network, ever. Serves the cache (stale is fine: better a
// 5-min-old gauge than a blocked statusline) and delegates refreshing to a
// detached child so a slow fetch can never eat the 2s render deadline.
// hasRateLimits: stdin rate_limits presence — the subscription signal.
// API-key (pay-as-you-go) sessions have none and skip everything.
export async function getClaudePlan(hasRateLimits: boolean): Promise<ClaudePlan | null> {
  if (!isAnthropic() || !hasRateLimits) return null;

  const cached = readCache();
  const now = Date.now();
  if (cached && now - cached.ts < TTL) {
    return toPlan(cached, now);
  }

  // Expired or missing → kick off a background refresh; the gauge arrives next tick.
  // The refreshTs stamp throttles detached-refresh spawns (REFRESH_COOLDOWN).
  if (cached?.refreshTs == null || now - cached.refreshTs >= REFRESH_COOLDOWN) {
    const placeholder: CacheEntry = cached
      ? { ...cached, refreshTs: now }
      : { payload: { topModel: null }, ts: 0, refreshTs: now };
    writeCacheEntry(placeholder);
    spawnRefresh();
    return toPlan(placeholder, now);
  }

  return toPlan(cached, now);
}
