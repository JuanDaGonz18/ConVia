// ConVía+ paid by bank transfer (payment_requests, migration 047; launch: docs/LANZAR_PLUS.md).
//
//   npm run plus -- --list                                   payments waiting for review, oldest first, with
//                                                            a 5-minute link to each receipt
//   npm run plus -- --list --all                             also the latest granted and rejected ones
//   npm run plus -- --grant CV-7K3P [--amount 12000] [--paid-on 2026-11-11]
//                                                            the transfer with that reference arrived: activates
//                                                            or extends ConVía+ 1 or 12 months and tells the person
//   npm run plus -- --reject CV-7K3P --reason "No encontramos la transferencia"
//                                                            the person sees the reason in the app and in a push
//
// Before granting, find the reference in the bank's movements and check the amount.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come only from the environment, normally
// scripts/admin/.env.review.local (gitignored). The key is never printed.
import { createClient } from '@supabase/supabase-js';
import { cop, explainError, formatPayment, grantPayment, listPayments, parseArgs, receiptUrl, rejectPayment } from './plus-core.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(`${error.message}\nUsage: npm run plus -- --list [--all] | --grant <ref> [--amount <COP>] [--paid-on YYYY-MM-DD] | --reject <ref> --reason "text"`);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in scripts/admin/.env.review.local (see .env.review.example there).');
console.log(`Project: ${new URL(url).host}`);
const admin = createClient(url, key, { auth: { persistSession: false } });

try {
  if (options.action === 'grant') {
    const result = await grantPayment(admin, options);
    console.log(`${result.reference} → granted. ConVía+ until ${String(result.period_end).slice(0, 10)}${options.amount ? ` (received ${cop(options.amount)})` : ''}. The person gets a push.`);
  } else if (options.action === 'reject') {
    await rejectPayment(admin, options);
    console.log(`${options.ref} → rejected. The person sees: "${options.reason}".`);
  } else {
    const rows = await listPayments(admin, { all: options.all });
    if (!rows.length) console.log(options.all ? 'No payments.' : 'No payments waiting for review.');
    for (const row of rows) console.log(`\n${formatPayment(row, row.status === 'pending' ? await receiptUrl(admin, row.receipt_path) : null)}`);
    if (rows.some((row) => row.status === 'pending')) {
      console.log('\nFind each reference in the bank, then: npm run plus -- --grant <ref>   or   --reject <ref> --reason "..."');
    }
  }
} catch (error) {
  fail(`Error: ${explainError(error?.message ?? error)}`);
}
