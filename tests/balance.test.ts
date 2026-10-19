import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const importBalance = () => import('../dist/balance.js');

describe('deepseek balance', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalFetch = globalThis.fetch;

  let tmpHome: string;
  let fetchCalls: { url: string; init: RequestInit | undefined }[];
  let nextResponse: Response;
  let nextError: unknown;
  const cachePath = () => join(tmpHome, '.cache', 'cc-hud', 'ds-balance.json');

  beforeEach(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    tmpHome = mkdtempSync(join(tmpdir(), 'balance-test-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    fetchCalls = [];
    nextResponse = new Response(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '13.44' }] }), { status: 200 });
    nextError = undefined;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      if (nextError) throw nextError;
      return nextResponse;
    }) as typeof fetch;
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    if (originalToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = originalToken;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    globalThis.fetch = originalFetch;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('isolation — non-DeepSeek backends', () => {
    it('returns null and never fetches when ANTHROPIC_BASE_URL is unset', async () => {
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
      const { getExtra } = await importBalance();
      assert.equal(await getExtra(), null);
      assert.equal(fetchCalls.length, 0);
    });

    it('returns null for the Anthropic backend', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
      const { getExtra } = await importBalance();
      assert.equal(await getExtra(), null);
      assert.equal(fetchCalls.length, 0);
    });

    it('returns null when DeepSeek env is set but no auth token', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      const { getExtra } = await importBalance();
      assert.equal(await getExtra(), null);
    });
  });

  describe('fetch + cache', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('formats the first balance entry and sends Bearer auth', async () => {
      const { getExtra } = await importBalance();
      assert.equal(await getExtra(), '¥13.44');
      assert.equal(fetchCalls[0]?.url, 'https://api.deepseek.com/user/balance');
      const headers = fetchCalls[0]?.init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer sk-test');
    });

    it('writes the cache atomically — no temp file left behind, second call served from cache', async () => {
      const { getExtra } = await importBalance();
      await getExtra();
      await getExtra();
      assert.equal(fetchCalls.length, 1);
      assert.equal(JSON.parse(readFileSync(cachePath(), 'utf8')).balance, '¥13.44');
      assert.deepEqual(readdirSync(join(tmpHome, '.cache', 'cc-hud')).filter(f => f.includes('.tmp-')), []);
    });

    it('returns null on a non-OK response, a network error, or malformed JSON', async () => {
      const { getExtra } = await importBalance();
      nextResponse = new Response('{}', { status: 401 });
      assert.equal(await getExtra(), null);
      nextError = new Error('ECONNREFUSED');
      assert.equal(await getExtra(), null);
      nextError = undefined;
      nextResponse = new Response('not json{', { status: 200 });
      assert.equal(await getExtra(), null);
    });

    it('falls back to a stale cache when the fetch fails', async () => {
      const { getExtra } = await importBalance();
      assert.equal(await getExtra(), '¥13.44');
      const cached = JSON.parse(readFileSync(cachePath(), 'utf8'));
      cached.ts = Date.now() - 10 * 60 * 1000;
      writeFileSync(cachePath(), JSON.stringify(cached));
      nextError = new Error('network down');
      assert.equal(await getExtra(), '¥13.44');
    });

    it('aborts a hanging endpoint within the 1.2s budget — well before the 2s hard exit', async () => {
      globalThis.fetch = ((_url: unknown, init?: RequestInit) => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
      const { getExtra } = await importBalance();
      const t0 = Date.now();
      const r = await getExtra();
      const ms = Date.now() - t0;
      assert.equal(r, null);
      assert.ok(ms >= 1000 && ms < 1900, `took ${ms}ms`);
    });
  });
});
