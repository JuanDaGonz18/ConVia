import type { Ionicons } from '@expo/vector-icons';

/**
 * FREE / ConVía+ capability model.
 *
 * Source of truth: the database. `plan_capabilities` (catalog), `plans`
 * (limits), `subscriptions` (each user's plan) and `app_config.beta_mode`,
 * resolved by `get_my_plan()` and enforced by triggers. See docs/PLANES.md.
 *
 * This file is the app's mirror of that model and the only place the app
 * defines it:
 *   - CAPABILITIES: every capability, its plan, whether beta unlocks it, and
 *     the copy that explains it. Must match `plan_capabilities` (a unit test
 *     compares them with the migration).
 *   - PLAN_LIMITS: each plan's limits. Must match `plans.limits` (same test).
 *   - resolveCapabilities / resolveLimits: the same rules the server applies,
 *     used only as a fallback before the server answers (or in demo mode).
 *
 * Screens never check `isPlus` for permissions: they ask `usePlan().can(...)`
 * or `usePlan().limit(...)`, which come from the server.
 */

export type PlanTier = 'free' | 'plus';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired';

/** Numeric limits; `null` means unlimited. Enforced by database triggers (except visible_results, UI only). */
export type PlanLimit = 'vehicles' | 'saved_places' | 'favorite_drivers' | 'visible_results' | 'saved_routes';

type CapabilityInfo = {
  /** 'free': everyone. 'plus': ConVía+. */
  tier: PlanTier;
  /** While the beta lasts, FREE users also get it. */
  betaUnlocked: boolean;
  /** false: modeled for the future, not built in the app yet. */
  implemented: boolean;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export const CAPABILITIES = {
  // Essential (FREE)
  trip_search: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Buscar viajes', description: 'Busca viajes compatibles con tu trayecto.', icon: 'search-outline' },
  request_trip: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Pedir cupo', description: 'Pide un cupo en el viaje de otro miembro de tu comunidad.', icon: 'hand-left-outline' },
  publish_trip: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Publicar viajes', description: 'Ofrece los cupos libres de tu vehículo.', icon: 'add-circle-outline' },
  chat: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Chat del viaje', description: 'Coordina con los integrantes del viaje.', icon: 'chatbubbles-outline' },
  qr_boarding: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Abordaje con QR', description: 'Confirma quién sube al vehículo.', icon: 'qr-code-outline' },
  identity_verification: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Verificación de identidad', description: 'Rostro y licencia de conducción.', icon: 'shield-checkmark-outline' },
  ratings: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Calificaciones', description: 'Califica a conductores y pasajeros.', icon: 'star-outline' },
  trip_history: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Historial de viajes', description: 'Tus viajes como pasajero y conductor.', icon: 'time-outline' },
  basic_map: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Mapa', description: 'Mapa con búsqueda, rutas y viajes cercanos.', icon: 'map-outline' },
  basic_matching: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Viajes compatibles', description: 'Recomendaciones por origen, destino, ruta y horario.', icon: 'git-compare-outline' },
  time_filters: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Filtros de horario', description: 'Lo antes posible, hoy, mañana.', icon: 'calendar-outline' },
  saved_places: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Lugares guardados', description: 'Casa, trabajo, universidad y otros.', icon: 'bookmark-outline' },
  favorites: { tier: 'free', betaUnlocked: false, implemented: true, title: 'Conductores favoritos', description: 'Destaca los viajes de quienes prefieres.', icon: 'heart-outline' },
  // ConVía+ that the beta opens to everyone
  multiple_vehicles: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Varios vehículos', description: 'Registra más de un vehículo y elige con cuál vas en cada viaje.', icon: 'car-sport-outline' },
  repeat_trip: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Repetir viajes', description: 'Publica de nuevo un viaje anterior con un toque.', icon: 'repeat' },
  unlimited_results: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Todos los viajes compatibles', description: 'Ve todos los viajes que te sirven, no solo los primeros.', icon: 'list-outline' },
  advanced_saved_places: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Más lugares y favoritos', description: 'Guarda más lugares y conductores favoritos.', icon: 'bookmarks-outline' },
  advanced_filters: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Filtros avanzados', description: 'Filtra los viajes compatibles por horario, precio, cupos y qué tan cerca te recogen o te dejan.', icon: 'options-outline' },
  recurring_trips: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Viajes recurrentes', description: 'Define tu horario semanal y ConVía publica cada viaje por ti.', icon: 'sync-outline' },
  smart_match_alerts: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Alertas de viajes', description: 'Te avisamos cuando se publica un viaje compatible con tu ruta.', icon: 'notifications-outline' },
  advanced_preferences: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Preferencias avanzadas', description: 'Tu horario, punto de recogida, distancias y orden preferidos, sin cambiar la compatibilidad.', icon: 'construct-outline' },
  advanced_trip_stats: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Estadísticas de viajes', description: 'Kilómetros, ahorro y viajes compartidos.', icon: 'stats-chart-outline' },
  advanced_driver_stats: { tier: 'plus', betaUnlocked: true, implemented: true, title: 'Estadísticas de conductor', description: 'Viajes, pasajeros, ocupación, aportes y calificaciones.', icon: 'analytics-outline' },
  // ConVía+ that always follow the real plan (advantages over others, or what is being tested)
  google_maps: { tier: 'plus', betaUnlocked: false, implemented: true, title: 'Mapas de Google', description: 'Mapas de Google con lugares tocables y la cartografía más detallada.', icon: 'map-outline' },
  map_traffic: { tier: 'plus', betaUnlocked: false, implemented: true, title: 'Tráfico en el mapa', description: 'Mira el tráfico en tiempo real para planear mejor tu salida.', icon: 'speedometer-outline' },
  smart_match_priority: { tier: 'plus', betaUnlocked: false, implemented: true, title: 'Prioridad en solicitudes', description: 'Entre solicitudes igual de compatibles, la tuya va primero.', icon: 'trending-up-outline' },
  plus_badge: { tier: 'plus', betaUnlocked: false, implemented: true, title: 'Distintivo ConVía+', description: 'Tu perfil muestra el distintivo ConVía+.', icon: 'sparkles-outline' },
  highlighted_profile: { tier: 'plus', betaUnlocked: false, implemented: true, title: 'Perfil destacado', description: 'Tu foto se destaca en viajes y solicitudes. No cambia la compatibilidad.', icon: 'ribbon-outline' },
} as const satisfies Record<string, CapabilityInfo>;

export type Capability = keyof typeof CAPABILITIES;

const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];
const LIMIT_KEYS: PlanLimit[] = ['vehicles', 'saved_places', 'favorite_drivers', 'visible_results', 'saved_routes'];

