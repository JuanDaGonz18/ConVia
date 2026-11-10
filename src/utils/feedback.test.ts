import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  cleanFeedbackText,
  FEEDBACK_MAX_LENGTH,
  feedbackErrorKey,
  feedbackProblems,
  isFeedbackCategory,
} from './feedback.ts';

describe('feedback rules', () => {
  test('only the four known categories are accepted', () => {
    for (const ok of ['bug', 'suggestion', 'safety', 'other']) assert.equal(isFeedbackCategory(ok), true, ok);
    for (const bad of ['', 'BUG', 'spam', null, undefined, 3]) assert.equal(isFeedbackCategory(bad), false, String(bad));
  });

  test('a valid report has no problems', () => {
    assert.deepEqual(feedbackProblems('bug', 'La app se cierra al abrir el mapa.'), []);
  });

  test('missing category and short text are reported together', () => {
    assert.deepEqual(feedbackProblems(null, 'corto'), ['category', 'tooShort']);
  });

  test('length is measured after trimming and collapsing blank lines', () => {
    assert.deepEqual(feedbackProblems('other', '          a         '), ['tooShort']);
    assert.equal(cleanFeedbackText('  uno\r\n\r\n\r\n\r\ndos  '), 'uno\n\ndos');
  });

  test('the maximum length is inclusive', () => {
    assert.deepEqual(feedbackProblems('other', 'x'.repeat(FEEDBACK_MAX_LENGTH)), []);
    assert.deepEqual(feedbackProblems('other', 'x'.repeat(FEEDBACK_MAX_LENGTH + 1)), ['tooLong']);
  });

  test('server error codes map to user-facing keys', () => {
    assert.equal(feedbackErrorKey('FEEDBACK_RATE_LIMIT'), 'rateLimit');
    assert.equal(feedbackErrorKey('FEEDBACK_TOO_SHORT'), 'invalid');
    assert.equal(feedbackErrorKey('AUTH_REQUIRED'), 'auth');
    assert.equal(feedbackErrorKey('FEEDBACK_UPLOAD_FAILED'), 'upload');
    assert.equal(feedbackErrorKey('FEEDBACK_SCREENSHOT_INVALID'), 'upload');
    assert.equal(feedbackErrorKey('boom'), null);
  });
});
