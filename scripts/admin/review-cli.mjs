// Manual review of institution memberships and "my institution isn't listed" requests.
//
//   npm run review                      memberships in review, oldest first: a approve · r reject · s skip · q quit
//   npm run review -- --institutions    "my institution isn't listed" requests: a approve · m merge · r reject · s skip · q quit
//   npm run review -- --count           memberships in review and pending institution requests
//   npm run review -- --user <user_id>  only that user's membership (or, with --institutions, request)
//
// Memberships: approve and reject go through review-core.mjs, so the app's institution screen shows the new
// status or the rejection reason; a 5-minute link opens the card images kept for the review (face already cut
// out on the phone). Institution requests go through institution-requests-core.mjs: approve creates the
// institution and its domains, merge adds the domain to an existing one, and both re-run the requester's
// e-mail check. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come only from the environment, normally
// scripts/admin/.env.review.local (gitignored, outside the app bundle). The key is never printed.
import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';
import { REJECT_REASONS, approve, countPending, pendingReviews, reject, signedFiles } from './review-core.mjs';
import {
  REQUESTER_OUTCOME, allInstitutions, approveRequest, autoChecks, countInstitutionRequests, isDomain, mergeRequest,
  pendingInstitutionRequests, rejectRequest, searchInstitutions,
} from './institution-requests-core.mjs';

const args = process.argv.slice(2);
const userFilter = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in scripts/admin/.env.review.local (see .env.review.example there).');
// Only the host is shown, so the reviewer knows which project they are deciding on.
console.log(`Project: ${new URL(url).host}`);
const admin = createClient(url, key, { auth: { persistSession: false } });

const METHODS = { card_photo: 'photo ID', document: 'no-photo document' };

// Input from a terminal (raw mode, one key at a time) or piped (each character is a key; a line ends at
// "\n"). Ctrl+C or the end of the input quits.
const tty = process.stdin.isTTY;
const chars = [];
let waiting = null;
let ended = false;
function push(c) {
  if (waiting) { const resolve = waiting; waiting = null; resolve(c); } else chars.push(c);
}
function listenKeys() {
  if (tty) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, k) => {
      if (k?.ctrl && k.name === 'c') push('\x03');
      else if (k?.name === 'return' || k?.name === 'enter') push('\n');
      else if (k?.name === 'backspace') push('\b');
      else if (str) push(str);
    });
  } else {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { for (const c of chunk) if (c !== '\r') push(c); });
    process.stdin.on('end', () => { ended = true; push('\x03'); });
  }
}
function stopKeys() {
  if (tty) process.stdin.setRawMode(false);
  process.stdin.destroy();
}
const nextChar = () => (chars.length ? Promise.resolve(chars.shift()) : ended ? Promise.resolve('\x03') : new Promise((resolve) => { waiting = resolve; }));
async function nextKey() {
  for (;;) {
    const c = await nextChar();
    if (c === '\x03') return 'q';
    if (c !== '\b' && c.trim()) return c.toLowerCase();
  }
}
async function ask(prompt, allowed) {
  process.stdout.write(prompt);
  for (;;) {
    const k = await nextKey();
    if (allowed.includes(k)) { process.stdout.write(`${k}\n`); return k; }
    if (k === 'q' && !allowed.includes('q')) { process.stdout.write('\n'); return null; }
  }
}
// A line of text; Enter alone keeps `fallback`. null = cancelled (Ctrl+C / end of input).
async function readText(prompt, fallback = '') {
  process.stdout.write(fallback ? `${prompt} [${fallback}]: ` : `${prompt}: `);
  let line = '';
  for (;;) {
    const c = await nextChar();
    if (c === '\x03') { process.stdout.write('\n'); return null; }
    if (c === '\n') { process.stdout.write(tty ? '\n' : `${line}\n`); return line.trim() || fallback; }
    if (c === '\b') {
      if (line) { line = line.slice(0, -1); if (tty) process.stdout.write('\b \b'); }
      continue;
    }
    line += c;
    if (tty) process.stdout.write(c);
  }
}

// ─── Memberships in review ─────────────────────────────────────────────────

function show(row, index, total, files) {
  const { last } = row;
  console.log(`\n── ${index + 1}/${total} ─────────────────────────────────────────`);
  console.log(`Name:         ${row.profiles?.nombre || '(no name)'}  <${row.profiles?.email ?? '?'}>`);
  console.log(`Institution:  ${row.institutions?.nombre ?? '?'}`);
  console.log(`Method:       ${last ? METHODS[last.kind] ?? last.kind : 'no check recorded'}`);
  console.log(`Submitted:    ${new Date(last?.created_at ?? row.updated_at).toLocaleString()}`);
  console.log(`User id:      ${row.user_id}`);
  if (last) {
    console.log(`Reasons:      ${last.reasons.join(', ') || '-'}`);
    console.log(`Checks:       name similarity ${last.name_similarity ?? '-'} · institution read: ${last.institution_read ?? '-'} · e-mail domain: ${last.email_domain ?? '-'} · expires ${last.expires_on ?? '-'} · physical card: ${last.looks_real ?? '-'} · face match: ${last.face_match ?? '-'}`);
    if (last.review_summary) {
      console.log('AI summary:');
      for (const [k, v] of Object.entries(last.review_summary)) console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    } else console.log('AI summary:   -');
  }
  if (files.length) for (const f of files) console.log(`Image (5 min, face removed): ${f.name}\n  ${f.url}`);
  else console.log('Image:        none kept (e.g. the phone could not cut the face out, so nothing was sent)');
}

