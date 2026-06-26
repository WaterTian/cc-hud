import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = '.cache/cc-hud';
const TTL = 5 * 60 * 1000; // 5 min — matches balance.ts / mmx.ts
const TIMEOUT_MS = 5000; // OpenCode workspace page is a full HTML render (~1-2s)

export interface OpenCodeQuota {
  rollingPercent: number;
  rollingResetsAt: number;
  weeklyPercent: number;
  weeklyResetsAt: number;
  monthlyPercent: number;
  monthlyResetsAt: number;
}

interface CacheEntry {
  payload: OpenCodeQuota;
  ts: number;
}

// ── Detection ──────────────────────────────────────────────────────────

function isOpenCode(): boolean {
  return !!process.env.OPENCODE_AUTH;
}

function wsId(): string {
  return process.env.OPENCODE_WS || 'wrk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
}

function authCookie(): string | null {
  const auth = process.env.OPENCODE_AUTH;
  if (!auth) return null;
  return `oc_locale=zh; auth=${encodeURIComponent(auth)}`;
}

// ── Cache ──────────────────────────────────────────────────────────────

function cacheFile(): string {
  return join(homedir(), CACHE_DIR, 'oc-quota.json');
}

function readCache(): CacheEntry | null {
  try {
    return JSON.parse(readFileSync(cacheFile(), 'utf8')) as CacheEntry;
  } catch { return null; }
}

function writeCache(payload: OpenCodeQuota): void {
  try {
    mkdirSync(join(homedir(), CACHE_DIR), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify({ payload, ts: Date.now() }));
  } catch { /* best effort */ }
}

// ── HTML parsing ───────────────────────────────────────────────────────

/**
 * Extract usage data from the OpenCode workspace HTML page.
 *
 * The page embeds inline JS assignments like:
 *   rollingUsage:$R[30]={status:"ok",resetInSec:5647,usagePercent:7}
 *   weeklyUsage:$R[31]={status:"ok",resetInSec:245174,usagePercent:25}
 *   monthlyUsage:$R[32]={status:"ok",resetInSec:597495,usagePercent:98}
 */
function extractQuota(html: string): OpenCodeQuota | null {
  // Match each dimension independently so a partial page change
  // doesn't kill the whole feature. The object literal is the same
  // shape for all three: {status:"...",resetInSec:<num>,usagePercent:<num>}
  // Each dimension is assigned like: rollingUsage:$R[N]={...}
  // where the R-value reference may vary. Match the keyword followed by
  // an optional $R[N] bridge and the object literal.
  const OBJECT_RE = /\{status:"[^"]+",resetInSec:(\d+),usagePercent:(\d+)\}/;

  function extract(keyword: string): [number, number] | null {
    let pos = 0;
    for (;;) {
      const idx = html.indexOf(keyword + ':', pos);
      if (idx === -1) return null;
      // Skip if the value is null (e.g. monthlyUsage:null in customer data)
      const afterColon = html.slice(idx + keyword.length + 1).trimStart();
      if (afterColon.startsWith('null')) {
        pos = idx + 1; // resume search after this occurrence
        continue;
      }
      // Scan forward to find the next {...} object literal
      const rest = html.slice(idx + keyword.length + 1);
      const m = rest.match(OBJECT_RE);
      if (!m) return null;
      return [Number(m[2]), Number(m[1])];
    }
  }

  const roll = extract('rollingUsage');
  const week = extract('weeklyUsage');
  const month = extract('monthlyUsage');
  if (!roll || !week || !month) return null;

  const now = Date.now();
  return {
    rollingPercent: roll[0],
    rollingResetsAt: now + roll[1] * 1000,
    weeklyPercent: week[0],
    weeklyResetsAt: now + week[1] * 1000,
    monthlyPercent: month[0],
    monthlyResetsAt: now + month[1] * 1000,
  };
}

// ── Fetch ──────────────────────────────────────────────────────────────

async function fetchQuota(): Promise<OpenCodeQuota | null> {
  const cookie = authCookie();
  if (!cookie) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`https://opencode.ai/workspace/${wsId()}/go`, {
      headers: {
        accept: 'text/html',
        cookie,
        'user-agent': 'cc-hud/1.0',
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    return extractQuota(await resp.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    timer.unref();
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns the OpenCode Go subscription quota if:
 *  - OPENCODE_AUTH env var is set (detects OpenCode backend)
 *  - workspace page is reachable and parseable
 *
 * Returns null otherwise. Results are cached for 5 minutes with stale
 * fallback — silent on any failure, never blocks Claude Code.
 */
export async function getOpenCodeQuota(): Promise<OpenCodeQuota | null> {
  if (!isOpenCode()) return null;

  const cached = readCache();

  // Fresh cache — instant return (99.9% of calls)
  if (cached && Date.now() - cached.ts < TTL) {
    return cached.payload;
  }

  // Cache miss — fetch, fall back to stale cache on failure
  const quota = await fetchQuota();
  if (quota) {
    writeCache(quota);
    return quota;
  }

  return cached?.payload ?? null;
}
