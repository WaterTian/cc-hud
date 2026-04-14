import { readStdin } from './stdin.js';
import { parseAgents } from './transcript.js';
import { render } from './render.js';
import type { RenderData } from './types.js';

// Hard timeout — never block Claude Code
const TIMEOUT_MS = 2000;
setTimeout(() => process.exit(0), TIMEOUT_MS).unref();

function shortModelName(displayName?: string, id?: string): string {
  if (displayName) {
    const stripped = displayName.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (stripped) return stripped;
  }
  if (id) {
    const m = id.match(/claude-(\w+)-(\d+)-(\d+)/);
    if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  }
  return 'Claude';
}

async function main(): Promise<void> {
  const data = await readStdin();

  // Parse transcript in parallel with render prep — no dependency
  const agentsPromise = parseAgents(data.transcript_path);

  const contextPercent = data.context_window?.used_percentage ?? 0;
  const agents = await agentsPromise;

  const toMs = (ts: number | null | undefined): number | null => {
    if (ts == null) return null;
    return ts < 1e12 ? ts * 1000 : ts;
  };

  const renderData: RenderData = {
    model: shortModelName(data.model?.display_name, data.model?.id),
    contextPercent: Math.round(contextPercent),
    agents,
    fiveHourPercent: data.rate_limits?.five_hour?.used_percentage ?? null,
    sevenDayPercent: data.rate_limits?.seven_day?.used_percentage ?? null,
    fiveHourResetsAt: toMs(data.rate_limits?.five_hour?.resets_at),
    sevenDayResetsAt: toMs(data.rate_limits?.seven_day?.resets_at),
  };

  console.log(render(renderData));
}

main().catch(() => process.exit(0));
