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

const u = await c.query('select id, username, phone_number, lifetime_tasks, bought_badge from profiles order by created_at');
console.log('PROFILES', JSON.stringify(u.rows, null, 1));
const b = await c.query('select id, user_id, date_utc, completed_tasks, video_count, is_claimed, tier_at_batch from daily_batches order by date_utc');
console.log('BATCHES', JSON.stringify(b.rows, null, 1));
const t = await c.query('select user_id, campaign_id, platform, handle_used, created_at from task_completions order by created_at');
console.log('COMPLETIONS', JSON.stringify(t.rows, null, 1));
const ca = await c.query("select id, title, completed, slots, active from campaigns order by created_at");
console.log('CAMPAIGNS', JSON.stringify(ca.rows, null, 1));
await c.end();
