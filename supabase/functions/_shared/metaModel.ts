/**
 * Meta Model API transport shared by the AI Edge Functions: auth, timeouts,
 * one backoff retry on 429, durations and billed usage in the logs, and Muse
 * Spark 1.3 calls with strict JSON. Plain fetch and no Deno APIs, so the
 * same code runs in the Edge Functions and in Node tests.
 */

export const META_MODEL_API = 'https://api.meta.ai/v1';
/** The only chat/vision model the functions use. */
export const MUSE_MODEL = 'muse-spark-1.3';

export type ModelErrorKind = 'timeout' | 'rate_limited' | 'http' | 'malformed';

export class ModelError extends Error {
  kind: ModelErrorKind;
  constructor(kind: ModelErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export type ModelLog = (event: string, data: Record<string, unknown>) => void;

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type TransportOptions = { apiKey: string; baseUrl?: string; log?: ModelLog };

const MUSE_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Transport = {
  request(label: string, path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response>;
  json(label: string, path: string, body: unknown, timeoutMs: number): Promise<unknown>;
};

/** HTTP to the Meta Model API: auth, timeouts, one backoff retry on 429, durations and billed usage in the logs. */
export function createTransport({ apiKey, baseUrl = META_MODEL_API, log = () => undefined }: TransportOptions): Transport {
  const base = baseUrl.replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${apiKey}` };

  /** One backoff retry on 429; every attempt logs its own duration. */
  async function request(label: string, path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    let backoffMs = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (backoffMs) await sleep(backoffMs);
      const started = performance.now();
      let status = 0;
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        const res = await fetch(`${base}${path}`, { ...init, headers: { ...auth, ...init.headers }, signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
        status = res.status;
        if (res.status === 429 && attempt === 1) {
          await res.body?.cancel();
          const retryAfter = Number(res.headers.get('retry-after'));
          backoffMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : 500 + Math.random() * 250;
          continue;
        }
        if (res.status === 429) throw new ModelError('rate_limited', 'Rate limited');
        if (!res.ok) throw new ModelError('http', `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return res;
      } catch (error) {
        if (error instanceof ModelError || signal?.aborted) throw error;
        if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new ModelError('timeout', `Timed out after ${timeoutMs} ms`);
        }
        throw new ModelError('http', error instanceof Error ? error.message : String(error));
      } finally {
        log('model_call', { call: label, attempt, status, ms: Math.round(performance.now() - started) });
      }
    }
    throw new ModelError('rate_limited', 'Rate limited');
  }

  async function json(label: string, path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    const res = await request(label, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ModelError('malformed', 'Response is not JSON');
    }
    // Billed units (SAM frames, Muse tokens), for the cost per verification.
    const usage = (data as { usage?: unknown } | null)?.usage;
    if (usage) log('model_usage', { call: label, usage });
    return data;
  }

  return { request, json };
}

export type StructuredImageRequest = {
  label: string;
  system: string;
  text: string;
  imageDataUrl: string;
  schemaName: string;
  schema: Record<string, unknown>;
  reasoningEffort: ReasoningEffort;
};

/** Muse Spark on one image with strict JSON (https://dev.meta.ai/docs/structured-output). Returns the parsed object; the caller checks its shape. */
export async function museStructured(transport: Transport, { label, system, text, imageDataUrl, schemaName, schema, reasoningEffort }: StructuredImageRequest): Promise<unknown> {
  const data = await transport.json(label, '/chat/completions', {
    model: MUSE_MODEL,
    reasoning_effort: reasoningEffort,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } },
  }, MUSE_TIMEOUT_MS) as { choices?: { message?: { content?: unknown } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new ModelError('malformed', 'Muse response without content');
  try {
    return JSON.parse(content);
  } catch {
    throw new ModelError('malformed', 'Muse content is not JSON');
  }
}
