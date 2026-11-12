import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * card-review-cleanup: deletes the student-card images kept for manual review once they are
 * 7 days old (face-verifications/<user_id>/student-card-review-*) and the screenshots attached
 * to "Report a problem" once they are 30 days old (feedback/<user_id>/*), and the ConVía+ payment
 * receipts 30 days after the payment was decided (payment-receipts/<user_id>/*). Called daily by pg_cron
 * (private.dispatch_card_review_cleanup). It only deletes files that have already expired,
 * but it still requires the shared CRON_SECRET in x-convia-cron, like notify's sweep, so
 * nobody else can invoke it and spend calls. pg_net sends the anon key as the JWT.
 */

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
// Each bucket with the service_role RPC that lists its expired files.
const TARGETS = [
  { bucket: 'face-verifications', rpc: 'service_expired_card_review_files' },
  { bucket: 'feedback', rpc: 'service_expired_feedback_files' },
  // Migration 047; optional so the function also runs against a database without it.
  { bucket: 'payment-receipts', rpc: 'service_expired_payment_receipts', optional: true },
] as const;
const headers = { 'Content-Type': 'application/json' };
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'card-review-cleanup', event, ...data }));

/** Same length and every byte compared, so the time taken doesn't reveal how much matched. */
function sameSecret(given: string | null, expected: string) {
  if (given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), { status: 405, headers });
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !sameSecret(request.headers.get('x-convia-cron'), secret)) {
    return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401, headers });
  }
  try {
    let expired = 0;
    let removed = 0;
    for (const target of TARGETS) {
      const { bucket, rpc } = target;
      const { data, error } = await admin.rpc(rpc);
      if (error) {
        if ('optional' in target && target.optional) {
          log('skipped', { bucket, detail: String(error.message).slice(0, 120) });
          continue;
        }
        throw error;
      }
      const names = (data ?? []) as string[];
      expired += names.length;
      for (let i = 0; i < names.length; i += 100) {
        const { data: gone, error: removeError } = await admin.storage.from(bucket).remove(names.slice(i, i + 100));
        if (removeError) throw removeError;
        removed += gone?.length ?? 0;
      }
    }
    log('cleaned', { expired, removed });
    return new Response(JSON.stringify({ removed }), { headers });
  } catch (error) {
    log('error', { detail: String((error as Error)?.message ?? error).slice(0, 200) });
    return new Response(JSON.stringify({ error: 'CLEANUP_FAILED' }), { status: 500, headers });
  }
});
