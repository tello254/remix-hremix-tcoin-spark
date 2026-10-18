import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { supabaseAdmin } from './supabase.server';
import { isSafaricom, normalizePhone, PIN_RE, USERNAME_RE } from './auth.shared';

/**
 * Tcoins auth — native phone-as-identity. The project has phone logins enabled with
 * confirmations OFF (autoconfirm), and NO SMS is ever sent: accounts are created
 * already-verified via the admin API (`phone_confirm: true`), and login/forgot are
 * plain password grants ({ phone, password }) — KSh 0.
 * PIN must be 6 digits (Supabase enforces min length 6 → blueprint's 4–6 becomes exactly 6).
 */

type Profile = { id: string; username: string; phone_number: string; is_flagged: boolean };

const mapPlatform = (p: 'YouTube' | 'TikTok' | 'Instagram') => p.toLowerCase();

/** Live availability checks while the user types. */
export const checkAvailability = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ kind: z.enum(['username', 'phone']), value: z.string().min(3).max(30) }).parse(d))
  .handler(async ({ data }) => {
    if (data.kind === 'username') {
      const v = data.value.trim().toLowerCase();
      if (!USERNAME_RE.test(v)) return { valid: false, available: false };
      const { count } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('username', v);
      return { valid: true, available: (count ?? 0) === 0 };
    }
    const phone = normalizePhone(data.value);
    if (!isSafaricom(phone)) return { valid: false, available: false };
    const { count } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('phone_number', phone);
    return { valid: true, available: (count ?? 0) === 0 };
  });

/** Creates the phone-identity account (no email, no Google, no SMS). */
export const signUpUser = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ username: z.string().trim().toLowerCase(), phone: z.string(), pin: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const username = data.username.toLowerCase();
    const phone = normalizePhone(data.phone);
    if (!USERNAME_RE.test(username)) return { ok: false as const, error: 'username' };
    if (!isSafaricom(phone)) return { ok: false as const, error: 'phone' };
    if (!PIN_RE.test(data.pin)) return { ok: false as const, error: 'pin' };

    const { count: taken } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('username', username);
    if (taken) return { ok: false as const, error: 'username_taken' };

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      phone,
      password: data.pin,
      phone_confirm: true,        // no SMS — admin API creates the user already-verified
      user_metadata: { username },
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('taken') || msg.includes('exists'))
        return { ok: false as const, error: 'phone_taken' };
      return { ok: false as const, error: 'signup_failed' };
    }
    if (!created?.user) return { ok: false as const, error: 'signup_failed' };

    // The trigger already stamped phone_number; give it its chosen username.
    const { error: upd } = await supabaseAdmin.from('profiles').update({ username }).eq('id', created.user.id);
    if (upd) {
      const msg = (upd.message + (upd.details ?? '')).toLowerCase();
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);   // release the identity for a retry
      if (msg.includes('phone')) return { ok: false as const, error: 'phone_taken' };
      return { ok: false as const, error: 'username_taken' };
    }
    return { ok: true as const };
  });

const forgotInput = z.object({
  step: z.number().int().min(1).max(3),
  phone: z.string(),
  username: z.string().optional().default(''),
  platform: z.enum(['YouTube', 'TikTok', 'Instagram']).optional(),
  handle: z.string().optional().default(''),
});

/** Step-by-step identity proof: phone → phone+username → phone+username+linked handle. */
export const forgotVerify = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => forgotInput.parse(d))
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!isSafaricom(phone)) return { ok: false as const, error: 'phone_invalid' };
    const q = supabaseAdmin.from('profiles').select('id, username, phone_number').eq('phone_number', phone);
    if (data.step >= 2) q.eq('username', (data.username || '').trim().toLowerCase());
    const { data: rows, error } = await q;
    if (error) return { ok: false as const, error: 'lookup_failed' };
    const profile = (rows as Profile[] | null)?.[0];
    if (!profile) return { ok: false as const, error: data.step === 1 ? 'phone_not_found' : 'username_mismatch' };
    if (data.step === 3) {
      const { count } = await supabaseAdmin.from('social_handles')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('platform', mapPlatform(data.platform || 'YouTube'))
        .eq('handle', (data.handle || '').trim().toLowerCase().replace(/^@+/, '@'));
      if (!count) {
        // Accounts with ZERO linked handles get an identity pass from steps 1+2 alone,
        // otherwise a user who never linked a handle could never recover their PIN.
        const { count: any } = await supabaseAdmin.from('social_handles').select('id', { count: 'exact', head: true }).eq('user_id', profile.id);
        if (!any) return { ok: true as const, note: 'no_handles' };
        return { ok: false as const, error: 'handle_not_linked' };
      }
    }
    return { ok: true as const };
  });

/** Sets the new PIN only after re-proofing all three identity factors server-side. */
export const forgotReset = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => forgotInput.extend({ pin: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const proof = await forgotVerify({ data: { step: 3, phone: data.phone, username: data.username, platform: data.platform, handle: data.handle } });
    if (!proof.ok) return { ok: false as const, error: 'verification_failed' };
    if (!PIN_RE.test(data.pin)) return { ok: false as const, error: 'pin' };
    const phone = normalizePhone(data.phone);
    const { data: rows } = await supabaseAdmin.from('profiles').select('id').eq('phone_number', phone).eq('username', (data.username || '').trim().toLowerCase());
    const profile = (rows as Profile[] | null)?.[0];
    if (!profile) return { ok: false as const, error: 'verification_failed' };
    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: data.pin });
    if (error) return { ok: false as const, error: 'reset_failed' };
    return { ok: true as const };
  });
