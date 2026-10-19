// — Catppuccin Mocha palette (ANSI 256) —
const RESET = '\x1b[0m';
const fg = (n) => `\x1b[38;5;${n}m`;
const GREEN = fg(151); // #a6e3a1 — ok
const YELLOW = fg(223); // #f9e2af — caution
const PEACH = fg(216); // #fab387 — warning
const RED = fg(211); // #f38ba8 — critical
const TEAL = fg(115); // #94e2d5 — agent accent
const BLUE = fg(111); // #89b4fa — info accent
const SAPPHIRE = fg(117); // #74c7ec — countdown: plenty
const LAVENDER = fg(147); // #b4befe — countdown: moderate
const FLAMINGO = fg(224); // #f2cdcd — countdown: attention
const MAROON = fg(217); // #eba0ac — countdown: urgent
const OVERLAY = fg(243); // #6c7086 — dim/separator
const SURFACE = fg(238); // #313244 — bar track
const TEXT = fg(189); // #cdd6f4 — primary text
// — Bar config —
const BAR_WIDTH = 10;
const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const TRACK_CHAR = '░';
// Free-text fields (model / effort / branch / folder / agent type …) come from
// stdin, the transcript, git and third-party APIs: strip control characters
// so a stray newline or escape sequence can't break the single status line.
const clean = (s) => s.replace(/[\x00-\x1f\x7f]/g, '');
function color(percent) {
    if (percent <= 50)
        return GREEN;
    if (percent <= 70)
        return YELLOW;
    if (percent <= 85)
        return PEACH;
    return RED;
}
// Reasoning effort ("思考深度") — capitalize the raw level for display.
const EFFORT_LABELS = {
    low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max',
};
function effortLabel(raw) {
    const level = clean(raw);
    return EFFORT_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);
}
function progressBar(percent) {
    // null = current_usage not yet populated (start of session or just after /compact)
    // — render an empty track + dim em-dash so it doesn't look like context reset.
    if (percent === null || !Number.isFinite(percent)) {
        return `${SURFACE}${TRACK_CHAR.repeat(BAR_WIDTH)}${RESET} ${OVERLAY}—%${RESET}`;
    }
    const clamped = Math.max(0, Math.min(100, percent));
    const total = (clamped / 100) * BAR_WIDTH;
    const full = Math.floor(total);
    const frac = Math.round((total - full) * 8);
    const empty = BAR_WIDTH - full - (frac > 0 ? 1 : 0);
    const c = color(clamped);
    const bar = c + '█'.repeat(full) +
        (frac > 0 ? BLOCKS[frac] : '') +
        RESET + SURFACE +
        TRACK_CHAR.repeat(Math.max(0, empty)) +
        RESET;
    return `${bar} ${c}${clamped}%${RESET}`;
}
function countdownColor(ms) {
    const hours = ms / 3_600_000;
    if (hours >= 24)
        return SAPPHIRE;
    if (hours >= 3)
        return LAVENDER;
    if (hours >= 0.5)
        return FLAMINGO;
    return MAROON;
}
function formatCountdown(resetsAt) {
    if (resetsAt == null)
        return null;
    const ms = resetsAt - Date.now();
    if (ms <= 0)
        return null;
    const minutes = ms / 60_000;
    const c = countdownColor(ms);
    if (minutes < 60)
        return { text: `${Math.round(minutes)}m`, color: c };
    const hours = ms / 3_600_000;
    const fmtNum = (n) => { const r = n.toFixed(1); return r.endsWith('.0') ? r.slice(0, -2) : r; };
    if (hours < 24)
        return { text: `${fmtNum(hours)}h`, color: c };
    const days = ms / 86_400_000;
    return { text: `${fmtNum(days)}d`, color: c };
}
function countdownSuffix(resetsAt) {
    const cd = formatCountdown(resetsAt);
    return cd ? ` ${OVERLAY}(${RESET}${cd.color}${cd.text}${RESET}${OVERLAY})${RESET}` : '';
}
function rateSegment(label, percent, resetsAt) {
    if (percent == null || !Number.isFinite(percent))
        return null;
    const clamped = Math.round(Math.max(0, Math.min(100, percent)));
    const c = color(clamped);
    return `${OVERLAY}${clean(label)}:${RESET}${c}${clamped}%${RESET}${countdownSuffix(resetsAt)}`;
}
// Gateway spend cap: `$12/$50` when the dollar figures are present, else the
// bare percentage. Colored by percent, which may exceed 100 (overage).
function spendSegment(s) {
    if (!s)
        return null;
    const pct = Math.round(Math.max(0, s.percent));
    const c = color(Math.min(100, pct));
    const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    const body = s.usedUsd != null && s.limitUsd != null
        ? `$${fmt(s.usedUsd)}${OVERLAY}/${RESET}${c}$${fmt(s.limitUsd)}`
        : `${pct}%`;
    return `${OVERLAY}spend:${RESET}${c}${body}${RESET}${countdownSuffix(s.resetsAt)}`;
}
function agentSegment(agents) {
    if (agents.length === 0)
        return null;
    const parts = agents.slice(0, 3).map(a => {
        const model = a.model ? ` ${OVERLAY}[${clean(a.model)}]${RESET}` : '';
        return `${TEAL}◐${RESET} ${TEXT}${clean(a.type)}${RESET}${model}`;
    });
    return parts.join(' ');
}
// The top-model gauge usually resets together with the 7d window —
// suppress its countdown then, so the same time isn't printed twice.
function sameReset(a, b) {
    return a != null && b != null && Math.abs(a - b) < 60_000;
}
export function render(data) {
    const segments = [];
    // Model + context bar (variant suffix lives here — it describes context capacity)
    const variant = data.modelVariant ? ` ${OVERLAY}(${data.modelVariant})${RESET}` : '';
    const depth = data.thinkingDepth ? ` ${OVERLAY}· ${effortLabel(data.thinkingDepth)}${RESET}` : '';
    segments.push(`${OVERLAY}[${RESET}${BLUE}${clean(data.model)}${RESET}${depth}${OVERLAY}]${RESET} ${progressBar(data.contextPercent)}${variant}`);
    // Agents (if any)
    const agentStr = agentSegment(data.agents);
    if (agentStr)
        segments.push(agentStr);
    // Rate limits: 5h │ 7d │ top-model weekly gauge
    // A stale gauge (no successful refresh for 30 min) is prefixed with ~ so
    // "couldn't fetch" never reads as "fresh".
    const rTop = data.topModel
        ? rateSegment(`${data.topModelStale ? '~' : ''}${clean(data.topModel.name)}`, data.topModel.percent, sameReset(data.topModel.resetsAt, data.sevenDayResetsAt) ? null : data.topModel.resetsAt)
        : null;
    const rates = [
        rateSegment('5h', data.fiveHourPercent, data.fiveHourResetsAt),
        rateSegment('7d', data.sevenDayPercent, data.sevenDayResetsAt),
        rTop,
        spendSegment(data.spendLimit),
        ...data.extraLimits.map(l => rateSegment(l.label, l.percent, l.resetsAt)),
    ].filter((s) => s !== null);
    if (rates.length > 0) {
        segments.push(rates.join(` ${OVERLAY}│${RESET} `));
    }
    // Workspace: folder · branch (dirty tree marked with *, unknown status with ?)
    if (data.workspace) {
        const w = data.workspace;
        const mark = w.dirty ? '*' : w.dirty === null ? `${OVERLAY}?` : '';
        const branch = w.branch ? `${OVERLAY} · ${RESET}${GREEN}${clean(w.branch)}${mark}${RESET}` : '';
        segments.push(`${SAPPHIRE}${clean(w.name)}${RESET}${branch}`);
    }
    // Extra (generic pluggable segment, e.g. balance for non-Anthropic backends)
    if (data.extra) {
        segments.push(`${TEAL}${clean(data.extra)}${RESET}`);
    }
    // Session cost (client-side list-price estimate from stdin `cost`)
    if (data.costUsd != null) {
        segments.push(`${OVERLAY}$${data.costUsd.toFixed(2)}${RESET}`);
    }
    return segments.join(` ${OVERLAY}│${RESET} `);
}
