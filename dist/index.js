#!/usr/bin/env node
// Entry point — one statusline tick: stdin JSON → collectors (transcript,
// git, caches) → render() → exactly ONE stdout line, exit 0. Never blocks
// Claude Code: 2 s hard exit, and every failure degrades to a shorter line.
import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render.js';
import { shortModelName } from './model.js';
import { getExtra } from './balance.js';
import { getMmxQuota } from './mmx.js';
import { getGlmBalance } from './glm.js';
import { getClaudePlan } from './claude.js';
import { getWorkspace } from './git.js';
import { readFileSync, writeSync } from 'node:fs';
// Whatever went wrong, the bar still gets a line (the bare-model fallback)
// rather than going blank — and never a second one.
const FALLBACK = {
    model: 'Claude', modelVariant: null, contextPercent: null, agents: [],
    fiveHourPercent: null, sevenDayPercent: null, fiveHourResetsAt: null, sevenDayResetsAt: null,
    quotaStale: false, spendLimit: null, extraLimits: [], thinkingDepth: null, topModel: null, topModelStale: false,
    workspace: null, extra: null,
};
// What the line would be from stdin alone — replaced as soon as stdin is
// parsed, so the hard timeout still prints the model / context / limits when
// a collector hangs.
let partial = FALLBACK;
// Hard timeout — never block Claude Code, never leave the bar blank
const TIMEOUT_MS = 2000;
setTimeout(() => { emit(render(partial)); process.exit(0); }, TIMEOUT_MS).unref();
// Exactly one stdout write per tick — a second line corrupts the status bar.
// Written synchronously: a pipe is async on macOS / Windows and the timeout
// path exits right after.
let printed = false;
function emit(line) {
    if (printed)
        return;
    printed = true;
    try {
        writeSync(1, line + '\n');
    }
    catch {
        console.log(line);
    }
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
// current_usage is null before the first API call, and again after /compact
// until the next API call repopulates it. In those windows show "—" instead
// of collapsing to 0%, which would look like the context just emptied.
// When used_percentage is missing but the token counts and window size are
// there, derive the percentage from them rather than showing —%.
function contextPercent(cw) {
    const cu = cw?.current_usage;
    if (cu === null)
        return null;
    const used = num(cw?.used_percentage);
    if (used != null)
        return Math.round(used);
    const size = num(cw?.context_window_size);
    if (!cu || size == null || size <= 0)
        return null;
    const tokens = [cu.input_tokens, cu.cache_creation_input_tokens, cu.cache_read_input_tokens]
        .map(num)
        .filter((n) => n != null);
    return tokens.length > 0 ? Math.round((tokens.reduce((a, b) => a + b, 0) / size) * 100) : null;
}
// Everything the line can show from stdin alone — no IO.
function fromStdin(data) {
    const size = num(data.context_window?.context_window_size);
    const modelName = shortModelName(data.model?.display_name, data.model?.id);
    const { spend, extras } = splitLimits(data.rate_limits);
    return {
        ...FALLBACK,
        model: modelName.name,
        // `[1m]` id suffix is the explicit signal; context_window_size covers ids
        // that don't carry it (Fable 5.1 on a 1M window reports 1000000 here).
        modelVariant: modelName.variant ?? (size != null && size >= 1_000_000 ? `${Math.round(size / 1_000_000)}M` : null),
        contextPercent: contextPercent(data.context_window),
        fiveHourPercent: num(data.rate_limits?.five_hour?.used_percentage),
        sevenDayPercent: num(data.rate_limits?.seven_day?.used_percentage),
        fiveHourResetsAt: toMs(data.rate_limits?.five_hour?.resets_at),
        sevenDayResetsAt: toMs(data.rate_limits?.seven_day?.resets_at),
        spendLimit: spend,
        extraLimits: extras,
        // stdin `effort.level` is authoritative; the transcript fallback below
        // covers older Claude Code builds that don't send it.
        thinkingDepth: (typeof data.effort?.level === 'string' && data.effort.level) || null,
    };
}
async function main() {
    const data = await readStdin();
    const base = fromStdin(data);
    partial = base;
    // Top-model weekly gauge — no-op for third-party backends. The subscription
    // signal is a rate_limits object with at least one real window: an empty {}
    // must not write the cache placeholder or spawn the refresher.
    const rl = data.rate_limits;
    const hasRateLimits = !!rl && typeof rl === 'object' && !!(rl.five_hour || rl.seven_day || rl.spend_limit);
    // All collectors are independent — run them concurrently. The third-party
    // ones still fetch inline on a cache miss (each ≤ 1.2 s, concurrent — well
    // inside the 2 s hard exit, so a hung endpoint only drops its segment).
    const [{ agents, effort: transcriptEffort }, plan, workspace, extra, mmQuota,] = await Promise.all([
        parseTranscript(data.transcript_path),
        getClaudePlan(hasRateLimits),
        getWorkspace(data.workspace?.current_dir ?? data.cwd, data.worktree?.branch),
        // Extra segment: explicit CC_HUD_EXTRA_FILE > DeepSeek balance > GLM balance
        (async () => {
            const file = readExtraFile();
            if (file)
                return { payload: file, stale: false };
            return (await getExtra()) ?? (await getGlmBalance());
        })(),
        // MiniMax Token Plan quota — no-op for Claude/DeepSeek (returns null)
        getMmxQuota(),
    ]);
    const q = mmQuota?.payload;
    emit(render({
        ...base,
        agents,
        thinkingDepth: base.thinkingDepth ?? transcriptEffort,
        fiveHourPercent: base.fiveHourPercent ?? q?.fiveHourUsedPct ?? null,
        sevenDayPercent: base.sevenDayPercent ?? q?.sevenDayUsedPct ?? null,
        fiveHourResetsAt: base.fiveHourResetsAt ?? q?.fiveHourResetsAt ?? null,
        sevenDayResetsAt: base.sevenDayResetsAt ?? q?.sevenDayResetsAt ?? null,
        quotaStale: mmQuota?.stale ?? false,
        topModel: plan?.topModel ?? null,
        topModelStale: plan?.stale ?? false,
        workspace,
        // A stale (unrefreshable) balance is marked like the stale gauge
        extra: extra ? `${extra.stale ? '~' : ''}${extra.payload}` : null,
    }));
}
main().catch(() => {
    try {
        emit(render(partial));
    }
    catch { /* nothing left to do */ }
});
