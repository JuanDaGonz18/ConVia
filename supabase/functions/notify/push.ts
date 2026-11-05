/**
 * Expo push delivery and once-only sending for notify. Pure functions (no Deno
 * globals, no Supabase client) so Node can test them with `npm run test:functions`.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  channelId: 'default';
};

/** POSTs the messages to Expo, at most 100 per request. Throws PUSH_FAILED on any non-2xx. */
export async function postToExpo(messages: ExpoMessage[], fetchImpl: typeof fetch = fetch): Promise<number> {
  for (let start = 0; start < messages.length; start += 100) {
    const expoResponse = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(start, start + 100)),
    });
    if (!expoResponse.ok) {
      console.error('[notify] Expo push failed', expoResponse.status, await expoResponse.text());
      throw new Error('PUSH_FAILED');
    }
  }
  return messages.length;
}

/** The notified_events table: insert fails with code 23505 when (event, ref_id) already exists. */
export type ClaimStore = {
  insert(event: string, refId: string): Promise<{ code?: string } | null>;
  remove(event: string, refId: string): Promise<void>;
};

/**
 * Sends a push only the first time (event, refId) is seen, so replaying the
 * same request sends nothing. If sending fails the claim is released, so the
 * client can retry. Returns how many messages were sent.
 */
export async function sendOnce(store: ClaimStore, event: string, refId: string, send: () => Promise<number>): Promise<number> {
  const error = await store.insert(event, refId);
  if (error?.code === '23505') return 0;
  if (error) throw error;
  try {
    return await send();
  } catch (sendError) {
    await store.remove(event, refId);
    throw sendError;
  }
}
