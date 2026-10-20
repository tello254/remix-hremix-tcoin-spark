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

// campaign + linked handles FIRST — batch generation is linked-platform aware (fn_eligible_pool):
// missing platforms simply leave their videos out of the pool; handles are one-owner global assets
const { rows: [camp] } = await c.query(`insert into campaigns (title, url, platform, budget_ksh, payout_ksh, access_code) values ('E2E Video','https://youtu.be/abc12345678','youtube',1000,2,'E2E24') returning id, slots`);
expect('campaign slots derived', camp.slots === 500);
const R = Math.random().toString(36).slice(2, 7);   // randomized so E2E handles can never collide with a real signup
await c.query(`insert into social_handles (user_id, platform, handle) values ($1,'youtube','@earto${R}'),($1,'youtube','@nonexist${R}'),($1,'tiktok','@earto_tt${R}'),($1,'instagram','@earto_ig${R}')`, [A.id]);
await c.query(`insert into social_handles (user_id, platform, handle) values ($1,'youtube','@briano${R}'),($1,'tiktok','@briano_tt${R}'),($1,'instagram','@briano_ig${R}')`, [B.id]);

// banned duplicate ownership: the SAME handle (even case-shifted) can never belong to two accounts
let dupHandle = false;
try { await c.query(`insert into social_handles (user_id, platform, handle) values ($1,'youtube','@EARTO${R}')`, [B.id]); }
catch (e) { dupHandle = /duplicate key|unique/i.test(e.message); }
expect('one owner per public handle on a platform (anti-fraud §4.1)', dupHandle);

// the profile dialog's instant refusal: taken for a FOREIGN owner (case-insensitive), free for the owner
let tak = (await c.query(`select fn_handle_taken('youtube','@EARTO${R}',$1) t`, [B.id])).rows[0].t;
expect('fn_handle_taken: foreign owner sees the handle taken (case-insensitive)', tak === true);
tak = (await c.query(`select fn_handle_taken('youtube','@earto${R}',$1) t`, [A.id])).rows[0].t;
expect('fn_handle_taken: owner re-adding own handle is never blocked', tak === false);

// generate batches (UTC freeze)
let eligA = (await c.query(`select fn_eligible_pool($1) n`, [A.id])).rows[0].n;
const vA = Math.min(5, eligA);                      // day-1 plan = 5 videos, capped by the reachable pool
let gen = (await c.query(`select fn_generate_batch($1)`, [A.id])).rows[0].fn_generate_batch;
const batchA = gen;
expect('fn_generate_batch: Day-1 rule 5 videos / 75 (linked-platform scaled)',
  gen.video_count === vA && gen.reward === Math.floor(75 * vA / 5),
  `eligible=${eligA} videos=${gen.video_count} reward=${gen.reward}`);
await c.query(`select fn_generate_batch($1)`, [B.id]);
gen = (await c.query(`select fn_generate_batch($1)`, [B.id])).rows[0].fn_generate_batch;
expect('B day-1 batch exists', !!gen.already_existed, JSON.stringify(gen).slice(0, 80));
resW = (await c.query(`select fn_claim_welcome($1)`, [B.id])).rows[0].fn_claim_welcome;
expect('B claims welcome 25', resW.ok === true && resW.balance_after === 25, JSON.stringify(resW).slice(0, 90));

// test shortcut: shrink batches to 1 video so we can complete exactly one task each
await c.query(`update daily_batches set video_count = 1 where user_id = any($1)`, [[A.id, B.id]]);

// A completes the task
let res = (await c.query(`select fn_complete_task($1,$2,'youtube','@earto${R}','Real opinion, lovely content')`, [A.id, camp.id])).rows[0].fn_complete_task;
expect('fn_complete_task ok', res.ok === true && res.daily_complete === true, JSON.stringify(res).slice(0, 80));

// lifetime tasks advanced
q = await c.query(`select lifetime_tasks from profiles where id=$1`, [A.id]);
expect('lifetime_tasks incremented', q.rows[0].lifetime_tasks === 1);

// repeat claim of same video is refused — quota guard fires first (batch 1/1 full)
res = (await c.query(`select fn_complete_task($1,$2,'youtube','@earto${R}','again')`, [A.id, camp.id])).rows[0].fn_complete_task;
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
await c.query(`insert into referrals (referrer_id, referee_id, referral_code) values ($1,$2,'TC-DEMO24')`, [A.id, B.id]);

res = (await c.query(`select fn_complete_task($1,$2,'youtube','@briano${R}','So helpful, thank you')`, [B.id, camp.id])).rows[0].fn_complete_task;
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

