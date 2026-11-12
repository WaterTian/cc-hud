// Transcript tail reader — last 64 KB of the session JSONL → running
// subagents and the latest main-chain reasoning effort. Any read / parse
// failure → EMPTY.
//
// Subagents come from two sources, merged by tool_use id:
//   • sidecar — Claude Code launches Agent calls asynchronously: the
//     tool_result arrives at once ("async_launched") and the run is tracked in
//     <transcript dir>/<session>/subagents/agent-<id>.meta.json, written at
//     launch and rewritten with `finished: true` at the end. This is the
//     authoritative source and is independent of the 64 KB window.
//   • transcript — an Agent tool_use without any tool_result (older builds
//     that ran agents synchronously).
//
// A running sidecar agent also gets the model and effort it actually runs
// with, read from its own transcript (agent-<id>.jsonl) — see agentRuntime.
import { open, readdir, readFile, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEntry } from './types.js';

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

interface TranscriptLine {
  type?: string;
  effort?: unknown;
  isSidechain?: boolean;
  message?: { content?: ContentBlock[] };
}

interface AgentMeta {
  agentType?: unknown;
  description?: unknown;
  model?: unknown;
  toolUseId?: unknown;
  finished?: unknown;
}

export interface TranscriptInfo {
  agents: AgentEntry[];
  effort: string | null; // reasoning effort of the latest main-chain turn ("思考深度")
}

const EMPTY: TranscriptInfo = { agents: [], effort: null };

const TAIL_BYTES = 64 * 1024; // 64 KB — agent entries & the latest effort are near the end
// Head fallback for agentRuntime: the first API request sits after the prompt
// and attachments (20–180 KB in practice).
const RUNTIME_HEAD_BYTES = 256 * 1024;
// An unfinished meta whose agent transcript has not grown for this long is a
// leftover from a killed session, not a running agent.
export const AGENT_HEARTBEAT_MS = 15 * 60 * 1000;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

