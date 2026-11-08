import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env['VITE_SUPABASE_URL'];
const supabaseAnonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

/** Public Supabase client — safe for frontend, respects RLS policies. */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * The signed-in user, resilient to device-clock drift.
 *
 * supabase-js decides whether to refresh a token by comparing its `exp` against the DEVICE clock.
 * When a device runs behind the auth server (phone time-sync off is the usual cause) a token that
 * looks valid locally is already expired server-side: `getUser()` returns 403 `bad_jwt` and the
 * client never refreshes on its own. One forced refresh fixes it; a genuinely dead session signs
 * out, so the app shows the login screen instead of spinning forever.
 */
export async function authUser() {
  const first = await supabase.auth.getUser();
  if (first.data.user) return first.data.user;
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return null;
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.user) return refreshed.user;
  await supabase.auth.signOut();
  return null;
}
