import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]\w*=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const handle = process.argv[2] || '@earto';
const stale = await c.query("select u.id, u.phone from auth.users u join public.social_handles h on h.user_id = u.id where lower(h.handle) = $1", [handle]);
console.log('owners of', handle, ':', JSON.stringify(stale.rows));
for (const r of stale.rows) {
  if (String(r.phone ?? '').startsWith('0799')) {
    await c.query('delete from auth.users where id = $1', [r.id]);
    console.log('deleted stale e2e user', r.id);
  } else console.log('skipped — not an E2E phone pattern:', r.id, r.phone);
}
await c.end();
