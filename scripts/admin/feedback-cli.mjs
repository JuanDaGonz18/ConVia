// "Report a problem" reports (Perfil → Reportar un problema; feedback_reports, migrations 044 and 045).
//
//   npm run feedback                                  open reports (nuevo, en_revision): safety first, then oldest
//                                                     first, with a 5-minute link to each screenshot
//   npm run feedback -- --all                         every report, newest first
//   npm run feedback -- --close <id> [--note "text"]  mark it resuelto (the id or its first 8 characters)
//   npm run feedback -- --close <id> --discard        mark it descartado
//
// The reporter sees the status in the app; the note stays with the team.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come only from the environment, normally
// scripts/admin/.env.review.local (gitignored). The key is never printed.
import { createClient } from '@supabase/supabase-js';
import { closeFeedback, formatFeedback, listFeedback, resolveFeedbackId, screenshotUrl } from './monitoring-core.mjs';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in scripts/admin/.env.review.local (see .env.review.example there).');
console.log(`Project: ${new URL(url).host}`);
const admin = createClient(url, key, { auth: { persistSession: false } });

try {
  if (args.includes('--close')) {
    const id = await resolveFeedbackId(admin, arg('--close'));
    const status = args.includes('--discard') ? 'descartado' : 'resuelto';
    await closeFeedback(admin, id, arg('--note') ?? null, status);
    console.log(`${id} → ${status}.`);
  } else {
    const rows = await listFeedback(admin, { all: args.includes('--all') });
    if (!rows.length) console.log(args.includes('--all') ? 'No reports.' : 'No open reports.');
    for (const row of rows) console.log(`\n${formatFeedback(row, await screenshotUrl(admin, row.screenshot_path))}`);
    if (rows.length) console.log('\nClose one with: npm run feedback -- --close <id> [--note "what was done"]');
  }
} catch (error) {
  fail(`Error: ${error?.message ?? error}`);
}
