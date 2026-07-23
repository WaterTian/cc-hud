import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const importClaude = () => import('../dist/claude.js');

// Real /api/oauth/usage shape (captured live 2026-07-23)
const USAGE_RESPONSE = {
  five_hour: { utilization: 1, resets_at: '2026-07-23T11:09:59.824401+00:00' },
  seven_day: { utilization: 35, resets_at: '2026-07-27T09:59:59.824421+00:00' },
  seven_day_opus: null,
  limits: [
    { kind: 'session', group: 'session', percent: 1, severity: 'normal', resets_at: '2026-07-23T11:09:59.824401+00:00', scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 35, severity: 'normal', resets_at: '2026-07-27T09:59:59.824421+00:00', scope: null, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 46, severity: 'normal', resets_at: '2026-07-27T09:59:59.824694+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
  ],
};

describe('claude plan', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalFetch = globalThis.fetch;
  const originalCurl = process.env.CC_HUD_CURL;
  const originalNoRefresh = process.env.CC_HUD_NO_REFRESH;

  let tmpHome: string;
  let fetchCalls: { url: string; init: RequestInit | undefined }[];
  let nextResponse: Response;
  let nextError: unknown;

  const cachePath = () => join(tmpHome, '.cache', 'cc-hud', 'claude-plan.json');

  // Always materialize a credentials file: its presence makes the token verdict
  // final, keeping tests off the real macOS Keychain on darwin dev machines.
  function writeCreds(overrides: Record<string, unknown> = {}): void {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', '.credentials.json'), JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-oat-test',
        expiresAt: Date.now() + 3_600_000,
        ...overrides,
      },
    }));
  }

  function writeClaudeJson(oauthAccount: Record<string, unknown> | undefined): void {
    writeFileSync(join(tmpHome, '.claude.json'), JSON.stringify({ oauthAccount }));
  }

  beforeEach(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    tmpHome = mkdtempSync(join(tmpdir(), 'claude-test-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    // Default: expired creds → no token, no fetch — tests opt in via writeCreds()
    writeCreds({ expiresAt: Date.now() - 1000 });
    // Never spawn a real detached refresher, never let the curl fallback leave the machine
    process.env.CC_HUD_NO_REFRESH = '1';
    process.env.CC_HUD_CURL = join(tmpHome, 'curl-not-installed');
    fetchCalls = [];
    nextResponse = new Response(JSON.stringify(USAGE_RESPONSE), { status: 200 });
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
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalCurl === undefined) delete process.env.CC_HUD_CURL;
    else process.env.CC_HUD_CURL = originalCurl;
    if (originalNoRefresh === undefined) delete process.env.CC_HUD_NO_REFRESH;
    else process.env.CC_HUD_NO_REFRESH = originalNoRefresh;
    globalThis.fetch = originalFetch;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // ─── Isolation (the critical guarantee) ──────────────────────

  describe('isolation', () => {
    it('returns null for DeepSeek backend', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      const { getClaudePlan } = await importClaude();
      assert.equal(await getClaudePlan(true), null);
    });

    it('returns null for GLM backend', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
      const { getClaudePlan } = await importClaude();
      assert.equal(await getClaudePlan(true), null);
    });

    it('returns null for MiniMax backend', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic';
      const { getClaudePlan } = await importClaude();
      assert.equal(await getClaudePlan(true), null);
    });

    it('returns null without rate limits (API-key session)', async () => {
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const { getClaudePlan } = await importClaude();
      assert.equal(await getClaudePlan(false), null);
    });

    it('refreshClaudePlan is a no-op for third-party backends', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      writeCreds();
      const { refreshClaudePlan } = await importClaude();
      await refreshClaudePlan();
      assert.equal(fetchCalls.length, 0);
    });

    it('activates when ANTHROPIC_BASE_URL points at api.anthropic.com', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const { getClaudePlan } = await importClaude();
      const result = await getClaudePlan(true);
      assert.equal(result?.tier, 'Max5x');
    });
  });

  // ─── Tick path: no network, ever ──────────────────────────────

  describe('tick path', () => {
    it('never fetches inline, even with a valid token and no cache', async () => {
      writeCreds();
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const { getClaudePlan } = await importClaude();
      await getClaudePlan(true);
      assert.equal(fetchCalls.length, 0);
    });

    it('serves tier from ~/.claude.json on first run (gauge arrives via refresh)', async () => {
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const { getClaudePlan } = await importClaude();
      const result = await getClaudePlan(true);
      assert.equal(result!.tier, 'Max5x');
      assert.equal(result!.topModel, null);
    });

    it('parses ~/.claude.json once, then serves the placeholder from cache', async () => {
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const { getClaudePlan } = await importClaude();
      await getClaudePlan(true);
      // Corrupt the source file — a cached tick must not re-read it
      writeFileSync(join(tmpHome, '.claude.json'), 'corrupted{');
      const result = await getClaudePlan(true);
      assert.equal(result!.tier, 'Max5x');
    });

    it('returns null when nothing is known at all', async () => {
      const { getClaudePlan } = await importClaude();
      assert.equal(await getClaudePlan(true), null);
    });

    it('survives malformed ~/.claude.json', async () => {
      writeFileSync(join(tmpHome, '.claude.json'), 'not json{');
      const { getClaudePlan } = await importClaude();
      assert.equal(await getClaudePlan(true), null);
    });

    it('serves a fresh cache without touching source files', async () => {
      mkdirSync(join(tmpHome, '.cache', 'cc-hud'), { recursive: true });
      const payload = { tier: 'Max20x', topModel: { name: 'Fable', percent: 46, resetsAt: null } };
      writeFileSync(cachePath(), JSON.stringify({ payload, ts: Date.now() }));
      const { getClaudePlan } = await importClaude();
      assert.deepEqual(await getClaudePlan(true), payload);
    });

    it('serves a stale cache rather than nothing', async () => {
      mkdirSync(join(tmpHome, '.cache', 'cc-hud'), { recursive: true });
      const payload = { tier: 'Max5x', topModel: { name: 'Fable', percent: 46, resetsAt: null } };
      writeFileSync(cachePath(), JSON.stringify({ payload, ts: Date.now() - 60 * 60 * 1000 }));
      const { getClaudePlan } = await importClaude();
      assert.deepEqual(await getClaudePlan(true), payload);
    });

    it('survives a malformed cache file', async () => {
      mkdirSync(join(tmpHome, '.cache', 'cc-hud'), { recursive: true });
      writeFileSync(cachePath(), 'not json{');
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const { getClaudePlan } = await importClaude();
      const result = await getClaudePlan(true);
      assert.equal(result!.tier, 'Max5x');
    });
  });

  // ─── Tier normalization ───────────────────────────────────────

  describe('tier normalization', () => {
    const tierOf = async (oauthAccount: Record<string, unknown> | undefined) => {
      writeClaudeJson(oauthAccount);
      const { getClaudePlan } = await importClaude();
      return (await getClaudePlan(true))?.tier ?? null;
    };

    it('maps default_claude_max_5x to Max5x', async () => {
      assert.equal(await tierOf({ organizationRateLimitTier: 'default_claude_max_5x' }), 'Max5x');
    });

    it('maps default_claude_max_20x to Max20x', async () => {
      assert.equal(await tierOf({ organizationRateLimitTier: 'default_claude_max_20x' }), 'Max20x');
    });

    it('maps pro tier strings to Pro', async () => {
      assert.equal(await tierOf({ organizationRateLimitTier: 'default_claude_pro' }), 'Pro');
    });

    it('falls back to userRateLimitTier when org tier missing', async () => {
      assert.equal(await tierOf({ userRateLimitTier: 'default_claude_max_20x' }), 'Max20x');
    });

    it('falls back to organizationType for unknown tier strings', async () => {
      assert.equal(await tierOf({ organizationRateLimitTier: 'mystery_tier_v9', organizationType: 'claude_team' }), 'Team');
    });

    it('maps organizationType claude_max to Max when tier absent', async () => {
      assert.equal(await tierOf({ organizationType: 'claude_max' }), 'Max');
    });

    it('returns null tier for missing oauthAccount', async () => {
      assert.equal(await tierOf(undefined), null);
    });
  });

  // ─── Refresh pipeline (runs in the detached child) ────────────

  describe('refresh pipeline', () => {
    const refreshedPayload = async () => {
      const { refreshClaudePlan } = await importClaude();
      await refreshClaudePlan();
      return (JSON.parse(readFileSync(cachePath(), 'utf8')) as { payload: unknown }).payload as {
        tier: string | null;
        topModel: { name: string; percent: number; resetsAt: number | null } | null;
      };
    };

    beforeEach(() => {
      writeCreds();
    });

    it('calls the oauth usage endpoint with token and beta header', async () => {
      await refreshedPayload();
      assert.equal(fetchCalls[0]?.url, 'https://api.anthropic.com/api/oauth/usage');
      const headers = fetchCalls[0]?.init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer sk-ant-oat-test');
      assert.equal(headers?.['anthropic-beta'], 'oauth-2025-04-20');
    });

    it('extracts the weekly_scoped top-model gauge from real-shape response', async () => {
      const payload = await refreshedPayload();
      assert.ok(payload.topModel);
      assert.equal(payload.topModel!.name, 'Fable');
      assert.equal(payload.topModel!.percent, 46);
      assert.equal(payload.topModel!.resetsAt, Date.parse('2026-07-27T09:59:59.824694+00:00'));
    });

    it('prefers the is_active weekly_scoped entry', async () => {
      nextResponse = new Response(JSON.stringify({
        limits: [
          { kind: 'weekly_scoped', percent: 10, is_active: false, scope: { model: { display_name: 'Sonnet' } } },
          { kind: 'weekly_scoped', percent: 46, is_active: true, scope: { model: { display_name: 'Fable' } } },
        ],
      }), { status: 200 });
      const payload = await refreshedPayload();
      assert.equal(payload.topModel!.name, 'Fable');
      assert.equal(payload.topModel!.percent, 46);
    });

    it('falls back to first weekly_scoped entry when none is active', async () => {
      nextResponse = new Response(JSON.stringify({
        limits: [
          { kind: 'weekly_scoped', percent: 21, is_active: false, scope: { model: { display_name: 'Opus' } } },
        ],
      }), { status: 200 });
      const payload = await refreshedPayload();
      assert.equal(payload.topModel!.name, 'Opus');
      assert.equal(payload.topModel!.percent, 21);
    });

    it('stores null topModel when no weekly_scoped entry exists', async () => {
      nextResponse = new Response(JSON.stringify({
        limits: [
          { kind: 'session', percent: 1 },
          { kind: 'weekly_all', percent: 35 },
        ],
      }), { status: 200 });
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const payload = await refreshedPayload();
      assert.equal(payload.tier, 'Max5x');
      assert.equal(payload.topModel, null);
    });

    it('handles unparsable resets_at as null', async () => {
      nextResponse = new Response(JSON.stringify({
        limits: [
          { kind: 'weekly_scoped', percent: 46, is_active: true, scope: { model: { display_name: 'Fable' } } },
        ],
      }), { status: 200 });
      const payload = await refreshedPayload();
      assert.equal(payload.topModel!.resetsAt, null);
    });

    it('skips fetch when the access token is expired', async () => {
      writeCreds({ expiresAt: Date.now() - 1000 });
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const payload = await refreshedPayload();
      assert.equal(fetchCalls.length, 0);
      assert.equal(payload.tier, 'Max5x');
      assert.equal(payload.topModel, null);
    });

    it('falls back to curl transport when native fetch is 403-blocked', { skip: process.platform === 'win32' }, async () => {
      nextResponse = new Response('{"error":{"type":"forbidden","message":"Request not allowed"}}', { status: 403 });
      const stub = join(tmpHome, 'curl-stub.sh');
      const fixture = JSON.stringify({
        limits: [{ kind: 'weekly_scoped', percent: 46, is_active: true, scope: { model: { display_name: 'Fable' } } }],
      });
      writeFileSync(stub, `#!/bin/sh\ncat > /dev/null\necho '${fixture}'\n`, { mode: 0o755 });
      process.env.CC_HUD_CURL = stub;
      const payload = await refreshedPayload();
      assert.equal(payload.topModel!.name, 'Fable');
      assert.equal(payload.topModel!.percent, 46);
    });

    it('degrades to null topModel when both native fetch and curl fail', async () => {
      nextResponse = new Response('{"error":{"type":"forbidden"}}', { status: 403 });
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const payload = await refreshedPayload();
      assert.equal(payload.tier, 'Max5x');
      assert.equal(payload.topModel, null);
    });

    it('keeps tier when usage endpoint returns 401', async () => {
      nextResponse = new Response('{"error":"unauthorized"}', { status: 401 });
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const payload = await refreshedPayload();
      assert.equal(payload.tier, 'Max5x');
      assert.equal(payload.topModel, null);
    });

    it('keeps tier on network error', async () => {
      nextError = new Error('ECONNREFUSED');
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const payload = await refreshedPayload();
      assert.equal(payload.tier, 'Max5x');
      assert.equal(payload.topModel, null);
    });

    it('keeps tier on malformed JSON', async () => {
      nextResponse = new Response('not json{', { status: 200 });
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const payload = await refreshedPayload();
      assert.equal(payload.tier, 'Max5x');
      assert.equal(payload.topModel, null);
    });

    it('preserves the previous gauge when a later fetch fails', async () => {
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      await refreshedPayload(); // success → gauge cached
      nextError = new Error('network down');
      const payload = await refreshedPayload();
      assert.equal(payload.topModel!.name, 'Fable');
      assert.equal(payload.topModel!.percent, 46);
    });

    it('does not store the token in the cache file', async () => {
      await refreshedPayload();
      const raw = readFileSync(cachePath(), 'utf8');
      assert.ok(!raw.includes('sk-ant-oat-test'));
    });

    it('refreshed cache is served by the tick path without another fetch', async () => {
      writeClaudeJson({ organizationRateLimitTier: 'default_claude_max_5x' });
      const payload = await refreshedPayload();
      const { getClaudePlan } = await importClaude();
      const r1 = await getClaudePlan(true);
      const r2 = await getClaudePlan(true);
      assert.equal(fetchCalls.length, 1, 'only the refresh should fetch');
      assert.deepEqual(r1, payload);
      assert.deepEqual(r2, payload);
    });
  });
});
