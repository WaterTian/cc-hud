import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end: a statusline-shaped stdin through the real entry point.
// Sandboxed HOME (no real caches / credentials), refresh spawning disabled,
// no ANTHROPIC_BASE_URL so the Claude path is taken and the third-party
// collectors stay inert.

const ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

interface RunResult { out: string; code: number | null; ms: number }

function run(stdin: string, home: string, extraEnv: Record<string, string> = {}): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CC_HUD_NO_REFRESH: '1', ...extraEnv };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CC_HUD_EXTRA_FILE;
  const t0 = Date.now();
  return new Promise(resolve => {
    const child = execFile(process.execPath, [ENTRY], { env, encoding: 'utf8', timeout: 10_000 }, (err, stdout) => {
      resolve({ out: strip(stdout).trimEnd(), code: err ? (err as { code?: number }).code ?? 1 : 0, ms: Date.now() - t0 });
    });
    child.stdin?.end(stdin);
  });
}

const FULL = {
  model: { id: 'claude-fable-5-1', display_name: 'Fable 5.1' },
  effort: { level: 'xhigh' },
  context_window: { used_percentage: 37, context_window_size: 1_000_000, current_usage: { input_tokens: 1 } },
  rate_limits: {
    five_hour: { used_percentage: 11 },
    seven_day: { used_percentage: 15 },
    spend_limit: { used_percentage: 24, used_usd: 12, limit_usd: 50, period: 'weekly' },
    one_day: { used_percentage: 7 },
  },
  cost: { total_cost_usd: 1.237 },
};

describe('dist/index.js end-to-end', () => {
  let home: string;
  let plainDir: string;

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'cc-hud-e2e-'));
    plainDir = join(home, 'notes');
    mkdirSync(plainDir);
  });
  after(() => rmSync(home, { recursive: true, force: true }));

  it('renders the full Claude line from stdin alone', async () => {
    const r = await run(JSON.stringify({ ...FULL, workspace: { current_dir: plainDir } }), home);
    assert.equal(r.code, 0);
    assert.equal(
      r.out,
      '[Fable 5.1 · XHigh] ███▊░░░░░░ 37% (1M) │ 5h:11% │ 7d:15% │ spend:$12/$50 │ one day:7% │ notes │ $1.24',
    );
  });

  it('empty stdin degrades to a bare model line, exit 0', async () => {
    const r = await run('', home);
    assert.equal(r.code, 0);
    assert.equal(r.out, '[Claude] ░░░░░░░░░░ —%');
  });

  it('malformed stdin degrades the same way', async () => {
    const r = await run('{not json', home);
    assert.equal(r.code, 0);
    assert.equal(r.out, '[Claude] ░░░░░░░░░░ —%');
  });

  it('current_usage null (after /compact) shows —% not 0%', async () => {
    const r = await run(JSON.stringify({
      model: { id: 'claude-opus-4-7[1m]' },
      context_window: { used_percentage: 0, current_usage: null },
    }), home);
    assert.equal(r.out, '[Opus 4.7] ░░░░░░░░░░ —% (1M)');
  });

  it('falls back to the transcript effort when stdin has none', async () => {
    const transcript = join(home, 'session.jsonl');
    writeFileSync(transcript, [
      JSON.stringify({ type: 'assistant', effort: 'low', message: { content: [] } }),
      JSON.stringify({ type: 'assistant', effort: 'max', message: { content: [] } }),
    ].join('\n') + '\n');
    const r = await run(JSON.stringify({
      model: { id: 'claude-sonnet-4-20250514' },
      context_window: { used_percentage: 5, current_usage: { input_tokens: 1 } },
      transcript_path: transcript,
    }), home);
    assert.equal(r.out, '[Sonnet 4 · Max] ▌░░░░░░░░░ 5%');
  });

  it('shows a running subagent from the transcript', async () => {
    const transcript = join(home, 'agents.jsonl');
    writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'Explore', model: 'haiku' } }] },
    }) + '\n');
    const r = await run(JSON.stringify({
      model: { id: 'claude-fable-5-1' },
      context_window: { used_percentage: 10, current_usage: { input_tokens: 1 } },
      transcript_path: transcript,
    }), home);
    assert.equal(r.out, '[Fable 5.1] █░░░░░░░░░ 10% │ ◐ Explore [haiku]');
  });

  it('serves a cached top-model gauge and flags it stale without okTs', async () => {
    mkdirSync(join(home, '.cache', 'cc-hud'), { recursive: true });
    writeFileSync(join(home, '.cache', 'cc-hud', 'claude-plan.json'), JSON.stringify({
      payload: { topModel: { name: 'Fable', percent: 46, resetsAt: null } },
      ts: Date.now(),
    }));
    const r = await run(JSON.stringify({
      model: { id: 'claude-fable-5-1' },
      context_window: { used_percentage: 10, current_usage: { input_tokens: 1 } },
      rate_limits: { five_hour: { used_percentage: 1 } },
    }), home);
    assert.equal(r.out, '[Fable 5.1] █░░░░░░░░░ 10% │ 5h:1% │ ~Fable:46%');
  });

  it('CC_HUD_NO_COST hides the cost segment', async () => {
    const r = await run(JSON.stringify({
      model: { id: 'claude-fable-5-1' },
      context_window: { used_percentage: 10, current_usage: { input_tokens: 1 } },
      cost: { total_cost_usd: 3 },
    }), home, { CC_HUD_NO_COST: '1' });
    assert.equal(r.out, '[Fable 5.1] █░░░░░░░░░ 10%');
  });

  it('finishes well inside the 2s hard timeout', async () => {
    const r = await run(JSON.stringify(FULL), home);
    assert.ok(r.ms < 1500, `took ${r.ms}ms`);
  });
});
