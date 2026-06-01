import { readStdin } from './stdin.js';
import { parseAgents } from './transcript.js';
import { render } from './render.js';
import { shortModelName } from './model.js';
import { getExtra } from './balance.js';
import { getMmxQuota } from './mmx.js';
import { readFileSync } from 'node:fs';
// Hard timeout — never block Claude Code
const TIMEOUT_MS = 2000;
setTimeout(() => process.exit(0), TIMEOUT_MS).unref();
function readExtraFile() {
    const file = process.env.CC_HUD_EXTRA_FILE;
    if (!file)
        return null;
    try {
        const text = readFileSync(file, 'utf8').trim();
        return text || null;
    }
    catch {
        return null;
    }
}
async function main() {
    const data = await readStdin();
    // Parse transcript in parallel with render prep — no dependency
    const agentsPromise = parseAgents(data.transcript_path);
    const contextPercent = data.context_window?.used_percentage ?? 0;
    const agents = await agentsPromise;
    const toMs = (ts) => {
        if (ts == null)
            return null;
        return ts < 1e12 ? ts * 1000 : ts;
    };
    const modelName = shortModelName(data.model?.display_name, data.model?.id);
    // Extra segment: explicit CC_HUD_EXTRA_FILE > auto DeepSeek balance detection
    const extra = readExtraFile() ?? await getExtra();
    // MiniMax Token Plan quota — no-op for Claude/DeepSeek (returns null)
    const mmQuota = await getMmxQuota(data.model?.id);
    const renderData = {
        model: modelName.name,
        modelVariant: modelName.variant,
        contextPercent: Math.round(contextPercent),
        agents,
        fiveHourPercent: data.rate_limits?.five_hour?.used_percentage ?? mmQuota?.fiveHourUsedPct ?? null,
        sevenDayPercent: data.rate_limits?.seven_day?.used_percentage ?? mmQuota?.sevenDayUsedPct ?? null,
        fiveHourResetsAt: toMs(data.rate_limits?.five_hour?.resets_at) ?? mmQuota?.fiveHourResetsAt ?? null,
        sevenDayResetsAt: toMs(data.rate_limits?.seven_day?.resets_at) ?? mmQuota?.sevenDayResetsAt ?? null,
        extra,
    };
    console.log(render(renderData));
}
main().catch(() => process.exit(0));
