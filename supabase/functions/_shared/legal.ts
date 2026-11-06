/**
 * Legal version gate for the AI Edge Functions. The user must have accepted
 * at least MIN_LEGAL_VERSION (profiles.accepted_legal_version, migration 040);
 * otherwise the function answers 403 LEGAL_OUTDATED and the app shows the
 * acceptance modal. No Deno globals, so Node can test it.
 */

/** The first version that covers the AI features (Meta, pickup video, student card). */
export const MIN_LEGAL_VERSION = '1.2';

const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/** Numeric, part by part ('1.10' > '1.2'). Null or malformed never reaches. */
export function legalVersionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version || !VERSION.test(version)) return false;
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x > y;
  }
  return true;
}

export type LegalCheck =
  | { ok: true }
  | { ok: false; status: 403; error: 'LEGAL_OUTDATED' }
  | { ok: false; status: 500; error: 'LEGAL_CHECK_FAILED' };

type RpcClient = {
  rpc(fn: 'service_accepted_legal_version', args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Reads the user's accepted version (public.service_accepted_legal_version, service_role only) and compares it. */
export async function checkLegal(admin: RpcClient, userId: string, min = MIN_LEGAL_VERSION): Promise<LegalCheck> {
  const { data, error } = await admin.rpc('service_accepted_legal_version', { p_user: userId });
  if (error) return { ok: false, status: 500, error: 'LEGAL_CHECK_FAILED' };
  return legalVersionAtLeast(typeof data === 'string' ? data : null, min) ? { ok: true } : { ok: false, status: 403, error: 'LEGAL_OUTDATED' };
}
