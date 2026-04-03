import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
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

export async function parseAgents(transcriptPath: string | undefined): Promise<AgentEntry[]> {
  if (!transcriptPath) return [];

  try {
    const info = await stat(transcriptPath);
    if (!info.isFile()) return [];
  } catch {
    return [];
  }

  const agents = new Map<string, AgentEntry>();
  const completed = new Set<string>();

  try {
    const rl = createInterface({
      input: createReadStream(transcriptPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

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
  } catch {
    return [];
  }

  for (const id of completed) {
    const agent = agents.get(id);
    if (agent) agent.status = 'completed';
  }

  return [...agents.values()].filter(a => a.status === 'running');
}
