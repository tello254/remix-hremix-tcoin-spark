// Applies the linked-platform eligibility batch rules:
//  - daily_batches checks: video_count / daily_reward allow 0 (an honest empty day)
//  - helpers fn_eligible_pool + fn_daily_budget
//  - fn_generate_batch + fn_complete_task (auto-create) + fn_claim_daily_batch guard
import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]\w*=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// 0-video batches are legal now (users with no linked platforms get an honest empty day)
await c.query(`alter table public.daily_batches drop constraint if exists daily_batches_video_count_check`);
await c.query(`alter table public.daily_batches add constraint daily_batches_video_count_check check (video_count >= 0)`);
await c.query(`alter table public.daily_batches drop constraint if exists daily_batches_daily_reward_check`);
await c.query(`alter table public.daily_batches add constraint daily_batches_daily_reward_check check (daily_reward >= 0)`);
console.log('daily_batches checks relaxed to >= 0');

function build(fn) {
  const t = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const start = t.indexOf(`create or replace function public.${fn}`);
  const end = t.indexOf('end $$;', start) + 7;
  return t.slice(start, end);
}
for (const fn of ['fn_eligible_pool', 'fn_daily_budget', 'fn_handle_taken', 'fn_generate_batch', 'fn_complete_task', 'fn_claim_daily_batch']) {
  await c.query(build(fn));
  console.log(`${fn} applied`);
}
await c.query(`grant execute on function public.fn_handle_taken(text, text, uuid) to anon, authenticated`);
console.log('granted execute on fn_handle_taken to anon/authenticated');
console.log('LINKED-PLATFORM BATCH RULES APPLIED');
await c.end();
