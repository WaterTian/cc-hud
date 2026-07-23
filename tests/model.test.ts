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

  it('parses single-version model ids (Claude 5 family)', () => {
    assert.deepEqual(shortModelName(undefined, 'claude-fable-5'), { name: 'Fable 5', variant: null });
    assert.deepEqual(shortModelName(undefined, 'claude-fable-5[1m]'), { name: 'Fable 5', variant: '1M' });
    assert.deepEqual(shortModelName('Fable', 'claude-fable-5'), { name: 'Fable 5', variant: null });
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

  it('beautifies DeepSeek model ids', () => {
    assert.deepEqual(shortModelName(undefined, 'deepseek-v4-pro'), { name: 'DeepSeek V4 Pro', variant: null });
    assert.deepEqual(shortModelName(undefined, 'deepseek-v4-flash'), { name: 'DeepSeek V4 Flash', variant: null });
    assert.deepEqual(shortModelName(undefined, 'deepseek-v4-pro[1m]'), { name: 'DeepSeek V4 Pro', variant: '1M' });
  });

  it('beautifies MiniMax M3 model id', () => {
    assert.deepEqual(shortModelName(undefined, 'MiniMax-M3'), { name: 'MiniMax M3', variant: null });
  });

  it('extracts MiniMax 1M variant suffix', () => {
    assert.deepEqual(shortModelName(undefined, 'MiniMax-M3[1m]'), { name: 'MiniMax M3', variant: '1M' });
  });

  it('beautifies MiniMax-Text-01 model id', () => {
    assert.deepEqual(shortModelName(undefined, 'MiniMax-Text-01'), { name: 'MiniMax Text 01', variant: null });
  });

  it('beautifies legacy ABAB model ids', () => {
    assert.deepEqual(shortModelName(undefined, 'abab-6.5s-chat'), { name: 'ABAB 6.5s Chat', variant: null });
    assert.deepEqual(shortModelName(undefined, 'abab-7-chat'), { name: 'ABAB 7 Chat', variant: null });
  });

  it('returns family only when MiniMax id has no sub-model', () => {
    assert.deepEqual(shortModelName(undefined, 'MiniMax'), { name: 'MiniMax', variant: null });
  });

  it('beautifies GLM-5.2 model id', () => {
    assert.deepEqual(shortModelName(undefined, 'glm-5.2'), { name: 'GLM 5.2', variant: null });
  });

  it('extracts GLM 1M variant suffix', () => {
    assert.deepEqual(shortModelName(undefined, 'glm-5.2[1m]'), { name: 'GLM 5.2', variant: '1M' });
  });

  it('beautifies GLM-5-Turbo model id', () => {
    assert.deepEqual(shortModelName(undefined, 'glm-5-turbo'), { name: 'GLM 5 Turbo', variant: null });
  });

  it('beautifies GLM-4.7 model id', () => {
    assert.deepEqual(shortModelName(undefined, 'glm-4.7'), { name: 'GLM 4.7', variant: null });
  });

  it('beautifies GLM-4.5-Air model id', () => {
    assert.deepEqual(shortModelName(undefined, 'glm-4.5-air'), { name: 'GLM 4.5 Air', variant: null });
  });

  it('beautifies GLM-4 legacy id', () => {
    assert.deepEqual(shortModelName(undefined, 'glm-4'), { name: 'GLM 4', variant: null });
  });

  it('beautifies legacy ChatGLM model ids', () => {
    assert.deepEqual(shortModelName(undefined, 'chatglm_turbo'), { name: 'ChatGLM Turbo', variant: null });
  });

  it('parses GLM model from display_name when id is missing', () => {
    // Some backends only send display_name, not id
    assert.deepEqual(shortModelName('glm-5.2[1m]'), { name: 'GLM 5.2', variant: '1M' });
    assert.deepEqual(shortModelName('glm-5-turbo'), { name: 'GLM 5 Turbo', variant: null });
  });
});
