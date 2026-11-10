/**
 * Error and usage reporting, the parts that don't need React Native (tested with Node).
 * What leaves the phone goes to our own Supabase only (client_errors / app_events, migration 045):
 * never names, e-mails, phone numbers, addresses, coordinates, ids or tokens.
 */

/** The only events the server accepts (same list as public.track_app_event, migration 045). */
export const APP_EVENTS = [
  'signup', 'login', 'search', 'request_seat', 'publish_trip',
  'accept_request', 'boarding_qr', 'pickup_verify', 'chat_send', 'plan_view',
] as const;
export type AppEventName = (typeof APP_EVENTS)[number];
export type EventProps = Record<string, string | number | boolean>;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?/g;
const BEARER = /\b(Bearer|apikey|token|key|secret|password)([=:\s"']+)[^\s"'&,;]+/gi;
const QUERY = /(https?:\/\/[^\s?#"']+)\?[^\s#"']*/g;
// Coordinates (two decimals with 4+ places) and long digit runs (phones, documents, plates with digits).
const COORDS = /-?\d{1,3}\.\d{4,}/g;
const DIGITS = /\+?\d[\d\s-]{6,}\d/g;

/**
 * The text without personal data or secrets, cut to `max` characters. `numbers: false` keeps digit
 * runs (stack frames: bundle line and column numbers).
 */
export function scrubText(text: unknown, max: number, numbers = true): string {
  const raw = typeof text === 'string' ? text : text == null ? '' : String(text);
  const scrubbed = raw
    .replace(JWT, '[token]')
    .replace(BEARER, '$1$2[redacted]')
    .replace(QUERY, '$1?[query]')
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]');
  return (numbers ? scrubbed.replace(COORDS, '[n]').replace(DIGITS, '[n]') : scrubbed).trim().slice(0, max);
}

/** First lines of the stack, scrubbed (file:line:column references survive). */
export function cleanStack(stack: unknown, maxLines = 25, max = 4000): string | null {
  if (typeof stack !== 'string' || !stack.trim()) return null;
  const lines = stack.split('\n').slice(0, maxLines).map((line) => scrubText(line, 300, false)).filter(Boolean);
  return lines.join('\n').slice(0, max) || null;
}

/** An error-like value as message + stack. */
export function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    const message = scrubText(`${error.name && error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`, 500);
    return { message: message || 'Error', stack: cleanStack(error.stack) };
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return { message: scrubText((error as { message: unknown }).message, 500) || 'Error', stack: null };
  }
  return { message: scrubText(error, 500) || 'Unknown error', stack: null };
}

/** Same rule as the server: short lowercase keys, scalar values, strings up to 40, at most 8. */
export function cleanProps(props: Record<string, unknown> | undefined): EventProps {
  const out: EventProps = {};
  if (!props) return out;
  for (const key of Object.keys(props).sort()) {
    if (Object.keys(out).length >= 8) break;
    if (!/^[a-z_]{1,24}$/.test(key)) continue;
    const value = props[key];
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= 40) out[key] = scrubText(value, 40);
  }
  return out;
}

/** The route pattern (e.g. "chat/[tripId]"), never the ids in it. */
export function screenName(segments: readonly string[]): string {
  return (segments.length ? segments.join('/') : 'index').slice(0, 120);
}

/**
 * Drops repeats: the same key at most once per `windowMs`, and at most `max` reports per session,
 * so a render loop doesn't burn the server's hourly limit.
 */
export function createThrottle(windowMs: number, max: number) {
  const last = new Map<string, number>();
  let sent = 0;
  return (key: string, now = Date.now()) => {
    if (sent >= max) return false;
    const previous = last.get(key);
    if (previous !== undefined && now - previous < windowMs) return false;
    last.set(key, now);
    sent += 1;
    return true;
  };
}
