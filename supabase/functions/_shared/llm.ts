/**
 * Chat with tools for the trip assistant (match-agent): Muse Spark 1.3 on the
 * Meta Model API (/v1/chat/completions, MODEL_API_KEY). One provider only.
 *
 * The API accepts only tool_choice "auto". So a forced tool ({ name }) is sent
 * as that single tool, and 'required' as "auto": the agent loop already treats
 * a reply without a tool call as a failed turn and asks again.
 *
 * Every answer says who produced it: the model name as the response returned
 * it, the request id and the usage; failed attempts are returned too, so the
 * trace shows retries. No Deno globals: the Edge Function passes its
 * environment (configFromEnv) and `npm run test:functions` runs this module
 * under Node with a fake fetch.
 */
import { META_MODEL_API, MUSE_MODEL } from './metaModel.ts';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** 'required' = any tool; { name } = only that tool (sent as the only tool, see above). Default 'auto'. */
  toolChoice?: 'auto' | 'required' | { name: string };
  /** Tokens per call, reasoning included: the model reasons before answering, so leave room. */
  maxTokens?: number;
  /** Per attempt. */
  timeoutMs?: number;
};

export type ProviderName = 'meta';

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
};

export type Usage = { promptTokens: number; completionTokens: number; reasoningTokens: number; cachedTokens: number };

export type FailureKind = 'timeout' | 'network' | 'http_429' | 'http_5xx' | 'http_4xx' | 'invalid_json' | 'empty_reply';

export type Attempt = {
  provider: ProviderName;
  ok: boolean;
  failure: FailureKind | null;
  status: number | null;
  latencyMs: number;
  /** Model name in the response (null when there was no valid response). */
  returnedModel: string | null;
  requestId: string | null;
  finishReason: string | null;
  usage: Usage | null;
  costUsd: number;
  detail: string | null;
};

export type ChatResult = {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  provider: ProviderName;
  model: string;
  requestId: string | null;
  responseId: string | null;
  servedBy: Record<string, string>;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  /** Every attempt, failed ones first and the successful one last. */
  attempts: Attempt[];
};

export class LlmUnavailableError extends Error {
  readonly attempts: Attempt[];

  constructor(attempts: Attempt[]) {
    super(`The model did not answer: ${attempts.map((attempt) => attempt.failure).join(', ') || 'not configured'}`);
    this.name = 'LlmUnavailableError';
    this.attempts = attempts;
  }
}

export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_TIMEOUT_MS = 12_000;
/** Attempts per step: a 429, a 5xx or a network error is retried once. */
const MAX_ATTEMPTS = 2;
const RETRYABLE: ReadonlySet<FailureKind> = new Set(['http_429', 'http_5xx', 'network']);

/** USD per 1M tokens for muse-spark-1.3 (standard), from dev.meta.ai/docs/pricing-rate-limits. Reasoning bills as output. */
export const PRICES = { input: 1.25, cachedInput: 0.15, output: 4.25 };

export function costUsd(usage: Usage) {
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  return ((usage.promptTokens - cached) * PRICES.input + cached * PRICES.cachedInput + usage.completionTokens * PRICES.output) / 1_000_000;
}

/** Reasoning tokens in completion_tokens_details; cached tokens in prompt_tokens_details or at the top level. */
export function readUsage(raw: unknown): Usage {
  const usage = (raw ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  };
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0,
  };
}

/** The Meta Model API settings from the environment; null without MODEL_API_KEY (the function then answers 503). */
export function configFromEnv(env: (name: string) => string | undefined): LlmConfig | null {
  const apiKey = env('MODEL_API_KEY')?.trim();
  if (!apiKey) return null;
  const effort = env('AGENT_REASONING_EFFORT');
  return {
    baseUrl: (env('MODEL_API_BASE_URL')?.trim() || META_MODEL_API).replace(/\/+$/, ''),
    apiKey,
    model: MUSE_MODEL,
    reasoningEffort: effort === 'minimal' || effort === 'medium' || effort === 'high' ? effort : 'low',
  };
}

