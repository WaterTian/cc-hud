// DeepSeek: account balance as the "extra" segment (`¥13.44`). Active only
// when ANTHROPIC_BASE_URL contains "deepseek" and ANTHROPIC_AUTH_TOKEN is set.
// Cache: ~/.cache/cc-hud/ds-balance.json (5 min); a miss fetches inline.
import { cachedInline } from './cache.js';
import { fetchJsonNative } from './http.js';

const ENDPOINT = 'https://api.deepseek.com/user/balance';

interface DsBalance { balance_infos?: { total_balance?: string }[] }

export async function getExtra(): Promise<string | null> {
  if (!process.env.ANTHROPIC_BASE_URL?.includes('deepseek')) return null;
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;
  return cachedInline('ds-balance', async () => {
    const data = (await fetchJsonNative(ENDPOINT, { Authorization: `Bearer ${apiKey}` })) as DsBalance | null;
    const total = data?.balance_infos?.[0]?.total_balance;
    return total ? `¥${total}` : null;
  });
}
