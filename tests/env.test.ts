import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { envFlag } from '../dist/env.js';

describe('envFlag', () => {
  const NAME = 'CC_HUD_TEST_FLAG';
  afterEach(() => { delete process.env[NAME]; });

  it('is off when unset', () => {
    assert.equal(envFlag(NAME), false);
  });

  it('is on for the usual truthy spellings', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'anything']) {
      process.env[NAME] = v;
      assert.equal(envFlag(NAME), true, `value ${JSON.stringify(v)}`);
    }
  });

  it('treats "", "0" and "false" as off', () => {
    for (const v of ['', '0', 'false', 'FALSE', ' 0 ', 'False']) {
      process.env[NAME] = v;
      assert.equal(envFlag(NAME), false, `value ${JSON.stringify(v)}`);
    }
  });
});
