import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = join(homedir(), '.cache', 'cc-hud');
const CACHE_FILE = join(CACHE_DIR, 'ds-balance.json');
const TTL = 5 * 60 * 1000; // 5 min

function readCache(): { balance: string; ts: number } | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch { return null; }
}

function writeCache(balance: string): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ balance, ts: Date.now() }));
  } catch {}
}

async function fetchBalance(apiKey: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const resp = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { balance_infos?: { total_balance?: string }[] };
    const total = data?.balance_infos?.[0]?.total_balance;
    return total ? `¥${total}` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    timer.unref();
  }
}

export async function getExtra(): Promise<string | null> {
  // Only activate for DeepSeek backends — Claude users skip everything
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (!baseUrl?.includes('deepseek')) return null;

  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;

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
