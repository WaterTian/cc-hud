import { readStdin } from './stdin.js';
import { parseAgents } from './transcript.js';
import { render } from './render.js';
function shortModelName(displayName, id) {
    // "Opus 4.6 (1M context)" → "Opus 4.6"
    // "Sonnet 4.6" → "Sonnet 4.6"
    // "Claude 3.5 Haiku" → "Haiku 3.5"
    if (displayName) {
        const stripped = displayName.replace(/\s*\(.*?\)\s*/g, '').trim();
        if (stripped)
            return stripped;
    }
    // fallback: extract from model id like "claude-opus-4-6"
    if (id) {
        const m = id.match(/claude-(\w+)-(\d+)-(\d+)/);
        if (m)
            return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
    }
    return 'Claude';
}
async function main() {
    const data = await readStdin();
    const agents = await parseAgents(data.transcript_path);
    const contextPercent = data.context_window?.used_percentage ?? 0;
    const renderData = {
        model: shortModelName(data.model?.display_name, data.model?.id),
        contextPercent: Math.round(contextPercent),
        agents,
        fiveHourPercent: data.rate_limits?.five_hour?.used_percentage ?? null,
        sevenDayPercent: data.rate_limits?.seven_day?.used_percentage ?? null,
    };
    console.log(render(renderData));
}
main().catch(() => process.exit(0));
