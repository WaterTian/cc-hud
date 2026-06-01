import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const importMmx = () => import('../dist/mmx.js');

describe('mmx quota', () => {
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
    tmpHome = mkdtempSync(join(tmpdir(), 'mmx-test-'));
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

  describe('isolation — non-MiniMax backends', () => {
    it('returns null when ANTHROPIC_BASE_URL is unset', async () => {
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });

    it('returns null when ANTHROPIC_BASE_URL is Anthropic', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });

    it('returns null when ANTHROPIC_BASE_URL is DeepSeek', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });

    it('does not call fetch for non-MiniMax backends', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
      const { getMmxQuota } = await importMmx();
      await getMmxQuota();
      assert.equal(fetchCalls.length, 0);
    });

    it('returns null when MiniMax env set but no auth token', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });
  });

  // ─── Endpoint routing ─────────────────────────────────────────

  describe('endpoint routing', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('routes api.minimaxi.com to CN host', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      const { getMmxQuota } = await importMmx();
      await getMmxQuota();
      assert.equal(fetchCalls[0]?.url, 'https://api.minimaxi.com/v1/token_plan/remains');
    });

    it('routes api.minimax.io to global host', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic';
      const { getMmxQuota } = await importMmx();
      await getMmxQuota();
      assert.equal(fetchCalls[0]?.url, 'https://api.minimax.io/v1/token_plan/remains');
    });

    it('sends Bearer auth header', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-my-token-xyz';
      const { getMmxQuota } = await importMmx();
      await getMmxQuota();
      const headers = fetchCalls[0]?.init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer sk-my-token-xyz');
    });
  });

  // ─── Response parsing ─────────────────────────────────────────

  describe('response parsing', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('parses real-shape MiniMax response', async () => {
      // ACTUAL API shape (per user curl 2026-06-01):
      // - _usage_count / _total_count = 0 (always)
      // - real values in _remaining_percent
      // - status 1 = active, 3 = inactive
      const now = Date.now();
      nextResponse = new Response(JSON.stringify({
        model_remains: [{
          model_name: 'general',
          start_time: now - 1000,
          end_time: now + 3900000,
          remains_time: 3900000,
          current_interval_remaining_percent: 83,
          current_weekly_remaining_percent: 98,
          current_interval_status: 1,
          current_weekly_status: 1,
          weekly_start_time: now - 1000,
          weekly_end_time: now + 554400000,
          weekly_remains_time: 554400000,
        }],
      }));
      const { getMmxQuota } = await importMmx();
      const result = await getMmxQuota();
      assert.ok(result);
      assert.equal(result!.fiveHourUsedPct, 17);  // 100 - 83
      assert.equal(result!.sevenDayUsedPct, 2);   // 100 - 98
      assert.ok(Math.abs(result!.fiveHourResetsAt - (now + 3900000)) < 1000);
      assert.ok(Math.abs(result!.sevenDayResetsAt - (now + 554400000)) < 1000);
    });

    it('picks active entry (status=1) over inactive (status=3)', async () => {
      nextResponse = new Response(JSON.stringify({
        model_remains: [
          // Inactive (e.g. video, no quota) — should be ignored
          { model_name: 'video', remains_time: 27000000, current_interval_remaining_percent: 100, current_weekly_remaining_percent: 100, current_interval_status: 3, current_weekly_status: 3, weekly_remains_time: 545600000 },
          // Active (general, has real usage)
          { model_name: 'general', remains_time: 12800000, current_interval_remaining_percent: 74, current_weekly_remaining_percent: 94, current_interval_status: 1, current_weekly_status: 1, weekly_remains_time: 545600000 },
        ],
      }));
      const { getMmxQuota } = await importMmx();
      const result = await getMmxQuota();
      // Should pick 'general': 100-74=26%, 100-94=6%
      assert.equal(result!.fiveHourUsedPct, 26);
      assert.equal(result!.sevenDayUsedPct, 6);
    });

    it('falls back to first entry when no status=1', async () => {
      nextResponse = new Response(JSON.stringify({
        model_remains: [{
          model_name: 'a',
          remains_time: 1000,
          current_interval_remaining_percent: 50,
          current_weekly_remaining_percent: 60,
          weekly_remains_time: 2000,
        }],
      }));
      const { getMmxQuota } = await importMmx();
      const result = await getMmxQuota();
      assert.equal(result!.fiveHourUsedPct, 50);
      assert.equal(result!.sevenDayUsedPct, 40);
    });

    it('returns null for empty model_remains', async () => {
      nextResponse = new Response(JSON.stringify({ model_remains: [] }));
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });

    it('handles remaining_percent = 100 (fully unused) safely', async () => {
      nextResponse = new Response(JSON.stringify({
        model_remains: [{
          model_name: 'general',
          remains_time: 1000,
          current_interval_remaining_percent: 100,
          current_weekly_remaining_percent: 100,
          weekly_remains_time: 2000,
        }],
      }));
      const { getMmxQuota } = await importMmx();
      const result = await getMmxQuota();
      assert.equal(result!.fiveHourUsedPct, 0);
      assert.equal(result!.sevenDayUsedPct, 0);
    });
  });

  // ─── Error resilience ─────────────────────────────────────────

  describe('error resilience', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('returns null on 401 response', async () => {
      nextResponse = new Response('{"base_resp":{"status_code":1004}}', { status: 401 });
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });

    it('returns null on 500 response', async () => {
      nextResponse = new Response('internal error', { status: 500 });
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });

    it('returns null on network error', async () => {
      nextError = new Error('ECONNREFUSED');
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });

    it('returns null on malformed JSON', async () => {
      nextResponse = new Response('not json{', { status: 200 });
      const { getMmxQuota } = await importMmx();
      assert.equal(await getMmxQuota(), null);
    });
  });

  // ─── Cache ────────────────────────────────────────────────────

  describe('cache', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    });

    it('caches successful response for 5 minutes', async () => {
      nextResponse = new Response(JSON.stringify({
        model_remains: [{
          model_name: 'general',
          remains_time: 1000,
          current_interval_remaining_percent: 75,
          current_weekly_remaining_percent: 75,
          weekly_remains_time: 2000,
        }],
      }));
      const { getMmxQuota } = await importMmx();
      const r1 = await getMmxQuota();
      const r2 = await getMmxQuota();
      assert.equal(fetchCalls.length, 1, 'second call should hit cache');
      assert.deepEqual(r1, r2);
    });

    it('falls back to stale cache on fetch failure', async () => {
      // First call: succeed → write cache
      nextResponse = new Response(JSON.stringify({
        model_remains: [{
          model_name: 'general',
          remains_time: 1000,
          current_interval_remaining_percent: 75,
          current_weekly_remaining_percent: 75,
          weekly_remains_time: 2000,
        }],
      }));
      const { getMmxQuota } = await importMmx();
      const r1 = await getMmxQuota();
      // Force cache to look stale (10 min old)
      const cachePath = join(tmpHome, '.cache', 'cc-hud', 'mmx-quota.json');
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      cached.ts = Date.now() - 10 * 60 * 1000;
      writeFileSync(cachePath, JSON.stringify(cached));
      // Second call: fetch fails
      nextError = new Error('network down');
      const r2 = await getMmxQuota();
      assert.deepEqual(r1, r2, 'should return stale cache on fetch failure');
    });
  });
});