async function pickReason() {
  const names = Object.keys(REJECT_REASONS);
  console.log('Reject reason (review policy):');
  names.forEach((name, i) => console.log(`  ${i + 1}  ${name.padEnd(12)} ${REJECT_REASONS[name]}`));
  console.log('  c  cancel');
  const k = await ask('> ', [...names.map((_, i) => String(i + 1)), 'c']);
  return !k || k === 'c' ? null : names[Number(k) - 1];
}

async function reviewMemberships() {
  const all = await pendingReviews(admin);
  const pending = userFilter ? all.filter((r) => r.user_id === userFilter) : all;
  if (!pending.length) return console.log(userFilter ? 'That user has no request in review.' : 'Nothing to review.');
  const tally = { approved: 0, rejected: 0, skipped: 0 };
  listenKeys();
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    show(row, i, pending.length, await signedFiles(admin, row.user_id));
    const k = await ask('[a]pprove  [r]eject  [s]kip  [q]uit > ', ['a', 'r', 's', 'q']);
    if (k === 'q') break;
    try {
      if (k === 'a') {
        console.log(`Approved (${await approve(admin, row.user_id)}). Images deleted.`);
        tally.approved++;
      } else if (k === 'r') {
        const reason = await pickReason();
        if (!reason) { i--; continue; }
        await reject(admin, row.user_id, reason);
        console.log(`Rejected (${reason}). Images deleted.`);
        tally.rejected++;
      } else tally.skipped++;
    } catch (error) {
      console.error(`Not saved: ${error.message}`);
    }
  }
  stopKeys();
  console.log(`\n${tally.approved} approved · ${tally.rejected} rejected · ${tally.skipped} skipped · ${await countPending(admin)} still in review`);
}

// ─── Institution requests ──────────────────────────────────────────────────

const mark = (ok) => (ok ? '✓' : '✗');
const instLine = (inst) => `${inst.nombre}${inst.nombre_corto ? ` (${inst.nombre_corto})` : ''} · ${inst.ciudad ?? '?'} · ${inst.dominios.join(', ') || 'no domain'}${inst.activo ? '' : ' · inactive'}`;

function showRequest(row, index, total, checks) {
  console.log(`\n── Institution request ${index + 1}/${total} ─────────────────────────`);
  console.log(`Requested:    ${row.nombre}`);
  console.log(`City:         ${row.ciudad}`);
  console.log(`Website:      ${row.sitio_web ?? '-'}`);
  console.log(`Requester:    ${row.profiles?.nombre || '(no name)'}  <${row.profiles?.email ?? '?'}>  · ${row.rol} · membership: ${row.membership ? `${row.membership.status} (${row.membership.institutions?.nombre ?? '?'})` : 'none'}`);
  console.log(`Date:         ${new Date(row.created_at).toLocaleString()}`);
  console.log(`Request id:   ${row.id}`);
  if (!checks.domains.length) console.log('Domain(s):    none found (no website, personal e-mail): ask for it before approving');
  for (const d of checks.domainResults) {
    console.log(`Domain:       ${d.domain}  resolves ${mark(d.resolves)} · MX ${d.mxError ? `? (lookup failed: ${d.mxError})` : mark(d.mx.length)}${d.mx.length ? ` (${d.mx.slice(0, 2).join(', ')})` : ''}`);
  }
  if (checks.website) {
    const w = checks.website;
    console.log(`Site check:   ${mark(w.reachable)} ${w.reachable ? `reachable (${w.status ?? w.error}${w.finalUrl && hostDiffers(w.url, w.finalUrl) ? ` → ${w.finalUrl}` : ''})` : `not reachable (${w.status ?? w.error})`}`);
  }
  if (checks.duplicates.length) {
    console.log('Duplicates?');
    checks.duplicates.forEach((d, i) => console.log(`  ${i + 1}  ${instLine(d)}  — name ${d.similarity}${d.sharedDomains.length ? `, same domain (${d.sharedDomains.join(', ')})` : ''}`));
  } else console.log('Duplicates:   none found');
}