type ChatCompletion = {
  id?: string;
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; tool_calls?: ToolCall[] | null } }[];
  usage?: unknown;
};

function failureForStatus(status: number): FailureKind {
  if (status === 429) return 'http_429';
  return status >= 500 ? 'http_5xx' : 'http_4xx';
}

/** The tools and tool_choice to send: only "auto" is accepted, so a forced tool is the only one offered. */
export function toolsForRequest(request: Pick<ChatRequest, 'tools' | 'toolChoice'>) {
  if (!request.tools?.length) return {};
  const choice = request.toolChoice;
  const forced = typeof choice === 'object' ? request.tools.filter((tool) => tool.function.name === choice.name) : [];
  return { tools: forced.length ? forced : request.tools, tool_choice: 'auto' as const };
}

export function createLlm({ config, fetch: fetchImpl = globalThis.fetch }: { config: LlmConfig; fetch?: typeof fetch }) {
  async function attempt(request: ChatRequest): Promise<{ attempt: Attempt; result?: ChatResult }> {
    const started = performance.now();
    const base = { provider: 'meta' as const, returnedModel: null, requestId: null, finishReason: null, usage: null, costUsd: 0 };
    const failed = (failure: FailureKind, status: number | null, detail: string | null) => ({
      attempt: { ...base, ok: false, failure, status, latencyMs: Math.round(performance.now() - started), detail: detail?.slice(0, 300) ?? null },
    });
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: request.messages,
          ...toolsForRequest(request),
          reasoning_effort: config.reasoningEffort,
          max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      return failed(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', null, String(error));
    }
    const headerRequestId = response.headers.get('x-request-id');
    if (!response.ok) {
      const result = failed(failureForStatus(response.status), response.status, await response.text().catch(() => null));
      return { attempt: { ...result.attempt, requestId: headerRequestId } };
    }
    let body: ChatCompletion;
    try {
      body = await response.json() as ChatCompletion;
    } catch (error) {
      return failed('invalid_json', response.status, String(error));
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content?.trim() ? choice.message.content : null;
    const toolCalls = choice?.message?.tool_calls ?? [];
    const usage = readUsage(body.usage);
    const cost = costUsd(usage);
    const latencyMs = Math.round(performance.now() - started);
    const requestId = headerRequestId ?? body.id ?? null;
    const finishReason = choice?.finish_reason ?? null;
    const returnedModel = body.model ?? null;
    // No text and no tool call (e.g. every token spent on reasoning): a failed step.
    if (!content && !toolCalls.length) {
      return { attempt: { ...base, ok: false, failure: 'empty_reply', status: response.status, latencyMs, returnedModel, requestId, finishReason, usage, costUsd: cost, detail: null } };
    }
    const done: Attempt = { ...base, ok: true, failure: null, status: response.status, latencyMs, returnedModel, requestId, finishReason, usage, costUsd: cost, detail: null };
    return {
      attempt: done,
      result: {
        content,
        toolCalls,
        finishReason,
        provider: 'meta',
        model: returnedModel ?? config.model,
        requestId,
        responseId: body.id ?? null,
        servedBy: {},
        usage,
        costUsd: cost,
        latencyMs,
        attempts: [],
      },
    };
  }

  return {
    /** One model step; a 429, 5xx or network failure is retried once. */
    async chat(request: ChatRequest): Promise<ChatResult> {
      const attempts: Attempt[] = [];
      for (let index = 0; index < MAX_ATTEMPTS; index++) {
        const { attempt: tried, result } = await attempt(request);
        attempts.push(tried);
        if (result) return { ...result, attempts };
        if (!tried.failure || !RETRYABLE.has(tried.failure)) break;
      }
      throw new LlmUnavailableError(attempts);
    },
  };
}
