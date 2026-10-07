import type { Ionicons } from '@expo/vector-icons';

/**
 * FREE / PLUS (ConVía+) plan model.
 *
 * The user's plan always comes from the backend (`get_my_plan`, backed by the
 * `plans` and `subscriptions` tables), which also enforces every limit. This
 * file only holds:
 *   - the keys the app understands (limits and features),
 *   - fallback values used before the server answers or in demo mode
 *     (keep them in sync with the seed in the subscriptions migration),
 *   - the copy used to explain each premium feature.
 *
 * Adding a premium feature: add its key to PlanFeature and FEATURE_INFO, add
 * it to `plans.features` for 'plus' in the database, and check it with
 * `usePlan().has('<key>')` (or `requirePlus('<key>')`) where it is used.
 */

export type PlanTier = 'free' | 'plus';

/** Numeric limits; `null` means unlimited. Enforced by database triggers. */
export type PlanLimit = 'vehicles' | 'saved_places' | 'favorite_drivers';

/** On/off premium features. */
export type PlanFeature = 'google_maps' | 'map_traffic';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';

export type Plan = {
  tier: PlanTier;
  name: string;
  status: SubscriptionStatus;
  /** End of the paid period; null when it does not expire. */
  currentPeriodEnd: string | null;
  limits: Record<PlanLimit, number | null>;
  features: PlanFeature[];
};

const LIMIT_KEYS: PlanLimit[] = ['vehicles', 'saved_places', 'favorite_drivers'];
const FEATURE_KEYS: PlanFeature[] = ['google_maps', 'map_traffic'];

export const DEFAULT_PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: 'free',
    name: 'ConVía',
    status: 'active',
    currentPeriodEnd: null,
    limits: { vehicles: 1, saved_places: 10, favorite_drivers: null },
    features: [],
  },
  plus: {
    tier: 'plus',
    name: 'ConVía+',
    status: 'active',
    currentPeriodEnd: null,
    limits: { vehicles: 10, saved_places: 10, favorite_drivers: null },
    features: ['google_maps', 'map_traffic'],
  },
};

type FeatureInfo = { title: string; description: string; icon: keyof typeof Ionicons.glyphMap };

/** How each premium feature is explained when a FREE user reaches it. */
export const FEATURE_INFO: Record<PlanFeature, FeatureInfo> = {
  google_maps: {
    title: 'Mapas de Google',
    description: 'Mapas de Google con lugares tocables y la cartografía más detallada.',
    icon: 'map-outline',
  },
  map_traffic: {
    title: 'Tráfico en el mapa',
    description: 'Mira el tráfico en tiempo real en el mapa para planear mejor tu salida.',
    icon: 'speedometer-outline',
  },
};

type LimitInfo = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** "Las cuentas gratis pueden registrar 1 vehículo." */
  freeText: (limit: number) => string;
  /** What ConVía+ offers instead. */
  plusText: (limit: number | null) => string;
  /** Shown when the server rejects an action because the limit was reached. */
  reachedText: (limit: number) => string;
};

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export const LIMIT_INFO: Record<PlanLimit, LimitInfo> = {
  vehicles: {
    title: 'Varios vehículos',
    icon: 'car-sport-outline',
    freeText: (limit) => `Las cuentas gratis pueden registrar ${plural(limit, 'vehículo', 'vehículos')}.`,
    plusText: (limit) => (limit === null
      ? 'Registra todos tus vehículos con ConVía+.'
      : `Registra hasta ${plural(limit, 'vehículo', 'vehículos')} con ConVía+.`),
    reachedText: (limit) => `Ya registraste el máximo de tu plan (${plural(limit, 'vehículo', 'vehículos')}).`,
  },
  saved_places: {
    title: 'Más lugares guardados',
    icon: 'bookmark-outline',
    freeText: (limit) => `Puedes guardar hasta ${plural(limit, 'lugar', 'lugares')}.`,
    plusText: (limit) => (limit === null ? 'Guarda todos los lugares que quieras con ConVía+.' : `Guarda hasta ${plural(limit, 'lugar', 'lugares')} con ConVía+.`),
    reachedText: (limit) => `Puedes guardar hasta ${plural(limit, 'lugar', 'lugares')}.`,
  },
  favorite_drivers: {
    title: 'Más conductores favoritos',
    icon: 'star-outline',
    freeText: (limit) => `Puedes tener hasta ${plural(limit, 'conductor favorito', 'conductores favoritos')}.`,
    plusText: (limit) => (limit === null ? 'Marca todos los favoritos que quieras con ConVía+.' : `Hasta ${plural(limit, 'conductor favorito', 'conductores favoritos')} con ConVía+.`),
    reachedText: (limit) => `Ya tienes el máximo de ${plural(limit, 'conductor favorito', 'conductores favoritos')} de tu plan.`,
  },
};

/** True when `used` already reached the plan's limit for `key`. */
export function isAtLimit(plan: Plan, key: PlanLimit, used: number) {
  const limit = plan.limits[key];
  return limit !== null && used >= limit;
}

/** Turns the `get_my_plan` row into a Plan, ignoring keys this app version does not know. */
export function parsePlan(row: {
  tier: string;
  name: string;
  status: string;
  current_period_end: string | null;
  limits: unknown;
  features: string[] | null;
}): Plan {
  const tier: PlanTier = row.tier === 'plus' ? 'plus' : 'free';
  const fallback = DEFAULT_PLANS[tier];
  const rawLimits = (row.limits && typeof row.limits === 'object' ? row.limits : {}) as Record<string, unknown>;
  const limits = Object.fromEntries(LIMIT_KEYS.map((key) => {
    const value = rawLimits[key];
    // A key missing on the server means unlimited, as in the database.
    return [key, typeof value === 'number' && Number.isFinite(value) ? value : null];
  })) as Record<PlanLimit, number | null>;
  return {
    tier,
    name: row.name || fallback.name,
    status: (['active', 'trialing', 'past_due', 'canceled', 'expired'].includes(row.status) ? row.status : 'active') as SubscriptionStatus,
    currentPeriodEnd: row.current_period_end,
    limits,
    features: (row.features ?? []).filter((feature): feature is PlanFeature => FEATURE_KEYS.includes(feature as PlanFeature)),
  };
}

/** Error raised by the database when a plan limit is reached: 'LIMITE_PLAN:<key>:<limit>'. */
export function planLimitFromError(message: string): { key: PlanLimit; limit: number } | null {
  const match = /LIMITE_PLAN:(\w+):(\d+)/.exec(message);
  if (!match || !LIMIT_KEYS.includes(match[1] as PlanLimit)) return null;
  return { key: match[1] as PlanLimit, limit: Number(match[2]) };
}
