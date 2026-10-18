import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['VITE_SUPABASE_URL'] ?? '';
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

/**
 * Admin Supabase client — BYPASSES Row Level Security.
 * Only use in server-side code (API routes, server functions, scripts).
 * NEVER import this in frontend/client code.
 */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
