/**
 * Quick Supabase connection test.
 * Creates a sample `users` table, inserts a row, reads it back.
 * Run with: bun scripts/test-supabase.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !key) {
  console.error('❌ Missing env vars. Make sure .env has VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('🔌 Connecting to Supabase at:', url);

  // Step 1: Create the sample 'users' table via the SQL endpoint
  const createSQL = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'Free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;

  // Use the Supabase SQL endpoint (pg-meta)
  const sqlRes = await fetch(`${url}/rest/v1/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ name: 'exec_sql', params: { query: createSQL } }),
  });

  // If the RPC approach doesn't work, try alternative: direct table creation via the API
  // The RPC might not exist, so let's just try inserting and see if the table exists
  if (!sqlRes.ok) {
    console.log('ℹ️  RPC endpoint not available for DDL. Will create table via dashboard.');
    console.log('');
    console.log('📋 Copy this SQL and paste it into your Supabase Dashboard → SQL Editor → New query → Run:');
    console.log('');
    console.log(createSQL);
    console.log('');
    console.log('After running the SQL above, re-run this script to test the connection.');
    console.log('');

    // Still test if we can reach the API at all
    const healthRes = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    });
    if (healthRes.ok) {
      console.log('✅ Supabase API connection is WORKING! (HTTP', healthRes.status + ')');
      console.log('   Just need to create the table via the SQL Editor.');
    } else {
      console.error('❌ Cannot reach Supabase API. Status:', healthRes.status, await healthRes.text());
    }
    return;
  }

  console.log('✅ Table created via SQL endpoint');

  // Step 2: Insert a test row
  const { data: inserted, error: insertErr } = await supabase
    .from('users')
    .insert({ name: 'Alex Mwangi', phone: '0712345678', tier: 'Free' })
    .select()
    .single();

  if (insertErr) {
    console.error('❌ Insert failed:', insertErr.message);
    return;
  }
  console.log('✅ Test row inserted:', inserted);

  // Step 3: Read it back
  const { data: rows, error: readErr } = await supabase
    .from('users')
    .select('*')
    .limit(5);

  if (readErr) {
    console.error('❌ Read failed:', readErr.message);
    return;
  }
  console.log('✅ Read back from users table:', rows);

  // Step 4: Clean up the test row
  if (inserted?.id) {
    await supabase.from('users').delete().eq('id', inserted.id);
    console.log('🧹 Cleaned up test row');
  }

  console.log('');
  console.log('🎉 Supabase connection is fully working!');
}

main().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
