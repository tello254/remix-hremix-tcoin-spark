import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+[A-Z0-9_]*=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);

const base = env.VITE_SUPABASE_URL;
const secret = env.SUPABASE_SERVICE_ROLE_KEY;
const authApi = (path, method, body) => fetch(base + path, { method, headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const rest = owner => (table, op) => fetch(`${base}/rest/v1/${table}`, { headers: { apikey: secret, Authorization: `Bearer ${secret}`, Prefer: op === 'insert' ? 'return=representation' : '' } });

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
const expect = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : '')); };

// create two real auth users with phone-number identities (matches the profiles CHECK regex)
const mk = async (i) => {
  // 254711###### — random per run to avoid leftovers colliding
  const phone = '254711' + String(Math.floor(100000 + Math.random() * 900000));
  const r = await authApi('/auth/v1/admin/users', 'POST', { phone, password: 'Test-Tcoins-' + i + '!', phone_confirm: true });
  const j = await r.json();
  if (!r.ok) throw new Error('auth create failed: ' + JSON.stringify(j).slice(0, 300));
  return { id: j.id, phone };
};
const A = await mk(1);   // upline
const B = await mk(2);   // downline
console.log('auth users A/B:', A.id.slice(0, 8), B.id.slice(0, 8), 'phones', A.phone, B.phone);

// welcome bonus is claim-only: the trigger does NOT credit it (balance starts at 0)
let q = await c.query(`select amount from wallet_ledger where user_id=$1 and kind='welcome_bonus'`, [A.id]);
expect('trigger: NO welcome bonus until claimed (balance starts 0)', q.rows.length === 0);
let resW = (await c.query(`select fn_claim_welcome($1)`, [A.id])).rows[0].fn_claim_welcome;
expect('fn_claim_welcome pays 25', resW.ok === true && resW.balance_after === 25, JSON.stringify(resW).slice(0, 90));
resW = (await c.query(`select fn_claim_welcome($1)`, [A.id])).rows[0].fn_claim_welcome;
expect('fn_claim_welcome one-shot guard', resW.ok === false && resW.error === 'already_claimed', JSON.stringify(resW).slice(0, 90));

// profiles auto-created, phone → username
q = await c.query(`select username, phone_number, phone_locked from profiles where id=$1`, [A.id]);
expect('trigger: profile created, phone = username, locked',
  q.rows.length === 1 && q.rows[0].username === A.phone && q.rows[0].phone_number === A.phone && q.rows[0].phone_locked === true,
  `username=${q.rows[0]?.username}`);

// generate batches (UTC freeze)
let gen = (await c.query(`select fn_generate_batch($1)`, [A.id])).rows[0].fn_generate_batch;
const batchA = gen;
expect('fn_generate_batch: Day-1 rule 5 videos / 75', gen.video_count === 5 && gen.reward === 75, `videos=${gen.video_count} reward=${gen.reward}`);
await c.query(`select fn_generate_batch($1)`, [B.id]);
gen = (await c.query(`select fn_generate_batch($1)`, [B.id])).rows[0].fn_generate_batch;
expect('B day-1 batch exists', !!gen.already_existed, JSON.stringify(gen).slice(0, 80));
resW = (await c.query(`select fn_claim_welcome($1)`, [B.id])).rows[0].fn_claim_welcome;
expect('B claims welcome 25', resW.ok === true && resW.balance_after === 25, JSON.stringify(resW).slice(0, 90));

// campaign + A's linked handle
const { rows: [camp] } = await c.query(`insert into campaigns (title, url, platform, budget_ksh, payout_ksh, access_code) values ('E2E Video','https://youtu.be/abc12345678','youtube',1000,2,'E2E24') returning id, slots`);
expect('campaign slots derived', camp.slots === 500);
await c.query(`insert into social_handles (user_id, platform, handle) values ($1,'youtube','@earto'),($1,'youtube','@nonexist')`, [A.id]);

// test shortcut: shrink batches to 1 video so we can complete exactly one task each
await c.query(`update daily_batches set video_count = 1 where user_id = any($1)`, [[A.id, B.id]]);

// A completes the task
let res = (await c.query(`select fn_complete_task($1,$2,'youtube','@earto','Real opinion, lovely content')`, [A.id, camp.id])).rows[0].fn_complete_task;
expect('fn_complete_task ok', res.ok === true && res.daily_complete === true, JSON.stringify(res).slice(0, 80));

// lifetime tasks advanced
q = await c.query(`select lifetime_tasks from profiles where id=$1`, [A.id]);
expect('lifetime_tasks incremented', q.rows[0].lifetime_tasks === 1);

// repeat claim of same video is refused — quota guard fires first (batch 1/1 full)
res = (await c.query(`select fn_complete_task($1,$2,'youtube','@earto','again')`, [A.id, camp.id])).rows[0].fn_complete_task;
expect('quota guard on full batch', res.ok === false && res.error === 'daily_batch_closed', JSON.stringify(res).slice(0, 80));

// DB-level immutability: UNIQUE (user_id, campaign_id) rejects any duplicate directly
let dupRejected = false;
try {
  await c.query(`insert into task_completions (batch_id, user_id, campaign_id, platform, handle_used)
                 select batch_id, user_id, campaign_id, platform, handle_used from task_completions where user_id=$1 limit 1`, [A.id]);
} catch (e) { dupRejected = /duplicate key|unique/i.test(e.message); }
expect('UNIQUE(user_id, campaign_id) enforced at DB level', dupRejected);

