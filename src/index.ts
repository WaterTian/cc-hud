import { readStdin } from './stdin.js';
import { parseAgents } from './transcript.js';
import { render } from './render.js';
import { shortModelName } from './model.js';
import { getExtra } from './balance.js';
import { getMmxQuota } from './mmx.js';
import { getGlmBalance } from './glm.js';
import { getOpenCodeQuota } from './opencode.js';
import { readFileSync } from 'node:fs';
import type { RenderData } from './types.js';

// Hard timeout — never block Claude Code
const TIMEOUT_MS = 6000;
setTimeout(() => process.exit(0), TIMEOUT_MS).unref();

function readExtraFile(): string | null {
  const file = process.env.CC_HUD_EXTRA_FILE;
  if (!file) return null;
  try {
    const text = readFileSync(file, 'utf8').trim();
    return text || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const data = await readStdin();

  // Parse transcript in parallel with render prep — no dependency
  const agentsPromise = parseAgents(data.transcript_path);

  // current_usage is null before the first API call, and again after /compact
  // until the next API call repopulates it. In those windows show "—" instead
  // of collapsing to 0%, which would look like the context just emptied.
  const cw = data.context_window;
  const usageUnavailable = cw?.current_usage === null || cw?.used_percentage == null;
  const contextPercent: number | null = usageUnavailable
    ? null
    : Math.round(cw!.used_percentage as number);
  const agents = await agentsPromise;

  const toMs = (ts: number | null | undefined): number | null => {
    if (ts == null) return null;
    return ts < 1e12 ? ts * 1000 : ts;
  };

  const modelName = shortModelName(data.model?.display_name, data.model?.id);

  // Fetch from various backend-specific sources in parallel —
  // each module returns null when it doesn't apply (fast path).
  const [ocQuota, mmQuota, extra] = await Promise.all([
    getOpenCodeQuota(),          // OpenCode Go subscription — fast cache path
    getMmxQuota(),               // MiniMax Token Plan — fast cache path
    // Extra segment: explicit CC_HUD_EXTRA_FILE > DeepSeek balance > GLM balance
    (async () => readExtraFile() ?? (await getExtra()) ?? (await getGlmBalance()))(),
  ]);

  const renderData: RenderData = {
    model: modelName.name,
    modelVariant: modelName.variant,
    contextPercent,
    agents,
    // Priority: built-in rate limits > OpenCode quota > MiniMax quota
    fiveHourPercent: data.rate_limits?.five_hour?.used_percentage
      ?? ocQuota?.rollingPercent ?? mmQuota?.fiveHourUsedPct ?? null,
    sevenDayPercent: data.rate_limits?.seven_day?.used_percentage
      ?? ocQuota?.weeklyPercent ?? mmQuota?.sevenDayUsedPct ?? null,
    fiveHourResetsAt: toMs(data.rate_limits?.five_hour?.resets_at)
      ?? ocQuota?.rollingResetsAt ?? mmQuota?.fiveHourResetsAt ?? null,
    sevenDayResetsAt: toMs(data.rate_limits?.seven_day?.resets_at)
      ?? ocQuota?.weeklyResetsAt ?? mmQuota?.sevenDayResetsAt ?? null,
    extra,
    monthlyPercent: ocQuota?.monthlyPercent ?? null,
    monthlyResetsAt: ocQuota?.monthlyResetsAt ?? null,
  };

  console.log(render(renderData));
}

main().catch(() => process.exit(0));
