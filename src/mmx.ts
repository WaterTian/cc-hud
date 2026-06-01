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

function pickModel(remains: MmxModelRemain[], modelName?: string): MmxModelRemain | null {
  if (remains.length === 0) return null;
  if (modelName) {
    const found = remains.find(m => m.model_name.toLowerCase() === modelName.toLowerCase());
    if (found) return found;
  }
  return remains[0]!;
}

function toQuota(m: MmxModelRemain): MmxQuota {
  const now = Date.now();
  const safePct = (used: number, total: number) =>
    total > 0 ? Math.round((used / total) * 100) : 0;
  return {
    fiveHourUsedPct: safePct(m.current_interval_usage_count, m.current_interval_total_count),
    fiveHourResetsAt: now + m.remains_time,
    sevenDayUsedPct: safePct(m.current_weekly_usage_count, m.current_weekly_total_count),
    sevenDayResetsAt: now + m.weekly_remains_time,
  };
}

async function fetchQuota(apiKey: string, modelName?: string): Promise<MmxQuota | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${host()}/v1/token_plan/remains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as MmxResponse;
    const m = pickModel(data.model_remains ?? [], modelName);
    return m ? toQuota(m) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    timer.unref();
  }
}

export async function getMmxQuota(modelName?: string): Promise<MmxQuota | null> {
  if (!isMmx()) return null;

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;

  const cached = readCache();
  if (cached && Date.now() - cached.ts < TTL) {
    return cached.payload;
  }

  const quota = await fetchQuota(apiKey, modelName);
  if (quota) {
    writeCache(quota);
    return quota;
  }
  return cached?.payload ?? null;
}