/** Each plan's limits (what applies once the beta ends). Must match `plans.limits`. */
export const PLAN_LIMITS: Record<PlanTier, Record<PlanLimit, number | null>> = {
  free: { vehicles: 1, saved_places: 3, favorite_drivers: 10, visible_results: 5, saved_routes: 1 },
  plus: { vehicles: 10, saved_places: 20, favorite_drivers: null, visible_results: null, saved_routes: 10 },
};

/** Only used before the server answers or in demo mode; the server decides. */
export const FALLBACK_BETA_MODE = true;

/** The same rule as private.has_capability(). */
export function resolveCapabilities(tier: PlanTier, betaMode: boolean): Capability[] {
  return CAPABILITY_KEYS.filter((key) => {
    const info: CapabilityInfo = CAPABILITIES[key];
    return info.tier === 'free' || tier === 'plus' || (betaMode && info.betaUnlocked);
  });
}

/** The same rule as private.plan_limit(): during the beta everyone gets ConVía+ limits. */
export function resolveLimits(tier: PlanTier, betaMode: boolean): Record<PlanLimit, number | null> {
  return { ...PLAN_LIMITS[betaMode ? 'plus' : tier] };
}

export type Plan = {
  tier: PlanTier;
  name: string;
  status: SubscriptionStatus;
  /** End of the paid period; null when it does not expire. */
  currentPeriodEnd: string | null;
  /** Limits in force now (relaxed during the beta). */
  limits: Record<PlanLimit, number | null>;
  /** The plan's own limits (what applies once the beta ends). */
  planLimits: Record<PlanLimit, number | null>;
  /** Capabilities in force now (plan + beta). */
  capabilities: Capability[];
  betaMode: boolean;
};

function fallbackPlan(tier: PlanTier, betaMode = FALLBACK_BETA_MODE): Plan {
  return {
    tier,
    name: tier === 'plus' ? 'ConVía+' : 'ConVía',
    status: 'active',
    currentPeriodEnd: null,
    limits: resolveLimits(tier, betaMode),
    planLimits: { ...PLAN_LIMITS[tier] },
    capabilities: resolveCapabilities(tier, betaMode),
    betaMode,
  };
}

export const DEFAULT_PLANS: Record<PlanTier, Plan> = { free: fallbackPlan('free'), plus: fallbackPlan('plus') };

