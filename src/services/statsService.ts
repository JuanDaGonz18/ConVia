import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';

/** As a passenger: only the user's own requests and trips. */
export type PassengerStats = {
  requests: number;
  completed: number;
  upcoming: number;
  cancelled: number;
  /** Kilometres ridden, approximate (share of each trip's route). */
  km: number;
  /** Sum of the agreed price of completed trips (payment happens outside the app). */
  spent: number;
  drivers: number;
  rating: number;
  ratingCount: number;
};

/** As a driver: only the user's own trips. */
export type DriverStats = {
  published: number;
  completed: number;
  upcoming: number;
  cancelled: number;
  passengers: number;
  km: number;
  seatsOffered: number;
  /** Agreed contributions (price × passengers) and what the driver marked as received. */
  agreed: number;
  paid: number;
  accepted: number;
  rejected: number;
  rating: number;
  ratingCount: number;
};

/** null = the plan does not include that part (the server decides). */
export type TripStats = { passenger: PassengerStats | null; driver: DriverStats | null };

const number = (value: unknown) => Number(value ?? 0) || 0;

/** A comment the user received. The rater is deliberately not included. */
export type ReceivedComment = { score: number; comentario: string; createdAt: string };

export const statsService = {
  async getMyStats(): Promise<TripStats> {
    if (!isSupabaseEnabled) return { passenger: null, driver: null };
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('my_trip_stats');
    if (error) throw error;
    const raw = (data ?? {}) as { passenger?: Record<string, unknown> | null; driver?: Record<string, unknown> | null };
    const p = raw.passenger;
    const d = raw.driver;
    return {
      passenger: p
        ? {
            requests: number(p.requests),
            completed: number(p.completed),
            upcoming: number(p.upcoming),
            cancelled: number(p.cancelled),
            km: number(p.km),
            spent: number(p.spent),
            drivers: number(p.drivers),
            rating: number(p.rating),
            ratingCount: number(p.rating_count),
          }
        : null,
      driver: d
        ? {
            published: number(d.published),
            completed: number(d.completed),
            upcoming: number(d.upcoming),
            cancelled: number(d.cancelled),
            passengers: number(d.passengers),
            km: number(d.km),
            seatsOffered: number(d.seats_offered),
            agreed: number(d.agreed),
            paid: number(d.paid),
            accepted: number(d.accepted),
            rejected: number(d.rejected),
            rating: number(d.rating),
            ratingCount: number(d.rating_count),
          }
        : null,
    };
  },

  /** Ratings with a comment that the current user received, newest first. */
  async getMyReceivedComments(): Promise<ReceivedComment[]> {
    if (!isSupabaseEnabled) return [];
    ensureSupabaseConfigured();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user) throw new Error('AUTH_REQUIRED');
    const { data, error } = await supabase
      .from('ratings')
      // Inner join on the trip: only ratings received as that trip's driver (not as a passenger).
      .select('score, comentario, created_at, trips!inner(driver_id)')
      .eq('rated_id', auth.user.id)
      .eq('trips.driver_id', auth.user.id)
      .not('comentario', 'is', null)
      .neq('comentario', '')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as { score: unknown; comentario: string | null; created_at: string }[])
      .filter((row) => row.comentario?.trim())
      .map((row) => ({ score: number(row.score), comentario: row.comentario!.trim(), createdAt: row.created_at }));
  },
};
