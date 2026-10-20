import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]\w*=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
// widen the live ledger's kind constraint first (new referral kinds)
await c.query(`alter table public.wallet_ledger drop constraint if exists wallet_ledger_kind_check`);
await c.query(`alter table public.wallet_ledger add constraint wallet_ledger_kind_check
  check (kind in ('welcome_bonus','daily_batch','referral_claim','badge_purchase','withdrawal','withdrawal_refund','referral_task','referral_milestone'))`);
console.log('ledger kinds widened');
// sweep first — the other functions call it
await c.query('drop function if exists public.fn_my_referrals(uuid)');   // return signature changed (+referral_id)
for (const fn of ['fn_sweep_referral_vault', 'fn_complete_task', 'fn_my_referrals', 'fn_simulate_referral', 'fn_referral_vault']) {
  await c.query(build(fn));
  console.log(`${fn} applied`);
}
console.log('REFERRAL VAULT WALLET APPLIED');
await c.end();

function build(fn) {
  const t = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const start = t.indexOf(`create or replace function public.${fn}`);
  const end = t.indexOf('end $$;', start) + 7;
  return t.slice(start, end);
}
