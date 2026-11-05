// GLM (Zhipu): account balance as the "extra" segment (`¥88.50`). Active when
// ANTHROPIC_BASE_URL contains "bigmodel.cn" (CN) or "api.z.ai" (global) and
// ANTHROPIC_AUTH_TOKEN is set. Cache: ~/.cache/cc-hud/glm-balance.json (5 min).
import { cachedInline } from './cache.js';
import { fetchJsonNative } from './http.js';
const isGlm = (base = process.env.ANTHROPIC_BASE_URL) => !!base && (base.includes('bigmodel.cn') || base.includes('api.z.ai'));
const host = () => process.env.ANTHROPIC_BASE_URL?.includes('api.z.ai') ? 'https://api.z.ai' : 'https://open.bigmodel.cn';
// The report carries its figure under several names, sometimes one level
// down under `data`; the first usable number / non-empty string wins.
function extractBalance(data) {
    if (!data || typeof data !== 'object')
        return null;
    const d = data;
    // GLM reports success / error in a JSON-level `code`, not the HTTP status
    if (d.code && d.code !== 200)
        return null;
    const inner = (d.data ?? {});
    for (const src of [inner, d]) {
        for (const key of ['balance', 'total_balance', 'amount']) {
            const val = src[key];
            if (typeof val === 'number')
                return `¥${val.toFixed(2)}`;
            if (typeof val === 'string' && val.trim()) {
                const s = val.trim();
                return s.startsWith('¥') ? s : `¥${s}`;
            }
        }
    }
    return null;
}
export async function getGlmBalance() {
    if (!isGlm())
        return null;
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey)
        return null;
    return cachedInline('glm-balance', async () => extractBalance(await fetchJsonNative(`${host()}/api/biz/account/query-customer-account-report`, { Authorization: `Bearer ${apiKey}` })));
}
