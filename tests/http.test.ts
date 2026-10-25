import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const importHttp = () => import('../dist/http.js');

const PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'];

describe('http', () => {
  const saved: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;
  let tmpHome: string;
  let fetchCalls: string[];
  let nextResponse: Response;
  let nextError: unknown;

  beforeEach(() => {
    for (const k of ['HOME', 'USERPROFILE', 'CC_HUD_CURL', ...PROXY_KEYS]) saved[k] = process.env[k];
    for (const k of PROXY_KEYS) delete process.env[k];
    tmpHome = mkdtempSync(join(tmpdir(), 'http-test-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.CC_HUD_CURL = join(tmpHome, 'curl-not-installed');
    fetchCalls = [];
    nextResponse = new Response('{"ok":1}', { status: 200 });
    nextError = undefined;
    globalThis.fetch = (async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      if (nextError) throw nextError;
      return nextResponse;
    }) as typeof fetch;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    globalThis.fetch = originalFetch;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // A stand-in curl that records its environment and stdin, then prints JSON
  function fakeCurl(): { path: string; envFile: string; cfgFile: string } {
    const envFile = join(tmpHome, 'curl-env.txt');
    const cfgFile = join(tmpHome, 'curl-cfg.txt');
    const path = join(tmpHome, 'fake-curl.sh');
    writeFileSync(path, `#!/bin/sh\nenv > "${envFile}"\ncat > "${cfgFile}"\necho '{"via":"curl"}'\n`);
    chmodSync(path, 0o755);
    process.env.CC_HUD_CURL = path;
    return { path, envFile, cfgFile };
  }

  describe('resolveProxy', () => {
    it('returns null with no env and no config', async () => {
      const { resolveProxy } = await importHttp();
      assert.equal(resolveProxy(), null);
    });

    it('prefers the environment', async () => {
      process.env.https_proxy = 'http://127.0.0.1:7890';
      const { resolveProxy } = await importHttp();
      assert.equal(resolveProxy(), 'http://127.0.0.1:7890');
    });

    it('falls back to ~/.config/cc-hud/config.json', async () => {
      mkdirSync(join(tmpHome, '.config', 'cc-hud'), { recursive: true });
      writeFileSync(join(tmpHome, '.config', 'cc-hud', 'config.json'), JSON.stringify({ proxy: 'http://10.0.0.1:1080' }));
      const { resolveProxy } = await importHttp();
      assert.equal(resolveProxy(), 'http://10.0.0.1:1080');
    });

    it('ignores a malformed config file', async () => {
      mkdirSync(join(tmpHome, '.config', 'cc-hud'), { recursive: true });
      writeFileSync(join(tmpHome, '.config', 'cc-hud', 'config.json'), '{nope');
      const { resolveProxy } = await importHttp();
      assert.equal(resolveProxy(), null);
    });
  });

  describe('fetchJson', () => {
    it('returns parsed JSON from native fetch', async () => {
      const { fetchJson } = await importHttp();
      assert.deepEqual(await fetchJson('https://x.test/a', { Authorization: 'Bearer t' }), { ok: 1 });
      assert.equal(fetchCalls.length, 1);
    });

    it('does not retry via curl on 401 — the server already answered', async () => {
      nextResponse = new Response('{}', { status: 401 });
      const curl = fakeCurl();
      const { fetchJson } = await importHttp();
      assert.equal(await fetchJson('https://x.test/a', {}), null);
      assert.ok(!existsSync(curl.cfgFile), 'curl must not run');
    });

    it('falls back to curl on 403 (WAF)', { skip: process.platform === 'win32' }, async () => {
      nextResponse = new Response('blocked', { status: 403 });
      const curl = fakeCurl();
      const { fetchJson } = await importHttp();
      assert.deepEqual(await fetchJson('https://x.test/a', { Authorization: 'Bearer tok' }), { via: 'curl' });
      const cfg = readFileSync(curl.cfgFile, 'utf8');
      assert.match(cfg, /url = "https:\/\/x\.test\/a"/);
      assert.match(cfg, /header = "Authorization: Bearer tok"/);
    });

    it('falls back to curl on a transport error', { skip: process.platform === 'win32' }, async () => {
      nextError = new Error('ECONNRESET');
      fakeCurl();
      const { fetchJson } = await importHttp();
      assert.deepEqual(await fetchJson('https://x.test/a', {}), { via: 'curl' });
    });

    it('hands the configured proxy to curl via https_proxy', { skip: process.platform === 'win32' }, async () => {
      mkdirSync(join(tmpHome, '.config', 'cc-hud'), { recursive: true });
      writeFileSync(join(tmpHome, '.config', 'cc-hud', 'config.json'), JSON.stringify({ proxy: 'http://10.0.0.1:1080' }));
      const curl = fakeCurl();
      const { fetchJson } = await importHttp();
      assert.deepEqual(await fetchJson('https://x.test/a', {}), { via: 'curl' });
      assert.match(readFileSync(curl.envFile, 'utf8'), /^https_proxy=http:\/\/10\.0\.0\.1:1080$/m);
      assert.equal(fetchCalls.length, 0, 'native fetch would bypass the proxy');
    });

    it('goes straight to curl when the environment carries a proxy', { skip: process.platform === 'win32' }, async () => {
      process.env.https_proxy = 'http://127.0.0.1:7890';
      const curl = fakeCurl();
      const { fetchJson } = await importHttp();
      assert.deepEqual(await fetchJson('https://x.test/a', { Authorization: 'Bearer tok' }), { via: 'curl' });
      assert.equal(fetchCalls.length, 0, 'native fetch would bypass the proxy');
      assert.match(readFileSync(curl.cfgFile, 'utf8'), /header = "Authorization: Bearer tok"/);
    });

    it('behind a proxy, a curl failure does not fall back to native fetch', async () => {
      process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
      const { fetchJson } = await importHttp();
      assert.equal(await fetchJson('https://x.test/a', {}), null);
      assert.equal(fetchCalls.length, 0, 'native fetch would bypass the proxy');
    });

    it('refuses a header value that would break the curl config', async () => {
      nextError = new Error('ECONNRESET');
      const curl = fakeCurl();
      const { fetchJson } = await importHttp();
      assert.equal(await fetchJson('https://x.test/a', { Authorization: 'Bearer "evil"\nurl = "https://attacker"' }), null);
      assert.ok(!existsSync(curl.cfgFile), 'curl must not run');
    });

    it('returns null when both transports fail', async () => {
      nextError = new Error('ECONNRESET');
      const { fetchJson } = await importHttp();
      assert.equal(await fetchJson('https://x.test/a', {}), null);
    });
  });
});
