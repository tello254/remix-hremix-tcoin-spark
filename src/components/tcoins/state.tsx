import { createContext, useContext, useEffect, useRef, useState, type Context, type ReactNode } from 'react';
import one from '@/assets/task-1.jpg';
import { toast } from 'sonner';
import { campaignSlots, canClaimDaily, createDailyBatch, createDayOneBatch, effectiveTier, referralDailyCap, REFERRAL_TASK_REWARD, TIERS, tierRank, UPLINE_REWARD_FIRST_TASK, UPLINE_REWARD_FIRST_WITHDRAW, WELCOME_BONUS, withdrawableBalance, withdrawalMin, type DailyBatch, type Tier } from '@/lib/rewards';
import { supabase } from '@/lib/supabase';
import { rowToCampaign, type CampaignRow } from '@/lib/creator.functions';

export type Platform = 'YouTube' | 'TikTok' | 'Instagram';
export type Campaign = { id: string; title: string; creator: string; platform: Platform; thumbnail: string; url: string; budget: number; payout: number; completed: number; slots: number; duration: string; accessCode: string; instruction: string };
export type Entry = { id: string; label: string; detail: string; coins: number; kind: 'task' | 'withdrawal' | 'referral' | 'bonus' | 'badge'; time: string };
export type Profile = { name: string; phone: string; youtube: string[]; tiktok: string[]; instagram: string[] };
/** Instagram tasks always sort last — real comment verification exists for YouTube/TikTok only. */
const igLast = (list: Campaign[]) => [...list.filter(c => c.platform !== 'Instagram'), ...list.filter(c => c.platform === 'Instagram')];
/** LIVE task pool — real public videos by @tellonvysper (auto-scraped via oEmbed). Refresh with `node scripts/scrape-posts2.mjs` + reseed. */
const initialCampaigns: Campaign[] = [
  { id: '97b1a888', title: 'October 18, 2026', creator: '_tellon Vysper', platform: 'YouTube', thumbnail: 'https://i.ytimg.com/vi/pYETG1LuuP8/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=pYETG1LuuP8', budget: 100, payout: 2, completed: 0, slots: 50, duration: '—', accessCode: 'TC101', instruction: 'Watch the full video, then leave a genuine 3+ word comment from your linked handle. Real opinions only — verification checks the comment.' },
  { id: '572a079b', title: 'October 16, 2026', creator: '_tellon Vysper', platform: 'YouTube', thumbnail: 'https://i.ytimg.com/vi/K2uUtj_N1p0/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=K2uUtj_N1p0', budget: 100, payout: 2, completed: 0, slots: 50, duration: '—', accessCode: 'TC102', instruction: 'Watch the full video, then leave a genuine 3+ word comment from your linked handle. Real opinions only — verification checks the comment.' },
  { id: 'a68f21a3', title: 'Instagram reel — Oct 18, 2026', creator: '@vysper_talon', platform: 'Instagram', thumbnail: 'https://www.instagram.com/p/Deqo2-yi67q/media/?size=l', url: 'https://www.instagram.com/vysper_talon/reel/Deqo2-yi67q/', budget: 100, payout: 2, completed: 0, slots: 50, duration: '—', accessCode: 'TC103', instruction: 'Watch the full reel, then leave a genuine 3+ word comment from your linked handle. Real opinions only — verification checks the comment.' },
];
const initialEntries: Entry[] = [
  { id: 'e1', label: 'Video task completed', detail: 'The Growth Diaries', coins: 20, kind: 'task', time: 'Today, 10:42 AM' },
  { id: 'e2', label: 'Referral reward', detail: 'Faith completed a task', coins: REFERRAL_TASK_REWARD, kind: 'referral', time: 'Today, 9:18 AM' },
];
export type Friend = { id?: string; name: string; stage: 0 | 1 | 2 | 3; tasks: number; earned: number };
const initialFriends: Friend[] = [
  { name: 'Faith Wanjiku', stage: 3, tasks: 9, earned: 50 + 8 * REFERRAL_TASK_REWARD },
  { name: 'Brian Otieno', stage: 1, tasks: 1, earned: UPLINE_REWARD_FIRST_TASK },
  { name: 'Kevin Kariuki', stage: 0, tasks: 0, earned: 0 },
];
function useStore() {
  const [balance, setBalance] = useState(240 - WELCOME_BONUS);   // welcome coins live behind Claim, not in the starting balance
  const [profile, setProfile] = useState<Profile>({ name: 'Guest', phone: '07•• ••• •••', youtube: [], tiktok: [], instagram: [] });
  const [boughtTier, setBoughtTier] = useState<Tier>('Free');
  const [lifetimeTasks, setLifetimeTasks] = useState(11);
  const tier = effectiveTier(boughtTier, lifetimeTasks);
  const [batch, setBatch] = useState<DailyBatch>({ tier: 'Free', videoCount: 3, reward: 60 });
  const dailyLimit = batch.videoCount;
  const [batchVersion, setBatchVersion] = useState(0);
  const dayRef = useRef('');
  const completedRef = useRef(new Set<string>());
  const completedIdsRef = useRef(new Set<string>());   // every campaign id this user has EVER completed — never offered again
  const claimRef = useRef(false);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  useEffect(() => { dayRef.current = new Date().toISOString().slice(0, 10); setBatch(createDayOneBatch()); setCampaigns(v => [...v].sort(() => Math.random() - 0.5)); }, []);
  const [done, setDone] = useState<string[]>([]);
  const [entries, setEntries] = useState(initialEntries);
  const [onboarded, setOnboarded] = useState(false);
  const [welcomeClaimed, setWelcomeClaimed] = useState(false);   // balance shows 0 until the banner's Claim is pressed
  const [claimingWelcome, setClaimingWelcome] = useState(false);
  const [coinSplash, setCoinSplash] = useState(0);               // increments → header coin pill plays its splash
  const [streak, setStreak] = useState(3);                       // preview shows the demo streak; authed users get the real one
  const [weekEarned, setWeekEarned] = useState(180);             // earned in the last 7 days (real from the ledger when authed)
  const [payoutsDone, setPayoutsDone] = useState(0);             // Tcoins payouts banked — journey to the organic Pro badge
  const [hasWithdrawn, setHasWithdrawn] = useState(false);
  const [uplinePaid, setUplinePaid] = useState(false);
  const [friends, setFriends] = useState(initialFriends);
  const [referralCreditsToday, setReferralCreditsToday] = useState(0);
  const [referralToday, setReferralToday] = useState(REFERRAL_TASK_REWARD);
  const [referralVault, setReferralVault] = useState(0);   // coins in the referral wallet — separate from the main balance until transferred
  const [simBusy, setSimBusy] = useState(false);           // one referral simulation at a time

  /** Preview-mode persistence: simulated referral earnings, activity and withdrawals live in localStorage
   *  so a tester can refresh mid-demo without losing the story. Real (authed) data is DB-backed instead. */
  const PREVIEW_KEY = 'tcoins.preview.v2';
  const previewRead = () => { if (typeof window === 'undefined') return null; try { const raw = localStorage.getItem(PREVIEW_KEY); return raw ? JSON.parse(raw) as Record<string, unknown> : null; } catch { return null; } };
  const previewWrite = (st: Record<string, unknown>) => { if (typeof window === 'undefined') return; try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(st)); } catch { /* storage unavailable */ } };
  /** Real session → dashboard shows the wallet/ledger from PostgreSQL, not the preview defaults. */
  const [authed, setAuthed] = useState(false);
  const [hydrated, setHydrated] = useState(false);   // true only after a SUCCESSFUL account hydrate — preview data never shows past this
  useEffect(() => {   // preview persistence: apply the saved story once on client boot (SSR renders defaults)
    if (authed) return;
    const p = previewRead(); if (!p) return;
    if (typeof p.balance === 'number') setBalance(p.balance);
    if (typeof p.referralVault === 'number') setReferralVault(p.referralVault);
    if (typeof p.weekEarned === 'number') setWeekEarned(p.weekEarned);
    if (p.hasWithdrawn != null) setHasWithdrawn(!!p.hasWithdrawn);
    if (Array.isArray(p.friends)) setFriends(p.friends as Friend[]);
    if (Array.isArray(p.entries)) setEntries(p.entries);
  }, []);
  useEffect(() => {   // keep the preview story saved on every change while in preview mode
    if (authed) return;
    previewWrite({ balance, referralVault, weekEarned, hasWithdrawn, friends, entries });
  }, [authed, balance, referralVault, weekEarned, hasWithdrawn, friends, entries]);
  const assignRef = useRef(false);
  const hydrateRef = useRef<Promise<void> | null>(null);   // resolves once profile + handles + ledger + campaign pool are loaded
  useEffect(() => {
    const on = async (userId: string, isSignOut: boolean) => {
    if (isSignOut) { setAuthed(false); setOnboarded(false); setWelcomeClaimed(false); setHydrated(false); return; }
    setAuthed(true); setOnboarded(true);
    // profile (username, locked phone, badge, lifetime) + locked handles + the LIVE campaign pool.
    // Network drops must NEVER fall back to preview data: retry, then sign out with a clear message.
    let prof: { username: string; phone_number: string; bought_badge: string; lifetime_tasks: number; has_withdrawn: boolean } | null = null;
    let handles: { platform: string; handle: string }[] = [];
    let ledger: { id: string; kind: string; amount: number; balance_after: number; reference_id: string | null; description: string | null; created_at: string }[] = [];
    let campRows: CampaignRow[] | null = null;
    let myRefs: { referee_name: string; stage: number; tasks_completed: number; total_earned: number }[] | null = null;
    let comps: { campaign_id: string }[] = [];
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // 24h auto-transfer sweep first, so the ledger and everything below it is already up to date
          await supabase.rpc('fn_sweep_referral_vault', { p_user: userId });
          const [p, h, l, c, r, cp] = await Promise.all([
            supabase.from('profiles').select('username, phone_number, bought_badge, lifetime_tasks, has_withdrawn, is_flagged').eq('id', userId).maybeSingle(),
            supabase.from('social_handles').select('platform, handle').order('created_at', { ascending: true }).eq('user_id', userId),
            supabase.from('wallet_ledger').select('id, kind, amount, balance_after, reference_id, description, created_at').eq('user_id', userId).order('seq', { ascending: false }),
            supabase.from('campaigns').select('id, title, url, platform, thumbnail, budget_ksh, payout_ksh, access_code, instruction, duration, slots, completed, creator_name').eq('active', true).order('created_at', { ascending: false }).limit(50),
            supabase.rpc('fn_my_referrals', { p_user: userId }),
            supabase.from('task_completions').select('campaign_id'),   // RLS: own rows only — every campaign this user has ever done
          ]);
          if (p.error) throw p.error;
          prof = p.data; handles = h.data ?? []; ledger = l.data ?? []; campRows = c.data; myRefs = r.data; comps = cp.data ?? [];
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));   // brief backoff, then retry the whole hydrate
        }
      }
    } catch {
      toast.error('Network lost — couldn’t load your account. Please log in again.');
      await supabase.auth.signOut();
      return;
    }
      // the all-time completion ledger: a task done once can never reappear for this user
      completedIdsRef.current = new Set(comps.map(x => x.campaign_id));
      // creator-launched campaigns (creator studio) ARE the task pool — no scraping, pur et dur
      if (campRows?.length) {
        const pool = campRows.map(r => rowToCampaign(r as CampaignRow))
          .filter(x => !completedIdsRef.current.has(x.id))   // forever-done videos leave the pool at every load
          .map(c => ({ ...c, thumbnail: c.thumbnail || one }));
        setCampaigns(pool);
      }
      if (prof) {
        setProfile({          name: prof.username,
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
          label: r.kind === 'welcome_bonus' ? 'Welcome bonus' : r.kind === 'daily_batch' ? 'Daily tasks reward' : r.kind === 'referral_claim' ? 'Referral rewards unlocked' : r.kind === 'referral_milestone' ? 'Referral milestone (+25 wallet)' : r.kind === 'referral_task' ? 'Referral commission (+2 balance)' : r.kind === 'badge_purchase' ? 'Badge' : r.kind === 'withdrawal' ? 'M-Pesa withdrawal' : 'Refund',
          detail: r.description || r.reference_id || r.kind,
          coins: r.amount,
          kind: r.kind === 'withdrawal' || r.kind === 'withdrawal_refund' ? 'withdrawal' : r.kind === 'referral_claim' || r.kind === 'referral_milestone' || r.kind === 'referral_task' ? 'referral' : r.kind === 'badge_purchase' ? 'badge' : r.kind === 'welcome_bonus' ? 'bonus' : 'task',
          time: new Date(r.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
        })));
      } else { setBalance(0); setPayoutsDone(0); }
      // welcome claimed = a welcome_bonus row already exists in the ledger
      setWelcomeClaimed(!!ledger?.some(r => r.kind === 'welcome_bonus'));
      // real referrals replace the demo friends; simulated ones only ever show in preview mode
      if (myRefs?.length) setFriends(myRefs.map((r: any) => ({ id: r.referral_id, name: r.referee_name ?? 'New member', stage: Math.min(3, r.stage) as Friend['stage'], tasks: r.tasks_completed, earned: r.total_earned })));
      else setFriends([]);   // logged-in with no referrals: the truth, not a demo list
      // weekly earnings = positive ledger movement in the last 7 days (real money view)
      const weekAgo = Date.now() - 7 * 864e5;
      setWeekEarned((ledger || []).filter(r => r.amount > 0 && new Date(r.created_at).getTime() >= weekAgo).reduce((a, r) => a + r.amount, 0));
      // real streak = consecutive UTC days (ending today or yesterday) that ended in a claimed daily batch
      const daySet = new Set((ledger || []).filter(r => r.kind === 'daily_batch').map(r => r.created_at.slice(0, 10)));
      const today = new Date().toISOString().slice(0, 10);
      const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      let anchor: string | null = null;
      if (daySet.has(today)) anchor = today; else if (daySet.has(yest)) anchor = yest;
      let n = 0;
      if (anchor) for (let d = new Date(anchor + 'T00:00:00Z'); daySet.has(d.toISOString().slice(0, 10)); d = new Date(d.getTime() - 864e5)) n++;
      setStreak(n);
      // journey counter: every claimed daily batch is one Tcoins payout (16 unlock the organic Pro badge)
      setPayoutsDone((ledger || []).filter(r => r.kind === 'daily_batch').length);
      // referral wallet: coins earned from friends live separately until transferred (or 24h auto-transfer)
      const { data: vaultRow } = await supabase.rpc('fn_referral_vault', { p_user: userId });
      setReferralVault((vaultRow as { total?: number } | null)?.total ?? 0);
      if (!prof) { await supabase.auth.signOut(); return; }   // session without a profile row — not a real account
      setHydrated(true);
    };
    const refresh = async () => { const { data: { user } } = await supabase.auth.getUser(); if (user) { setAuthed(true); const p = on(user.id, false); hydrateRef.current = p; await p; } };
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
      // the restore below must see the LIVE campaign pool; wait for the hydrate to finish,
      // otherwise today's completed ids get dropped and progress resets to 0 on reload
      await hydrateRef.current?.catch(() => {});
      const { data: j } = await supabase.rpc('fn_generate_batch', { p_user: user.id });
      const b = j as { ok: boolean; video_count?: number; reward?: number; completed_tasks?: number; is_claimed?: boolean } | null;
      // today's video order — randomized, but Instagram tasks always go last (real comment checks exist for YT/TikTok first)
      // functional updater on purpose: the render-closure `campaigns` is stale after the awaited hydrate,
      // and overwriting with it would clobber the freshly loaded DB pool (studio tasks would vanish!)
      // forevers-done videos (any day, any batch) are filtered out permanently — never offered twice
      setCampaigns(v => igLast([...v].filter(x => !completedIdsRef.current.has(x.id)).sort(() => Math.random() - 0.5)));   // assign today's video order
      setDone([]); setPassed(0);
      completedRef.current.clear();
      if (b?.ok) {
        const t: Tier = effectiveTier(boughtTier, lifetimeTasks);
        setBatch({ tier: t, videoCount: b.video_count ?? createDayOneBatch().videoCount, reward: b.reward ?? createDayOneBatch().reward });
        // restore today's REAL progress by ID — from task_completions; no filtering against the (possibly
        // still-loading) pool: an id without a matching card simply renders nothing until the pool lands
        let doneIds: string[] = []; const n = Math.max(0, b.completed_tasks ?? 0);
        if (n > 0) {
          const today = new Date().toISOString().slice(0, 10);
          const { data: batchRow } = await supabase.from('daily_batches').select('id').eq('user_id', user.id).eq('date_utc', today).maybeSingle();
          if (batchRow) {
            const { data: tRows } = await supabase.from('task_completions').select('campaign_id').eq('batch_id', batchRow.id);
            doneIds = [...new Set((tRows ?? []).map(r => r.campaign_id))];
          }
        }
        doneIds.forEach(id => completedRef.current.add(id));
        setDone(doneIds); setPassed(Math.max(n, doneIds.length));
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
  const [claimed, setClaimed] = useState(false);  /** Records a reviewed task. Tcoins are only paid out once the daily quota is 100% done. */
  const completeTask = (id: string, ok: boolean, handle: string) => {
    const campaign = campaigns.find(c => c.id === id);
    if (!ok || !campaign || !campaigns.slice(0, dailyLimit).some(c => c.id === id) || completedRef.current.has(id) || campaign.completed >= campaign.slots || completedRef.current.size >= dailyLimit) return false;
    completedRef.current.add(id);
    completedIdsRef.current.add(id);   // lifelong: this campaign can never reappear for this account
    setDone(v => [...v, id]);
    if (ok) {
      setPassed(v => v + 1); setLifetimeTasks(v => v + 1);
      setCampaigns(v => v.map(c => c.id === id ? { ...c, completed: Math.min(c.slots, c.completed + 1) } : c));
      if (!uplinePaid) { setUplinePaid(true); toast.success(`Your upline received ${UPLINE_REWARD_FIRST_TASK} Tcoins for your first review!`); }
    }
    addEntry({ label: 'Task completed', detail: campaign.title, coins: Math.floor(batch.reward / Math.max(dailyLimit, 1)), kind: 'task' });
    // finish line: the goal panel lights up with the pulsating neon CLAIM button — money moves when the
    // user taps it, so they SEE exactly when they're paid. The toast makes sure nobody walks away early.
    if (completedRef.current.size >= dailyLimit && !claimRef.current) toast.success(`Daily batch complete — claim your ${batch.reward} Tcoins! 🎉`);
    return true;
  };
  const quotaDone = passed >= dailyLimit;
  const [claimTick, setClaimTick] = useState(0);   // bumped when a batch claim actually pays — drives the coin-fly + ring burst
  const pendingReward = quotaDone && !claimed ? batch.reward : 0;
  const claimDaily = () => {
    if (!canClaimDaily(batch, completedRef.current.size, claimRef.current)) return 0;
    claimRef.current = true; setClaimed(true);
    if (authed) {
      // Real claim: server-side all-or-nothing (fn_claim_daily_batch) — referral coins stay vaulted.
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        const { data: r } = await supabase.rpc('fn_claim_daily_batch', { p_user: user.id });
        const j = r as { ok: boolean; coins_paid?: number; balance_after?: number; pro_awarded?: boolean; error?: string } | null;
        if (j?.ok) {
          setBalance(j.balance_after ?? 0);
          setPayoutsDone(v => v + 1);   // another Tcoins payout banked on the journey to Pro
          setWeekEarned(v => v + (batch.reward ?? 0));
          setStreak(v => v + 1);   // today joined the streak (ledger anchor moves to today)
          setTimeout(() => setCoinSplash(v => v + 1), 1000);   // the pill pops only when the coins actually ARRIVE
          setClaimTick(v => v + 1);   // ring burst + coin flight start together, immediately
          addEntry({ label: 'Daily tasks reward', detail: `${dailyLimit} verified tasks · Complete daily batch`, coins: batch.reward, kind: 'task' });
          toast.success(`${j.coins_paid} Tcoins collected — daily batch complete! 🎉`);
          if (j.pro_awarded) { setBoughtTier('Pro'); toast.success('Pro badge unlocked — 16 payouts banked. Higher daily rewards are live!'); }
        } else { setClaimed(false); claimRef.current = false; toast.error(j?.error === 'batch_incomplete' ? 'Finish every assigned video first.' : 'Could not collect right now.'); }
      });
      return batch.reward;
    }
    setBalance(v => v + batch.reward);
    setClaimTick(v => v + 1);
    setTimeout(() => setCoinSplash(v => v + 1), 1000);   // preview: pill pops when the coins arrive, same as the real path
    addEntry({ label: 'Daily tasks reward', detail: `${dailyLimit} verified tasks · Complete daily batch`, coins: batch.reward, kind: 'task' });
    return batch.reward;
  };
  /** Referral wallet → main wallet. The privilege is earned by finishing today's tasks; anything
   *  left untransferred lands automatically after 24 hours (server-side sweep on every money call). */
  const transferReferral = () => {
    if (!(referralVault > 0)) return;
    if (authed) {
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        const { data: r } = await supabase.rpc('fn_transfer_referral_vault', { p_user: user.id });
        const j = r as { ok: boolean; coins?: number; balance_after?: number; error?: string } | null;
        if (j?.ok) {
          setBalance(j.balance_after ?? 0);
          setReferralVault(0);
          if (j.coins) {
            setReferralToday(v => v + j.coins!);
            addEntry({ label: 'Referral rewards transferred', detail: 'Referral wallet → available balance', coins: j.coins, kind: 'referral' });
            toast.success(`${j.coins} referral Tcoins moved to your main wallet.`);
          }
        } else toast.error(j?.error === 'quota_incomplete' ? 'Finish today’s tasks to transfer referral coins.' : 'Could not transfer right now.');
      });
      return;
    }
    setBalance(v => v + referralVault);
    setReferralToday(v => v + referralVault);
    addEntry({ label: 'Referral rewards transferred', detail: 'Referral wallet → available balance', coins: referralVault, kind: 'referral' });
    toast.success(`${referralVault} referral Tcoins moved to your main wallet.`);
    setReferralVault(0);
  };
  const withdrawable = withdrawableBalance(balance);
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
  const addCampaign = (data: ({ title: string; url: string; platform: Platform; thumbnail: string; budget: number; payout: number; accessCode: string; instruction: string } | Campaign)) => setCampaigns(v => 'id' in data ? [data, ...v] : [...v, { ...data, thumbnail: data.thumbnail || one, id: crypto.randomUUID(), creator: profile.name, completed: 0, slots: campaignSlots(data.budget, data.payout), duration: 'New' }]);
  const referralCapReached = referralCreditsToday >= referralDailyCap(tier);   // Free 2/day · Pro 5/day · Premium unlimited
  /** Moves a direct referral one step: first video (+25), first withdrawal (+25), then +2 per task. Milestones count against the Free daily cap. */
  /** Referral event through the REAL money rules — DB-persisted when logged in:
   *  milestones (+25 first video / +25 first cashout) land in the REFERRAL WALLET;
   *  every later downline task pays +2 straight into the MAIN BALANCE. Both are ledger entries. */
  const advanceReferral = (name: string) => {
    if (authed) {
      if (simBusy) return;
      const f = friends.find(x => x.name === name);
      setSimBusy(true);
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) { setSimBusy(false); return; }
        const { data: r } = await supabase.rpc('fn_simulate_referral', { p_user: user.id, p_referral_id: f?.id ?? null });
        const j = r as { ok: boolean; kind?: 'first_task' | 'first_withdraw' | 'task'; coins?: number; balance_after?: number; vault_total?: number; stage?: number; tasks_completed?: number; total_earned?: number; referral_id?: string; referee_name?: string; error?: string } | null;
        setSimBusy(false);
        if (!j?.ok) {
          toast.error(j?.error === 'cap_reached' ? `Daily referral milestone cap reached (${referralDailyCap(tier)}/day). ${tier === 'Free' ? 'Pro allows 5 per day.' : ''}` : 'Could not record the referral event.');
          return;
        }
        if (j.kind === 'task') { setBalance(j.balance_after ?? 0); toast.success('+2 Tcoins commission paid straight to your balance.'); }
        else { setReferralVault(j.vault_total ?? referralVault); toast.success('+25 milestone Tcoins landed in your referral wallet.'); if (j.kind) setReferralCreditsToday(v => v + 1); }
        const row: Friend = { id: j.referral_id, name: j.referee_name ?? 'Sim Friend', stage: (j.stage ?? 0) as Friend['stage'], tasks: j.tasks_completed ?? 0, earned: j.total_earned ?? 0 };
        setFriends(v => { const i = v.findIndex(x => x.id === j.referral_id); if (i >= 0) { const w = [...v]; w[i] = row; return w; } return [...v, row]; });
        addEntry({ label: j.kind === 'task' ? 'Referral commission' : 'Referral milestone', detail: `${row.name.split(' ')[0]} ${j.kind === 'task' ? 'completed a task (+2 main balance)' : 'milestone (+25 referral wallet)'}`, coins: j.kind === 'task' ? 2 : 25, kind: 'referral' });
      });
      return;
    }
    const f = friends.find(x => x.name === name); if (!f) return;
    const isMilestone = f.stage < 2;
    if (isMilestone && referralCapReached) { toast.error(`Daily referral cap reached (${referralDailyCap(tier)}/${referralDailyCap(tier)}). ${tier === 'Free' ? 'Upgrade to Pro for 5 per day.' : 'Upgrade to Premium for unlimited.'}`); return; }
    const coins = f.stage === 0 ? UPLINE_REWARD_FIRST_TASK : f.stage === 1 ? UPLINE_REWARD_FIRST_WITHDRAW : REFERRAL_TASK_REWARD;
    const label = f.stage === 0 ? 'watched their first video' : f.stage === 1 ? 'made their first withdrawal' : 'completed a task';
    setFriends(v => v.map(x => x.name === name ? { ...x, stage: Math.min(3, x.stage + 1) as Friend['stage'], tasks: x.tasks + (x.stage === 1 ? 0 : 1), earned: x.earned + coins } : x));
    if (isMilestone) { setReferralCreditsToday(v => v + 1); setReferralVault(v => v + coins); }   // milestones → referral wallet
    else setBalance(v => v + coins);                                                              // commission → main balance
    addEntry({ label: isMilestone ? 'Referral milestone' : 'Referral commission', detail: `${name.split(' ')[0]} ${label}`, coins, kind: 'referral' });
  };
  /** Buys a badge with Tcoins (deducted) or simulated M-Pesa. */
  const buyTier = (t: Tier, method: 'mpesa' | 'coins') => {
    if (tierRank(t) <= tierRank(tier)) return 'You already have this badge.';
    if (method === 'coins') { if (balance < TIERS[t].priceCoins) return `You need ${TIERS[t].priceCoins.toLocaleString()} Tcoins.`; setBalance(v => v - TIERS[t].priceCoins); addEntry({ label: `${t} badge`, detail: 'Paid with Tcoins', coins: -TIERS[t].priceCoins, kind: 'badge' }); }
    else addEntry({ label: `${t} badge`, detail: `KSH ${TIERS[t].priceKsh} · M-Pesa (simulated)`, coins: 0, kind: 'badge' });
    setBoughtTier(t); return null;
  };
  /** 00:00 UTC rollover: unfinished tasks are pulled, nothing carries over. */
  const rollDay = () => { dayRef.current = new Date().toISOString().slice(0, 10); completedRef.current.clear(); claimRef.current = false; setBatch(createDailyBatch(tier)); setBatchVersion(v => v + 1); setCampaigns(v => igLast([...v].sort(() => Math.random() - 0.5))); setDone([]); setPassed(0); setClaimed(false); setReferralCreditsToday(0); setReferralToday(0); if (authed) void assignTasks(); };
  useEffect(() => { const check = () => { if (dayRef.current && dayRef.current !== new Date().toISOString().slice(0, 10)) rollDay(); }; const timer = setInterval(check, 1000); window.addEventListener('focus', check); return () => { clearInterval(timer); window.removeEventListener('focus', check); }; }, [tier]);
  return { balance, profile, setProfile, tier, boughtTier, lifetimeTasks, buyTier, campaigns, done, entries, completeTask, claimDaily, pendingReward, claimed, passed, withdraw, withdrawable, minWithdrawal, hasWithdrawn, quotaDone, referralToday, addCampaign, onboarded, setOnboarded, welcomeClaimed, claimWelcome, claimingWelcome, coinSplash, streak, friends, advanceReferral, referralCreditsToday, referralCapReached, rollDay, dailyLimit, dailyReward: batch.reward, batchVersion, authed, hydrated, assignTasks, payoutsDone, weekEarned, claimTick, referralVault, transferReferral };
}
type StoreValue = ReturnType<typeof useStore>;
/** Kept on globalThis so hot reloads reuse one context instead of splitting provider and consumers. */
const g = globalThis as typeof globalThis & { __tcoinsStore?: Context<StoreValue | null> };
const Store = g.__tcoinsStore ?? (g.__tcoinsStore = createContext<StoreValue | null>(null));
export function TcoinsProvider({ children }: { children: ReactNode }) { const store = useStore(); return <Store.Provider value={store}>{children}</Store.Provider>; }
export function useTcoins() { const store = useContext(Store); if (!store) throw new Error('TcoinsProvider is required'); return store; }