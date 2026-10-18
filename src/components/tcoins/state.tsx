import { createContext, useContext, useEffect, useRef, useState, type Context, type ReactNode } from 'react';
import one from '@/assets/task-1.jpg';
import { toast } from 'sonner';
import { campaignSlots, canClaimDaily, createDailyBatch, createDayOneBatch, effectiveTier, FREE_DAILY_REFERRAL_CAP, REFERRAL_TASK_REWARD, TIERS, tierRank, UPLINE_REWARD_FIRST_TASK, UPLINE_REWARD_FIRST_WITHDRAW, WELCOME_BONUS, withdrawableBalance, withdrawalMin, type DailyBatch, type Tier } from '@/lib/rewards';
import { supabase } from '@/lib/supabase';

export type Platform = 'YouTube' | 'TikTok' | 'Instagram';
export type Campaign = { id: string; title: string; creator: string; platform: Platform; thumbnail: string; url: string; budget: number; payout: number; completed: number; slots: number; duration: string; accessCode: string; instruction: string };
export type Entry = { id: string; label: string; detail: string; coins: number; kind: 'task' | 'withdrawal' | 'referral' | 'bonus' | 'badge'; time: string };
export type Profile = { name: string; phone: string; youtube: string[]; tiktok: string[]; instagram: string[] };
/** LIVE task pool — real public videos by @tellonvysper (auto-scraped via oEmbed). Refresh with `node scripts/scrape-posts2.mjs` + reseed. */
const initialCampaigns: Campaign[] = [
  { id: '97b1a888', title: 'October 18, 2026', creator: '_tellon Vysper', platform: 'YouTube', thumbnail: 'https://i.ytimg.com/vi/pYETG1LuuP8/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=pYETG1LuuP8', budget: 100, payout: 2, completed: 0, slots: 50, duration: '—', accessCode: 'TC101', instruction: 'Watch the full video, then leave a genuine 3+ word comment from your linked handle. Real opinions only — verification checks the comment.' },
  { id: '572a079b', title: 'October 16, 2026', creator: '_tellon Vysper', platform: 'YouTube', thumbnail: 'https://i.ytimg.com/vi/K2uUtj_N1p0/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=K2uUtj_N1p0', budget: 100, payout: 2, completed: 0, slots: 50, duration: '—', accessCode: 'TC102', instruction: 'Watch the full video, then leave a genuine 3+ word comment from your linked handle. Real opinions only — verification checks the comment.' },
];
const initialEntries: Entry[] = [
  { id: 'e1', label: 'Video task completed', detail: 'The Growth Diaries', coins: 20, kind: 'task', time: 'Today, 10:42 AM' },
  { id: 'e2', label: 'Referral reward', detail: 'Faith completed a task', coins: REFERRAL_TASK_REWARD, kind: 'referral', time: 'Today, 9:18 AM' },
];
export type Friend = { name: string; stage: 0 | 1 | 2 | 3; tasks: number; earned: number };
const initialFriends: Friend[] = [
  { name: 'Faith Wanjiku', stage: 3, tasks: 9, earned: 50 + 8 * REFERRAL_TASK_REWARD },
  { name: 'Brian Otieno', stage: 1, tasks: 1, earned: UPLINE_REWARD_FIRST_TASK },
  { name: 'Kevin Kariuki', stage: 0, tasks: 0, earned: 0 },
];
function useStore() {
  const [balance, setBalance] = useState(240 - WELCOME_BONUS);   // welcome coins live behind Claim, not in the starting balance
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
  const [welcomeClaimed, setWelcomeClaimed] = useState(false);   // balance shows 0 until the banner's Claim is pressed
  const [claimingWelcome, setClaimingWelcome] = useState(false);
  const [coinSplash, setCoinSplash] = useState(0);               // increments → header coin pill plays its splash
  const [hasWithdrawn, setHasWithdrawn] = useState(false);
  const [uplinePaid, setUplinePaid] = useState(false);
  const [friends, setFriends] = useState(initialFriends);
  const [referralCreditsToday, setReferralCreditsToday] = useState(0);
  const [referralToday, setReferralToday] = useState(REFERRAL_TASK_REWARD);
  /** Real session → dashboard shows the wallet/ledger from PostgreSQL, not the preview defaults. */
  const [authed, setAuthed] = useState(false);
  const assignRef = useRef(false);
  useEffect(() => {
    const on = async (userId: string, isSignOut: boolean) => {
      if (isSignOut) { setAuthed(false); setOnboarded(false); setWelcomeClaimed(false); return; }
      setAuthed(true); setOnboarded(true);
      // profile (username, locked phone, badge, lifetime) + locked handles
      const [{ data: prof }, { data: handles }, { data: ledger }] = await Promise.all([
        supabase.from('profiles').select('username, phone_number, bought_badge, lifetime_tasks, has_withdrawn, is_flagged').eq('id', userId).maybeSingle(),
        supabase.from('social_handles').select('platform, handle').eq('user_id', userId),
        supabase.from('wallet_ledger').select('id, kind, amount, balance_after, reference_id, description, created_at').eq('user_id', userId).order('seq', { ascending: false }),
      ]);
      if (prof) {
        setProfile({
          name: prof.username,
          phone: prof.phone_number,
          youtube: (handles || []).filter(h => h.platform === 'youtube').map(h => h.handle),
          tiktok: (handles || []).filter(h => h.platform === 'tiktok').map(h => h.handle),
          instagram: (handles || []).filter(h => h.platform === 'instagram').map(h => h.handle),
        });
        setBoughtTier(prof.bought_badge === 'premium' ? 'Premium' : prof.bought_badge === 'pro' ? 'Pro' : 'Free');
        setLifetimeTasks(prof.lifetime_tasks ?? 0);
        setHasWithdrawn(!!prof.has_withdrawn);
      }
      // wallet = last balance_after in the immutable ledger (never a stored balance)
      if (ledger?.length) {
        const last = ledger[0];
        if (last) setBalance(last.balance_after);
        setEntries(ledger.map(r => ({
          id: r.id,
          label: r.kind === 'welcome_bonus' ? 'Welcome bonus' : r.kind === 'daily_batch' ? 'Daily tasks reward' : r.kind === 'referral_claim' ? 'Referral rewards unlocked' : r.kind === 'badge_purchase' ? 'Badge' : r.kind === 'withdrawal' ? 'M-Pesa withdrawal' : 'Refund',
          detail: r.description || r.reference_id || r.kind,
          coins: r.amount,
          kind: r.kind === 'withdrawal' || r.kind === 'withdrawal_refund' ? 'withdrawal' : r.kind === 'referral_claim' ? 'referral' : r.kind === 'badge_purchase' ? 'badge' : r.kind === 'welcome_bonus' ? 'bonus' : 'task',
          time: new Date(r.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
        })));
      } else setBalance(0);
      // welcome claimed = a welcome_bonus row already exists in the ledger
      setWelcomeClaimed(!!ledger?.some(r => r.kind === 'welcome_bonus'));
    };
    const refresh = async () => { const { data: { user } } = await supabase.auth.getUser(); if (user) { setAuthed(true); await on(user.id, false); } };
    refresh();
    return supabase.auth.onAuthStateChange((evt, sess) => {
      if (evt === 'SIGNED_OUT') { on('', true); return; }
      if (sess?.user) refresh();
    }).data.subscription.unsubscribe;
  }, []);
  /**
   * Videos are NEVER assigned before login: this runs right after the session exists
   * (behind the "Loading Tasks" overlay) and generates/fetches today's frozen batch.
   */
  const assignTasks = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || assignRef.current) return;
    assignRef.current = true;
    try {
      const { data: j } = await supabase.rpc('fn_generate_batch', { p_user: user.id });
      const b = j as { ok: boolean; video_count?: number; reward?: number; completed_tasks?: number; is_claimed?: boolean } | null;
      const shuffled = [...campaigns].sort(() => Math.random() - 0.5);
      setCampaigns(shuffled);                      // assign today's video order
      setDone([]); setPassed(0);
      completedRef.current.clear();
      if (b?.ok) {
        const t: Tier = effectiveTier(boughtTier, lifetimeTasks);
        setBatch({ tier: t, videoCount: b.video_count ?? createDayOneBatch().videoCount, reward: b.reward ?? createDayOneBatch().reward });
        const doneIds = shuffled.slice(0, b.completed_tasks ?? 0).map(c => c.id);   // restore today's progress
        doneIds.forEach(id => completedRef.current.add(id));
        setDone(doneIds); setPassed(b.completed_tasks ?? 0);
        setClaimed(!!b.is_claimed); claimRef.current = !!b.is_claimed;
        setBatchVersion(v => v + 1);
      }
    } finally { assignRef.current = false; }
  };
  const addEntry = (entry: Omit<Entry, 'id' | 'time'>) => setEntries(v => [{ ...entry, id: crypto.randomUUID(), time: 'Just now' }, ...v]);
  /** The 25 welcome Tcoins: invisible (balance 0) until the user claims them from the banner. */
  const claimWelcome = () => {
    if (welcomeClaimed || claimingWelcome) return;
    setClaimingWelcome(true);
    const finish = (bal?: number) => {
      setBalance(b => bal ?? b + WELCOME_BONUS);
      setWelcomeClaimed(true);
      addEntry({ label: 'Welcome bonus', detail: 'Thanks for joining Tcoins', coins: WELCOME_BONUS, kind: 'bonus' });
      setCoinSplash(v => v + 1);   // header coin pill splash
      setClaimingWelcome(false);
    };
    if (authed) {
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) { setClaimingWelcome(false); return; }
        const { data: r } = await supabase.rpc('fn_claim_welcome', { p_user: user.id });
        const j = r as { ok: boolean; balance_after?: number; error?: string } | null;
        if (j?.ok) finish(j.balance_after);
        else { setWelcomeClaimed(true); setClaimingWelcome(false); toast.error(j?.error === 'already_claimed' ? 'Welcome bonus already claimed.' : 'Could not claim right now.'); }
      });
      return;
    }
    finish();   // preview mode
  };
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
  const claimDaily = () => {
    if (!canClaimDaily(batch, completedRef.current.size, claimRef.current)) return 0;
    claimRef.current = true; setClaimed(true);
    if (authed) {
      // Real claim: server-side all-or-nothing + referral vault unlock (fn_claim_daily_batch).
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        const { data: r } = await supabase.rpc('fn_claim_daily_batch', { p_user: user.id });
        const j = r as { ok: boolean; coins_paid?: number; referral_unlocked?: number; balance_after?: number; error?: string } | null;
        if (j?.ok) {
          setBalance(j.balance_after ?? 0);
          if (j.referral_unlocked) { setReferralToday(v => v + j.referral_unlocked!); addEntry({ label: 'Referral rewards unlocked', detail: 'Finish-today bonus vault opened', coins: j.referral_unlocked, kind: 'referral' }); }
          addEntry({ label: 'Daily tasks reward', detail: `${dailyLimit} verified tasks · Complete daily batch`, coins: batch.reward, kind: 'task' });
        } else { setClaimed(false); claimRef.current = false; toast.error(j?.error === 'batch_incomplete' ? 'Finish every assigned video first.' : 'Could not collect right now.'); }
      });
      return batch.reward;
    }
    setBalance(v => v + batch.reward);
    addEntry({ label: 'Daily tasks reward', detail: `${dailyLimit} verified tasks · Complete daily batch`, coins: batch.reward, kind: 'task' });
    return batch.reward;
  };
  const withdrawable = withdrawableBalance(balance, referralToday, quotaDone);
  const minWithdrawal = withdrawalMin(hasWithdrawn);
  const withdraw = (coins: number, method: string, receipt: string) => {
    if (authed) {
      // Real debit: atomic ledger hold on the coins while M-Pesa B2C is pending (fn_request_withdrawal).
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        const { data: r } = await supabase.rpc('fn_request_withdrawal', { p_user: user.id, p_amount: coins });
        const j = r as { ok: boolean; withdrawal_id?: string; balance_after?: number; error?: string; minimum?: number } | null;
        if (j?.ok) {
          setBalance(j.balance_after ?? 0);
          setHasWithdrawn(true);
          addEntry({ label: `${method} withdrawal`, detail: `${String(j.withdrawal_id).slice(0, 8)} · Pending M-Pesa`, coins: -coins, kind: 'withdrawal' });
        } else {
          toast.error(j?.error === 'below_minimum' ? `Minimum for this cashout is ${j.minimum} Tcoins.` : j?.error === 'balance_too_low' ? 'Not enough withdrawable Tcoins.' : 'Cashout rejected — try again.');
        }
      });
      return;
    }
    setBalance(v => v - coins); setHasWithdrawn(true); addEntry({ label: `${method} withdrawal`, detail: `${receipt} · Completed`, coins: -coins, kind: 'withdrawal' });
  };
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
  const rollDay = () => { dayRef.current = new Date().toISOString().slice(0, 10); completedRef.current.clear(); claimRef.current = false; setBatch(createDailyBatch(tier)); setBatchVersion(v => v + 1); setCampaigns(v => [...v].sort(() => Math.random() - 0.5)); setDone([]); setPassed(0); setClaimed(false); setReferralCreditsToday(0); setReferralToday(0); if (authed) void assignTasks(); };
  useEffect(() => { const check = () => { if (dayRef.current && dayRef.current !== new Date().toISOString().slice(0, 10)) rollDay(); }; const timer = setInterval(check, 1000); window.addEventListener('focus', check); return () => { clearInterval(timer); window.removeEventListener('focus', check); }; }, [tier]);
  return { balance, profile, setProfile, tier, boughtTier, lifetimeTasks, buyTier, campaigns, done, entries, completeTask, claimDaily, pendingReward, claimed, passed, withdraw, withdrawable, minWithdrawal, hasWithdrawn, quotaDone, referralToday, addCampaign, onboarded, setOnboarded, welcomeClaimed, claimWelcome, claimingWelcome, coinSplash, friends, advanceReferral, referralCreditsToday, referralCapReached, rollDay, dailyLimit, dailyReward: batch.reward, batchVersion, authed, assignTasks };
}
type StoreValue = ReturnType<typeof useStore>;
/** Kept on globalThis so hot reloads reuse one context instead of splitting provider and consumers. */
const g = globalThis as typeof globalThis & { __tcoinsStore?: Context<StoreValue | null> };
const Store = g.__tcoinsStore ?? (g.__tcoinsStore = createContext<StoreValue | null>(null));
export function TcoinsProvider({ children }: { children: ReactNode }) { const store = useStore(); return <Store.Provider value={store}>{children}</Store.Provider>; }
export function useTcoins() { const store = useContext(Store); if (!store) throw new Error('TcoinsProvider is required'); return store; }