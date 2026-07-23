import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/render.js';
import type { RenderData } from '../dist/types.js';

// Strip ANSI escape codes for content assertions
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function makeData(overrides: Partial<RenderData> = {}): RenderData {
  return {
    model: 'Opus',
    modelVariant: null,
    contextPercent: 0,
    agents: [],
    fiveHourPercent: null,
    sevenDayPercent: null,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null,
    planTier: null,
    topModel: null,
    extra: null,
    ...overrides,
  };
}

describe('render', () => {
  it('shows model name and 0% bar with no data', () => {
    const out = strip(render(makeData()));
    assert.match(out, /\[Opus\]/);
    assert.match(out, /0%/);
  });

  it('shows correct percentage', () => {
    const out = strip(render(makeData({ contextPercent: 45 })));
    assert.match(out, /45%/);
  });

  it('clamps percentage to 0-100', () => {
    const outLow = strip(render(makeData({ contextPercent: -5 })));
    assert.match(outLow, /0%/);
    const outHigh = strip(render(makeData({ contextPercent: 150 })));
    assert.match(outHigh, /100%/);
  });

  it('shows model variant after context percentage', () => {
    const out = strip(render(makeData({ contextPercent: 5, modelVariant: '1M' })));
    assert.match(out, /\[Opus\].*5%\s+\(1M\)/);
  });

  it('omits variant parens when modelVariant is null', () => {
    const out = strip(render(makeData({ contextPercent: 5 })));
    assert.ok(!out.includes('(1M)'));
  });

  it('shows rate limits when provided', () => {
    const out = strip(render(makeData({ fiveHourPercent: 25, sevenDayPercent: 10 })));
    assert.match(out, /5h:.*25%.*│.*7d:.*10%/);
  });

  it('omits rate limits when null', () => {
    const out = strip(render(makeData()));
    assert.ok(!out.includes('5h:'));
    assert.ok(!out.includes('7d:'));
  });

  it('shows only 5h when 7d is null', () => {
    const out = strip(render(makeData({ fiveHourPercent: 50 })));
    assert.match(out, /5h:.*50%/);
    assert.ok(!out.includes('7d:'));
  });

  it('shows agent segment when agents exist', () => {
    const out = strip(render(makeData({
      agents: [{ id: '1', type: 'explore', model: 'haiku', status: 'running' }],
    })));
    assert.match(out, /◐/);
    assert.match(out, /explore/);
    assert.match(out, /\[haiku\]/);
  });

  it('limits agents to 3', () => {
    const agents = Array.from({ length: 5 }, (_, i) => ({
      id: String(i), type: `agent${i}`, status: 'running' as const,
    }));
    const out = strip(render(makeData({ agents })));
    assert.ok(out.includes('agent0'));
    assert.ok(out.includes('agent2'));
    assert.ok(!out.includes('agent3'));
  });

  it('uses separator between segments', () => {
    const out = strip(render(makeData({ fiveHourPercent: 20 })));
    assert.ok(out.includes('│'));
  });

  it('contains ANSI color codes in raw output', () => {
    const raw = render(makeData({ contextPercent: 90 }));
    assert.match(raw, /\x1b\[38;5;211m/); // RED for 90%
  });

  it('uses green for low usage', () => {
    const raw = render(makeData({ contextPercent: 30 }));
    assert.match(raw, /\x1b\[38;5;151m/); // GREEN
  });

  it('uses yellow for medium usage', () => {
    const raw = render(makeData({ contextPercent: 60 }));
    assert.match(raw, /\x1b\[38;5;223m/); // YELLOW
  });

  it('uses peach for high usage', () => {
    const raw = render(makeData({ contextPercent: 80 }));
    assert.match(raw, /\x1b\[38;5;216m/); // PEACH
  });

  it('shows countdown in hours when resets_at is provided', () => {
    const resetsAt = Date.now() + 1.9 * 3_600_000; // 1.9h from now
    const out = strip(render(makeData({
      fiveHourPercent: 3,
      fiveHourResetsAt: resetsAt,
    })));
    assert.match(out, /5h:3% \(1\.9h\)/);
  });

  it('shows countdown in days for 7d window', () => {
    const resetsAt = Date.now() + 2.3 * 86_400_000; // 2.3d from now
    const out = strip(render(makeData({
      sevenDayPercent: 90,
      sevenDayResetsAt: resetsAt,
    })));
    assert.match(out, /7d:90% \(2\.3d\)/);
  });

  it('shows countdown in minutes when less than 1 hour', () => {
    const resetsAt = Date.now() + 47 * 60_000; // 47m from now
    const out = strip(render(makeData({
      fiveHourPercent: 80,
      fiveHourResetsAt: resetsAt,
    })));
    assert.match(out, /5h:80% \(47m\)/);
  });

  it('omits countdown when resets_at is null', () => {
    const out = strip(render(makeData({ fiveHourPercent: 25 })));
    assert.match(out, /5h:\s*25%/);
    assert.ok(!out.includes('('));
  });

  it('omits countdown when resets_at is in the past', () => {
    const resetsAt = Date.now() - 60_000; // 1m ago
    const out = strip(render(makeData({
      fiveHourPercent: 25,
      fiveHourResetsAt: resetsAt,
    })));
    assert.ok(!out.includes('('));
  });

  it('shows extra segment when provided', () => {
    const out = strip(render(makeData({ extra: '¥3.77' })));
    assert.match(out, /¥3\.77/);
  });

  it('omits extra segment when null', () => {
    const out = strip(render(makeData({ extra: null })));
    assert.ok(!out.includes('¥'));
  });

  it('shows extra segment alongside rate limits', () => {
    const out = strip(render(makeData({
      fiveHourPercent: 50,
      extra: '¥3.77',
    })));
    assert.match(out, /5h:.*50%/);
    assert.match(out, /¥3\.77/);
  });

  it('renders DeepSeek model name', () => {
    const out = strip(render(makeData({ model: 'DeepSeek V4 Pro' })));
    assert.match(out, /\[DeepSeek V4 Pro\]/);
  });

  it('shows plan tier inside model brackets', () => {
    const out = strip(render(makeData({ planTier: 'Max5x' })));
    assert.match(out, /\[Opus · Max5x\]/);
  });

  it('omits tier dot when planTier is null', () => {
    const out = strip(render(makeData()));
    assert.match(out, /\[Opus\]/);
    assert.ok(!out.includes('·'));
  });

  it('shows top-model gauge after 7d', () => {
    const out = strip(render(makeData({
      fiveHourPercent: 1,
      sevenDayPercent: 35,
      topModel: { name: 'Fable', percent: 46, resetsAt: null },
    })));
    assert.match(out, /5h:1%.*│.*7d:35%.*│.*Fable:46%/);
  });

  it('shows top-model gauge alone when 5h/7d are null', () => {
    const out = strip(render(makeData({
      topModel: { name: 'Opus', percent: 80, resetsAt: null },
    })));
    assert.match(out, /Opus:80%/);
  });

  it('suppresses top-model countdown when it matches the 7d reset', () => {
    const resetsAt = Date.now() + 2.5 * 86_400_000;
    const out = strip(render(makeData({
      sevenDayPercent: 35,
      sevenDayResetsAt: resetsAt,
      topModel: { name: 'Fable', percent: 46, resetsAt: resetsAt + 500 },
    })));
    assert.match(out, /7d:35% \(2\.5d\)/);
    assert.match(out, /Fable:46%(?! \()/);
  });

  it('shows top-model countdown when it differs from the 7d reset', () => {
    const now = Date.now();
    const out = strip(render(makeData({
      sevenDayPercent: 35,
      sevenDayResetsAt: now + 2 * 86_400_000,
      topModel: { name: 'Fable', percent: 46, resetsAt: now + 4 * 86_400_000 },
    })));
    assert.match(out, /Fable:46% \(4d\)/);
  });

  it('colors top-model gauge by usage threshold', () => {
    const raw = render(makeData({ topModel: { name: 'Fable', percent: 90, resetsAt: null } }));
    assert.match(raw, /\x1b\[38;5;211m/); // RED for 90%
  });

  it('shows em-dash when contextPercent is null (no current_usage yet)', () => {
    const out = strip(render(makeData({ contextPercent: null })));
    assert.match(out, /—%/);
    assert.ok(!out.includes('0%'));
  });

  it('null contextPercent renders an empty track, not a filled bar', () => {
    const raw = render(makeData({ contextPercent: null }));
    assert.ok(!raw.includes('█'));
  });
});
