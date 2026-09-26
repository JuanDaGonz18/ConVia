import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { DriverStatus, UserRole } from '@/types';

export type DriverProfile = {
  status: DriverStatus;
  reviewNotes: string | null;
  /** When the license photo's face was registered (the photo itself is not stored). */
  submittedAt: string | null;
  /** When a live selfie matched the license photo. */
  identityVerifiedAt: string | null;
};

export const driverService = {
  async getDriverProfile(userId: string): Promise<DriverProfile | null> {
    if (!isSupabaseEnabled) return null;
    ensureSupabaseConfigured();
    const { data, error } = await supabase
      .from('driver_profiles')
      .select('status, review_notes, submitted_at, identity_verified_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      status: data.status,
      reviewNotes: data.review_notes,
      submittedAt: data.submitted_at,
      identityVerifiedAt: data.identity_verified_at,
    };
  },

  /** Changes the active mode (pasajero / conductor). */
  async switchRole(role: UserRole): Promise<void> {
    if (!isSupabaseEnabled) return;
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('switch_role', { p_rol: role === 'driver' ? 'conductor' : 'usuario' });
    if (error) throw error;
  },
};