// ============ the referral WALLET: every call runs AS the user (JWT txn) so the auth.uid guards hold ============
const asA = async (expr, key) => { const rr = await c.query(`begin; select set_config('request.jwt.claims', '{"sub":"${A.id}"}', true); select ${expr}; commit;`); return rr.map(r => r.rows?.[0]?.[key]).find(v => v !== undefined); };
let vault = await asA(`fn_referral_vault('${A.id}')`, 'fn_referral_vault');
expect('A referral wallet reads 25', vault.total === 25 && vault.auto === 0, JSON.stringify(vault));
res = await asA(`fn_transfer_referral_vault('${A.id}')`, 'fn_transfer_referral_vault');
expect('A transfers referral wallet after quota — +25', res.ok === true && res.coins === 25, JSON.stringify(res));
q = await c.query(`select balance_after from wallet_ledger where user_id=$1 order by seq desc limit 1`, [A.id]);
expect('A balance 100 + 25 = 125', q.rows[0].balance_after === 125);
vault = await asA(`fn_referral_vault('${A.id}')`, 'fn_referral_vault');
expect('A referral wallet emptied', vault.total === 0, JSON.stringify(vault));

// quota gate: pretend A never finished today (0/1 completed), plus one fresh referral earning
await c.query(`insert into referral_pending_vault (user_id, source_referee_id, coins_locked, reason) values ($1,$2,5,'task_commission')`, [A.id, B.id]);
const Aclaim = (await c.query(`update daily_batches set is_claimed = false, completed_tasks = 0 where user_id=$1 and date_utc = today_utc() returning is_claimed, completed_tasks`, [A.id]));
expect('A batch unfinished (fixture)', Aclaim.rows[0].is_claimed === false && Aclaim.rows[0].completed_tasks === 0, '');
res = await asA(`fn_transfer_referral_vault('${A.id}')`, 'fn_transfer_referral_vault');
expect('unfinished quota blocks manual transfer', res.ok === false && res.error === 'quota_incomplete', JSON.stringify(res));

// the 24h clock: coins older than 24h auto-transfer even with quota unfinished
await c.query(`update referral_pending_vault set created_at = now() - interval '25 hours' where user_id=$1 and status='locked'`, [A.id]);
const swept = await asA(`fn_sweep_referral_vault('${A.id}')`, 'fn_sweep_referral_vault');
expect('24h auto-transfer swept 5 into balance', swept === 5, `swept=${swept}`);
q = await c.query(`select balance_after from wallet_ledger where user_id=$1 order by seq desc limit 1`, [A.id]);
expect('A balance 125 + 5 swept = 130', q.rows[0].balance_after === 130);
vault = await asA(`fn_referral_vault('${A.id}')`, 'fn_referral_vault');
expect('A referral wallet swept clean', vault.total === 0 && vault.auto === 0, JSON.stringify(vault));

// withdrawal guards, in meaningful order: over-balance first (balance still 100, first-cashout min 100)
res = (await c.query(`select fn_request_withdrawal($1, 150)`, [B.id])).rows[0].fn_request_withdrawal;
expect('over-balance rejected', res.ok === false && res.error === 'balance_too_low' && res.balance === 100, JSON.stringify(res).slice(0, 80));
// first cashout: min 100
res = (await c.query(`select fn_request_withdrawal($1, 100)`, [B.id])).rows[0].fn_request_withdrawal;
expect('B first withdrawal at 100 ok', res.ok === true);
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
expect('v_badge_progress works', q.rows.length === 1 && q.rows[0].tasks_to_next_badge === 59, `lifetime=${q.rows[0]?.lifetime_tasks} to_pro=${q.rows[0]?.tasks_to_next_badge}`);
q = await c.query(`select count(*) n from pg_policies where schemaname='public'`);
expect('RLS policies', q.rows[0].n >= 11);

// ============ linked-platform eligibility: the rules the app's profile warnings mirror ============
const C = await mk(3);   // YouTube-only worker
const D = await mk(4);   // no handles at all — the honest empty day
await c.query(`insert into social_handles (user_id, platform, handle) values ($1,'youtube','@sonly${R}')`, [C.id]);
const eligC = (await c.query(`select fn_eligible_pool($1) n`, [C.id])).rows[0].n;
const vC = Math.min(5, eligC);
gen = (await c.query(`select fn_generate_batch($1)`, [C.id])).rows[0].fn_generate_batch;
expect('YouTube-only user: pool-scaled day-1 (min(5, reachable) + per-video pay)',
  gen.video_count === vC && gen.reward === Math.floor(75 * vC / 5),
  `eligible=${eligC} videos=${gen.video_count} reward=${gen.reward}`);
gen = (await c.query(`select fn_generate_batch($1)`, [D.id])).rows[0].fn_generate_batch;
expect('zero linked handles: honest empty day (0 videos / 0 reward)',
  gen.ok === true && gen.video_count === 0 && gen.reward === 0, JSON.stringify(gen));
resW = (await c.query(`select fn_claim_daily_batch($1)`, [D.id])).rows[0].fn_claim_daily_batch;
expect('claiming an empty batch is refused', resW.ok === false && resW.error === 'nothing_to_claim', JSON.stringify(resW));

// cleanup
await c.query(`delete from campaigns where id=$1`, [camp.id]);
for (const uu of [A.id, B.id, C.id, D.id]) { try { await authApi('/auth/v1/admin/users/' + uu, 'DELETE'); } catch { /* already gone */ } }
console.log(`\n${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
