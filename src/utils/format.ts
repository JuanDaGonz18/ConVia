import i18n, { localeTag } from '@/i18n';
import { CAPABILITIES, capabilityFromError, LIMIT_INFO, planLimitFromError } from '@/subscription/plans';

function toDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatDateTime(value: string) {
  const date = toDate(value);
  if (!date) return value;
  return date.toLocaleString(localeTag(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "10:42 a. m." today, "ayer", or "12 sept." for older messages. */
export function formatMessageTime(value: string) {
  const date = toDate(value);
  if (!date) return '';
  const now = new Date();
  if (isSameDay(date, now)) return date.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return i18n.t('common.yesterday');
  return date.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short' });
}

/** "350 m", "3,2 km" ("3.2 km" in English); never below 50 m. */
export function formatDistance(km: number) {
  if (km < 1) return i18n.t('distance.meters', { value: Math.max(50, Math.round((km * 1000) / 50) * 50) });
  return i18n.t('distance.km', { value: km.toLocaleString(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

export function formatPrice(value: number) {
  // Pesos with the language's digit grouping: $12.000 in Spanish, $12,000 in English.
  return `$${value.toLocaleString(localeTag())}`;
}

// Technical errors from the network, Supabase or Postgres, mapped to messages a
// user can act on. Messages raised by our own database functions are already in
// Spanish and are shown as they are. The second value is a key under errors.*.
const FRIENDLY_ERRORS: [RegExp, string][] = [
  [/network request failed|failed to fetch|fetch failed|networkerror|timed? ?out|aborted/i, 'offline'],
  [/jwt|refresh token|session (?:not found|expired|missing)|auth_required|not authenticated/i, 'session'],
  [/row-level security|permission denied|not authorized|unauthorized/i, 'permission'],
  [/duplicate key|already exists|unique constraint/i, 'duplicate'],
  [/rate limit|too many requests/i, 'rateLimit'],
  [/supabase_env_missing|supabase_required/i, 'notConnected'],
  [/PERFIL_NO_ENCONTRADO/, 'noProfile'],
  [/DOMINIO_NO_PERMITIDO/, 'domain'],
];

// Signs that a message is an internal/technical one we should not show verbatim.
const TECHNICAL_ERROR = /violates|relation "|column "|function .*does not exist|syntax error|PGRST|invalid input syntax|null value in column|foreign key|constraint|undefined|TypeError|\bnull\b/i;

/** The original message of any thrown value, for matching specific errors. */
export function rawErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '';
}

/** A message safe to show to the user, in their language (server messages stay in Spanish). */
export function errorMessage(error: unknown, fallback: string) {
  const message = rawErrorMessage(error).trim();
  if (!message) return fallback;

  // A plan limit enforced by the database ('LIMITE_PLAN:<key>:<limit>').
  const planLimit = planLimitFromError(message);
  if (planLimit) return LIMIT_INFO[planLimit.key].reachedText(planLimit.limit);
  // A ConVía+ capability the plan does not include ('CAPACIDAD_PLAN:<key>').
  const capability = capabilityFromError(message);
  if (capability) return `${CAPABILITIES[capability].title} es parte de ConVía+.`;

  for (const [pattern, key] of FRIENDLY_ERRORS) {
    if (pattern.test(message)) return i18n.t(`errors.${key}`);
  }
  if (TECHNICAL_ERROR.test(message)) {
    if (__DEV__) console.warn('[error]', message);
    return fallback;
  }
  return message;
}
