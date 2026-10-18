/** Shared auth validation rules — identical on client and server (single source of truth). */

/** Kenyan Safaricom prefixes: 2547 (01x,02x,04x,05x,06x,07x,09x blocks) and 2541 (11x0-5). */
const SAFARICOM_RE = /^254(?:7(?:[0129]\d|4[0-8]|5[7-9]|6[89])|11[0-5])\d{6}$/;
export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/** Auth identity domain: phone digits used as the email local-part (email provider is free & always on). */
export const PHONE_ALIAS_DOMAIN = 'tcoins.app';
export function phoneAlias(phone: string): string {
  return `${normalizePhone(phone)}@${PHONE_ALIAS_DOMAIN}`;
}

/**
 * Supabase enforces a minimum password length of 6 — a 4-digit PIN is rejected
 * by the auth server, so the PIN is exactly 6 digits.
 */
export const PIN_LENGTH = 6;
export const PIN_RE = /^\d{6}$/;

/** Normalizes 07.. / +2547.. / 2547.. into the canonical `2547…` form stored everywhere. */
export function normalizePhone(raw: string): string {
  let d = (raw || '').replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (d.startsWith('0') && d.length === 10) d = '254' + d.slice(1);
  else if (!d.startsWith('254') && d.length === 9) d = '254' + d;
  return d;
}

export function isSafaricom(raw: string): boolean {
  return SAFARICOM_RE.test(normalizePhone(raw));
}

export function normalizeHandle(raw: string): string {
  const h = (raw || '').trim().replace(/^@+/, '').toLowerCase();
  return h ? '@' + h : '';
}

export function isUsername(v: string): boolean {
  return USERNAME_RE.test(v.trim().toLowerCase());
}
