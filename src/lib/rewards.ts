import { z } from 'zod';

export const COINS_PER_KSH = 10;
export const REFERRAL_REWARD = 2;
export const MIN_WITHDRAWAL = 100;
export const WELCOME_BONUS = 25;
export const FIRST_WITHDRAWAL_MIN = 100;
export const REGULAR_WITHDRAWAL_MIN = 300;
export const UPLINE_REWARD_FIRST_TASK = 25;
export const UPLINE_REWARD_FIRST_WITHDRAW = 25;
export const REFERRAL_TASK_REWARD = 2;
export const FREE_DAILY_REFERRAL_CAP = 2;
export type Tier = 'Free' | 'Pro' | 'Premium';
export const TIERS: Record<Tier, { videos: readonly number[]; dailyReward: readonly [number, number]; priceKsh: number; priceCoins: number; unlockTasks: number }> = {
  Free: { videos: [3, 4], dailyReward: [56, 60], priceKsh: 0, priceCoins: 0, unlockTasks: 0 },
  Pro: { videos: [6, 7], dailyReward: [99, 106], priceKsh: 150, priceCoins: 1500, unlockTasks: 16 },
  Premium: { videos: [10, 11, 12], dailyReward: [199, 207], priceKsh: 350, priceCoins: 3500, unlockTasks: 40 },
};
export type DailyBatch = { tier: Tier; videoCount: number; reward: number };
export function createDailyBatch(tier: Tier, random = Math.random): DailyBatch {
  const config = TIERS[tier];
  const videoCount = config.videos[Math.floor(random() * config.videos.length)] ?? config.videos[0] ?? 3;
  const [min, max] = config.dailyReward;
  return { tier, videoCount, reward: min + Math.floor(random() * (max - min + 1)) };
}
/** Day 1 onboarding: 5 videos unlock 75 Tcoins so 25 welcome + 75 = the 100 Tcoin first cashout. */
export const createDayOneBatch = (): DailyBatch => ({ tier: 'Free', videoCount: 5, reward: 75 });
export const canClaimDaily = (batch: DailyBatch, verifiedCount: number, claimed: boolean) => !claimed && verifiedCount >= batch.videoCount;
const RANK: Tier[] = ['Free', 'Pro', 'Premium'];
export const tierRank = (t: Tier) => RANK.indexOf(t);
/** Highest of the purchased tier and the tier unlocked organically by lifetime tasks. */
export function effectiveTier(bought: Tier, lifetimeTasks: number): Tier {
  const organic: Tier = lifetimeTasks >= TIERS.Premium.unlockTasks ? 'Premium' : lifetimeTasks >= TIERS.Pro.unlockTasks ? 'Pro' : 'Free';
  return tierRank(organic) > tierRank(bought) ? organic : bought;
}
export function nextUtcReset(now = new Date()) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)); }
export const withdrawalMin = (hasWithdrawn: boolean) => hasWithdrawn ? REGULAR_WITHDRAWAL_MIN : FIRST_WITHDRAWAL_MIN;
/** Referral Tcoins earned today stay locked until the user's own daily quota is complete. */
export const withdrawableBalance = (balance: number, referralToday: number, quotaDone: boolean) => Math.max(0, quotaDone ? balance : balance - referralToday);
export const normalizePhone = (p: string) => p.replace(/\s/g, '').replace(/^(?:\+254|254|0)/, '');
/** Safaricom (M-Pesa) prefixes only: 070-072, 0740-0748, 0757-0759, 0768-0769, 079, 0110-0115. */
export const isSafaricomMpesa = (p: string) => /^(?:\+254|254|0)?\d{9}$/.test(p.replace(/\s/g, '')) && /^(?:7(?:[0129]\d|4[0-8]|5[7-9]|6[89])|11[0-5])\d{6}$/.test(normalizePhone(p));
export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(60),
  phone: z.string().trim().refine(isSafaricomMpesa, 'Enter a Safaricom M-Pesa number (07… / 01… / +254)'),
  youtube: z.array(z.string().trim().regex(/^@[\w.-]{2,40}$/)).min(1, 'Select your YouTube account').max(3),
  tiktok: z.array(z.string().trim().regex(/^@[\w.-]{2,40}$/)).min(1, 'Select your TikTok account').max(3),
  instagram: z.array(z.string().trim().regex(/^@[\w.-]{2,40}$/, 'Enter an Instagram handle starting with @')).max(3),
});
export const commentSchema = z.string().trim().max(1000).refine(v => v.split(/\s+/).filter(Boolean).length >= 3, 'Leave a natural comment of at least 3 words.');
export function validateCashout(amount: number, balance: number, phone: string, opts: { min?: number; accountPhone?: string } = {}) {
  const min = opts.min ?? MIN_WITHDRAWAL;
  if (!Number.isInteger(amount) || amount < min) return `Withdraw at least ${min} whole Tcoins.`;
  if (amount > balance) return 'Your withdrawable balance is too low for this withdrawal.';
  if (!isSafaricomMpesa(phone)) return 'Enter a Safaricom M-Pesa number (07… / 01… / +254).';
  if (opts.accountPhone && normalizePhone(phone) !== normalizePhone(opts.accountPhone)) return 'Payouts go only to the phone number registered on your account.';
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