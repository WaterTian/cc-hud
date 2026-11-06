// MiniMax Token Plan: 5h / 7d used% + reset times, filling the rate slots
// the official backend gets from stdin. Active when ANTHROPIC_BASE_URL
// contains "minimax" ("minimaxi.com" → CN endpoint, anything else → global)
// and ANTHROPIC_AUTH_TOKEN is set. Cache: ~/.cache/cc-hud/mmx-quota.json (5 min).
import { cachedInline, type Served } from './cache.js';
import { fetchJsonNative } from './http.js';

export interface MmxQuota {
  fiveHourUsedPct: number;
  fiveHourResetsAt: number;
  sevenDayUsedPct: number;
  sevenDayResetsAt: number;
}

interface MmxModelRemain {
  model_name: string;
  remains_time: number;
  weekly_remains_time: number;
  // API returns _usage_count/_total_count = 0; real values are in *_remaining_percent
  current_interval_remaining_percent: number;
  current_weekly_remaining_percent: number;
  // status: 1 = active quota, 3 = inactive/empty (skip these)
  current_interval_status?: number;
  current_weekly_status?: number;
}

const host = () =>
  process.env.ANTHROPIC_BASE_URL?.includes('minimaxi.com') ? 'https://api.minimaxi.com' : 'https://api.minimax.io';

// Pick the active entry (status 1) and compute used% as 100 - remaining%.
function aggregatePlan(remains: unknown): MmxQuota | null {
  if (!Array.isArray(remains) || remains.length === 0) return null;
  const list = remains as MmxModelRemain[];
  const active = list.find(m => m?.current_interval_status === 1) ?? list[0];
  const now = Date.now();
  const quota = {
    fiveHourUsedPct: Math.max(0, 100 - active.current_interval_remaining_percent),
    fiveHourResetsAt: now + active.remains_time,
    sevenDayUsedPct: Math.max(0, 100 - active.current_weekly_remaining_percent),
    sevenDayResetsAt: now + active.weekly_remains_time,
  };
  // A missing / non-numeric field would otherwise leak NaN into the bar
  return Object.values(quota).every(Number.isFinite) ? quota : null;
}

export async function getMmxQuota(): Promise<Served<MmxQuota> | null> {
  if (!process.env.ANTHROPIC_BASE_URL?.includes('minimax')) return null;
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;
  return cachedInline('mmx-quota', async () => {
    const data = (await fetchJsonNative(`${host()}/v1/token_plan/remains`, { Authorization: `Bearer ${apiKey}` })) as
      { model_remains?: unknown } | null;
    return aggregatePlan(data?.model_remains);
  });
}
