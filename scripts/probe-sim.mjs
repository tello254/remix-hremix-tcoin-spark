// One-off probe: fn_simulate_referral ladder (create-sim + first_task → first_withdraw → task commission)
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
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const phone = '254711' + String(Math.floor(100000 + Math.random() * 900000));
const r = await fetch(base + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: 'Test-Tcoins-9!', phone_confirm: true }) });
const j = await r.json();
if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
const U = j.id;
console.log('user', U.slice(0, 8), phone);

const asUser = async (expr, key) => { const rr = await c.query(`begin; select set_config('request.jwt.claims', '{"sub":"${U}"}', true); select ${expr}; commit;`); return rr.map(x => x.rows?.[0]?.[key]).find(v => v !== undefined); };

let ok = 0, bad = 0;
const chk = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : '')); };

const r1 = await asUser(`fn_simulate_referral('${U}')`, 'fn_simulate_referral');
chk('click 1: creates sim friend + first_task milestone', r1.ok === true && r1.kind === 'first_task' && r1.stage === 1 && r1.vault_total === 25, JSON.stringify(r1));
const r2 = await asUser(`fn_simulate_referral('${U}')`, 'fn_simulate_referral');
chk('click 2: first_withdraw milestone', r2.ok === true && r2.kind === 'first_withdraw' && r2.stage === 2 && r2.vault_total === 50, JSON.stringify(r2));
const r3 = await asUser(`fn_simulate_referral('${U}')`, 'fn_simulate_referral');
chk('click 3: +2 commission direct to balance', r3.ok === true && r3.kind === 'task' && r3.balance_after === 2, JSON.stringify(r3));

const led = (await c.query(`select kind, amount, balance_after from wallet_ledger where user_id=$1 and kind like 'referral%' order by seq`, [U])).rows;
chk('ledger registers both kinds', led.length === 3 && led[0].kind === 'referral_milestone' && led[1].kind === 'referral_milestone' && led[2].kind === 'referral_task' && led[2].balance_after === 2, JSON.stringify(led));

// friendship row carries the stage/tasks/earned state for the UI
const ref = (await c.query(`select stage, tasks_completed, total_earned_from_referee from referrals where referrer_id=$1`, [U])).rows[0];
chk('referrals row state', ref.stage === 2 && ref.tasks_completed === 2 && ref.total_earned_from_referee === 52, JSON.stringify(ref));
const simname = (await c.query(`select p.username from referrals r join public.profiles p on p.id = r.referee_id where r.referrer_id=$1`, [U])).rows[0]?.username;
chk('sim friend clearly named', /^Sim Friend /.test(simname ?? ''), simname);

console.log(`${ok} passed, ${bad} failed`);

// cleanup the probe user (+ its sim friend) so the probe is re-runnable
try {
  const simId = (await c.query(`select referee_id from public.referrals where referrer_id = $1`, [U])).rows[0]?.referee_id;
  await c.query(`delete from public.referrals where referrer_id = $1`, [U]);
  for (const id of [U, simId].filter(Boolean)) {
    await c.query(`delete from public.profiles where id = $1`, [id]);
    await c.query(`delete from auth.users where id = $1`, [id]);
  }
  console.log('probe cleaned up');
} catch (e) { console.log('cleanup warning:', e.message.slice(0, 120)); }
await c.end();
