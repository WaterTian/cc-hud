import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = '.cache/cc-hud';
const TTL = 5 * 60 * 1000; // 5 min — same as balance.ts / mmx.ts
const TIMEOUT_MS = 2000;

function cacheFile(): string {
  return join(homedir(), CACHE_DIR, 'glm-balance.json');
}

interface CacheEntry {
  balance: string;
  ts: number;
}

// Critical isolation: non-GLM backends skip the whole module
function isGlm(): boolean {
  const base = process.env.ANTHROPIC_BASE_URL;
  return !!base && (base.includes('bigmodel.cn') || base.includes('api.z.ai'));
}

function host(): string {
  return process.env.ANTHROPIC_BASE_URL?.includes('api.z.ai')
    ? 'https://api.z.ai'
    : 'https://open.bigmodel.cn';
}

function readCache(): CacheEntry | null {
  try {
    return JSON.parse(readFileSync(cacheFile(), 'utf8')) as CacheEntry;
  } catch { return null; }
}

function writeCache(balance: string): void {
  try {
    mkdirSync(join(homedir(), CACHE_DIR), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify({ balance, ts: Date.now() }));
  } catch { /* best effort */ }
}

function extractBalance(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const inner = (d.data as Record<string, unknown>) ?? {};

  const candidates = [
    inner.balance,
    inner.total_balance,
    inner.amount,
    d.balance,
    d.total_balance,
    d.amount,
  ];

  for (const val of candidates) {
    if (typeof val === 'number') return `¥${val.toFixed(2)}`;
    if (typeof val === 'string' && val.trim()) {
      return val.trim().startsWith('¥') ? val.trim() : `¥${val.trim()}`;
    }
  }
  return null;
}

async function fetchBalance(apiKey: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${host()}/api/biz/account/query-customer-account-report`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    // GLM wraps success/error in JSON-level `code` field
    if (data.code && data.code !== 200) return null;
    return extractBalance(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    timer.unref();
  }
}

export async function getGlmBalance(): Promise<string | null> {
  if (!isGlm()) return null;

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;

  const cached = readCache();
  if (cached && Date.now() - cached.ts < TTL) {
    return cached.balance;
  }

  const balance = await fetchBalance(apiKey);
  if (balance) {
    writeCache(balance);
    return balance;
  }
  return cached?.balance ?? null;
}
