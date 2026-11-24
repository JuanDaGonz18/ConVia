import { supabase } from '@/lib/supabase';

/**
 * The web admin panel (app/control-q8z3.tsx). Every call goes through SECURITY DEFINER functions
 * that check private.admins (migration admin_panel): finding the panel's address is not enough.
 * Same decisions as scripts/admin/review-cli.mjs.
 */

export type CardCheck = {
  kind: 'card_photo' | 'document';
  decision: string;
  reasons: string[] | null;
  name_similarity: number | null;
  institution_read: string | null;
  email_domain: string | null;
  expires_on: string | null;
  looks_real: boolean | null;
  face_match: number | null;
  summary: string | null;
  created_at: string;
};

export type MembershipReview = {
  user_id: string;
  nombre: string | null;
  email: string | null;
  institucion: string | null;
  desde: string;
  check: CardCheck | null;
};

export type InstitutionRequest = {
  id: string;
  nombre: string;
  ciudad: string | null;
  sitio_web: string | null;
  rol: string | null;
  created_at: string;
  solicitante: string | null;
  email: string | null;
  membresia: string | null;
  membresia_institucion: string | null;
};

export type AdminInstitution = {
  id: string;
  nombre: string;
  nombre_corto: string | null;
  ciudad: string | null;
  activo: boolean;
  dominios: string[];
};

export type AdminPanel = {
  memberships: MembershipReview[];
  requests: InstitutionRequest[];
  institutions: AdminInstitution[];
  stats: { usuarios: number; nuevos_7d: number; verificados: number; plus_activos: number; viajes_7d: number };
};

export type RejectReason = 'unclear' | 'mismatch' | 'not_student';
export type CommunityType = 'universidad' | 'empresa';

const REVIEW_BUCKET = 'face-verifications';
const REVIEW_PREFIX = 'student-card-review-';

// Personal e-mail providers: their domain says nothing about the institution (as in the CLI).
const PUBLIC_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'live.com.co',
  'yahoo.com', 'yahoo.es', 'yahoo.com.co', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'proton.me', 'protonmail.com',
]);
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

function hostOf(url: string): string | null {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
    return DOMAIN.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** The website's host and the requester's e-mail domain (unless it is a personal provider). */
export function candidateDomains(request: Pick<InstitutionRequest, 'sitio_web' | 'email'>): string[] {
  const emailDomain = (request.email ?? '').split('@')[1]?.toLowerCase();
  return [...new Set([
    request.sitio_web ? hostOf(request.sitio_web) : null,
    emailDomain && DOMAIN.test(emailDomain) && !PUBLIC_MAIL.has(emailDomain) ? emailDomain : null,
  ].filter((d): d is string => Boolean(d)))];
}

export function parseDomains(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
}

export const adminService = {
  async amIAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('am_i_admin');
    if (error) throw error;
    return data === true;
  },

  async load(): Promise<AdminPanel> {
    const { data, error } = await supabase.rpc('admin_panel');
    if (error) throw error;
    return data as unknown as AdminPanel;
  },

  /** Short-lived links to the card images kept for review (face already removed on the device). */
  async reviewImages(userId: string): Promise<{ path: string; url: string }[]> {
    const bucket = supabase.storage.from(REVIEW_BUCKET);
    const { data, error } = await bucket.list(userId, { search: REVIEW_PREFIX, limit: 20 });
    if (error) throw error;
    const paths = (data ?? []).filter((f) => f.id && f.name.startsWith(REVIEW_PREFIX)).map((f) => `${userId}/${f.name}`);
    if (!paths.length) return [];
    const { data: signed, error: signError } = await bucket.createSignedUrls(paths, 300);
    if (signError) throw signError;
    return (signed ?? []).flatMap((s) => (s.signedUrl ? [{ path: s.path ?? '', url: s.signedUrl }] : []));
  },

  async decideMembership(userId: string, approve: boolean, reason?: RejectReason) {
    const { error } = await supabase.rpc('admin_decide_membership', { p_user: userId, p_approve: approve, p_reason: reason });
    if (error) throw error;
    // The images are only for this decision; the 7-day cleanup is the fallback.
    const bucket = supabase.storage.from(REVIEW_BUCKET);
    const { data } = await bucket.list(userId, { search: REVIEW_PREFIX, limit: 20 });
    const paths = (data ?? []).filter((f) => f.id && f.name.startsWith(REVIEW_PREFIX)).map((f) => `${userId}/${f.name}`);
    if (paths.length) await bucket.remove(paths);
  },

  async approveRequest(requestId: string, nombre: string, dominios: string[], tipo: CommunityType) {
    const { error } = await supabase.rpc('admin_resolve_institution_request', {
      p_request: requestId, p_action: 'approve', p_nombre: nombre, p_dominios: dominios, p_tipo: tipo,
    });
    if (error) throw error;
  },

  async mergeRequest(requestId: string, institutionId: string, dominios: string[]) {
    const { error } = await supabase.rpc('admin_resolve_institution_request', {
      p_request: requestId, p_action: 'merge', p_institution: institutionId, p_dominios: dominios,
    });
    if (error) throw error;
  },

  async rejectRequest(requestId: string, motivo: string) {
    const { error } = await supabase.rpc('admin_resolve_institution_request', {
      p_request: requestId, p_action: 'reject', p_motivo: motivo,
    });
    if (error) throw error;
  },
};
