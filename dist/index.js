import { readStdin } from './stdin.js';
import { parseAgents } from './transcript.js';
import { render } from './render.js';
import { shortModelName } from './model.js';
// Hard timeout — never block Claude Code
const TIMEOUT_MS = 2000;
setTimeout(() => process.exit(0), TIMEOUT_MS).unref();
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
    const renderData = {
        model: modelName.name,
        modelVariant: modelName.variant,
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
