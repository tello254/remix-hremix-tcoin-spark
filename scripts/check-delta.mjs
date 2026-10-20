import pg from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]\w*=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const t = readFileSync(new URL('../supabase/delta-pro.sql', import.meta.url), 'utf8');
const first = t.indexOf('end $$;') + 7;
try { await c.query(t.slice(0, first)); console.log('PART 1 OK'); }
catch (e) { console.log('FAIL:', e.message); console.log('WHERE:', e.where); console.log('DETAIL:', e.detail, 'CODE:', e.code); }
await c.end();
