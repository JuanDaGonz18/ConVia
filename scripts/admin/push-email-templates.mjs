#!/usr/bin/env node
/**
 * Sends the ConVía e-mail templates (supabase/templates, subjects from supabase/config.toml) to the
 * production project. Only those fields change: nothing else of the Auth settings is touched.
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_ACCESS_TOKEN = "<token from supabase.com/dashboard/account/tokens>"
 *   node scripts/admin/push-email-templates.mjs            # sends them
 *   node scripts/admin/push-email-templates.mjs --dry-run  # only shows what it would send
 * Never commit the token. Delete it from the dashboard when you are done if you won't reuse it.
 */
import { readFileSync } from 'node:fs';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'hfnsgeunskbkapjavcao';
const root = new URL('../../', import.meta.url);
const config = readFileSync(new URL('supabase/config.toml', root), 'utf8');

/** Subject and HTML of one [auth.email.template.<kind>] section. */
function template(kind) {
  const section = config.split(`[auth.email.template.${kind}]`)[1]?.split('\n[')[0] ?? '';
  const subject = section.match(/^subject\s*=\s*"(.*)"\s*$/m)?.[1];
  const path = section.match(/^content_path\s*=\s*"\.\/(.*)"\s*$/m)?.[1];
  if (!subject || !path) throw new Error(`No subject or content_path for ${kind} in supabase/config.toml`);
  const html = readFileSync(new URL(path, root), 'utf8');
  if (!html.includes('{{ .TokenHash }}')) throw new Error(`${path} has no {{ .TokenHash }} link`);
  return { subject, html };
}

const body = {};
for (const kind of ['confirmation', 'recovery', 'email_change']) {
  const { subject, html } = template(kind);
  body[`mailer_subjects_${kind}`] = subject;
  body[`mailer_templates_${kind}_content`] = html;
  console.log(`${kind.padEnd(13)} "${subject}" (${html.length} characters)`);
}

if (process.argv.includes('--dry-run')) {
  console.log('Dry run: nothing sent.');
  process.exit(0);
}
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (create one at https://supabase.com/dashboard/account/tokens).');
  process.exit(1);
}
const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
console.log(`Done: ${Object.keys(body).length / 2} templates updated on ${PROJECT_REF}.`);
