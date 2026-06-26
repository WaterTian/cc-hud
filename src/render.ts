import type { RenderData } from './types.js';

// — Catppuccin Mocha palette (ANSI 256) —
const RESET = '\x1b[0m';
const fg = (n: number) => `\x1b[38;5;${n}m`;

const GREEN  = fg(151);  // #a6e3a1 — ok
const YELLOW = fg(223);  // #f9e2af — caution
const PEACH  = fg(216);  // #fab387 — warning
const RED    = fg(211);  // #f38ba8 — critical
const TEAL   = fg(115);  // #94e2d5 — agent accent
const BLUE   = fg(111);  // #89b4fa — info accent
const SAPPHIRE  = fg(117); // #74c7ec — countdown: plenty
const LAVENDER  = fg(147); // #b4befe — countdown: moderate
const FLAMINGO  = fg(224); // #f2cdcd — countdown: attention
const MAROON    = fg(217); // #eba0ac — countdown: urgent
const OVERLAY = fg(243); // #6c7086 — dim/separator
const SURFACE = fg(238); // #313244 — bar track
const TEXT   = fg(189);  // #cdd6f4 — primary text

// — Bar config —
const BAR_WIDTH = 10;
const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const TRACK_CHAR = '░';

function color(percent: number): string {
  if (percent <= 50) return GREEN;
  if (percent <= 70) return YELLOW;
  if (percent <= 85) return PEACH;
  return RED;
}

function progressBar(percent: number | null): string {
  // null = current_usage not yet populated (start of session or just after /compact)
  // — render an empty track + dim em-dash so it doesn't look like context reset.
  if (percent === null) {
    return `${SURFACE}${TRACK_CHAR.repeat(BAR_WIDTH)}${RESET} ${OVERLAY}—%${RESET}`;
  }

  const clamped = Math.max(0, Math.min(100, percent));
  const total = (clamped / 100) * BAR_WIDTH;
  const full = Math.floor(total);
  const frac = Math.round((total - full) * 8);
  const empty = BAR_WIDTH - full - (frac > 0 ? 1 : 0);

  const c = color(clamped);
  const bar =
    c + '█'.repeat(full) +
    (frac > 0 ? BLOCKS[frac] : '') +
    RESET + SURFACE +
    TRACK_CHAR.repeat(Math.max(0, empty)) +
    RESET;

  return `${bar} ${c}${clamped}%${RESET}`;
}

function countdownColor(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 24) return SAPPHIRE;
  if (hours >= 3)  return LAVENDER;
  if (hours >= 0.5) return FLAMINGO;
  return MAROON;
}

function formatCountdown(resetsAt: number | null): { text: string; color: string } | null {
  if (resetsAt == null) return null;
  const ms = resetsAt - Date.now();
  if (ms <= 0) return null;
  const minutes = ms / 60_000;
  const c = countdownColor(ms);
  if (minutes < 60) return { text: `${Math.round(minutes)}m`, color: c };
  const hours = ms / 3_600_000;
  const fmtNum = (n: number) => { const r = n.toFixed(1); return r.endsWith('.0') ? r.slice(0, -2) : r; };
  if (hours < 24) return { text: `${fmtNum(hours)}h`, color: c };
  const days = ms / 86_400_000;
  return { text: `${fmtNum(days)}d`, color: c };
}

function rateSegment(label: string, percent: number | null, resetsAt: number | null): string | null {
  if (percent == null) return null;
  const clamped = Math.round(Math.max(0, Math.min(100, percent)));
  const c = color(clamped);
  const cd = formatCountdown(resetsAt);
  const suffix = cd ? ` ${OVERLAY}(${RESET}${cd.color}${cd.text}${RESET}${OVERLAY})${RESET}` : '';
  return `${OVERLAY}${label}:${RESET}${c}${clamped}%${RESET}${suffix}`;
}

function agentSegment(agents: RenderData['agents']): string | null {
  if (agents.length === 0) return null;
  const parts = agents.slice(0, 3).map(a => {
    const model = a.model ? ` ${OVERLAY}[${a.model}]${RESET}` : '';
    return `${TEAL}◐${RESET} ${TEXT}${a.type}${RESET}${model}`;
  });
  return parts.join(' ');
}

export function render(data: RenderData): string {
  const segments: string[] = [];

  // Model + context bar (variant suffix lives here — it describes context capacity)
  const variant = data.modelVariant ? ` ${OVERLAY}(${data.modelVariant})${RESET}` : '';
  segments.push(`${OVERLAY}[${RESET}${BLUE}${data.model}${RESET}${OVERLAY}]${RESET} ${progressBar(data.contextPercent)}${variant}`);

  // Agents (if any)
  const agentStr = agentSegment(data.agents);
  if (agentStr) segments.push(agentStr);

  // Rate limits & quotas (up to three segments: 5h/滚动, 7d/每周, 月)
  const r5 = rateSegment('5h', data.fiveHourPercent, data.fiveHourResetsAt);
  const r7 = rateSegment('7d', data.sevenDayPercent, data.sevenDayResetsAt);
  const rm = rateSegment('月', data.monthlyPercent, data.monthlyResetsAt);

  const rateParts = [r5, r7, rm].filter((s): s is string => s !== null);
  if (rateParts.length > 0) {
    segments.push(rateParts.join(` ${OVERLAY}│${RESET} `));
  }

  // Extra (generic pluggable segment, e.g. balance for non-Anthropic backends)
  if (data.extra) {
    segments.push(`${TEAL}${data.extra}${RESET}`);
  }

  return segments.join(` ${OVERLAY}│${RESET} `);
}
