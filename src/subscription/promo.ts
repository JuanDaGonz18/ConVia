/**
 * Launch promotion: accounts created before this moment get ConVía+ for PLUS_PROMO_MONTHS months
 * (server: app_config.plus_promo_until, migration plus_launch_promo). This copy only decides whether
 * the sign-up screens mention it; the server is what grants it.
 */
export const PLUS_PROMO_UNTIL = new Date('2027-02-15T00:00:00-05:00');
export const PLUS_PROMO_MONTHS = 2;

export const plusPromoActive = (now: Date = new Date()) => now < PLUS_PROMO_UNTIL;
