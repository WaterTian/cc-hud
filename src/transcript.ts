import { open, stat } from 'node:fs/promises';
import type { AgentEntry } from './types.js';

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

interface TranscriptLine {
  message?: { content?: ContentBlock[] };
}

const TAIL_BYTES = 64 * 1024; // 64 KB — agent entries are near the end

async function readTail(filePath: string): Promise<string> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) return '';

  const fd = await open(filePath, 'r');
  try {
    const start = Math.max(0, info.size - TAIL_BYTES);
    const len = info.size - start;
    const buf = Buffer.alloc(len);
    await fd.read(buf, 0, len, start);
    const text = buf.toString('utf8');

    if (start > 0) {
      const nl = text.indexOf('\n');
      return nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text;
  } finally {
    await fd.close();
  }
}

export async function parseAgents(transcriptPath: string | undefined): Promise<AgentEntry[]> {
  if (!transcriptPath) return [];

  let text: string;
  try {
    text = await readTail(transcriptPath);
  } catch {
    return [];
  }

  if (!text) return [];

  const agents = new Map<string, AgentEntry>();
  const completed = new Set<string>();

  const lines = text.split('\n');
  for (const line of lines) {
    // Fast pre-filter: skip lines that can't contain agent data
    if (!line.includes('"Agent"') && !line.includes('"tool_result"')) continue;

    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
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

      if (block.type === 'tool_result' && block.tool_use_id) {
        completed.add(block.tool_use_id);
      }
    }
  }

  for (const id of completed) {
    const agent = agents.get(id);
    if (agent) agent.status = 'completed';
  }

  return [...agents.values()].filter(a => a.status === 'running');
}
