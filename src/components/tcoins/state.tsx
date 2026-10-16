import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import one from '@/assets/task-1.jpg';
import two from '@/assets/task-2.jpg';
import three from '@/assets/task-3.jpg';
import { campaignSlots, REFERRAL_REWARD, TASK_REWARD } from '@/lib/rewards';

export type Platform = 'YouTube' | 'TikTok' | 'Instagram';
export type Campaign = { id: string; title: string; creator: string; platform: Platform; thumbnail: string; url: string; budget: number; payout: number; completed: number; slots: number; duration: string; accessCode: string; instruction: string };
export type Entry = { id: string; label: string; detail: string; coins: number; kind: 'task' | 'withdrawal' | 'referral'; time: string };
export type Profile = { name: string; phone: string; youtube: string[]; tiktok: string[]; instagram: string[] };
const initialCampaigns: Campaign[] = [
  { id: '1', title: 'The habits that changed my life', creator: 'The Growth Diaries', platform: 'YouTube', thumbnail: one, url: 'https://www.youtube.com/results?search_query=kenya+growth+diaries', budget: 1000, payout: 2, completed: 382, slots: 500, duration: '8:24', accessCode: 'GROW24', instruction: 'Like the video and leave a comment of 3+ words.' },
  { id: '2', title: 'Nairobi after hours: a different view', creator: 'Explore with Kevin', platform: 'YouTube', thumbnail: two, url: 'https://www.youtube.com/results?search_query=nairobi+after+hours', budget: 1000, payout: 2, completed: 246, slots: 500, duration: '12:06', accessCode: 'NBO7', instruction: 'Comment 3+ words about your favourite scene.' },
  { id: '3', title: 'A little rhythm. A lot of Nairobi.', creator: 'Nia Moves', platform: 'TikTok', thumbnail: three, url: 'https://vm.tiktok.com/ZSg8tPbNv/', budget: 1000, payout: 2, completed: 418, slots: 500, duration: '0:58', accessCode: 'NIA58', instruction: 'Comment 3+ words. The access code is in the creator’s comment.' },
];
const extraTitles = ['Small steps, bigger dreams', 'A weekend in the city', 'Behind the moves', 'Five minutes of inspiration', 'The Nairobi you haven’t seen'];
extraTitles.forEach((title, index) => { const source = initialCampaigns[index % 3]; if (source) initialCampaigns.push({ ...source, id: String(index + 4), title, completed: 100 + index * 37 }); });
const initialEntries: Entry[] = [
  { id: 'e1', label: 'Video task completed', detail: 'The Growth Diaries', coins: 20, kind: 'task', time: 'Today, 10:42 AM' },
  { id: 'e2', label: 'Referral reward', detail: 'Brian completed a task', coins: REFERRAL_REWARD, kind: 'referral', time: 'Today, 9:18 AM' },
  { id: 'e3', label: 'M-Pesa withdrawal', detail: 'TC9KP4M2 · Completed', coins: -100, kind: 'withdrawal', time: 'Yesterday, 4:30 PM' },
];
function useStore() {
  const [balance, setBalance] = useState(240);
  const [profile, setProfile] = useState<Profile>({ name: 'Alex Mwangi', phone: '0712345678', youtube: ['@alexmwangi'], tiktok: ['@alexmwangi'], instagram: ['@alexmwangi'] });
  const [tier, setTier] = useState<'Free' | 'Pro'>('Free');
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  useEffect(() => { setCampaigns(v => { const first = v.slice(0, 3).sort(() => Math.random() - 0.5); return [...first, ...v.slice(3)]; }); }, []);
  const [done, setDone] = useState<string[]>([]);
  const [entries, setEntries] = useState(initialEntries);
  const [onboarded, setOnboarded] = useState(false);
  const [referralTasks, setReferralTasks] = useState(38);
  const addEntry = (entry: Omit<Entry, 'id' | 'time'>) => setEntries(v => [{ ...entry, id: crypto.randomUUID(), time: 'Just now' }, ...v]);
  const [passed, setPassed] = useState(0);
  const [claimed, setClaimed] = useState(false);
  /** Records a reviewed task. Tcoins are only paid out once the daily quota is 100% done. */
  const completeTask = (id: string, ok: boolean, handle: string) => {
    const campaign = campaigns.find(c => c.id === id);
    if (!campaign || done.includes(id) || campaign.completed >= campaign.slots || done.length >= (tier === 'Free' ? 3 : 8)) return false;
    setDone(v => [...v, id]);
    if (ok) { setPassed(v => v + 1); setCampaigns(v => v.map(c => c.id === id ? { ...c, completed: Math.min(c.slots, c.completed + 1) } : c)); }
    addEntry({ label: ok ? 'Video task verified' : 'Video task not granted', detail: `${campaign.creator} · @${handle.replace(/^@/, '')}`, coins: 0, kind: 'task' });
    return true;
  };
  /** Varied payout (e.g. 56–60 for three tasks) so rewards don't feel automated. */
  const [claimAmount] = useState(() => Math.floor(Math.random() * 5));
  const pendingReward = passed > 0 ? passed * TASK_REWARD - claimAmount : 0;
  const claimDaily = () => { if (claimed || done.length < (tier === 'Free' ? 3 : 8) || pendingReward <= 0) return 0; setClaimed(true); setBalance(v => v + pendingReward); addEntry({ label: 'Daily tasks reward', detail: `${passed} verified tasks`, coins: pendingReward, kind: 'task' }); return pendingReward; };
  const withdraw = (coins: number, method: string, receipt: string) => { setBalance(v => v - coins); addEntry({ label: `${method} withdrawal`, detail: `${receipt} · Completed`, coins: -coins, kind: 'withdrawal' }); };
  const addCampaign = (data: { title: string; url: string; platform: Platform; thumbnail: string; budget: number; payout: number; accessCode: string; instruction: string }) => setCampaigns(v => [...v, { ...data, thumbnail: data.thumbnail || one, id: crypto.randomUUID(), creator: profile.name, completed: 0, slots: campaignSlots(data.budget, data.payout), duration: 'New' }]);
  const simulateReferral = () => { setReferralTasks(v => v + 1); setBalance(v => v + REFERRAL_REWARD); addEntry({ label: 'Referral reward', detail: 'Brian completed a task', coins: REFERRAL_REWARD, kind: 'referral' }); };
  return { balance, profile, setProfile, tier, setTier, campaigns, done, entries, completeTask, claimDaily, pendingReward, claimed, passed, withdraw, addCampaign, onboarded, setOnboarded, referralTasks, simulateReferral, dailyLimit: tier === 'Free' ? 3 : 8, reward: TASK_REWARD, referralReward: REFERRAL_REWARD };
}
const Store = createContext<ReturnType<typeof useStore> | null>(null);
export function TcoinsProvider({ children }: { children: ReactNode }) { const store = useStore(); return <Store.Provider value={store}>{children}</Store.Provider>; }
export function useTcoins() { const store = useContext(Store); if (!store) throw new Error('TcoinsProvider is required'); return store; }