function hostDiffers(a, b) {
  try {
    return new URL(/^https?:\/\//i.test(a) ? a : `https://${a}`).hostname !== new URL(b).hostname;
  } catch {
    return false;
  }
}

// Comma-separated domains, all valid; null = cancelled.
async function readDomains(prompt, fallback, { allowEmpty = false } = {}) {
  for (;;) {
    const text = await readText(prompt, fallback);
    if (text === null) return null;
    if (text === '-' && allowEmpty) return [];
    const list = text.split(/[\s,]+/).map((d) => d.toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (!list.length && allowEmpty) return [];
    const bad = list.filter((d) => !isDomain(d));
    if (list.length && !bad.length) return list;
    console.log(bad.length ? `Not a domain: ${bad.join(', ')}` : 'At least one domain.');
  }
}

async function approveFlow(row, checks) {
  const nombre = await readText('Name', row.nombre);
  if (nombre === null) return false;
  const dominios = await readDomains('Domain(s), comma-separated, main first', checks.domains.join(', '));
  if (dominios === null) return false;
  if (await ask(`Create "${nombre}" (${row.ciudad}) with ${dominios.join(', ')}? [y/n] > `, ['y', 'n']) !== 'y') return false;
  const result = await approveRequest(admin, row.id, { nombre, dominios });
  console.log(`Approved: institution created (${result.institution_id}). Requester: ${REQUESTER_OUTCOME[result.requester] ?? result.requester}.`);
  return true;
}

async function mergeFlow(row, checks, institutions) {
  let options = checks.duplicates;
  if (!options.length) {
    const text = await readText('No duplicate found. Search existing institutions');
    if (!text) return false;
    options = searchInstitutions(text, institutions);
    if (!options.length) { console.log('No match.'); return false; }
    options.forEach((d, i) => console.log(`  ${i + 1}  ${instLine(d)}`));
  }
  const k = await ask(`Merge into [1-${options.length}] or [c]ancel > `, [...options.map((_, i) => String(i + 1)), 'c']);
  if (!k || k === 'c') return false;
  const target = options[Number(k) - 1];
  const fresh = checks.domains.filter((d) => !target.dominios.includes(d)).join(', ');
  const dominios = await readDomains('Domain(s) to add, comma-separated ("-" for none)', fresh, { allowEmpty: true });
  if (dominios === null) return false;
  if (await ask(`Merge into "${target.nombre}"${dominios.length ? `, adding ${dominios.join(', ')}` : ''}? [y/n] > `, ['y', 'n']) !== 'y') return false;
  const result = await mergeRequest(admin, row.id, { institutionId: target.id, dominios });
  console.log(`Merged into ${target.nombre}. Requester: ${REQUESTER_OUTCOME[result.requester] ?? result.requester}.`);
  return true;
}

async function rejectFlow(row) {
  const presets = ['Not a higher-education institution or company we can verify', 'Duplicate of an institution already listed', 'Could not confirm the institution or its e-mail domain'];
  console.log('Reason:');
  presets.forEach((p, i) => console.log(`  ${i + 1}  ${p}`));
  const text = await readText('Number or your own reason (Enter alone: cancel)');
  if (!text) return false;
  const motivo = presets[Number(text) - 1] ?? text;
  await rejectRequest(admin, row.id, motivo);
  console.log(`Rejected: ${motivo}`);
  return true;
}

async function reviewInstitutionRequests() {
  const all = await pendingInstitutionRequests(admin);
  const pending = userFilter ? all.filter((r) => r.user_id === userFilter) : all;
  if (!pending.length) return console.log(userFilter ? 'That user has no pending institution request.' : 'No institution requests.');
  const tally = { approved: 0, merged: 0, rejected: 0, skipped: 0 };
  listenKeys();
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const institutions = await allInstitutions(admin);
    const checks = await autoChecks(row, institutions);
    showRequest(row, i, pending.length, checks);
    const k = await ask('[a]pprove  [m]erge  [r]eject  [s]kip  [q]uit > ', ['a', 'm', 'r', 's', 'q']);
    if (k === 'q') break;
    try {
      const done = k === 'a' ? await approveFlow(row, checks)
        : k === 'm' ? await mergeFlow(row, checks, institutions)
          : k === 'r' ? await rejectFlow(row) : null;
      if (done === null) tally.skipped++;
      else if (done) tally[{ a: 'approved', m: 'merged', r: 'rejected' }[k]]++;
      else { console.log('Cancelled.'); i--; }
    } catch (error) {
      console.error(`Not saved: ${error.message}`);
      i--;
      if (ended) break;
    }
  }
  stopKeys();
  console.log(`\n${tally.approved} approved · ${tally.merged} merged · ${tally.rejected} rejected · ${tally.skipped} skipped · ${await countInstitutionRequests(admin)} still pending`);
}

try {
  if (args.includes('--count')) {
    const [memberships, requests] = await Promise.all([countPending(admin), countInstitutionRequests(admin)]);
    console.log(`${memberships} memberships in review · ${requests} institution requests pending`);
  } else if (args.includes('--institutions')) await reviewInstitutionRequests();
  else await reviewMemberships();
} catch (error) {
  fail(error.message);
}
