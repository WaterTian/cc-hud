import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const importCache = () => import('../dist/cache.js');

describe('cache', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalNoRefresh = process.env.CC_HUD_NO_REFRESH;
  let tmpHome: string;
  const cacheDir = () => join(tmpHome, '.cache', 'cc-hud');

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'cache-test-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.CC_HUD_NO_REFRESH = '1'; // never spawn a real refresher
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalUserProfile;
    if (originalNoRefresh === undefined) delete process.env.CC_HUD_NO_REFRESH; else process.env.CC_HUD_NO_REFRESH = originalNoRefresh;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('writeFileAtomic', () => {
    it('writes the content and leaves no temp file behind', async () => {
      const { writeFileAtomic } = await importCache();
      const target = join(tmpHome, 'a.json');
      writeFileAtomic(target, '{"x":1}');
      assert.equal(readFileSync(target, 'utf8'), '{"x":1}');
      assert.deepEqual(readdirSync(tmpHome).filter(f => f.includes('.tmp-')), []);
    });

    it('replaces an existing file wholesale', async () => {
      const { writeFileAtomic } = await importCache();
      const target = join(tmpHome, 'a.json');
      writeFileAtomic(target, 'x'.repeat(100));
      writeFileAtomic(target, 'short');
      assert.equal(readFileSync(target, 'utf8'), 'short');
    });

    it('cleans up the temp file when the rename fails, without throwing', async () => {
      const { writeFileAtomic } = await importCache();
      const target = join(tmpHome, 'blocked.json');
      mkdirSync(target); // a directory in the way → rename fails
      assert.doesNotThrow(() => writeFileAtomic(target, '{}'));
      assert.deepEqual(readdirSync(tmpHome).filter(f => f.includes('.tmp-')), []);
    });
  });

  describe('writeCache / readCache', () => {
    it('round-trips an entry and leaves no temp file', async () => {
      const { writeCache, readCache } = await importCache();
      writeCache('unit', { payload: { v: 1 }, ts: 123, okTs: 123 });
      assert.deepEqual(readCache('unit'), { payload: { v: 1 }, ts: 123, okTs: 123 });
      assert.deepEqual(readdirSync(cacheDir()).filter(f => f.includes('.tmp-')), []);
    });

    it('returns null for a missing or malformed file', async () => {
      const { readCache, writeFileAtomic } = await importCache();
      assert.equal(readCache('nope'), null);
      mkdirSync(cacheDir(), { recursive: true });
      writeFileAtomic(join(cacheDir(), 'bad.json'), '{not json');
      assert.equal(readCache('bad'), null);
    });
  });

  describe('serveCache', () => {
    it('writes a placeholder on a cache miss so the next tick sees the cooldown', async () => {
      const { serveCache } = await importCache();
      assert.equal(serveCache('miss', 'claude'), null);
      const entry = JSON.parse(readFileSync(join(cacheDir(), 'miss.json'), 'utf8'));
      assert.equal(entry.payload, null);
      assert.ok(entry.refreshTs > 0);
    });

    it('serves a fresh entry without rewriting it', async () => {
      const { writeCache, serveCache } = await importCache();
      const now = Date.now();
      writeCache('fresh', { payload: { v: 2 }, ts: now, okTs: now });
      assert.deepEqual(serveCache('fresh', 'claude'), { payload: { v: 2 }, stale: false });
      assert.ok(existsSync(join(cacheDir(), 'fresh.json')));
    });
  });

  describe('cachedInline', () => {
    it('serves a fresh entry without calling the fetcher', async () => {
      const { writeCache, cachedInline } = await importCache();
      const now = Date.now();
      writeCache('bal', { payload: 'v1', ts: now, okTs: now });
      let calls = 0;
      assert.deepEqual(await cachedInline('bal', async () => { calls++; return 'v2'; }), { payload: 'v1', stale: false });
      assert.equal(calls, 0);
    });

    it('writes a fetched value with okTs and serves it fresh', async () => {
      const { cachedInline, readCache } = await importCache();
      assert.deepEqual(await cachedInline('new', async () => 'v'), { payload: 'v', stale: false });
      const e = readCache<string>('new')!;
      assert.equal(e.payload, 'v');
      assert.equal(e.okTs, e.ts);
    });

    it('a failed fetch is not retried within the cooldown', async () => {
      const { cachedInline, readCache } = await importCache();
      let calls = 0;
      const dead = async () => { calls++; return null; };
      assert.equal(await cachedInline('dead', dead), null);
      assert.equal(await cachedInline('dead', dead), null);
      assert.equal(calls, 1);
      assert.ok((readCache('dead')?.failTs ?? 0) > 0);
    });

    it('keeps the old payload on failure and flags it stale after 30 min', async () => {
      const { writeCache, cachedInline, STALE_MS, TTL } = await importCache();
      const old = Date.now() - STALE_MS - 60_000;
      writeCache('aged', { payload: 'v', ts: old, okTs: old });
      assert.deepEqual(await cachedInline('aged', async () => null), { payload: 'v', stale: true });
      // Recent failure, but the last good value is younger than STALE_MS → not stale
      const recent = Date.now() - TTL - 1000;
      writeCache('recent', { payload: 'w', ts: recent, okTs: recent });
      assert.deepEqual(await cachedInline('recent', async () => null), { payload: 'w', stale: false });
    });

    it('treats an entry written before okTs existed as good at its ts', async () => {
      const { writeCache, cachedInline } = await importCache();
      writeCache('legacy', { payload: 'v', ts: Date.now() });
      assert.deepEqual(await cachedInline('legacy', async () => null), { payload: 'v', stale: false });
    });
  });
});
