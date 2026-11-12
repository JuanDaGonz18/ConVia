// The app's most frequent errors (client_errors, migration 044), grouped by message.
//
//   npm run errors                     last 7 days, top 20
//   npm run errors -- --days 30 --limit 50
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come only from the environment, normally
// scripts/admin/.env.review.local (gitignored). The key is never printed.
import { createClient } from '@supabase/supabase-js';
import { formatErrors, topErrors } from './monitoring-core.mjs';

const args = process.argv.slice(2);
const number = (name, fallback) => {
  const value = Number(args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in scripts/admin/.env.review.local (see .env.review.example there).');
  process.exit(1);
}
console.log(`Project: ${new URL(url).host}`);
const admin = createClient(url, key, { auth: { persistSession: false } });

const days = Math.min(number('--days', 7), 90);
try {
  console.log(formatErrors(await topErrors(admin, { days, limit: Math.min(number('--limit', 20), 100) }), days));
} catch (error) {
  console.error(`Error: ${error?.message ?? error}`);
  process.exit(1);
}
