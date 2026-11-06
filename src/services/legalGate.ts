import { create } from 'zustand';

import { LEGAL_OUTDATED } from '@/content/legalVersion';

/**
 * Which version of the Terms and the Privacy Policy the signed-in person
 * accepted (profiles.accepted_legal_version, migration 040). Older than
 * LEGAL_VERSION → <LegalGateHost /> asks them to accept the new one.
 */
type LegalGate = {
  /** unknown: not checked yet (or signed out); outdated: the modal is up. */
  status: 'unknown' | 'current' | 'outdated';
  /** The person chose to delete their account: the modal steps aside for the deletion dialog. */
  suspended: boolean;
  set: (status: LegalGate['status']) => void;
  suspend: () => void;
  resume: () => void;
};

export const useLegalGate = create<LegalGate>((set) => ({
  status: 'unknown',
  suspended: false,
  set: (status) => set({ status, suspended: false }),
  suspend: () => set({ suspended: true }),
  resume: () => set({ suspended: false }),
}));

/** An AI Edge Function answered 403 LEGAL_OUTDATED: show the modal. */
export function reportLegalOutdated() {
  useLegalGate.getState().set('outdated');
}

/** True (and the modal opens) when an Edge Function error body is LEGAL_OUTDATED. */
export function handleLegalOutdated(code: unknown): boolean {
  if (code !== LEGAL_OUTDATED) return false;
  reportLegalOutdated();
  return true;
}

/**
 * fetch for the Supabase client: a 403 LEGAL_OUTDATED from an Edge Function
 * opens the modal, wherever it was called from. The response is returned as is.
 */
export function createLegalAwareFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (response.status === 403 && url.includes('/functions/v1/')) {
      void response.clone().json().then((body: { error?: unknown } | null) => handleLegalOutdated(body?.error)).catch(() => undefined);
    }
    return response;
  };
}
