import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTranscript, AGENT_HEARTBEAT_MS } from '../dist/transcript.js';

// Build a JSONL transcript file from line objects and return its path.
describe('parseTranscript', () => {
  let dir: string;
  let file: string;

  const write = (lines: unknown[]): string => {
    writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'));
    return file;
  };

  const assistant = (effort: string | null, extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    ...(effort === null ? {} : { effort }),
    message: { content: [{ type: 'text', text: 'hi' }] },
    ...extra,
  });

  const agentUse = (id: string, subagent_type: string, model?: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Agent', id, input: { subagent_type, model } }] },
  });

  const toolResult = (tool_use_id: string) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id }] },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'transcript-test-'));
    file = join(dir, 'session.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ─── Thinking depth (reasoning effort) ────────────────────────

  it('extracts the effort of the latest main-chain assistant turn', async () => {
    const { effort } = await parseTranscript(write([assistant('high')]));
    assert.equal(effort, 'high');
  });

  it('the most recent effort wins when it changes mid-session', async () => {
    const { effort } = await parseTranscript(write([
      assistant('medium'),
      assistant('xhigh'),
    ]));
    assert.equal(effort, 'xhigh');
  });

  it('ignores effort on sidechain (subagent) turns', async () => {
    const { effort } = await parseTranscript(write([
      assistant('high'),
      assistant('low', { isSidechain: true }),
    ]));
    assert.equal(effort, 'high');
  });

  it('returns null effort when no assistant turn carries one', async () => {
    const { effort } = await parseTranscript(write([assistant(null)]));
    assert.equal(effort, null);
  });

  it('returns empty result for a missing transcript path', async () => {
    assert.deepEqual(await parseTranscript(undefined), { agents: [], effort: null });
  });

  it('returns empty result for a nonexistent file', async () => {
    assert.deepEqual(await parseTranscript(join(dir, 'nope.jsonl')), { agents: [], effort: null });
  });

  // ─── Active subagents ─────────────────────────────────────────

  it('reports a running agent that has no tool_result yet', async () => {
    const { agents } = await parseTranscript(write([
      assistant('high'),
      agentUse('a1', 'explore', 'haiku'),
    ]));
    assert.equal(agents.length, 1);
    assert.equal(agents[0].type, 'explore');
    assert.equal(agents[0].model, 'haiku');
  });

  it('drops an agent once its tool_result arrives', async () => {
    const { agents } = await parseTranscript(write([
      agentUse('a1', 'explore'),
      toolResult('a1'),
    ]));
    assert.equal(agents.length, 0);
  });

  it('extracts effort and agents together from one tail read', async () => {
    const { agents, effort } = await parseTranscript(write([
      assistant('max'),
      agentUse('a1', 'general-purpose'),
    ]));
    assert.equal(effort, 'max');
    assert.equal(agents.length, 1);
  });

  // ─── 64 KB tail window boundary ───────────────────────────────

  const TAIL = 64 * 1024;
  // Exactly TAIL bytes (ASCII): two complete Agent lines, then a filler line the
  // pre-filter skips, padded so the window starts right at the first Agent line.
  const buildTail = (): string => {
    const head = JSON.stringify(agentUse('a1', 'explore')) + '\n' + JSON.stringify(agentUse('a2', 'general-purpose')) + '\n';
    const prefix = '{"type":"progress","pad":"';
    const tail = head + prefix + 'x'.repeat(TAIL - head.length - prefix.length - 2) + '"}';
    assert.equal(Buffer.byteLength(tail), TAIL);
    return tail;
  };

  it('keeps the first line when the tail window starts exactly on a line boundary', async () => {
    writeFileSync(file, 'y'.repeat(100) + '\n' + buildTail());
    const { agents } = await parseTranscript(file);
    assert.deepEqual(agents.map(a => a.id), ['a1', 'a2']);
  });

  it('drops the leading partial line when the tail window starts mid-line', async () => {
    writeFileSync(file, 'y'.repeat(100) + buildTail()); // a1's line is cut in half
    const { agents } = await parseTranscript(file);
    assert.deepEqual(agents.map(a => a.id), ['a2']);
  });

  it('ignores a tool_result whose Agent tool_use fell outside the tail window', async () => {
    // Only the result line is in the window — must not resurrect or crash
    const { agents } = await parseTranscript(write([
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_gone' }] } },
    ]));
    assert.deepEqual(agents, []);
  });

  // ─── Async agents (sidecar meta files) ────────────────────────
  // Claude Code answers an Agent call at once with an "async_launched"
  // receipt and tracks the run in <session>/subagents/agent-<id>.meta.json.

  const asyncReceipt = (tool_use_id: string) => ({
    type: 'user',
    toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'x' },
    message: { content: [{ type: 'tool_result', tool_use_id, content: 'Async agent launched successfully.' }] },
  });

  const meta = (agentId: string, body: Record<string, unknown>, ageMs = 0) => {
    const d = join(dir, 'session', 'subagents');
    mkdirSync(d, { recursive: true });
    const metaFile = join(d, `agent-${agentId}.meta.json`);
    const log = join(d, `agent-${agentId}.jsonl`);
    writeFileSync(metaFile, JSON.stringify(body));
    writeFileSync(log, '{}\n');
    if (ageMs) {
      const t = (Date.now() - ageMs) / 1000;
      utimesSync(metaFile, t, t);
      utimesSync(log, t, t);
    }
  };

  it('keeps an async-launched agent visible while its meta is unfinished', async () => {
    meta('x1', { agentType: 'explore', model: 'haiku', description: 'probe', toolUseId: 'a1' });
    const { agents } = await parseTranscript(write([agentUse('a1', 'explore', 'haiku'), asyncReceipt('a1')]));
    assert.deepEqual(agents, [{ id: 'a1', type: 'explore', model: 'haiku', description: 'probe', status: 'running' }]);
  });

  it('drops it once the meta says finished', async () => {
    meta('x1', { agentType: 'explore', toolUseId: 'a1', finished: true });
    const { agents } = await parseTranscript(write([agentUse('a1', 'explore'), asyncReceipt('a1')]));
    assert.deepEqual(agents, []);
  });

  it('hides an async receipt that has no sidecar at all', async () => {
    const { agents } = await parseTranscript(write([agentUse('a1', 'explore'), asyncReceipt('a1')]));
    assert.deepEqual(agents, []);
  });

  it('lists a running sidecar agent even when its launch fell outside the tail window', async () => {
    meta('x2', { agentType: 'general-purpose', toolUseId: 'a2' });
    const { agents } = await parseTranscript(write([assistant('high')]));
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, 'a2');
    assert.equal(agents[0].model, undefined);
  });

  it('ignores an unfinished meta whose transcript stopped growing before the heartbeat window', async () => {
    meta('x3', { agentType: 'explore', toolUseId: 'a3' }, AGENT_HEARTBEAT_MS + 60_000);
    const { agents } = await parseTranscript(write([assistant('high')]));
    assert.deepEqual(agents, []);
  });

  it('merges sidecar and transcript agents by tool_use id', async () => {
    meta('x1', { agentType: 'explore', toolUseId: 'a1' });
    const { agents } = await parseTranscript(write([agentUse('a1', 'explore'), agentUse('a4', 'Plan')]));
    assert.deepEqual(agents.map(a => a.id).sort(), ['a1', 'a4']);
  });

  it('still scans the sidecar when the transcript file is unreadable', async () => {
    meta('x1', { agentType: 'explore', toolUseId: 'a1' });
    const { agents } = await parseTranscript(file); // never written
    assert.equal(agents.length, 1);
  });
});
