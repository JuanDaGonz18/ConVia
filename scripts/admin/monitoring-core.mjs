// Used by feedback-cli.mjs and errors-cli.mjs (service_role only): "Report a problem" reports
// (feedback_reports, migrations 044 and 045) and the app's error reports (client_errors, migration 045). The formatting helpers are pure so they can be tested without a project.
import { check } from './review-core.mjs';

const FEEDBACK_BUCKET = 'feedback';
const COLUMNS = 'id, user_id, category, description, screenshot_path, app_version, platform, status, team_note, created_at';
/** Still to handle; resuelto and descartado are closed. */
export const OPEN_STATUSES = ['nuevo', 'en_revision'];
export const CLOSE_STATUSES = ['resuelto', 'descartado'];

/** Open reports, safety first and then oldest first; `all` lists every report, newest first. */
export async function listFeedback(admin, { all = false, limit = 50 } = {}) {
  let query = admin.from('feedback_reports').select(COLUMNS).limit(limit);
  query = all ? query.order('created_at', { ascending: false }) : query.in('status', OPEN_STATUSES).order('created_at');
  const rows = check(await query);
  const ids = [...new Set(rows.map((row) => row.user_id))];
  const profiles = ids.length ? check(await admin.from('profiles').select('id, nombre, email').in('id', ids)) : [];
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const out = rows.map((row) => ({ ...row, profile: byId.get(row.user_id) ?? null }));
  return all ? out : [...out.filter((row) => row.category === 'safety'), ...out.filter((row) => row.category !== 'safety')];
}

/** A 5-minute link to the screenshot, or null (none, or already deleted after 30 days). */
export async function screenshotUrl(admin, path, seconds = 300) {
  if (!path) return null;
  const { data, error } = await admin.storage.from(FEEDBACK_BUCKET).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

/** Accepts the full id or a unique prefix of at least 6 characters (what the list prints). */
export async function resolveFeedbackId(admin, idOrPrefix) {
  const value = String(idOrPrefix ?? '').trim().toLowerCase();
  if (!/^[0-9a-f-]{6,36}$/.test(value)) throw new Error('Give the report id (or its first 8 characters).');
  if (value.length === 36) return value;
  const rows = check(await admin.from('feedback_reports').select('id').order('created_at', { ascending: false }).limit(1000));
  const matches = rows.filter((row) => row.id.startsWith(value));
  if (matches.length !== 1) throw new Error(matches.length ? `"${value}" matches ${matches.length} reports; give more characters.` : `No report starts with "${value}".`);
  return matches[0].id;
}

/** status: resuelto (default) or descartado; the note is for the team only (the app never shows it). */
export async function closeFeedback(admin, id, note = null, status = 'resuelto') {
  if (!CLOSE_STATUSES.includes(status)) throw new Error(`Status must be ${CLOSE_STATUSES.join(' or ')}.`);
  const patch = { status };
  if (note) patch.team_note = String(note).slice(0, 1000);
  const rows = check(await admin.from('feedback_reports').update(patch).eq('id', id).select('id'));
  if (!rows.length) throw new Error(`No report ${id}.`);
  return rows[0].id;
}

export async function countOpenFeedback(admin) {
  const { count, error } = await admin.from('feedback_reports').select('id', { count: 'exact', head: true }).in('status', OPEN_STATUSES);
  if (error) throw error;
  return count;
}

export async function topErrors(admin, { days = 7, limit = 20 } = {}) {
  return check(await admin.rpc('service_top_client_errors', { p_days: days, p_limit: limit }));
}

// ─── Formatting ────────────────────────────────────────────────────────────

const when = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16);

export function formatFeedback(row, url = null) {
  const who = row.profile ? `${row.profile.nombre || '(no name)'} <${row.profile.email ?? '?'}>` : row.user_id;
  const lines = [
    `── ${row.id.slice(0, 8)} · ${row.category === 'safety' ? 'SAFETY' : row.category} · ${row.status} · ${when(row.created_at)} UTC ─────────────`,
    `From:     ${who}`,
    `App:      ${row.app_version ?? '?'} · ${row.platform ?? '?'}`,
    ...row.description.split('\n').map((line, i) => `${i ? '          ' : 'Message:  '}${line}`),
  ];
  if (row.screenshot_path) lines.push(url ? `Screenshot (5 min): ${url}` : 'Screenshot: (no longer available)');
  if (row.team_note) lines.push(`Note:     ${row.team_note}`);
  return lines.join('\n');
}

export function formatErrors(rows, days) {
  if (!rows.length) return `No errors in the last ${days} days.`;
  const out = [`Top errors, last ${days} days (${rows.length}):`];
  rows.forEach((row, i) => {
    out.push('');
    out.push(`${String(i + 1).padStart(2)}. ${row.occurrences}× · ${row.users} user(s)${row.fatal ? ` · ${row.fatal} fatal` : ''} · last ${when(row.last_seen)} UTC`);
    out.push(`    ${row.message}`);
    out.push(`    screens: ${(row.screens ?? []).join(', ') || '-'} · ${(row.platforms ?? []).join('/')} · versions: ${(row.versions ?? []).join(', ') || '-'}`);
    if (row.sample_stack) out.push(...row.sample_stack.split('\n').slice(0, 4).map((line) => `      ${line.trim()}`));
  });
  return out.join('\n');
}
