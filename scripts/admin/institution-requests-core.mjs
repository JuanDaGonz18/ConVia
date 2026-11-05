// "My institution isn't listed" requests (institution_requests, estado 'pendiente'), for review-cli.mjs.
// Decisions go through public.service_resolve_institution_request (migration 039): approve creates the
// institution and its domains like the seed, merge adds the domain to an existing one, reject keeps a
// reason. Approve and merge re-run the e-mail check for the requester (institutional e-mail → verified).
import { promises as dns } from 'node:dns';
import { check } from './review-core.mjs';

// Personal e-mail providers: their domain says nothing about the institution.
const PUBLIC_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'live.com.co',
  'yahoo.com', 'yahoo.es', 'yahoo.com.co', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'proton.me', 'protonmail.com',
]);
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;
// Words that every Colombian institution name shares; left out when comparing names.
const STOP = new Set(['universidad', 'universitaria', 'universitario', 'institucion', 'instituto', 'corporacion', 'fundacion',
  'escuela', 'colegio', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'u']);

export const isDomain = (value) => DOMAIN.test(value);

export async function countInstitutionRequests(admin) {
  const { count, error } = await admin.from('institution_requests').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
  if (error) throw error;
  return count;
}

// Oldest first, with the requester and their membership (if any).
export async function pendingInstitutionRequests(admin) {
  const rows = check(await admin.from('institution_requests')
    .select('id, user_id, nombre, ciudad, sitio_web, rol, created_at, profiles(nombre, email)')
    .eq('estado', 'pendiente').order('created_at'));
  const memberships = rows.length
    ? check(await admin.from('institution_memberships').select('user_id, status, institutions(nombre)').in('user_id', rows.map((r) => r.user_id)))
    : [];
  return rows.map((row) => ({ ...row, membership: memberships.find((m) => m.user_id === row.user_id) ?? null }));
}

export async function allInstitutions(admin) {
  const rows = check(await admin.from('institutions').select('id, nombre, nombre_corto, ciudad, activo, institution_domains(dominio)').order('nombre'));
  return rows.map((row) => ({ ...row, dominios: row.institution_domains.map((d) => d.dominio) }));
}

export function hostOf(url) {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
    return isDomain(host) ? host : null;
  } catch {
    return null;
  }
}

// The website's host and the requester's e-mail domain (unless it is a personal provider).
export function candidateDomains(request) {
  const emailDomain = (request.profiles?.email ?? '').split('@')[1]?.toLowerCase();
  return [...new Set([
    request.sitio_web ? hostOf(request.sitio_web) : null,
    emailDomain && isDomain(emailDomain) && !PUBLIC_MAIL.has(emailDomain) ? emailDomain : null,
  ].filter(Boolean))];
}

const timeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

// MX through the system's DNS; if that server can't answer (some local setups refuse it), public resolvers.
const publicDns = new dns.Resolver();
publicDns.setServers(['1.1.1.1', '8.8.8.8']);
async function resolveMx(domain) {
  try {
    return await timeout(dns.resolveMx(domain), 5000);
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') return [];
    return timeout(publicDns.resolveMx(domain), 5000)
      .catch((e) => { if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return []; throw e; });
  }
}

export async function domainCheck(domain) {
  const [address, mx] = await Promise.allSettled([timeout(dns.lookup(domain), 5000), resolveMx(domain)]);
  return {
    domain,
    resolves: address.status === 'fulfilled',
    mx: mx.status === 'fulfilled' ? mx.value.sort((a, b) => a.priority - b.priority).map((r) => r.exchange) : [],
    mxError: mx.status === 'rejected' ? mx.reason.code ?? mx.reason.message : null,
  };
}

