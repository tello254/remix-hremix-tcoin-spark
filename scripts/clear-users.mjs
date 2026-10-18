import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z_]+[A-Z0-9_]*=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const base = env.VITE_SUPABASE_URL, secret = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: secret, Authorization: `Bearer ${secret}` };

// Delete every auth user — profiles, ledger, handles, batches cascade automatically (FK on delete cascade).
let deleted = 0, page = 1;
for (;;) {
  const r = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
  const j = await r.json();
  const users = j.users || [];
  if (!users.length) break;
  for (const u of users) {
    const d = await fetch(`${base}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H });
    if (d.ok || d.status === 404) deleted++; else console.log('skip', u.id.slice(0, 8), d.status);
  }
  if (!j.nextPage) break;
  page++;
}

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(`select
  (select count(*) from auth.users) users,
  (select count(*) from public.profiles) profiles,
  (select count(*) from public.wallet_ledger) ledger,
  (select count(*) from public.social_handles) handles,
  (select count(*) from public.campaigns) campaigns`);
console.log(`deleted ${deleted} auth users`);
console.log(`remaining → auth users: ${rows[0].users}, profiles: ${rows[0].profiles}, ledger: ${rows[0].ledger}, handles: ${rows[0].handles}, campaigns: ${rows[0].campaigns}`);
await c.end();