async function readAt(fd: FileHandle, from: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len);
  let got = 0;
  // A single read may come back short — keep going until the window is full
  while (got < len) {
    const { bytesRead } = await fd.read(buf, got, len - got, from + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

async function readTail(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) return '';

  const fd = await open(filePath, 'r');
  try {
    const start = Math.max(0, info.size - TAIL_BYTES);
    // Read one byte before the window (when there is one): if it is '\n' the
    // window begins on a line boundary and its first line is complete.
    const from = start > 0 ? start - 1 : 0;
    const data = await readAt(fd, from, info.size - from);
    if (start === 0) return data.toString('utf8');

    const text = data.subarray(1).toString('utf8');
    if (data[0] === 0x0a) return text;
    // Window starts mid-line: drop that partial first line
    const nl = text.indexOf('\n');
    return nl >= 0 ? text.slice(nl + 1) : '';
  } finally {
    await fd.close();
  }
}

// First `bytes` of the file, cut back to the last complete line.
async function readHead(filePath: string, bytes: number): Promise<string> {
  const fd = await open(filePath, 'r');
  try {
    const data = await readAt(fd, 0, bytes);
    if (data.length < bytes) return data.toString('utf8');
    const nl = data.lastIndexOf(0x0a);
    return nl >= 0 ? data.subarray(0, nl).toString('utf8') : '';
  } finally {
    await fd.close();
  }
}

interface RuntimeLine {
  type?: unknown;
  querySource?: unknown;
  effort?: unknown;
  requestedModel?: unknown;
  message?: { model?: unknown } | null;
  params?: { model?: unknown; output_config?: { effort?: unknown } | null } | null;
}

export interface AgentRuntime {
  model?: string;
  effort?: string;
}

// One subagent transcript line → the model / effort it records, if any.
//   api-request — params.model + params.output_config.effort, written before
//                 each call (so known while the first response is pending)
//   assistant   — requestedModel (or message.model) + effort, every turn
function runtimeOf(line: string): AgentRuntime | null {
  const isRequest = line.includes('"type":"api-request"'); // not -shape / -blob
  if (!isRequest && !line.includes('"type":"assistant"')) return null;
  try {
    const o = JSON.parse(line) as RuntimeLine;
    let model: string | undefined;
    let effort: string | undefined;
    if (o.type === 'api-request') {
      // Only the agent's own loop; a side query could use another model
      if (typeof o.querySource === 'string' && !o.querySource.startsWith('agent')) return null;
      model = str(o.params?.model);
      effort = str(o.params?.output_config?.effort);
    } else if (o.type === 'assistant') {
      model = str(o.requestedModel) ?? str(o.message?.model);
      // Locally generated turns (API errors, interrupts) carry no real model
      if (model === '<synthetic>') return null;
      effort = str(o.effort);
    }
    return model || effort ? { model, effort } : null;
  } catch {
    return null;
  }
}

// Model and effort a subagent runs with. They are fixed for its lifetime, so
// the newest record in the last 64 KB is enough; when one huge tool result
// fills the whole window, fall back to the first record in the head. Nothing
// found (first request not sent yet) or unreadable → {}.
export async function agentRuntime(logPath: string): Promise<AgentRuntime> {
  try {
    const tail = (await readTail(logPath)).split('\n');
    for (let i = tail.length - 1; i >= 0; i--) {
      const r = runtimeOf(tail[i]);
      if (r) return r;
    }
    for (const line of (await readHead(logPath, RUNTIME_HEAD_BYTES)).split('\n')) {
      const r = runtimeOf(line);
      if (r) return r;
    }
  } catch { /* unreadable → unknown */ }
  return {};
}

// Sidecar scan: every agent-*.meta.json without `finished: true` whose
// transcript (or, failing that, the meta file) was touched recently.
async function sidecarAgents(transcriptPath: string): Promise<AgentEntry[]> {
  const dir = join(transcriptPath.replace(/\.jsonl$/i, ''), 'subagents');
  let names: string[];
  try { names = (await readdir(dir)).filter(n => n.endsWith('.meta.json')).sort(); } catch { return []; }

  const now = Date.now();
  const found = await Promise.all(names.map(async (name): Promise<AgentEntry | null> => {
    try {
      const metaPath = join(dir, name);
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as AgentMeta;
      if (meta.finished === true) return null;
      const logPath = metaPath.replace(/\.meta\.json$/, '.jsonl');
      const beat = await stat(logPath).catch(() => stat(metaPath));
      if (now - beat.mtimeMs > AGENT_HEARTBEAT_MS) return null;
      // meta.model is only the alias passed to the Agent call ("haiku") and
      // is absent for defaults; the agent's own transcript has the resolved
      // id. (meta.pickedEffortModel is the parent's model — not used.)
      const run = await agentRuntime(logPath);
      return {
        id: str(meta.toolUseId) ?? name,
        type: str(meta.agentType) ?? 'general-purpose',
        model: run.model ?? str(meta.model),
        effort: run.effort,
        description: str(meta.description),
        status: 'running',
      };
    } catch { return null; }
  }));
  return found.filter((a): a is AgentEntry => a !== null);
}

// Single tail read → active subagents + current thinking depth.
export async function parseTranscript(transcriptPath: string | undefined): Promise<TranscriptInfo> {
  if (!transcriptPath) return EMPTY;

  const sidecar = sidecarAgents(transcriptPath);
  let text: string;
  try {
    text = await readTail(transcriptPath);
  } catch {
    text = '';
  }

  const agents = new Map<string, AgentEntry>();
  const settled = new Set<string>(); // tool_use ids with a tool_result (sync completion or async launch)
  let effort: string | null = null; // last (= most recent) main-chain assistant effort wins

  for (const line of text.split('\n')) {
    // Fast pre-filter: skip lines that carry neither agent data nor an effort field
    const maybeAgent = line.includes('"Agent"') || line.includes('"tool_result"');
    const maybeEffort = line.includes('"effort"');
    if (!maybeAgent && !maybeEffort) continue;

    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Thinking depth = the effort of the newest main-chain assistant turn.
    // Ignore sidechain (subagent) turns — they carry their own effort.
    if (entry.type === 'assistant' && entry.isSidechain !== true && typeof entry.effort === 'string') {
      effort = entry.effort;
    }

    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === 'Agent' && block.id) {
        const input = block.input ?? {};
        agents.set(block.id, {
          id: block.id,
          type: (input.subagent_type as string) ?? 'general-purpose',
          model: input.model as string | undefined,
          description: input.description as string | undefined,
          status: 'running',
        });
      }
      // Either a real completion or the immediate "async_launched" receipt —
      // in both cases the transcript no longer knows whether the agent runs;
      // the sidecar does.
      if (block.type === 'tool_result' && block.tool_use_id) settled.add(block.tool_use_id);
    }
  }

  for (const id of settled) agents.delete(id);
  for (const a of await sidecar) agents.set(a.id, a);

  return { agents: [...agents.values()], effort };
}
