import { fetch as streamingFetch } from 'expo/fetch';

import { supabase } from '@/lib/supabase';

/**
 * The ride-matching agent (Edge Function match-agent, Muse Spark Open). A run streams its real
 * progress (NDJSON) and ends with a result: a verified proposal, a question, "nothing fits"…
 * Confirm is the user's approval, bound to the exact proposal by its hash. The trace stays in
 * agent_runs/agent_steps (RLS: own runs only).
 */
const FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/match-agent`;

export type AgentProgress = 'understanding' | 'searching' | 'checking' | 'verifying';
export type AgentStatus = 'proposed' | 'clarify' | 'no_match' | 'answered' | 'unverified' | 'limit' | 'failed' | 'paused';

export type AgentOption = {
  trip_id: string;
  departure: string;
  minutes_from_requested: number;
  from: string;
  to: string;
  pickup_km: number | null;
  seats_left: number;
  price_cop: number;
  driver_first_name: string;
  driver_rating: number | null;
  vehicle: { brand: string; color: string; plate_masked: string } | null;
  verified: boolean;
};

export type AgentResult = {
  run_id: string | null;
  status: AgentStatus;
  reply: string | null;
  spec: { origin: { label: string } | null; destination: { label: string }; date: string; time: string; flex_minutes: number; seats: number } | null;
  options: AgentOption[];
  proposal: { hash: string; trip_id: string; seats: number; price_cop: number; departure: string; pickup: string | null; dropoff: string } | null;
  error: string | null;
};

async function token() {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error('AUTH_REQUIRED');
  return value;
}

const headersFor = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  'Content-Type': 'application/json',
});

export const agentService = {
  /** One run: progress events as they happen, then the result. */
  async ask(message: string, language: 'es' | 'en', onProgress: (step: AgentProgress, status: 'active' | 'done') => void): Promise<AgentResult> {
    const res = await streamingFetch(FUNCTION_URL, {
      method: 'POST',
      headers: { ...headersFor(await token()), Accept: 'application/x-ndjson' },
      body: JSON.stringify({ message, language }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP_${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('STREAM_UNAVAILABLE');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line) as { type: 'progress'; step: AgentProgress; status: 'active' | 'done' } | ({ type: 'result' } & AgentResult);
        if (event.type === 'progress') onProgress(event.step, event.status);
        else return event;
      }
      if (done) throw new Error('STREAM_ENDED');
    }
  },

  /** The user's approval of the exact proposal (after the face check). */
  async confirm(runId: string, proposalHash: string): Promise<{ requestId: string }> {
    const res = await fetch(`${FUNCTION_URL}/confirm`, {
      method: 'POST',
      headers: headersFor(await token()),
      body: JSON.stringify({ run_id: runId, proposal_hash: proposalHash }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; request_id?: string; error?: string } | null;
    if (!res.ok || !body?.ok || !body.request_id) throw new Error(body?.error ?? `HTTP_${res.status}`);
    return { requestId: body.request_id };
  },
};
