// Used by plus-cli.mjs (service_role only): ConVía+ paid by bank transfer (payment_requests, migration 047).
// The formatting and argument helpers are pure so they can be tested without a project.
import { check } from './review-core.mjs';

const RECEIPT_BUCKET = 'payment-receipts';
const COLUMNS = 'id, reference, user_id, period, months, amount_cop, status, receipt_path, reject_reason, paid_amount_cop, paid_on, period_end, created_at, submitted_at, decided_at';
/** Same alphabet as private.new_payment_reference(). */
export const REFERENCE = /^CV-[2-9A-HJKMNP-Z]{4}$/;

export function normalizeReference(value) {
  const ref = String(value ?? '').trim().toUpperCase();
  if (!REFERENCE.test(ref)) throw new Error(`"${value ?? ''}" is not a reference (CV- and 4 characters, e.g. CV-7K3P).`);
  return ref;
}

/**
 * --list | --grant <ref> [--amount <COP>] [--paid-on YYYY-MM-DD] | --reject <ref> --reason "text".
 * Returns { action, ref?, amount?, paidOn?, reason? } or throws with the usage.
 */
export function parseArgs(args) {
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
  };
  const actions = ['--list', '--grant', '--reject'].filter((name) => args.includes(name));
  if (actions.length > 1) throw new Error('Use only one of --list, --grant or --reject.');
  const action = actions[0] ?? '--list';
  if (action === '--list') return { action: 'list', all: args.includes('--all') };
  const ref = normalizeReference(value(action));
  if (action === '--grant') {
    const amountText = value('--amount');
    const amount = amountText === undefined ? null : Number(amountText.replace(/[.,\s$]/g, ''));
    if (amount !== null && (!Number.isInteger(amount) || amount <= 0)) throw new Error('--amount must be a whole number of pesos, e.g. --amount 12000.');
    const paidOn = value('--paid-on') ?? null;
    if (paidOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new Error('--paid-on must be YYYY-MM-DD.');
    return { action: 'grant', ref, amount, paidOn };
  }
  const reason = String(value('--reason') ?? '').trim();
  if (reason.length < 3 || reason.length > 300) throw new Error('--reject needs --reason "what was wrong" (3 to 300 characters); the person sees it.');
  return { action: 'reject', ref, reason };
}

/** Pending first (oldest first, as they should be handled); --all adds the latest decided ones. */
export async function listPayments(admin, { all = false, limit = 50 } = {}) {
  let query = admin.from('payment_requests').select(COLUMNS).limit(limit);
  query = all
    ? query.neq('status', 'draft').order('created_at', { ascending: false })
    : query.eq('status', 'pending').order('submitted_at');
  const rows = check(await query);
  const ids = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const profiles = ids.length ? check(await admin.from('profiles').select('id, nombre, email').in('id', ids)) : [];
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((row) => ({ ...row, profile: byId.get(row.user_id) ?? null }));
}

/** A 5-minute link to the receipt, or null (none, or already deleted 30 days after the decision). */
export async function receiptUrl(admin, path, seconds = 300) {
  if (!path) return null;
  const { data, error } = await admin.storage.from(RECEIPT_BUCKET).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

export async function grantPayment(admin, { ref, amount = null, paidOn = null }) {
  return check(await admin.rpc('service_grant_plus_payment', { p_reference: ref, p_amount: amount, p_paid_on: paidOn }));
}

export async function rejectPayment(admin, { ref, reason }) {
  return check(await admin.rpc('service_reject_plus_payment', { p_reference: ref, p_reason: reason }));
}

// ─── Formatting ────────────────────────────────────────────────────────────

const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) : '-');
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '-');
export const cop = (amount) => `$${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

export function formatPayment(row, url = null) {
  const who = row.profile ? `${row.profile.nombre || '(no name)'} <${row.profile.email ?? '?'}>` : row.user_id ? row.user_id : '(account deleted)';
  const lines = [
    `── ${row.reference} · ${row.status} · ${row.period === 'yearly' ? 'yearly (12 months)' : 'monthly (1 month)'} · ${cop(row.amount_cop)} ─────────────`,
    `From:     ${who}`,
    `Sent:     ${when(row.submitted_at)} UTC`,
  ];
  if (row.status === 'pending') lines.push(url ? `Receipt (5 min): ${url}` : row.receipt_path ? 'Receipt: (no longer available)' : 'Receipt: none (check the bank for the reference)');
  if (row.status === 'granted') lines.push(`Granted:  ${when(row.decided_at)} UTC · received ${cop(row.paid_amount_cop ?? row.amount_cop)} on ${row.paid_on ?? '-'} · ConVía+ until ${day(row.period_end)}`);
  if (row.status === 'rejected') lines.push(`Rejected: ${when(row.decided_at)} UTC · ${row.reject_reason ?? ''}`);
  return lines.join('\n');
}

/** The errors the RPCs raise, in plain words for the admin. */
export function explainError(message) {
  const map = {
    PAYMENTS_DISABLED: 'Payments are off (app_config.payments_enabled = false). Nothing was changed.',
    PAYMENT_NOT_FOUND: 'No payment has that reference.',
    PAYMENT_ALREADY_DECIDED: 'That payment was already granted or rejected.',
    PAYMENT_USER_DELETED: 'The account behind that payment was deleted; refund it by hand.',
    PLUS_NO_EXPIRY: 'This person already has ConVía+ with no expiry (activated by hand). Decide by hand.',
    PAYMENT_REASON_REQUIRED: 'Give a reason (3 to 300 characters).',
    PAYMENT_AMOUNT_INVALID: '--amount must be positive.',
  };
  const code = Object.keys(map).find((key) => String(message).includes(key));
  return code ? `${code}: ${map[code]}` : String(message);
}
