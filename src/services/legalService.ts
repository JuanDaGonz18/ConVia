import { LEGAL_VERSION } from '@/content/legal';
import { needsLegalAcceptance } from '@/content/legalVersion';
import { supabase } from '@/lib/supabase';
import { useLegalGate } from '@/services/legalGate';

/**
 * Which version of the Terms and the Privacy Policy the signed-in person
 * accepted (profiles.accepted_legal_version, migration 040); see legalGate.ts.
 */
export const legalService = {
  async acceptedVersion(): Promise<string | null> {
    const { data, error } = await supabase.rpc('my_accepted_legal_version');
    if (error) throw error;
    return data ?? null;
  },

  /** Checks the signed-in person; the modal opens if they must accept again. */
  async check(): Promise<void> {
    const accepted = await legalService.acceptedVersion();
    useLegalGate.getState().set(needsLegalAcceptance(accepted, LEGAL_VERSION) ? 'outdated' : 'current');
  },

  /** The person's explicit acceptance of the current version. */
  async accept(): Promise<void> {
    const { error } = await supabase.rpc('accept_legal', { p_version: LEGAL_VERSION });
    if (error) throw error;
    useLegalGate.getState().set('current');
  },

  reset() {
    useLegalGate.getState().set('unknown');
  },
};