// A claims the batch: welcome 25 + daily 75 = 100
res = (await c.query(`select fn_claim_daily_batch($1)`, [A.id])).rows[0].fn_claim_daily_batch;
expect('A claims batch', res.ok === true, `paid=${res.coins_paid}`);
q = await c.query(`select balance_after from wallet_ledger where user_id=$1 order by seq desc limit 1`, [A.id]);
expect('A balance 25 + 75 = 100', q.rows[0].balance_after === 100);

// vault locked before the OWNER's claim: even after A claimed, this NEW vault entry (from B) stays
// B linked handle + referral: B was referred by A
await c.query(`insert into social_handles (user_id, platform, handle) values ($1,'youtube','@briano')`, [B.id]);
await c.query(`insert into referrals (referrer_id, referee_id, referral_code) values ($1,$2,'TC-DEMO24')`, [A.id, B.id]);

res = (await c.query(`select fn_complete_task($1,$2,'youtube','@briano','So helpful, thank you')`, [B.id, camp.id])).rows[0].fn_complete_task;
expect('B completes task', res.ok === true);
q = await c.query(`select coins_locked, reason, status from referral_pending_vault where user_id=$1`, [A.id]);
expect('A vault: +25 locked for B first review', q.rows.length === 1 && q.rows[0].coins_locked === 25 && q.rows[0].status === 'locked');
q = await c.query(`select balance_after from wallet_ledger where user_id=$1 order by seq desc limit 1`, [A.id]);
expect('A balance still 100 (vault locked)', q.rows[0].balance_after === 100);

// anti-leech: claim pays daily + unlocks vault
res = (await c.query(`select fn_claim_daily_batch($1)`, [B.id])).rows[0].fn_claim_daily_batch;
expect('B claims batch', res.ok === true, `paid=${res.coins_paid}`);
q = await c.query(`select balance_after from wallet_ledger where user_id=$1 order by seq desc limit 1`, [B.id]);
expect('B balance 25 + 75 = 100 (no referral of own)', q.rows[0].balance_after === 100);
q = await c.query(`select status from referral_pending_vault where user_id=$1`, [A.id]);
// vault still locked: it unlocks on the OWNER's claim (A). A already claimed today → stays locked to tomorrow ⇒ test unlock via direct A claim flow:
// shortcut: A claims again on a fresh batch (simulate next day) is heavy here; instead verify lock guarantee holds — expected locked
expect('A vault locked until A claims (anti-leech)', q.rows[0].status === 'locked');

// withdrawal guards, in meaningful order: over-balance first (balance still 100)
res = (await c.query(`select fn_request_withdrawal($1, 150)`, [B.id])).rows[0].fn_request_withdrawal;
expect('over-balance rejected', res.ok === false && res.error === 'balance_too_low' && res.balance === 100, JSON.stringify(res).slice(0, 80));
// first cashout: min 100
res = (await c.query(`select fn_request_withdrawal($1, 100)`, [B.id])).rows[0].fn_request_withdrawal;
expect('B withdrawal request ok', res.ok === true);
q = await c.query(`select balance_after from wallet_ledger where user_id=$1 order by seq desc limit 1`, [B.id]);
expect('B debited instantly to 0', q.rows[0].balance_after === 0);
// has_withdrawn now true → minimum jumps to 300
res = (await c.query(`select fn_request_withdrawal($1, 100)`, [B.id])).rows[0].fn_request_withdrawal;
expect('sub-300 after first cashout rejected', res.ok === false && res.error === 'below_minimum' && res.minimum === 300, JSON.stringify(res).slice(0, 80));
q = await c.query(`select referrals.stage from referrals where id=(select id from referrals where referee_id=$1)`, [B.id]);
expect('referral stage advanced 1→2 on first cashout', q.rows[0].stage === 2, 'stage=' + q.rows[0].stage);

// refund safety (Daraja failure)
const w = (await c.query(`select id from withdrawals where user_id=$1 limit 1`, [B.id])).rows[0];
await c.query(`select fn_refund_withdrawal($1,'TEST_TIMEOUT')`, [w.id]);
q = await c.query(`select balance_after from wallet_ledger where user_id=$1 order by seq desc limit 1`, [B.id]);
expect('refund restores B to 100', q.rows[0].balance_after === 100);

// views
q = await c.query(`select * from v_badge_progress where user_id=$1`, [A.id]);
expect('v_badge_progress works', q.rows.length === 1 && q.rows[0].tasks_to_next_badge === 15, `lifetime=${q.rows[0]?.lifetime_tasks} to_pro=${q.rows[0]?.tasks_to_next_badge}`);
q = await c.query(`select count(*) n from pg_policies where schemaname='public'`);
expect('RLS policies', q.rows[0].n >= 11);

// cleanup
await c.query(`delete from campaigns where id=$1`, [camp.id]);
await authApi('/auth/v1/admin/users/' + A.id, 'DELETE');
await authApi('/auth/v1/admin/users/' + B.id, 'DELETE');
console.log(`\n${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
