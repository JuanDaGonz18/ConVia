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
  return date.toLocaleString('es-CO', {
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
  if (isSameDay(date, now)) return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'ayer';
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

export function formatPrice(value: number) {
  return `$${value.toLocaleString('es-CO')}`;
}

// Technical errors from the network, Supabase or Postgres, mapped to messages a
// user can act on. Messages raised by our own database functions are already in
// Spanish and are shown as they are.
const FRIENDLY_ERRORS: [RegExp, string][] = [
  [/network request failed|failed to fetch|fetch failed|networkerror|timed? ?out|aborted/i, 'Sin conexión. Revisa tu internet e inténtalo de nuevo.'],
  [/jwt|refresh token|session (?:not found|expired|missing)|auth_required|not authenticated/i, 'Tu sesión expiró. Cierra sesión y vuelve a ingresar.'],
  [/row-level security|permission denied|not authorized|unauthorized/i, 'No tienes permiso para realizar esta acción.'],
  [/duplicate key|already exists|unique constraint/i, 'Ese registro ya existe.'],
  [/rate limit|too many requests/i, 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'],
  [/supabase_env_missing|supabase_required/i, 'La app no está conectada al servidor. Contacta al administrador.'],
  [/PERFIL_NO_ENCONTRADO/, 'Tu cuenta no tiene perfil en WheelsApp. Contacta al administrador.'],
  [/DOMINIO_NO_PERMITIDO/, 'Usa el correo de tu institución (por ejemplo @unisabana.edu.co).'],
];

// Signs that a message is an internal/technical one we should not show verbatim.
const TECHNICAL_ERROR = /violates|relation "|column "|function .*does not exist|syntax error|PGRST|invalid input syntax|null value in column|foreign key|constraint|undefined|TypeError|\bnull\b/i;

/** The original message of any thrown value, for matching specific errors. */
export function rawErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '';
}

/** A message safe to show to the user, in Spanish. */
export function errorMessage(error: unknown, fallback: string) {
  const message = rawErrorMessage(error).trim();
  if (!message) return fallback;

  for (const [pattern, friendly] of FRIENDLY_ERRORS) {
    if (pattern.test(message)) return friendly;
  }
  if (TECHNICAL_ERROR.test(message)) {
    if (__DEV__) console.warn('[error]', message);
    return fallback;
  }
  return message;
}