/** True when the capability is ConVía+ but the user has it only because of the beta. */
export function isBetaPerk(plan: Plan, capability: Capability) {
  return plan.tier !== 'plus' && CAPABILITIES[capability].tier === 'plus' && plan.capabilities.includes(capability);
}

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
    title: 'Vehículos registrados',
    icon: 'car-sport-outline',
    freeText: (limit) => `Las cuentas gratis pueden registrar ${plural(limit, 'vehículo', 'vehículos')}.`,
    plusText: (limit) => (limit === null
      ? 'Registra todos tus vehículos con ConVía+.'
      : `Registra hasta ${plural(limit, 'vehículo', 'vehículos')} con ConVía+.`),
    reachedText: (limit) => `Ya registraste el máximo de tu plan (${plural(limit, 'vehículo', 'vehículos')}).`,
  },
  saved_places: {
    title: 'Lugares guardados',
    icon: 'bookmark-outline',
    freeText: (limit) => `Puedes guardar hasta ${plural(limit, 'lugar', 'lugares')}.`,
    plusText: (limit) => (limit === null ? 'Guarda todos los lugares que quieras con ConVía+.' : `Guarda hasta ${plural(limit, 'lugar', 'lugares')} con ConVía+.`),
    reachedText: (limit) => `Puedes guardar hasta ${plural(limit, 'lugar', 'lugares')}.`,
  },
  favorite_drivers: {
    title: 'Conductores favoritos',
    icon: 'star-outline',
    freeText: (limit) => `Puedes tener hasta ${plural(limit, 'conductor favorito', 'conductores favoritos')}.`,
    plusText: (limit) => (limit === null ? 'Marca todos los favoritos que quieras con ConVía+.' : `Hasta ${plural(limit, 'conductor favorito', 'conductores favoritos')} con ConVía+.`),
    reachedText: (limit) => `Ya tienes el máximo de ${plural(limit, 'conductor favorito', 'conductores favoritos')} de tu plan.`,
  },
  visible_results: {
    title: 'Viajes compatibles visibles',
    icon: 'list-outline',
    freeText: (limit) => `Con el plan gratis ves los ${plural(limit, 'viaje más compatible', 'viajes más compatibles')}.`,
    plusText: (limit) => (limit === null ? 'Ve todos los viajes compatibles con ConVía+.' : `Ve hasta ${plural(limit, 'viaje', 'viajes')} con ConVía+.`),
    reachedText: (limit) => `Tu plan muestra hasta ${plural(limit, 'viaje', 'viajes')}.`,
  },
  saved_routes: {
    title: 'Rutas guardadas',
    icon: 'git-branch-outline',
    freeText: (limit) => `Puedes guardar ${plural(limit, 'ruta', 'rutas')}.`,
    plusText: (limit) => (limit === null ? 'Guarda todas tus rutas con ConVía+.' : `Guarda hasta ${plural(limit, 'ruta', 'rutas')} con ConVía+.`),
    reachedText: (limit) => `Ya guardaste el máximo de tu plan (${plural(limit, 'ruta', 'rutas')}).`,
  },
};

/** True when `used` already reached the plan's limit for `key`. */
export function isAtLimit(plan: Plan, key: PlanLimit, used: number) {
  const limit = plan.limits[key];
  return limit !== null && used >= limit;
}

function parseLimits(value: unknown): Record<PlanLimit, number | null> {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(LIMIT_KEYS.map((key) => {
    const limit = raw[key];
    // A key missing on the server means unlimited, as in the database.
    return [key, typeof limit === 'number' && Number.isFinite(limit) ? limit : null];
  })) as Record<PlanLimit, number | null>;
}

/** Turns the `get_my_plan` row into a Plan, ignoring keys this app version does not know. */
export function parsePlan(row: {
  tier: string;
  name: string;
  status: string;
  current_period_end: string | null;
  limits: unknown;
  features?: string[] | null;
  plan_limits?: unknown;
  capabilities?: string[] | null;
  beta_mode?: boolean | null;
}): Plan {
  const tier: PlanTier = row.tier === 'plus' ? 'plus' : 'free';
  const betaMode = row.beta_mode ?? false;
  const known = (keys: string[] | null | undefined) => (keys ?? []).filter((key): key is Capability => key in CAPABILITIES);
  return {
    tier,
    name: row.name || fallbackPlan(tier).name,
    status: (['active', 'trialing', 'past_due', 'canceled', 'expired'].includes(row.status) ? row.status : 'active') as SubscriptionStatus,
    currentPeriodEnd: row.current_period_end,
    limits: parseLimits(row.limits),
    planLimits: row.plan_limits === undefined ? parseLimits(row.limits) : parseLimits(row.plan_limits),
    // Servers older than the capability model only sent the plan's features.
    capabilities: row.capabilities ? known(row.capabilities) : [...resolveCapabilities('free', false), ...known(row.features)],
    betaMode,
  };
}

/** Error raised by the database when the plan lacks a capability: 'CAPACIDAD_PLAN:<key>'. */
export function capabilityFromError(message: string): Capability | null {
  const match = /CAPACIDAD_PLAN:(\w+)/.exec(message);
  return match && match[1] in CAPABILITIES ? (match[1] as Capability) : null;
}

/** Error raised by the database when a plan limit is reached: 'LIMITE_PLAN:<key>:<limit>'. */
export function planLimitFromError(message: string): { key: PlanLimit; limit: number } | null {
  const match = /LIMITE_PLAN:(\w+):(\d+)/.exec(message);
  if (!match || !LIMIT_KEYS.includes(match[1] as PlanLimit)) return null;
  return { key: match[1] as PlanLimit, limit: Number(match[2]) };
}
