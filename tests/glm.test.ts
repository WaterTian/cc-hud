import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const importGlm = () => import('../dist/glm.js');

describe('glm balance', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalFetch = globalThis.fetch;

  let tmpHome: string;
  let fetchCalls: { url: string; init: RequestInit | undefined }[];
  let nextResponse: Response;
  let nextError: unknown;

  beforeEach(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    tmpHome = mkdtempSync(join(tmpdir(), 'glm-test-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    fetchCalls = [];
    nextResponse = new Response('{}', { status: 200 });
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

  // ─── Isolation (the critical guarantee) ──────────────────────

  describe('isolation — non-GLM backends', () => {
    it('returns null when ANTHROPIC_BASE_URL is unset', async () => {
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('returns null when ANTHROPIC_BASE_URL is Anthropic', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('returns null when ANTHROPIC_BASE_URL is DeepSeek', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('returns null when ANTHROPIC_BASE_URL is MiniMax', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('does not call fetch for non-GLM backends', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
      const { getGlmBalance } = await importGlm();
      await getGlmBalance();
      assert.equal(fetchCalls.length, 0);
    });

    it('returns null when GLM env set but no auth token', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });
  });

  // ─── Endpoint routing ─────────────────────────────────────────

  describe('endpoint routing', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('routes bigmodel.cn to CN api/biz/account endpoint', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
      const { getGlmBalance } = await importGlm();
      await getGlmBalance();
      assert.equal(fetchCalls[0]?.url, 'https://open.bigmodel.cn/api/biz/account/query-customer-account-report');
    });

    it('routes api.z.ai to global api/biz/account endpoint', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';
      const { getGlmBalance } = await importGlm();
      await getGlmBalance();
      assert.equal(fetchCalls[0]?.url, 'https://api.z.ai/api/biz/account/query-customer-account-report');
    });

    it('sends Bearer auth header', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-my-token-xyz';
      const { getGlmBalance } = await importGlm();
      await getGlmBalance();
      const headers = fetchCalls[0]?.init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer sk-my-token-xyz');
    });
  });

  // ─── Response parsing ─────────────────────────────────────────

  describe('response parsing', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('extracts data.balance from real GLM response shape', async () => {
      // Real GLM response: { code: 200, data: { balance: 0.556 } }
      nextResponse = new Response(JSON.stringify({ code: 200, msg: '操作成功', data: { balance: 0.556208 } }));
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), '¥0.56');
    });

    it('extracts data.total_balance', async () => {
      nextResponse = new Response(JSON.stringify({ code: 200, data: { total_balance: 100.00 } }));
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), '¥100.00');
    });

    it('extracts top-level balance', async () => {
      nextResponse = new Response(JSON.stringify({ balance: '50.00' }));
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), '¥50.00');
    });

    it('returns null on JSON-level code error (code != 200)', async () => {
      nextResponse = new Response(JSON.stringify({ code: 401, msg: 'unauthorized' }), { status: 200 });
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('extracts top-level total_balance', async () => {
      nextResponse = new Response(JSON.stringify({ total_balance: 42.5 }));
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), '¥42.50');
    });

    it('formats number to 2 decimal places', async () => {
      nextResponse = new Response(JSON.stringify({ code: 200, data: { balance: 88.5 } }));
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), '¥88.50');
    });

    it('does not double-prefix ¥', async () => {
      nextResponse = new Response(JSON.stringify({ code: 200, data: { balance: '¥3.77' } }));
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), '¥3.77');
    });

    it('falls back to data.amount', async () => {
      nextResponse = new Response(JSON.stringify({ code: 200, data: { amount: 500 } }));
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), '¥500.00');
    });
  });

  // ─── Error resilience ─────────────────────────────────────────

  describe('error resilience', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('returns null on 401 response', async () => {
      nextResponse = new Response('{"error":{"code":"401","message":"令牌已过期"}}', { status: 401 });
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('returns null on 500 response', async () => {
      nextResponse = new Response('internal error', { status: 500 });
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('returns null on network error', async () => {
      nextError = new Error('ECONNREFUSED');
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('returns null on malformed JSON', async () => {
      nextResponse = new Response('not json{', { status: 200 });
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });

    it('returns null on empty response', async () => {
      nextResponse = new Response('{}', { status: 200 });
      const { getGlmBalance } = await importGlm();
      assert.equal(await getGlmBalance(), null);
    });
  });

  // ─── Cache ────────────────────────────────────────────────────

  describe('cache', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('caches successful response for 5 minutes', async () => {
      nextResponse = new Response(JSON.stringify({ code: 200, data: { balance: '99.99' } }));
      const { getGlmBalance } = await importGlm();
      const r1 = await getGlmBalance();
      const r2 = await getGlmBalance();
      assert.equal(fetchCalls.length, 1, 'second call should hit cache');
      assert.deepEqual(r1, r2);
    });

    it('falls back to stale cache on fetch failure', async () => {
      nextResponse = new Response(JSON.stringify({ code: 200, data: { balance: '44.44' } }));
      const { getGlmBalance } = await importGlm();
      const r1 = await getGlmBalance();
      // Force cache stale (10 min old)
      const cachePath = join(tmpHome, '.cache', 'cc-hud', 'glm-balance.json');
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      cached.ts = Date.now() - 10 * 60 * 1000;
      writeFileSync(cachePath, JSON.stringify(cached));
      // Second call: fetch fails
      nextError = new Error('network down');
      const r2 = await getGlmBalance();
      assert.deepEqual(r1, r2, 'should return stale cache on fetch failure');
    });
  });
});
