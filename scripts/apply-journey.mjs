import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// --- apply journey delta ---
const sql = readFileSync(new URL('../supabase/delta-journey.sql', import.meta.url), 'utf8');
await c.query(sql);
console.log('JOURNEY DELTA APPLIED');

// --- reset tello for a fresh start (task completions, batches, campaign counter, journey counters) ---
const u = await c.query("select id, username from profiles where username = 'tello'");
const tello = u.rows[0]?.id;
if (!tello) throw new Error('tello not found');

// referrals: revert tello's referral row (they were the referee) or drop entries where they are referrer
await c.query('update referrals set stage = 0, stage1_paid = false, stage2_paid = false, tasks_completed = 0, total_earned_from_referee = 0 where referee_id = $1', [tello]);
await c.query("delete from referral_pending_vault where source_referee_id = $1 and date_credited = current_date", [tello]);
// ledger activity for the user (task entries are local-only; nothing to delete in wallet_ledger)
await c.query('delete from task_completions where user_id = $1', [tello]);
await c.query('delete from daily_batches where user_id = $1', [tello]);
await c.query("update campaigns set completed = 0, active = true where completed > 0 and completed <= 1", []);
await c.query('update profiles set lifetime_tasks = 0 where id = $1', [tello]);

const check = await c.query(`select (select count(*) from task_completions where user_id = $1) tc,
  (select count(*) from daily_batches where user_id = $1) db,
  (select lifetime_tasks from profiles where id = $1) lt,
  (select completed from campaigns where id = '6321a69f-78c3-4c98-a81b-64c3281a587b') grown86`, [tello]);
console.log('RESET CHECK', JSON.stringify(check.rows[0]));

// sanity: journey sizes simulate payouts 0..16 for a free organic user
for (let p = 0; p <= 15; p++) {
  const lt = p === 0 ? 0 : 5 + Array.from({ length: p - 1 }, (_, i) => 3 + (i % 2 === 0 ? 1 : 0)).reduce((a, b) => a + b, 0);
  const r = await c.query('select journey_batch_size($1, $2, $3) size', [lt, 'none', p]);
  console.log(`payout ${p + 1}: lifetime ${lt} -> ${r.rows[0].size} tasks`);
}

await c.query('select fn_generate_batch($1)', [tello]);
const b = await c.query('select video_count, daily_reward from daily_batches where user_id = $1 and date_utc = current_date', [tello]);
console.log('RESTART BATCH (must be day-1 5/75):', JSON.stringify(b.rows));
await c.query('delete from daily_batches where user_id = $1 and date_utc = current_date', [tello]);

await c.end();
