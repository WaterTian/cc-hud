import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchJson } from './http.js';
import { serveCache, storeRefresh } from './cache.js';
import type { TopModelUsage } from './types.js';

const CACHE_NAME = 'claude-plan';

// Same endpoint the /usage panel reads; its `limits[]` array carries the
// top-tier-model weekly gauge that the statusline stdin JSON does not expose.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export interface ClaudePlan {
  topModel: TopModelUsage | null;
  // "couldn't fetch" must never look like "fresh": true when the last
  // successful fetch is older than 30 min (or there has never been one).
  stale: boolean;
}

// Cache payload shape (kept as an object so older entries stay readable)
interface PlanPayload { topModel: TopModelUsage | null }

// Critical isolation: third-party backends (DeepSeek / GLM / MiniMax) skip the whole module
function isAnthropic(): boolean {
  const base = process.env.ANTHROPIC_BASE_URL;
  return !base || base.includes('api.anthropic.com');
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

// Full pipeline with network — runs in the DETACHED refresher (refresh.ts),
// never inside a statusline tick. Writes the cache for the next tick to read.
export async function refreshClaudePlan(): Promise<void> {
  if (!isAnthropic()) return;
  const token = readAccessToken();
  const data = token
    ? await fetchJson(USAGE_URL, { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' })
    : null;
  const topModel = extractTopModel(data);
  storeRefresh<PlanPayload>(CACHE_NAME, topModel ? { topModel } : null);
}

// Tick path — NO network, ever (see cache.ts).
// hasRateLimits: stdin rate_limits presence — the subscription signal.
// API-key (pay-as-you-go) sessions have none and skip everything.
export async function getClaudePlan(hasRateLimits: boolean): Promise<ClaudePlan | null> {
  if (!isAnthropic() || !hasRateLimits) return null;
  const served = serveCache<PlanPayload>(CACHE_NAME, 'claude');
  if (!served?.payload.topModel) return null;
  return { topModel: served.payload.topModel, stale: served.stale };
}
