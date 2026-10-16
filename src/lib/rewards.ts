import { z } from 'zod';

export const COINS_PER_KSH = 10;
export const TASK_REWARD = 20;
export const REFERRAL_REWARD = 2;
export const MIN_WITHDRAWAL = 50;
export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(60),
  phone: z.string().trim().regex(/^(?:\+254|254|0)[17]\d{8}$/, 'Enter a valid Kenyan phone number'),
  youtube: z.array(z.string().trim().regex(/^@[\w.-]{2,40}$/)).min(1, 'Select your YouTube account').max(3),
  tiktok: z.array(z.string().trim().regex(/^@[\w.-]{2,40}$/)).min(1, 'Select your TikTok account').max(3),
  instagram: z.array(z.string().trim().regex(/^@[\w.-]{2,40}$/, 'Enter an Instagram handle starting with @')).max(3),
});
export const commentSchema = z.string().trim().max(1000).refine(v => v.split(/\s+/).filter(Boolean).length >= 3, 'Leave a natural comment of at least 3 words.');
export function validateCashout(amount: number, balance: number, phone: string) {
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL) return 'Withdraw at least 50 whole Tcoins.';
  if (amount > balance) return 'Your balance is too low for this withdrawal.';
  if (!/^(?:\+254|254|0)[17]\d{8}$/.test(phone)) return 'Enter a valid Kenyan phone number.';
  return null;
}
export function campaignSlots(budget: number, payout: number) {
  return Number.isFinite(budget) && Number.isFinite(payout) && budget > 0 && payout > 0 ? Math.floor(budget / payout) : 0;
}
export const campaignSchema = z.object({
  title: z.string().trim().min(3).max(100),
  url: z.string().url().max(500).refine(v => { const u = new URL(v); return u.protocol === 'https:' && /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)$/.test(u.hostname); }, 'Use a valid HTTPS YouTube, TikTok or Instagram URL'),
  platform: z.enum(['YouTube', 'TikTok', 'Instagram']),
  thumbnail: z.string().max(500).refine(v => !v || /^https:\/\//.test(v), 'Thumbnail must be an HTTPS URL'),
  budget: z.coerce.number().positive().max(1000000),
  payout: z.coerce.number().min(0.1).max(10000),
  accessCode: z.string().trim().min(3, 'Add an access code').max(20).regex(/^[A-Za-z0-9-]+$/, 'Letters and numbers only'),
  instruction: z.string().trim().min(5).max(200),
}).refine(v => campaignSlots(v.budget, v.payout) >= 1, { message: 'Budget must cover at least one task.' });