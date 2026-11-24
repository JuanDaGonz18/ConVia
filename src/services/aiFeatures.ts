import { useEffect, useState } from 'react';

import { isSupabaseEnabled, supabase } from '@/lib/supabase';

/**
 * Which AI features are switched on (app_config.ai_features). The server refuses the ones that are
 * off before calling any model; this only hides their buttons. Unknown until loaded: hidden.
 */
export type AiFeature = 'student_card' | 'vehicle_verify' | 'vehicle_suggest' | 'pickup_verify' | 'assistant';

const TTL_MS = 5 * 60_000;
let cache: { at: number; features: Set<string> } | null = null;
let inFlight: Promise<Set<string>> | null = null;

export async function loadAiFeatures(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.features;
  if (!isSupabaseEnabled) return new Set();
  inFlight ??= (async () => {
    try {
      const { data, error } = await supabase.from('app_config').select('ai_features').eq('id', true).maybeSingle();
      if (error) throw error;
      const features = new Set(data?.ai_features ?? []);
      cache = { at: Date.now(), features };
      return features;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useAiFeature(feature: AiFeature): boolean {
  const [enabled, setEnabled] = useState(() => cache?.features.has(feature) ?? false);
  useEffect(() => {
    let active = true;
    void loadAiFeatures()
      .then((features) => { if (active) setEnabled(features.has(feature)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [feature]);
  return enabled;
}

/** All switched-on features (null until loaded), for screens that list several. */
export function useAiFeatures(): Set<string> | null {
  const [features, setFeatures] = useState<Set<string> | null>(() => cache?.features ?? null);
  useEffect(() => {
    let active = true;
    void loadAiFeatures()
      .then((loaded) => { if (active) setFeatures(loaded); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return features;
}

/** Plan capabilities and limits that only work while an AI feature is on. */
export const AI_FEATURE_OF: Partial<Record<string, AiFeature>> = {
  trip_assistant: 'assistant',
  vehicle_autofill: 'vehicle_suggest',
  pickup_verification: 'pickup_verify',
  pickup_verifications_month: 'pickup_verify',
};

/** False only when the item needs an AI feature that is known to be off. */
export function aiItemShown(key: string, features: Set<string> | null) {
  const feature = AI_FEATURE_OF[key];
  return !feature || !features || features.has(feature);
}
