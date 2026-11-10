/**
 * First-use download of the face model: checksum, retries and cleanup. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ChecksumMismatchError, downloadVerified, type VerifiedDownload } from './modelDownload.ts';

const GOOD = 'ab'.repeat(32);

function fakeFile(results: ('ok' | 'bad-hash' | Error)[]) {
  const log: string[] = [];
  let current: 'ok' | 'bad-hash' | Error = 'ok';
  const file: VerifiedDownload = {
    download: async () => {
      current = results.shift() ?? new Error('no more answers');
      log.push('download');
      if (current instanceof Error) throw current;
    },
    sha256: async () => (current === 'ok' ? GOOD.toUpperCase() : 'cd'.repeat(32)),
    commit: () => void log.push('commit'),
    discard: () => void log.push('discard'),
  };
  return { file, log };
}

describe('downloadVerified', () => {
  test('commits the first download whose SHA-256 matches', async () => {
    const { file, log } = fakeFile(['ok']);
    const delays: number[] = [];
    const ok = await downloadVerified(file, { expectedSha256: GOOD, attempts: 3, sleep: async (ms) => void delays.push(ms) });
    assert.equal(ok, true);
    assert.deepEqual(log, ['download', 'commit']);
    assert.deepEqual(delays, []);
  });

  test('never commits a file with the wrong checksum, and retries with backoff', async () => {
    const { file, log } = fakeFile(['bad-hash', new Error('offline'), 'ok']);
    const delays: number[] = [];
    const errors: unknown[] = [];
    const ok = await downloadVerified(file, {
      expectedSha256: GOOD,
      attempts: 3,
      sleep: async (ms) => void delays.push(ms),
      onError: (_attempt, error) => void errors.push(error),
    });
    assert.equal(ok, true);
    assert.deepEqual(log, ['download', 'discard', 'download', 'discard', 'download', 'commit']);
    assert.deepEqual(delays, [1000, 2000]);
    assert.ok(errors[0] instanceof ChecksumMismatchError);
  });

  test('gives up after the last attempt and leaves no temporary file', async () => {
    const { file, log } = fakeFile([new Error('offline'), new Error('offline'), new Error('offline')]);
    const ok = await downloadVerified(file, { expectedSha256: GOOD, attempts: 3, sleep: async () => undefined });
    assert.equal(ok, false);
    assert.equal(log.filter((entry) => entry === 'commit').length, 0);
    assert.equal(log.at(-1), 'discard');
  });
});
