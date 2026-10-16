import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render.js';
import { shortModelName } from './model.js';
import { getExtra } from './balance.js';
import { getMmxQuota } from './mmx.js';
import { getGlmBalance } from './glm.js';
import { getClaudePlan } from './claude.js';
import { getWorkspace } from './git.js';
import { readFileSync } from 'node:fs';
import type { ExtraLimit, RenderData, SpendLimit, SpendLimitWindow, StdinData } from './types.js';

// Hard timeout — never block Claude Code
const TIMEOUT_MS = 2000;
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

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// resets_at: stdin gives epoch seconds, MiniMax gives ms — normalize to ms
const toMs = (ts: unknown): number | null => {
  const n = num(ts);
  if (n == null) return null;
  return n < 1e12 ? n * 1000 : n;
};

const KNOWN_WINDOWS = new Set(['five_hour', 'seven_day', 'spend_limit']);

// Rate windows beyond 5h / 7d: the gateway spend cap gets its own slot, any
// other key Claude Code adds later is listed generically so it isn't dropped.
function splitLimits(rl: StdinData['rate_limits']): { spend: SpendLimit | null; extras: ExtraLimit[] } {
  if (!rl || typeof rl !== 'object') return { spend: null, extras: [] };

  let spend: SpendLimit | null = null;
  const s = rl.spend_limit as SpendLimitWindow | null | undefined;
  const sp = num(s?.used_percentage);
  if (sp != null) {
    spend = { percent: sp, resetsAt: toMs(s?.resets_at), usedUsd: num(s?.used_usd), limitUsd: num(s?.limit_usd) };
  }

  const extras: ExtraLimit[] = [];
  for (const [key, v] of Object.entries(rl)) {
    if (KNOWN_WINDOWS.has(key) || !v || typeof v !== 'object') continue;
    const p = num(v.used_percentage);
    if (p == null) continue;
    extras.push({ label: key.replace(/_/g, ' '), percent: p, resetsAt: toMs(v.resets_at) });
  }
  return { spend, extras };
}

async function main(): Promise<void> {
  const data = await readStdin();

  // Parse transcript in parallel with render prep — no dependency.
  // Yields active subagents (+ thinking depth, for stdin without `effort`).
  const transcriptPromise = parseTranscript(data.transcript_path);

  // Top-model weekly gauge — no-op for third-party backends, started early
  // so a cache-miss fetch overlaps with transcript parsing.
  const planPromise = getClaudePlan(!!data.rate_limits);

  // Folder + git branch — short git calls, overlapped with the above.
  const workspacePromise = getWorkspace(
    data.workspace?.current_dir ?? data.cwd,
    data.worktree?.branch,
  );

  // current_usage is null before the first API call, and again after /compact
  // until the next API call repopulates it. In those windows show "—" instead
  // of collapsing to 0%, which would look like the context just emptied.
  const cw = data.context_window;
  const usageUnavailable = cw?.current_usage === null || cw?.used_percentage == null;
  const contextPercent: number | null = usageUnavailable
    ? null
    : Math.round(cw!.used_percentage as number);
  const { agents, effort: transcriptEffort } = await transcriptPromise;

  // Thinking depth: stdin `effort.level` is authoritative; the transcript
  // fallback covers older Claude Code builds that don't send it.
  const effort = (typeof data.effort?.level === 'string' && data.effort.level) || transcriptEffort;

  const modelName = shortModelName(data.model?.display_name, data.model?.id);
  // `[1m]` id suffix is the explicit signal; context_window_size covers ids
  // that don't carry it (Fable 5.1 on a 1M window reports 1000000 here).
  const size = num(cw?.context_window_size);
  const modelVariant = modelName.variant ?? (size != null && size >= 1_000_000 ? `${Math.round(size / 1_000_000)}M` : null);

  // Extra segment: explicit CC_HUD_EXTRA_FILE > DeepSeek balance > GLM balance
  const extra = readExtraFile() ?? (await getExtra()) ?? (await getGlmBalance());

  // MiniMax Token Plan quota — no-op for Claude/DeepSeek (returns null)
  const mmQuota = await getMmxQuota();

  const plan = await planPromise;
  const workspace = await workspacePromise;
  const { spend, extras } = splitLimits(data.rate_limits);

  const cost = num(data.cost?.total_cost_usd);

  const renderData: RenderData = {
    model: modelName.name,
    modelVariant,
    contextPercent,
    agents,
    fiveHourPercent: data.rate_limits?.five_hour?.used_percentage ?? mmQuota?.fiveHourUsedPct ?? null,
    sevenDayPercent: data.rate_limits?.seven_day?.used_percentage ?? mmQuota?.sevenDayUsedPct ?? null,
    fiveHourResetsAt: toMs(data.rate_limits?.five_hour?.resets_at) ?? mmQuota?.fiveHourResetsAt ?? null,
    sevenDayResetsAt: toMs(data.rate_limits?.seven_day?.resets_at) ?? mmQuota?.sevenDayResetsAt ?? null,
    spendLimit: spend,
    extraLimits: extras,
    thinkingDepth: effort,
    topModel: plan?.topModel ?? null,
    topModelStale: plan?.stale ?? false,
    workspace,
    costUsd: process.env.CC_HUD_NO_COST || cost == null || cost <= 0 ? null : cost,
    extra,
  };

  console.log(render(renderData));
}

main().catch(() => process.exit(0));
