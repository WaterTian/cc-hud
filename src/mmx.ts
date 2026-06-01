import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = '.cache/cc-hud';
const TTL = 5 * 60 * 1000; // 5 min — same as balance.ts
const TIMEOUT_MS = 2000;

function cacheFile(): string {
  return join(homedir(), CACHE_DIR, 'mmx-quota.json');
}

const HOST_CN = 'https://api.minimaxi.com';
const HOST_GLOBAL = 'https://api.minimax.io';

export interface MmxQuota {
  fiveHourUsedPct: number;
  fiveHourResetsAt: number;
  sevenDayUsedPct: number;
  sevenDayResetsAt: number;
}

interface CacheEntry {
  payload: MmxQuota;
  ts: number;
}

interface MmxModelRemain {
  model_name: string;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  weekly_remains_time: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
}

interface MmxResponse {
  model_remains: MmxModelRemain[];
}

// Critical isolation: non-MiniMax backends skip the whole module
function isMmx(): boolean {
  const base = process.env.ANTHROPIC_BASE_URL;
  return !!base?.includes('minimax');
}

function host(): string {
  return process.env.ANTHROPIC_BASE_URL?.includes('minimaxi.com') ? HOST_CN : HOST_GLOBAL;
}

function readCache(): CacheEntry | null {
  try {
    return JSON.parse(readFileSync(cacheFile(), 'utf8')) as CacheEntry;
  } catch { return null; }
}

function writeCache(payload: MmxQuota): void {
  try {
    mkdirSync(join(homedir(), CACHE_DIR), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify({ payload, ts: Date.now() }));
  } catch { /* best effort */ }
}

// Token Plan Plus: text/image/voice/music share a single quota window
// (each model_remains entry shows the same plan total, usage is per-model).
// Aggregate by summing usage across all models and using max total as plan quota.
function aggregatePlan(remains: MmxModelRemain[]): MmxQuota | null {
  if (remains.length === 0) return null;
  const sumUsage = remains.reduce((a, m) => a + m.current_interval_usage_count, 0);
  const sumWeekly = remains.reduce((a, m) => a + m.current_weekly_usage_count, 0);
  const total5h = Math.max(...remains.map(m => m.current_interval_total_count));
  const total7d = Math.max(...remains.map(m => m.current_weekly_total_count));
  const minRemains = Math.min(...remains.map(m => m.remains_time));
  const minWeekly = Math.min(...remains.map(m => m.weekly_remains_time));
  const now = Date.now();
  const safePct = (u: number, t: number) => t > 0 ? Math.round((u / t) * 100) : 0;
  return {
    fiveHourUsedPct: safePct(sumUsage, total5h),
    fiveHourResetsAt: now + minRemains,
    sevenDayUsedPct: safePct(sumWeekly, total7d),
    sevenDayResetsAt: now + minWeekly,
  };
}

async function fetchQuota(apiKey: string): Promise<MmxQuota | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${host()}/v1/token_plan/remains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as MmxResponse;
    return aggregatePlan(data.model_remains ?? []);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    timer.unref();
  }
}

export async function getMmxQuota(): Promise<MmxQuota | null> {
  if (!isMmx()) return null;

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;

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
