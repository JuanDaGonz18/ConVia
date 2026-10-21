/**
 * fetch for the Supabase client: every request gets a timeout, and only
 * reads (GET/HEAD) are retried, a couple of times, with exponential backoff
 * and jitter, on network errors or 502/503/504. Writes and RPCs (POST/PATCH/
 * DELETE) are never retried here, so nothing is created or charged twice;
 * neither are 4xx answers such as an expired session (401) or a denied
 * permission (403). Pure TypeScript, tested in resilientFetch.test.ts.
 */
export type ResilientFetchOptions = {
  timeoutMs?: number;
  /** Extra attempts for reads. */
  retries?: number;
  baseDelayMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_STATUS = new Set([502, 503, 504]);

/** A message the app already turns into "Sin conexión…" (see utils/format.ts). */
export class RequestTimeoutError extends Error {
  constructor() {
    super('Network request failed: timed out');
    this.name = 'RequestTimeoutError';
  }
}

export function backoffDelay(attempt: number, baseDelayMs: number, random: () => number) {
  // Full jitter: a random wait up to base × 2^attempt.
  return Math.round(random() * baseDelayMs * 2 ** attempt);
}

export function createResilientFetch(baseFetch: typeof fetch, options: ResilientFetchOptions = {}): typeof fetch {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async (input, init) => {
    const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    const canRetry = method === 'GET' || method === 'HEAD';
    const callerSignal = init?.signal ?? undefined;

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const forwardAbort = () => controller.abort();
      callerSignal?.addEventListener('abort', forwardAbort);
      try {
        const response = await baseFetch(input, { ...init, signal: controller.signal });
        if (canRetry && RETRY_STATUS.has(response.status) && attempt < retries) {
          await sleep(backoffDelay(attempt, baseDelayMs, random));
          continue;
        }
        return response;
      } catch (error) {
        // The caller cancelled on purpose: don't retry or rename the error.
        if (callerSignal?.aborted) throw error;
        if (canRetry && attempt < retries) {
          await sleep(backoffDelay(attempt, baseDelayMs, random));
          continue;
        }
        throw timedOut ? new RequestTimeoutError() : error;
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', forwardAbort);
      }
    }
  };
}
