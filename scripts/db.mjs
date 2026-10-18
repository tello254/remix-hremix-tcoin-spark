/**
 * Supabase Postgres DDL runner.
 * Usage: node scripts/db.mjs <path-to-sql-file>   (or `node scripts/db.mjs --check`)
 * Reads SUPABASE_DB_URL from .env. Never prints the connection string.
 */
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

// tiny .env loader (no dotenv dep needed)
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+[A-Z0-9_]*=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);

const url = process.env.SUPABASE_DB_URL ?? env.SUPABASE_DB_URL;
if (!url) { console.error('❌ SUPABASE_DB_URL missing in .env'); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

async function main() {
  if (process.argv[2] === '--check') {
    const v = await client.query('select version()');
    console.log('✅ connected:', v.rows[0].version.split(' ').slice(0, 2).join(' '), '(PG', v.rows[0].version.match(/(\d+\.\d+)/)?.[1] + ')');
    const tables = await client.query(
      `select table_name from information_schema.tables where table_schema='public' order by table_name`);
    console.log('tables in public:', tables.rows.map(r => r.table_name).join(', ') || '(none)');
    return;
  }
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/db.mjs <sql-file> | --check'); process.exit(1); }
  const path = existsSync(file) ? file : `supabase/${file}`;
  const sql = readFileSync(path, 'utf8');
  console.log(`▶ running ${path} (${sql.length} chars)`);
  const res = await client.query(sql);
  console.log('✅ done.', res.command, Array.isArray(res.rows) ? res.rows.length + ' rows returned' : '');
}

try { await main(); } catch (e) { console.error('❌ SQL failed:', e.message); process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
