import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAiSwitch } from './aiFeatures.ts';

describe('createAiSwitch', () => {
  it('allows only the listed features', async () => {
    const enabled = createAiSwitch(async () => ({ data: { ai_features: ['student_card'] }, error: null }));
    assert.equal(await enabled('student_card'), true);
    assert.equal(await enabled('assistant'), false);
  });

  it('an empty list turns everything off', async () => {
    const enabled = createAiSwitch(async () => ({ data: { ai_features: [] }, error: null }));
    assert.equal(await enabled('student_card'), false);
  });

  it('stays on when the config cannot be read', async () => {
    const failing = createAiSwitch(async () => ({ data: null, error: new Error('down') }));
    assert.equal(await failing('vehicle_verify'), true);
    const throwing = createAiSwitch(async () => { throw new Error('down'); });
    assert.equal(await throwing('vehicle_verify'), true);
  });

  it('caches the list for a minute', async () => {
    let reads = 0;
    let clock = 0;
    const enabled = createAiSwitch(async () => { reads++; return { data: { ai_features: ['assistant'] }, error: null }; }, () => clock);
    await enabled('assistant');
    clock = 59_000;
    await enabled('assistant');
    assert.equal(reads, 1);
    clock = 61_000;
    await enabled('assistant');
    assert.equal(reads, 2);
  });
});