export async function websiteCheck(url) {
  try {
    const res = await fetch(/^https?:\/\//i.test(url) ? url : `https://${url}`, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'ConVia-review/1.0' } });
    return { url, reachable: res.status < 500, status: res.status, finalUrl: res.url };
  } catch (error) {
    const code = error.cause?.code ?? error.name;
    // The server answered but its certificate is incomplete or wrong (common on university sites).
    const tls = /CERT|SIGNATURE|SELF_SIGNED|TLS|SSL/i.test(code);
    return { url, reachable: tls, status: null, error: tls ? `TLS problem: ${code}` : code };
  }
}

const normalize = (text) => (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (text) => normalize(text).split(' ').filter((w) => w && !STOP.has(w));
function trigrams(text) {
  const padded = `  ${words(text).join(" ")} `;
  const set = new Set();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}
const dice = (a, b) => (a.size + b.size ? (2 * [...a].filter((x) => b.has(x)).length) / (a.size + b.size) : 0);

// 0..1: distinctive words in common, or letter trigrams, whichever is higher; a short name typed
// as the name ("Uniandes") counts as 1.
export function nameSimilarity(requested, institution) {
  const req = normalize(requested);
  if (institution.nombre_corto && (req === normalize(institution.nombre_corto) || words(requested).includes(normalize(institution.nombre_corto)))) return 1;
  return Math.max(dice(new Set(words(requested)), new Set(words(institution.nombre))), dice(trigrams(requested), trigrams(institution.nombre)));
}

const sameDomain = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

// Existing institutions that look like the request: similar name, or a domain equal to (or a
// subdomain of) one of the candidate domains.
export function likelyDuplicates(request, domains, institutions) {
  return institutions
    .map((inst) => ({
      ...inst,
      similarity: Math.round(nameSimilarity(request.nombre, inst) * 100) / 100,
      sharedDomains: inst.dominios.filter((d) => domains.some((c) => sameDomain(c, d))),
    }))
    .filter((inst) => inst.similarity >= 0.5 || inst.sharedDomains.length)
    .sort((a, b) => b.sharedDomains.length - a.sharedDomains.length || b.similarity - a.similarity)
    .slice(0, 5);
}

// For "merge" without a listed duplicate: the best name matches for what the reviewer typed.
export function searchInstitutions(text, institutions) {
  return institutions
    .map((inst) => ({ ...inst, similarity: Math.max(nameSimilarity(text, inst), normalize(inst.nombre).includes(normalize(text)) ? 1 : 0) }))
    .filter((inst) => inst.similarity >= 0.3)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

export async function autoChecks(request, institutions) {
  const domains = candidateDomains(request);
  const [domainResults, website] = await Promise.all([
    Promise.all(domains.map(domainCheck)),
    request.sitio_web || domains[0] ? websiteCheck(request.sitio_web || domains[0]) : null,
  ]);
  return { domains, domainResults, website, duplicates: likelyDuplicates(request, domains, institutions) };
}

const resolve = async (admin, params) => check(await admin.rpc('service_resolve_institution_request', params));

export const approveRequest = (admin, requestId, { nombre, dominios }) =>
  resolve(admin, { p_request: requestId, p_action: 'approve', p_nombre: nombre, p_dominios: dominios });

export const mergeRequest = (admin, requestId, { institutionId, dominios }) =>
  resolve(admin, { p_request: requestId, p_action: 'merge', p_institution: institutionId, p_dominios: dominios });

export const rejectRequest = (admin, requestId, motivo) => {
  if (!motivo || motivo.trim().length < 3) throw new Error('Give a reason (3+ characters).');
  return resolve(admin, { p_request: requestId, p_action: 'reject', p_motivo: motivo.trim().slice(0, 300) });
};

// What re-running the e-mail check did to the requester, for the reviewer.
export const REQUESTER_OUTCOME = {
  verified_by_email: 'verified now (institutional e-mail on that domain)',
  institution_chosen: 'institution chosen for them (pending): the app offers the card',
  already_verified: 'already verified elsewhere, unchanged',
  unchanged: 'unchanged (their e-mail is not on that domain; they keep their current choice)',
};
