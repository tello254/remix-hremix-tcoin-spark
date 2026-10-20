import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]\w*=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(build('fn_request_withdrawal'));
console.log('v_min := first 100 / then 300 APPLIED');

function build(fn) {
  const t = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const start = t.indexOf(`create or replace function public.${fn}`);
  const end = t.indexOf('end $$;', start) + 7;
  return t.slice(start, end);
}
await c.end();
