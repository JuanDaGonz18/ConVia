import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { closeFeedback, formatErrors, formatFeedback, listFeedback, resolveFeedbackId } from './monitoring-core.mjs';

// A tiny stand-in for the Supabase query builder: records the calls and returns `result`.
function fakeAdmin(tables) {
  const calls = [];
  const builder = (table) => {
    const state = { table, ops: [] };
    const chain = {
      select: (...a) => (state.ops.push(['select', ...a]), chain),
      update: (...a) => (state.ops.push(['update', ...a]), chain),
      eq: (...a) => (state.ops.push(['eq', ...a]), chain),
      in: (...a) => (state.ops.push(['in', ...a]), chain),
      order: (...a) => (state.ops.push(['order', ...a]), chain),
      limit: (...a) => (state.ops.push(['limit', ...a]), chain),
      then: (resolve) => { calls.push(state); resolve({ data: tables[table](state), error: null }); },
    };
    return chain;
  };
  return { calls, from: builder };
}

const ROW = {
  id: '0c9d7e1a-2b3c-4d5e-8f90-aaaaaaaaaaaa', user_id: 'u1', category: 'bug', description: 'El mapa no carga\nen el inicio', screenshot_path: 'u1/x.jpg',
  app_version: '1.4.0', platform: 'android', status: 'nuevo', team_note: null, created_at: '2026-11-10T13:05:00Z',
};

describe('feedback', () => {
  test('open reports (nuevo, en_revision), safety first, oldest first, with the reporter', async () => {
    const safety = { ...ROW, id: '1c9d7e1a-0000-4000-8000-000000000000', category: 'safety', created_at: '2026-11-10T14:00:00Z' };
    const admin = fakeAdmin({ feedback_reports: () => [ROW, safety], profiles: () => [{ id: 'u1', nombre: 'Ana', email: 'ana@x.co' }] });
    const rows = await listFeedback(admin);
    assert.deepEqual(rows.map((row) => row.category), ['safety', 'bug']);
    assert.equal(rows[0].profile.nombre, 'Ana');
    const ops = admin.calls[0].ops;
    assert.deepEqual(ops.find((op) => op[0] === 'in'), ['in', 'status', ['nuevo', 'en_revision']]);
    assert.deepEqual(ops.find((op) => op[0] === 'order'), ['order', 'created_at']);
  });

  test('close marks it resuelto (or descartado) with the team note', async () => {
    const admin = fakeAdmin({ feedback_reports: () => [{ id: ROW.id }] });
    await closeFeedback(admin, ROW.id, 'arreglado en 1.4.1');
    const update = admin.calls[0].ops.find((op) => op[0] === 'update')[1];
    assert.deepEqual(update, { status: 'resuelto', team_note: 'arreglado en 1.4.1' });
    await closeFeedback(admin, ROW.id, null, 'descartado');
    assert.deepEqual(admin.calls[1].ops.find((op) => op[0] === 'update')[1], { status: 'descartado' });
    await assert.rejects(closeFeedback(admin, ROW.id, null, 'nuevo'), /resuelto or descartado/);
    await assert.rejects(closeFeedback(fakeAdmin({ feedback_reports: () => [] }), ROW.id), /No report/);
  });

  test('an 8-character prefix resolves to the report; ambiguous or bad ids are refused', async () => {
    const admin = fakeAdmin({ feedback_reports: () => [{ id: ROW.id }, { id: '0c9d7e1b-0000-4000-8000-000000000000' }] });
    assert.equal(await resolveFeedbackId(admin, '0c9d7e1a'), ROW.id);
    await assert.rejects(resolveFeedbackId(admin, '0c9d7e'), /matches 2/);
    await assert.rejects(resolveFeedbackId(admin, 'zz'), /report id/);
  });

  test('format shows id, category, reporter, version, multi-line text and screenshot link', () => {
    const text = formatFeedback({ ...ROW, profile: { nombre: 'Ana', email: 'ana@x.co' } }, 'https://signed');
    assert.match(text, /0c9d7e1a · bug · nuevo · 2026-11-10 13:05 UTC/);
    assert.match(formatFeedback({ ...ROW, category: 'safety', profile: null }), /· SAFETY ·/);
    assert.match(text, /From: {5}Ana <ana@x.co>/);
    assert.match(text, /App: {6}1\.4\.0 · android/);
    assert.match(text, /Message: {2}El mapa no carga\n {10}en el inicio/);
    assert.match(text, /Screenshot \(5 min\): https:\/\/signed/);
    assert.match(formatFeedback({ ...ROW, profile: null }, null), /Screenshot: \(no longer available\)/);
  });
});

describe('errors', () => {
  test('format lists count, users, fatal, screens and a few stack lines', () => {
    const text = formatErrors([{
      message: 'TypeError: x is undefined', occurrences: 12, users: 4, fatal: 2, screens: ['(tabs)/index'], platforms: ['android', 'ios'],
      versions: ['1.4.0'], first_seen: '2026-11-04T00:00:00Z', last_seen: '2026-11-10T08:00:00Z', sample_stack: 'a\nb\nc\nd\ne',
    }], 7);
    assert.match(text, /Top errors, last 7 days \(1\)/);
    assert.match(text, / 1\. 12× · 4 user\(s\) · 2 fatal/);
    assert.match(text, /screens: \(tabs\)\/index · android\/ios · versions: 1\.4\.0/);
    assert.doesNotMatch(text, /^ {6}e$/m);
    assert.equal(formatErrors([], 7), 'No errors in the last 7 days.');
  });
});
