// ConVía — e-mails that are not about the account: welcome and first ConVía+ payment.
//
// The database queues them in private.email_outbox (migration transactional_emails) and calls this
// function with the cron secret; a cron every 10 minutes retries what failed. Sent with the Brevo
// API (secret BREVO_API_KEY). Without the key nothing is sent and the queue waits.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { type EmailKind, renderEmail, sendWithBrevo } from '../_shared/emails.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SENDER_EMAIL = Deno.env.get('EMAIL_SENDER') ?? 'gonzalezjuandavid07@gmail.com';
const SENDER_NAME = Deno.env.get('EMAIL_SENDER_NAME') ?? 'ConVía';
const BATCH = 20;

type Claimed = {
  id: number;
  kind: EmailKind;
  email: string;
  nombre: string | null;
  plus_until: string | null;
  promo: boolean;
  months: number | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function sendOne(apiKey: string, row: Claimed): Promise<string | null> {
  const mail = renderEmail({
    kind: row.kind, email: row.email, nombre: row.nombre, plusUntil: row.plus_until, promo: row.promo, months: row.months,
  });
  return sendWithBrevo(apiKey, { email: SENDER_EMAIL, name: SENDER_NAME }, row.email, mail, `convia-${row.kind}`);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || request.headers.get('x-convia-cron') !== secret) return json({ error: 'AUTH_REQUIRED' }, 401);
  const apiKey = Deno.env.get('BREVO_API_KEY');
  if (!apiKey) return json({ sent: 0, skipped: 'BREVO_API_KEY not set' });

  const { data, error } = await admin.rpc('service_claim_emails', { p_limit: BATCH });
  if (error) return json({ error: 'CLAIM_FAILED' }, 500);
  let sent = 0;
  for (const row of (data ?? []) as Claimed[]) {
    let failure: string | null;
    try {
      failure = await sendOne(apiKey, row);
    } catch (sendError) {
      failure = sendError instanceof Error ? sendError.message.slice(0, 300) : 'send failed';
    }
    await admin.rpc('service_mark_email', { p_id: row.id, p_error: failure });
    if (!failure) sent += 1;
    else console.warn(`[send-emails] ${row.kind} #${row.id}: ${failure}`);
  }
  return json({ sent, claimed: (data ?? []).length });
});
