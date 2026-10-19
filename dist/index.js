#!/usr/bin/env node
import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render.js';
import { shortModelName } from './model.js';
import { getExtra } from './balance.js';
import { getMmxQuota } from './mmx.js';
import { getGlmBalance } from './glm.js';
import { getClaudePlan } from './claude.js';
import { getWorkspace } from './git.js';
import { envFlag } from './env.js';
import { readFileSync } from 'node:fs';
// Hard timeout — never block Claude Code
const TIMEOUT_MS = 2000;
setTimeout(() => process.exit(0), TIMEOUT_MS).unref();
// Exactly one stdout write per tick — a second line corrupts the status bar.
let printed = false;
function emit(line) {
    if (printed)
        return;
    printed = true;
    console.log(line);
}
function readExtraFile() {
    const file = process.env.CC_HUD_EXTRA_FILE;
    if (!file)
        return null;
    try {
        // Documented contract: the first line is the text to display
        const text = (readFileSync(file, 'utf8').split('\n')[0] ?? '').trim();
        return text || null;
    }
    catch {
        return null;
    }
}
const num = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
// resets_at: stdin gives epoch seconds, MiniMax gives ms — normalize to ms
const toMs = (ts) => {
    const n = num(ts);
    if (n == null)
        return null;
    return n < 1e12 ? n * 1000 : n;
};
const KNOWN_WINDOWS = new Set(['five_hour', 'seven_day', 'spend_limit']);
// Rate windows beyond 5h / 7d: the gateway spend cap gets its own slot, any
// other key Claude Code adds later is listed generically so it isn't dropped.
function splitLimits(rl) {
    if (!rl || typeof rl !== 'object')
        return { spend: null, extras: [] };
    let spend = null;
    const s = rl.spend_limit;
    const sp = num(s?.used_percentage);
    if (sp != null) {
        spend = { percent: sp, resetsAt: toMs(s?.resets_at), usedUsd: num(s?.used_usd), limitUsd: num(s?.limit_usd) };
    }
    const extras = [];
    for (const [key, v] of Object.entries(rl)) {
        if (KNOWN_WINDOWS.has(key) || !v || typeof v !== 'object')
            continue;
        const p = num(v.used_percentage);
        if (p == null)
            continue;
        extras.push({ label: key.replace(/_/g, ' '), percent: p, resetsAt: toMs(v.resets_at) });
    }
    return { spend, extras };
}
async function main() {
    const data = await readStdin();
    // Parse transcript in parallel with render prep — no dependency.
    // Yields active subagents (+ thinking depth, for stdin without `effort`).
    const transcriptPromise = parseTranscript(data.transcript_path);
    // Top-model weekly gauge — no-op for third-party backends, started early
    // so a cache-miss fetch overlaps with transcript parsing. The subscription
    // signal is a rate_limits object with at least one real window: an empty {}
    // must not write the cache placeholder or spawn the refresher.
    const rl = data.rate_limits;
    const hasRateLimits = !!rl && typeof rl === 'object' && !!(rl.five_hour || rl.seven_day || rl.spend_limit);
    const planPromise = getClaudePlan(hasRateLimits);
    // Folder + git branch — short git calls, overlapped with the above.
    const workspacePromise = getWorkspace(data.workspace?.current_dir ?? data.cwd, data.worktree?.branch);
    // current_usage is null before the first API call, and again after /compact
    // until the next API call repopulates it. In those windows show "—" instead
    // of collapsing to 0%, which would look like the context just emptied.
    // When used_percentage is missing but the token counts and window size are
    // there, derive the percentage from them rather than showing —%.
    const cw = data.context_window;
    const cu = cw?.current_usage;
    const size = num(cw?.context_window_size);
    const used = num(cw?.used_percentage);
    let contextPercent = null;
    if (cu !== null) {
        if (used != null) {
            contextPercent = Math.round(used);
        }
        else if (cu && size != null && size > 0) {
            const tokens = [cu.input_tokens, cu.cache_creation_input_tokens, cu.cache_read_input_tokens]
                .map(num)
                .filter((n) => n != null);
            if (tokens.length > 0)
                contextPercent = Math.round((tokens.reduce((a, b) => a + b, 0) / size) * 100);
        }
    }
    // Everything else is independent — await it all at once. The third-party
    // collectors still fetch inline on a cache miss (each ≤ 1.2s, concurrent —
    // well inside the 2s hard exit, so a hung endpoint only drops its segment).
    const [{ agents, effort: transcriptEffort }, plan, workspace, extra, mmQuota,] = await Promise.all([
        transcriptPromise,
        planPromise,
        workspacePromise,
        // Extra segment: explicit CC_HUD_EXTRA_FILE > DeepSeek balance > GLM balance
        (async () => readExtraFile() ?? (await getExtra()) ?? (await getGlmBalance()))(),
        // MiniMax Token Plan quota — no-op for Claude/DeepSeek (returns null)
        getMmxQuota(),
    ]);
    // Thinking depth: stdin `effort.level` is authoritative; the transcript
    // fallback covers older Claude Code builds that don't send it.
    const effort = (typeof data.effort?.level === 'string' && data.effort.level) || transcriptEffort;
    const modelName = shortModelName(data.model?.display_name, data.model?.id);
    // `[1m]` id suffix is the explicit signal; context_window_size covers ids
    // that don't carry it (Fable 5.1 on a 1M window reports 1000000 here).
    const modelVariant = modelName.variant ?? (size != null && size >= 1_000_000 ? `${Math.round(size / 1_000_000)}M` : null);
    const { spend, extras } = splitLimits(data.rate_limits);
    const cost = num(data.cost?.total_cost_usd);
    const renderData = {
        model: modelName.name,
        modelVariant,
        contextPercent,
        agents,
        fiveHourPercent: num(data.rate_limits?.five_hour?.used_percentage) ?? mmQuota?.fiveHourUsedPct ?? null,
        sevenDayPercent: num(data.rate_limits?.seven_day?.used_percentage) ?? mmQuota?.sevenDayUsedPct ?? null,
        fiveHourResetsAt: toMs(data.rate_limits?.five_hour?.resets_at) ?? mmQuota?.fiveHourResetsAt ?? null,
        sevenDayResetsAt: toMs(data.rate_limits?.seven_day?.resets_at) ?? mmQuota?.sevenDayResetsAt ?? null,
        spendLimit: spend,
        extraLimits: extras,
        thinkingDepth: effort,
        topModel: plan?.topModel ?? null,
        topModelStale: plan?.stale ?? false,
        workspace,
        costUsd: envFlag('CC_HUD_NO_COST') || cost == null || cost <= 0 ? null : cost,
        extra,
    };
    emit(render(renderData));
}
// Whatever went wrong, the bar still gets a line (the bare-model fallback)
// rather than going blank — and never a second one.
const FALLBACK = {
    model: 'Claude', modelVariant: null, contextPercent: null, agents: [],
    fiveHourPercent: null, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null,
    spendLimit: null, extraLimits: [], thinkingDepth: null, topModel: null, topModelStale: false,
    workspace: null, costUsd: null, extra: null,
};
main().catch(() => {
    try {
        emit(render(FALLBACK));
    }
    catch { /* nothing left to do */ }
});
