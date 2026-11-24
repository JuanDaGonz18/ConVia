/**
 * Per-feature AI switch (app_config.ai_features, migration ai_feature_switches). A feature not in
 * the list answers 503 MODEL_UNAVAILABLE before any model call, exactly as without MODEL_API_KEY,
 * so turning one off never spends tokens. Read with the service role and cached for a minute.
 * If the read fails the feature stays on: the per-user and daily caps still bound the spend.
 * No Deno globals, so Node can test it.
 */

export const AI_FEATURES = ['student_card', 'vehicle_verify', 'vehicle_suggest', 'pickup_verify', 'assistant'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

type ConfigReader = () => PromiseLike<{ data: { ai_features?: string[] | null } | null; error: unknown }>;

const TTL_MS = 60_000;

export function createAiSwitch(read: ConfigReader, now: () => number = Date.now) {
  let cached: { at: number; features: Set<string> | null } | null = null;
  return async function aiFeatureEnabled(feature: AiFeature): Promise<boolean> {
    if (!cached || now() - cached.at > TTL_MS) {
      let features: Set<string> | null = null;
      try {
        const { data, error } = await read();
        if (!error && Array.isArray(data?.ai_features)) features = new Set(data.ai_features);
      } catch {
        features = null;
      }
      cached = { at: now(), features };
    }
    return cached.features === null || cached.features.has(feature);
  };
}
