/**
 * Legal versions ('1.2', '1.10'): compared number by number, not as text.
 * Same rule as the server (private.legal_version_at_least, migration 040, and
 * supabase/functions/_shared/legal.ts). No React Native imports, so Node can test it.
 */

const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/** Null or malformed never reaches. */
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

/** The person must accept again: what they accepted is older than `current` (or unknown). */
export function needsLegalAcceptance(accepted: string | null | undefined, current: string): boolean {
  return !legalVersionAtLeast(accepted, current);
}

/** The error the AI Edge Functions answer (403) when the accepted version is too old. */
export const LEGAL_OUTDATED = 'LEGAL_OUTDATED';
