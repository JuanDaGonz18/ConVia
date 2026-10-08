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
};
