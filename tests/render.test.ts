import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/render.js';
import type { RenderData } from '../dist/types.js';

// Strip ANSI escape codes for content assertions
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function makeData(overrides: Partial<RenderData> = {}): RenderData {
  return {
    model: 'Opus',
    contextPercent: 0,
    agents: [],
    fiveHourPercent: null,
    sevenDayPercent: null,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null,
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
});
