import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortModelName } from '../dist/model.js';

describe('shortModelName', () => {
  it('parses standard model id', () => {
    assert.deepEqual(shortModelName(undefined, 'claude-opus-4-7'), { name: 'Opus 4.7', variant: null });
    assert.deepEqual(shortModelName(undefined, 'claude-sonnet-4-6'), { name: 'Sonnet 4.6', variant: null });
    assert.deepEqual(shortModelName(undefined, 'claude-haiku-4-5'), { name: 'Haiku 4.5', variant: null });
  });

  it('extracts 1M variant separately from name', () => {
    assert.deepEqual(shortModelName(undefined, 'claude-opus-4-7[1m]'), { name: 'Opus 4.7', variant: '1M' });
    assert.deepEqual(shortModelName(undefined, 'claude-opus-4-6[1m]'), { name: 'Opus 4.6', variant: '1M' });
  });

  it('tolerates dated id suffix', () => {
    assert.deepEqual(shortModelName(undefined, 'claude-haiku-4-5-20251001'), { name: 'Haiku 4.5', variant: null });
    assert.deepEqual(
      shortModelName(undefined, 'claude-opus-4-7-20260101[1m]'),
      { name: 'Opus 4.7', variant: '1M' },
    );
  });

  it('prefers id over display_name when both are given', () => {
    // Historical mismatch case: display_name lagged while id was correct
    assert.deepEqual(
      shortModelName('Opus 4', 'claude-opus-4-7'),
      { name: 'Opus 4.7', variant: null },
    );
  });

  it('falls back to display_name when id is missing', () => {
    assert.deepEqual(shortModelName('Opus 4.7 (1M context)'), { name: 'Opus 4.7', variant: null });
    assert.deepEqual(shortModelName('Sonnet'), { name: 'Sonnet', variant: null });
  });

  it('returns "Claude" when both are missing', () => {
    assert.deepEqual(shortModelName(), { name: 'Claude', variant: null });
    assert.deepEqual(shortModelName('', ''), { name: 'Claude', variant: null });
  });

  it('falls back to display_name when id does not match pattern', () => {
    assert.deepEqual(shortModelName('Custom', 'unknown-model-id'), { name: 'Custom', variant: null });
  });
});
