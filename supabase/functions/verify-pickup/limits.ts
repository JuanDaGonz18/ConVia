/**
 * How many paid checks a passenger may run, besides the plan's monthly limit
 * (pickup_verifications_month, checked in the database). Every attempt is
 * recorded as a row BEFORE the paid call and then counted, so server errors
 * and parallel calls count too; the counts passed here already include the
 * caller's own new row. Pure TypeScript, unit-tested.
 */
export type CheckLimits = {
  /** Filmed clips: per trip request, per passenger in 24 h, and for everyone in 24 h. */
  perRequest: number;
  perUserPerDay: number;
  totalPerDay: number;
};

export const DEFAULT_LIMITS: CheckLimits = { perRequest: 6, perUserPerDay: 30, totalPerDay: 1000 };

export type AttemptCounts = { request: number; own: number; total: number };

export function attemptAllowed(counts: AttemptCounts, limits: CheckLimits = DEFAULT_LIMITS): boolean {
  return counts.request <= limits.perRequest && counts.own <= limits.perUserPerDay && counts.total <= limits.totalPerDay;
}

/**
 * Start of the current calendar month in Colombia (UTC-5, no daylight saving),
 * the period of the monthly plan limit.
 */
export function monthStart(now: Date): Date {
  const local = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 5));
}
