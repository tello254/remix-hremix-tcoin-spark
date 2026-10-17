import { createContext, useContext, useEffect, useRef, useState, type Context, type ReactNode } from 'react';
import one from '@/assets/task-1.jpg';
import two from '@/assets/task-2.jpg';
import three from '@/assets/task-3.jpg';
import { toast } from 'sonner';
import { campaignSlots, canClaimDaily, createDailyBatch, createDayOneBatch, effectiveTier, FREE_DAILY_REFERRAL_CAP, REFERRAL_TASK_REWARD, TIERS, tierRank, UPLINE_REWARD_FIRST_TASK, UPLINE_REWARD_FIRST_WITHDRAW, WELCOME_BONUS, withdrawableBalance, withdrawalMin, type DailyBatch, type Tier } from '@/lib/rewards';

export type Platform = 'YouTube' | 'TikTok' | 'Instagram';
export type Campaign = { id: string; title: string; creator: string; platform: Platform; thumbnail: string; url: string; budget: number; payout: number; completed: number; slots: number; duration: string; accessCode: string; instruction: string };
export type Entry = { id: string; label: string; detail: string; coins: number; kind: 'task' | 'withdrawal' | 'referral' | 'bonus' | 'badge'; time: string };
export type Profile = { name: string; phone: string; youtube: string[]; tiktok: string[]; instagram: string[] };
const initialCampaigns: Campaign[] = [
  { id: '1', title: 'The habits that changed my life', creator: 'The Growth Diaries', platform: 'YouTube', thumbnail: one, url: 'https://www.youtube.com/results?search_query=kenya+growth+diaries', budget: 1000, payout: 2, completed: 382, slots: 500, duration: '8:24', accessCode: 'GROW24', instruction: 'Like the video and leave a comment of 3+ words.' },
  { id: '2', title: 'Nairobi after hours: a different view', creator: 'Explore with Kevin', platform: 'YouTube', thumbnail: two, url: 'https://www.youtube.com/results?search_query=nairobi+after+hours', budget: 1000, payout: 2, completed: 246, slots: 500, duration: '12:06', accessCode: 'NBO7', instruction: 'Comment 3+ words about your favourite scene.' },
  { id: '3', title: 'A little rhythm. A lot of Nairobi.', creator: 'Nia Moves', platform: 'TikTok', thumbnail: three, url: 'https://vm.tiktok.com/ZSg8tPbNv/', budget: 1000, payout: 2, completed: 418, slots: 500, duration: '0:58', accessCode: 'NIA58', instruction: 'Comment 3+ words. The access code is in the creator’s comment.' },
];
const extraTitles = ['Small steps, bigger dreams', 'A weekend in the city', 'Behind the moves', 'Five minutes of inspiration', 'The Nairobi you haven’t seen', 'A new perspective', 'City stories', 'Finding your rhythm', 'Making it count'];
extraTitles.forEach((title, index) => { const source = initialCampaigns[index % 3]; if (source) initialCampaigns.push({ ...source, id: String(index + 4), title, completed: 100 + index * 37 }); });
const initialEntries: Entry[] = [
  { id: 'e1', label: 'Video task completed', detail: 'The Growth Diaries', coins: 20, kind: 'task', time: 'Today, 10:42 AM' },
  { id: 'e2', label: 'Referral reward', detail: 'Faith completed a task', coins: REFERRAL_TASK_REWARD, kind: 'referral', time: 'Today, 9:18 AM' },
  { id: 'e0', label: 'Welcome bonus', detail: 'Thanks for joining Tcoins', coins: WELCOME_BONUS, kind: 'bonus', time: '3 days ago' },
];
export type Friend = { name: string; stage: 0 | 1 | 2 | 3; tasks: number; earned: number };
const initialFriends: Friend[] = [
  { name: 'Faith Wanjiku', stage: 3, tasks: 9, earned: 50 + 8 * REFERRAL_TASK_REWARD },
  { name: 'Brian Otieno', stage: 1, tasks: 1, earned: UPLINE_REWARD_FIRST_TASK },
  { name: 'Kevin Kariuki', stage: 0, tasks: 0, earned: 0 },
];
function useStore() {
  const [balance, setBalance] = useState(240);
  const [profile, setProfile] = useState<Profile>({ name: 'Alex Mwangi', phone: '0712345678', youtube: ['@alexmwangi'], tiktok: ['@alexmwangi'], instagram: ['@alexmwangi'] });
  const [boughtTier, setBoughtTier] = useState<Tier>('Free');
  const [lifetimeTasks, setLifetimeTasks] = useState(11);
  const tier = effectiveTier(boughtTier, lifetimeTasks);
  const [batch, setBatch] = useState<DailyBatch>({ tier: 'Free', videoCount: 3, reward: 60 });
  const dailyLimit = batch.videoCount;
  const [batchVersion, setBatchVersion] = useState(0);
  const dayRef = useRef('');
  const completedRef = useRef(new Set<string>());
  const claimRef = useRef(false);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  useEffect(() => { dayRef.current = new Date().toISOString().slice(0, 10); setBatch(createDayOneBatch()); setCampaigns(v => [...v].sort(() => Math.random() - 0.5)); }, []);
  const [done, setDone] = useState<string[]>([]);
  const [entries, setEntries] = useState(initialEntries);
  const [onboarded, setOnboarded] = useState(false);
  const [welcomeSeen, setWelcomeSeen] = useState(false);
  const [hasWithdrawn, setHasWithdrawn] = useState(false);
  const [uplinePaid, setUplinePaid] = useState(false);
  const [friends, setFriends] = useState(initialFriends);
  const [referralCreditsToday, setReferralCreditsToday] = useState(0);
  const [referralToday, setReferralToday] = useState(REFERRAL_TASK_REWARD);
  const addEntry = (entry: Omit<Entry, 'id' | 'time'>) => setEntries(v => [{ ...entry, id: crypto.randomUUID(), time: 'Just now' }, ...v]);
  const [passed, setPassed] = useState(0);
  const [claimed, setClaimed] = useState(false);
  /** Records a reviewed task. Tcoins are only paid out once the daily quota is 100% done. */
  const completeTask = (id: string, ok: boolean, handle: string) => {
    const campaign = campaigns.find(c => c.id === id);
    if (!ok || !campaign || !campaigns.slice(0, dailyLimit).some(c => c.id === id) || completedRef.current.has(id) || campaign.completed >= campaign.slots || completedRef.current.size >= dailyLimit) return false;
    completedRef.current.add(id);
    setDone(v => [...v, id]);
    if (ok) {
      setPassed(v => v + 1); setLifetimeTasks(v => v + 1);
      setCampaigns(v => v.map(c => c.id === id ? { ...c, completed: Math.min(c.slots, c.completed + 1) } : c));
      if (!uplinePaid) { setUplinePaid(true); toast.success(`Your upline received ${UPLINE_REWARD_FIRST_TASK} Tcoins for your first review!`); }
    }
    addEntry({ label: ok ? 'Video task verified' : 'Video task not granted', detail: `${campaign.creator} · @${handle.replace(/^@/, '')}`, coins: 0, kind: 'task' });
    return true;
  };
  const quotaDone = passed >= dailyLimit;
  const pendingReward = quotaDone && !claimed ? batch.reward : 0;
  const claimDaily = () => { if (!canClaimDaily(batch, completedRef.current.size, claimRef.current)) return 0; claimRef.current = true; setClaimed(true); setBalance(v => v + batch.reward); addEntry({ label: 'Daily tasks reward', detail: `${dailyLimit} verified tasks · Complete daily batch`, coins: batch.reward, kind: 'task' }); return batch.reward; };
  const withdrawable = withdrawableBalance(balance, referralToday, quotaDone);
  const minWithdrawal = withdrawalMin(hasWithdrawn);
  const withdraw = (coins: number, method: string, receipt: string) => { setBalance(v => v - coins); setHasWithdrawn(true); addEntry({ label: `${method} withdrawal`, detail: `${receipt} · Completed`, coins: -coins, kind: 'withdrawal' }); };
  const addCampaign = (data: { title: string; url: string; platform: Platform; thumbnail: string; budget: number; payout: number; accessCode: string; instruction: string }) => setCampaigns(v => [...v, { ...data, thumbnail: data.thumbnail || one, id: crypto.randomUUID(), creator: profile.name, completed: 0, slots: campaignSlots(data.budget, data.payout), duration: 'New' }]);
  const referralCapReached = tier === 'Free' && referralCreditsToday >= FREE_DAILY_REFERRAL_CAP;
  /** Moves a direct referral one step: first video (+25), first withdrawal (+25), then +2 per task. Milestones count against the Free daily cap. */
  const advanceReferral = (name: string) => {
    const f = friends.find(x => x.name === name); if (!f) return;
    const milestone = f.stage < 2;
    if (milestone && referralCapReached) { toast.error(`Daily referral cap reached (${FREE_DAILY_REFERRAL_CAP}/${FREE_DAILY_REFERRAL_CAP}). Upgrade to Pro for unlimited.`); return; }
    const coins = f.stage === 0 ? UPLINE_REWARD_FIRST_TASK : f.stage === 1 ? UPLINE_REWARD_FIRST_WITHDRAW : REFERRAL_TASK_REWARD;
    const label = f.stage === 0 ? 'reviewed their first video' : f.stage === 1 ? 'made their first withdrawal' : 'completed a task';
    setFriends(v => v.map(x => x.name === name ? { ...x, stage: Math.min(3, x.stage + 1) as Friend['stage'], tasks: x.tasks + (x.stage === 1 ? 0 : 1), earned: x.earned + coins } : x));
    if (milestone) setReferralCreditsToday(v => v + 1);
    setReferralToday(v => v + coins); setBalance(v => v + coins);
    addEntry({ label: 'Referral reward', detail: `${name.split(' ')[0]} ${label}`, coins, kind: 'referral' });
  };
  /** Buys a badge with Tcoins (deducted) or simulated M-Pesa. */
  const buyTier = (t: Tier, method: 'mpesa' | 'coins') => {
    if (tierRank(t) <= tierRank(tier)) return 'You already have this badge.';
    if (method === 'coins') { if (balance < TIERS[t].priceCoins) return `You need ${TIERS[t].priceCoins.toLocaleString()} Tcoins.`; setBalance(v => v - TIERS[t].priceCoins); addEntry({ label: `${t} badge`, detail: 'Paid with Tcoins', coins: -TIERS[t].priceCoins, kind: 'badge' }); }
    else addEntry({ label: `${t} badge`, detail: `KSH ${TIERS[t].priceKsh} · M-Pesa (simulated)`, coins: 0, kind: 'badge' });
    setBoughtTier(t); return null;
  };
  /** 00:00 UTC rollover: unfinished tasks are pulled, nothing carries over. */
  const rollDay = () => { dayRef.current = new Date().toISOString().slice(0, 10); completedRef.current.clear(); claimRef.current = false; setBatch(createDailyBatch(tier)); setBatchVersion(v => v + 1); setCampaigns(v => [...v].sort(() => Math.random() - 0.5)); setDone([]); setPassed(0); setClaimed(false); setReferralCreditsToday(0); setReferralToday(0); };
  useEffect(() => { const check = () => { if (dayRef.current && dayRef.current !== new Date().toISOString().slice(0, 10)) rollDay(); }; const timer = setInterval(check, 1000); window.addEventListener('focus', check); return () => { clearInterval(timer); window.removeEventListener('focus', check); }; }, [tier]);
  return { balance, profile, setProfile, tier, boughtTier, lifetimeTasks, buyTier, campaigns, done, entries, completeTask, claimDaily, pendingReward, claimed, passed, withdraw, withdrawable, minWithdrawal, hasWithdrawn, quotaDone, referralToday, addCampaign, onboarded, setOnboarded, welcomeSeen, setWelcomeSeen, friends, advanceReferral, referralCreditsToday, referralCapReached, rollDay, dailyLimit, dailyReward: batch.reward, batchVersion };
}
type StoreValue = ReturnType<typeof useStore>;
/** Kept on globalThis so hot reloads reuse one context instead of splitting provider and consumers. */
const g = globalThis as typeof globalThis & { __tcoinsStore?: React.Context<StoreValue | null> };
const Store = g.__tcoinsStore ?? (g.__tcoinsStore = createContext<StoreValue | null>(null));
export function TcoinsProvider({ children }: { children: ReactNode }) { const store = useStore(); return <Store.Provider value={store}>{children}</Store.Provider>; }
export function useTcoins() { const store = useContext(Store); if (!store) throw new Error('TcoinsProvider is required'); return store; }