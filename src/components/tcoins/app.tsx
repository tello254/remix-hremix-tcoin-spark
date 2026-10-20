import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, Coins, Copy, Crown, Flame, Gift, LayoutGrid, Loader2, Lock, LogOut, Megaphone, Play, Plus, Settings, ShieldCheck, Sparkles, Target, TrendingUp, Users, Wallet, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTcoins, type Campaign, type Platform } from './state';
import { FREE_DAILY_REFERRAL_CAP, nextUtcReset, REFERRAL_TASK_REWARD, TIERS, tierRank, UPLINE_REWARD_FIRST_TASK, UPLINE_REWARD_FIRST_WITHDRAW, validateCashout, WELCOME_BONUS, type Tier } from '@/lib/rewards';
import { CampaignForm, ProfileForm, TaskDialog } from './verify';
import { createCampaign, listCampaigns, rowToCampaign, updateCampaign, type CampaignRow } from '@/lib/creator.functions';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { InteractiveWalletCoins } from './wallet-coins';
import tcoinsArtwork from '@/assets/tcoins.png';

type Modal = 'cashout' | 'profile' | 'pro' | 'campaign' | 'notifications' | 'help' | null;
const nav = [{ to: '/', label: 'Daily tasks', icon: LayoutGrid }, { to: '/wallet', label: 'My wallet', icon: Wallet }, { to: '/referrals', label: 'Referrals', icon: Users }, { to: '/creator', label: 'Creator studio', icon: Megaphone }, { to: '/account', label: 'Account settings', icon: Settings }] as const;
export function TcoinsShell({ children }: { children: ReactNode }) {
  const s = useTcoins();
  const path = useRouterState({ select: state => state.location.pathname });
  const [modal, setModal] = useState<Modal>(null);
  const [flash, setFlash] = useState(false);   // balance-pill splash when welcome coins are claimed
  useEffect(() => {
    if (!s.coinSplash) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(t);
  }, [s.coinSplash]);
  const title = nav.find(n => n.to === path)?.label || 'Daily tasks';
  return <div className="app-shell">
    <aside className="sidebar"><Link to="/" className="brand"><span className="brand-mark">T</span>Tcoins<span className="brand-dot">.</span></Link><nav>{nav.map(n => <Button key={n.to} asChild variant="ghost" className={`nav-item ${path === n.to ? 'nav-active' : ''}`}><Link to={n.to}><n.icon />{n.label}{n.to === '/' && <span className="nav-count">{Math.max(0, s.dailyLimit - s.done.length)}</span>}{n.to === '/referrals' && <span className="new-tag">NEW</span>}</Link></Button>)}</nav>
      <div className="sidebar-pro"><Crown className="text-gold"/><h3>A little more hustle.<br/>A lot more rewards.</h3><p>Unlock higher daily rewards<br/>with Tcoins Pro.</p><Button onClick={() => setModal('pro')} variant="secondary">Explore Pro <ArrowUpRight /></Button></div>
      <div className="sidebar-bottom"><Button variant="ghost" onClick={() => setModal('help')}><CircleHelp /> Help & support <ArrowUpRight /></Button><div className="system-status"><span/> All systems operational</div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><strong>{title}</strong></div><div className="topbar-actions"><span className="preview-label"><span/> PREVIEW MODE</span><Button variant="ghost" size="icon" aria-label="Notifications" onClick={() => setModal('notifications')}><Bell size={18}/><i className="notification-dot"/></Button><Link id="balance-pill" to="/wallet" className={`header-balance${flash ? ' balance-flash' : ''}`} aria-label="Wallet balance"><SpinCoin small/><span><strong>{s.balance.toLocaleString()}</strong> <small>Tcoins</small></span></Link><span className="topbar-divider"/><Button variant="ghost" className="profile-button" onClick={() => setModal('profile')}><span className="avatar">{s.profile.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><span>{s.profile.name.split(' ')[0]} <small>{s.tier} account</small></span><ChevronDown/></Button></div></header>
      <main className="page-content">{children}<footer className="page-footer"><span>Made for your everyday hustle.</span><span><ShieldCheck size={13}/> Secure. Transparent. Always yours.</span><span>© 2026 Tcoins</span></footer></main>
    </div><div className="mobile-nav">{nav.slice(0,4).map(n => <Button asChild variant="ghost" key={n.to} className={path === n.to ? 'text-primary' : ''}><Link to={n.to}><n.icon/><span>{n.label.split(' ')[0]}</span></Link></Button>)}</div>
    <AppModal modal={modal} close={() => setModal(null)}/>
  </div>;
}

function PageHeading({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{children}</div>; }
function SpinCoin({ small = false }: { small?: boolean }) {
  const edgeLayers = [-2.2, -1.8, -1.4, -1.0, -0.6, -0.2, 0.2, 0.6, 1.0, 1.4, 1.8, 2.2];
  return (
    <span className={`spin-coin ${small ? 'spin-coin-sm' : ''}`} aria-hidden>
      <span className="spin-shadow" />
      <span className="spin-body">
        <span className="spin-face spin-front">
          <span className="coin-rim" />
          <span className="coin-inner-ring" />
          <span className="coin-symbol">T</span>
          <span className="coin-glare" />
        </span>
        <span className="spin-edge-wrap">
          {edgeLayers.map((z, idx) => (
            <span
              key={idx}
              className="spin-edge-slice"
              style={{ transform: `translateZ(${z}px)` }}
            />
          ))}
        </span>
        <span className="spin-face spin-back">
          <span className="coin-rim" />
          <span className="coin-inner-ring" />
          <span className="coin-symbol coin-back-symbol">✦</span>
          <span className="coin-glare" />
        </span>
      </span>
    </span>
  );
}
function Coin({ small = false }: { small?: boolean }) { return <span className={small ? 'mini-coin' : 'inline-coin'}>T</span>; }
/** Actively burning fire for the streak badge — layered CSS flame; dim grey ember when the streak is dead. */
function LiveFlame({ lit = true }: { lit?: boolean }) {
  return <span className={`live-flame${lit ? '' : ' unlit'}`} aria-hidden>
    <span className="fl-glow" /><span className="fl-outer" /><span className="fl-mid" />
    <span className="fl-core" /><span className="fl-spark fl-spark-a" /><span className="fl-spark fl-spark-b" />
  </span>;
}
function PlatformMark({ platform }: { platform: Platform }) { return <span className={`platform-mark platform-${platform.toLowerCase()}`}>{platform === 'YouTube' ? <Play size={12} fill="currentColor"/> : platform === 'TikTok' ? '♪' : '◎'}</span>; }
function CashoutButton({ className = '', cashoutReady = false, minTcoins = 300 }: { className?: string; cashoutReady?: boolean; minTcoins?: number }) {
  const [open, setOpen] = useState(false);
  const label = cashoutReady ? 'Instant cashout' : `Cashout at ${minTcoins}+ Tcoins`;
  return <><Button className={`${className} ${cashoutReady ? 'cashout-ready' : ''}`} disabled={!cashoutReady} onClick={() => setOpen(true)}><ArrowUpRight/> {label}</Button><AppModal modal={open ? 'cashout' : null} close={() => setOpen(false)}/></>;
}

/** Coins physically fly from the neon claim button to the top-right balance pill when a batch claim pays. */
function CoinFly({ tick }: { tick: number }) {
  const [coins, setCoins] = useState<{ id: number; x: number; y: number; dx: number; dy: number; delay: number }[]>([]);
  useEffect(() => {
    if (!tick) return;
    const from = document.getElementById('claim-daily-btn')?.getBoundingClientRect();
    const to = document.getElementById('balance-pill')?.getBoundingClientRect();
    if (!from || !to) return;
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    const tx = to.left + to.width / 2, ty = to.top + to.height / 2;
    setCoins(Array.from({ length: 7 }, (_, i) => ({ id: tick * 10 + i, x: fx + (Math.random() * 56 - 28), y: fy + (Math.random() * 14 - 7), dx: tx - fx, dy: ty - fy, delay: i * 75 })));
    const t = setTimeout(() => setCoins([]), 1700);
    return () => clearTimeout(t);
  }, [tick]);
  if (!coins.length) return null;
  return <div className="coin-fly" aria-hidden>{coins.map(c => <i key={c.id} style={{ left: c.x, top: c.y, '--dx': `${c.dx}px`, '--dy': `${c.dy}px`, animationDelay: `${c.delay}ms` } as CSSProperties}>T</i>)}</div>;
}

export function DailyTasks() {
  const s = useTcoins(); const [filter, setFilter] = useState('All tasks'); const [active, setActive] = useState<Campaign | null>(null); const [pro, setPro] = useState(false);
  const [burst, setBurst] = useState(false);   // one-shot neon ring burst when the batch claim actually pays
  useEffect(() => { setActive(null); }, [s.batchVersion]);
  useEffect(() => {
    if (!s.claimTick) return;
    setBurst(true);
    const t = setTimeout(() => setBurst(false), 1700);
    return () => clearTimeout(t);
  }, [s.claimTick]);
  // Linked-platform eligibility (except preview): no TikTok handle → TikTok tasks never appear; same for Instagram.
  const pool = s.campaigns.filter(c => !s.authed || (s.profile[c.platform.toLowerCase() as 'youtube' | 'tiktok' | 'instagram'] ?? []).length > 0);
  const tasks = pool.filter(c => c.completed < c.slots && !s.done.includes(c.id) && (filter === 'All tasks' || c.platform === filter)).slice(0, s.dailyLimit);
  return <><CoinFly tick={s.claimTick}/><PageHeading eyebrow="LET’S MAKE TODAY COUNT" title={`Hey ${s.profile.name.split(' ')[0]}, ready to earn?`} subtitle="A few videos. A little engagement. Real rewards."><span className="day-streak"><LiveFlame lit={s.streak > 0}/> {s.streak > 0 ? `${s.streak}-day streak` : 'Start your streak today'}</span></PageHeading>
    {!s.welcomeClaimed && <section className="welcome-banner"><Gift/><div><strong>You got {WELCOME_BONUS} Tcoins to start.</strong><p>{s.done.length}/{s.dailyLimit} videos completed towards today’s batch. Finish all {s.dailyLimit} to unlock {s.dailyReward} Tcoins — with your welcome coins that’s {WELCOME_BONUS + s.dailyReward} Tcoins, and your first KSh 10 cashout.</p><progress value={s.done.length} max={s.dailyLimit}/></div><Button variant="ghost" className="claim-btn" disabled={s.claimingWelcome} onClick={() => s.claimWelcome()}>{s.claimingWelcome ? <Loader2 className="spin" size={15}/> : <>Claim <Gift size={14}/></>}</Button></section>}
    <div className="overview-grid overview-two"><section className="daily-goal"><div className="panel-top"><span className="panel-label">TODAY’S GOAL</span><Target size={17}/></div><div className={`goal-ring ${burst ? 'goal-celebrate' : ''} ${s.quotaDone && !s.claimed ? 'goal-charged' : ''}`} style={{ background: `conic-gradient(var(--primary) ${s.claimed ? 0 : Math.round(360 * Math.min(s.done.length, s.dailyLimit) / Math.max(s.dailyLimit, 1))}deg, var(--muted) 0deg)` }}><div><strong>{s.claimed ? 0 : s.done.length}<span>/{s.claimed ? 0 : s.dailyLimit}</span></strong><small>{s.claimed ? 'goal complete' : 'tasks completed'}</small></div></div><div className="goal-bottom"><span>Daily reward <strong className="text-gold">{s.dailyReward} Tcoins</strong></span><ResetCountdown/></div>{s.quotaDone && !s.claimed && s.pendingReward > 0 && <Button id="claim-daily-btn" className="neon-claim" onClick={() => s.claimDaily()}>Claim daily reward {s.dailyReward} Tcoins</Button>}</section>
      <section className="week-panel"><div className="panel-top"><span className="panel-label">THIS WEEK</span><TrendingUp size={17}/></div><div className="week-number">{s.weekEarned}<Coin small/></div><div className="week-growth"><TrendingUp size={12}/> 24% <span>vs. last week</span></div><div className="mini-chart">{[24,40,31,62,48,80,57].map((height,i) => <div key={i} className={`bar bar-${height}`}><span>{['M','T','W','T','F','S','S'][i]}</span></div>)}</div></section></div>
    <section className="task-section"><div className="section-title"><div><h2>Today’s tasks <span className="count-chip">{Math.max(0, s.dailyLimit - s.done.length)} available</span></h2><p>Complete every assigned video to unlock today’s reward.</p></div><div className="daily-refresh"><Clock3 size={14}/> Tasks unfinished at 00:00 UTC are pulled · Nothing carries over · Fresh set daily</div></div><div className="task-toolbar"><div className="filter-tabs">{['All tasks','YouTube','TikTok'].map(f => <Button key={f} variant="ghost" className={filter === f ? 'filter-active' : ''} onClick={() => setFilter(f)}>{f !== 'All tasks' && <PlatformMark platform={f as Platform}/>} {f}</Button>)}</div><span className="reward-hint"><ShieldCheck size={14}/> Verified engagement. Guaranteed rewards.</span></div>
      <div className="task-grid">{tasks.map((c,i) => <article className="task-card" key={c.id}><div className="task-thumb"><img src={c.thumbnail} alt={c.title} width={512} height={768} loading="lazy"/><span className="platform-chip"><PlatformMark platform={c.platform}/>{c.platform}</span><span className="duration">{c.duration}</span><div className="thumbnail-play"><Play size={20} fill="currentColor"/></div>{i === 2 && <span className="hot-tag"><Flame size={11}/> Filling fast</span>}</div><div className="task-body"><div className="creator-line"><span className={`creator-avatar creator-${i % 3}`}>{c.creator[0]}</span>{c.creator}<CheckCheck size={12}/></div><h3>{c.title}</h3><div className="task-reward"><div><Coin small/><strong>Daily batch</strong><span>Reward after all tasks</span></div><span><Clock3 size={12}/> 45 sec</span></div><div className="slots-line"><span>{c.completed} / {c.slots} completed</span><strong>{c.slots - c.completed} slots left</strong></div><progress value={c.completed} max={c.slots}/><Button className={`start-task ${s.done.includes(c.id) ? 'task-done' : ''}`} disabled={s.done.includes(c.id) || s.done.length >= s.dailyLimit} onClick={() => setActive(c)}>{s.done.includes(c.id) ? <><Check/> Task verified</> : <>Start task <ArrowRight/></>}</Button></div></article>)}</div>{tasks.length === 0 && <div className="empty-state"><CheckCheck/><h3>{pool.length < s.campaigns.length ? 'No tasks for your linked accounts here.' : 'You’re all caught up.'}</h3><p>{pool.length < s.campaigns.length ? 'Link another platform in your profile to unlock those tasks.' : 'Fresh tasks arrive tomorrow.'}</p></div>}</section>
    {s.tier === 'Free' && <section className="journey-counter"><Crown/><div><strong>Your journey to Pro <span className="journey-count">{Math.min(s.payoutsDone, 16)}/16 payouts</span></strong><progress value={Math.min(s.payoutsDone, 16)} max={16}/></div></section>}
    <section className="pro-banner"><div className="pro-banner-icon"><Crown/></div><div><div className="pro-banner-title">Direct Entry to Pro Badge <span className="pro-tag">TCOINS PRO</span></div><p>Double daily rewards. More tasks. Bigger referrals.</p></div><Button variant="secondary" onClick={() => setPro(true)}>Purchase badge <ArrowUpRight/></Button></section>
    <TaskDialog key={s.batchVersion} task={active} close={() => setActive(null)}/><AppModal modal={pro ? 'pro' : null} close={() => setPro(false)}/>
  </>;
}

const TAGS = { task: 'Task', referral: 'Referral', bonus: 'Welcome bonus', badge: 'Badge', withdrawal: 'M-Pesa withdrawal' } as const;
function ResetCountdown() { const [now,setNow] = useState<Date | null>(null); useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []); if (!now) return <span className="muted">Resets 00:00 UTC</span>; const ms = nextUtcReset(now).getTime() - now.getTime(); const h = Math.floor(ms/3.6e6), m = Math.floor(ms/6e4)%60, sec = Math.floor(ms/1000)%60; return <span className="muted">Resets 00:00 UTC in {h}h {String(m).padStart(2,'0')}m {String(sec).padStart(2,'0')}s</span>; }
function ActivityList({ limit }: { limit?: number }) { const s = useTcoins(); return <div className="activity-list">{s.entries.slice(0,limit).map(e => <div className="activity-row" key={e.id}><span className={`activity-icon activity-${e.kind}`}>{e.kind === 'task' ? <Check/> : e.kind === 'referral' ? <Users/> : e.kind === 'bonus' ? <Gift/> : e.kind === 'badge' ? <Crown/> : <ArrowUpRight/>}</span><div className="activity-text"><strong>{e.label} <span className="source-tag">{TAGS[e.kind]}</span></strong><span>{e.detail}</span></div><div className="activity-amount"><strong className={e.coins > 0 ? 'text-primary' : ''}>{e.coins > 0 ? '+' : ''}{e.coins} <Coin small/></strong><small>{e.time}</small></div></div>)}</div>; }


export function WalletPage() { const s = useTcoins(); const cashoutReady = s.withdrawable >= s.minWithdrawal; const out = -s.entries.filter(e => e.kind === 'withdrawal').reduce((a,e) => a + e.coins, 0); return <><PageHeading eyebrow="YOUR HUSTLE, IN NUMBERS" title="My wallet" subtitle="Your balance and every Tcoin in and out."/><div className="wallet-overview"><section className="wallet-total"><InteractiveWalletCoins/><span className="panel-label">AVAILABLE BALANCE</span><div className="balance-number">{s.balance} <span>Tcoins</span></div><p className="text-gold">KSH {(s.balance / 10).toFixed(2)}</p><CashoutButton cashoutReady={cashoutReady} minTcoins={s.minWithdrawal}/><small>Withdrawable now: {s.withdrawable} Tcoins</small></section><section className="wallet-summary referral-wallet-card"><Users/><h3>{s.referralVault} Tcoins</h3><p>Referral wallet — kept separate from your cashable earnings.</p><Button variant="secondary" size="sm" disabled={!s.authed || !s.quotaDone || s.referralVault <= 0} onClick={() => s.transferReferral()}>Transfer to main wallet <ArrowRight size={13}/></Button><small>{s.referralVault > 0 ? 'Auto-transfers to your available balance 24 hours after they’re earned.' : s.authed ? 'Referral coins land here. Finish today’s tasks to activate the transfer.' : 'You earn referral Tcoins when friends join through your code.'}</small></section><section className="wallet-summary"><ArrowDownToLine/><h3>{out} Tcoins</h3><p>Previously cashed out</p></section></div><section className="pro-banner"><Gift className="text-gold"/><div><h3>{s.claimed ? 'Daily reward collected' : 'Today’s daily reward'}</h3><p>{s.claimed ? `${s.dailyReward} Tcoins added to your wallet.` : s.quotaDone ? `${s.pendingReward} Tcoins ready to collect.` : `Complete every assigned video to unlock ${s.dailyReward} Tcoins.`}</p></div><Button disabled={!s.quotaDone || s.claimed || s.pendingReward <= 0} onClick={() => s.claimDaily()}>{s.claimed ? <><Check/> Collected</> : <>Collect daily reward <ArrowRight/></>}</Button></section><div className="section-title"><h2>Activity & transaction history</h2><span className="preview-label">{s.authed ? 'WALLET LEDGER' : 'SIMULATED TRANSACTIONS'}</span></div><ActivityList/></>; }
const STAGES = ['Registered', 'First video reviewed', 'First cashout done', 'Daily active'];
export function ReferralsPage() { const s = useTcoins(); const [copied,setCopied] = useState(false); const [link,setLink] = useState(''); useEffect(() => setLink(`${window.location.origin}/?ref=TC-DEMO24`),[]); const total = s.friends.reduce((a,f) => a + f.earned, 0); return <><PageHeading eyebrow="GOOD ENERGY TRAVELS" title="Bring your people." subtitle="You earn when your friends take real action — not when they just sign up."/><section className="rules-banner"><h2>How referral rewards work</h2><ol><li><strong>{UPLINE_REWARD_FIRST_TASK} + {UPLINE_REWARD_FIRST_WITHDRAW} Tcoins per friend.</strong> {UPLINE_REWARD_FIRST_TASK} when they review their first video, {UPLINE_REWARD_FIRST_WITHDRAW} when they make their first withdrawal.</li><li><strong>{REFERRAL_TASK_REWARD} Tcoins per task after that.</strong> Every task they complete keeps paying you.</li><li><strong>Direct referrals only.</strong> One level — no multi-tier network.</li><li><strong>Earn your own keep.</strong> Referral Tcoins can be cashed out only after you finish your own daily tasks that day.</li></ol><p className="muted">{s.tier === 'Free' ? `${s.referralCreditsToday}/2 referral milestones credited today. Upgrade to Pro for 5 per day.` : s.tier === 'Pro' ? `${s.referralCreditsToday}/5 referral milestones credited today. Premium goes unlimited.` : 'Unlimited referral milestones on your badge.'}</p></section><div className="referral-stats"><section><Users/><strong>{s.friends.length}</strong><span>Direct referrals</span></section><section><Coins/><strong>{total}</strong><span>Tcoins earned</span></section><section><TrendingUp/><strong>KSH {(total / 10).toFixed(2)}</strong><span>Referral earnings</span></section></div><section className="invite-band"><Gift size={40}/><div><h2>Your link. Their first step.</h2><p>They start with {WELCOME_BONUS} Tcoins. You earn once they act.</p><div className="copy-field"><input aria-label="Your referral link" readOnly value={link}/><Button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check/> : <Copy/>}{copied ? 'Copied' : 'Copy link'}</Button></div></div></section><div className="section-title"><h2>Your people</h2></div>{s.authed && !s.friends.length ? <div className="empty-state"><Users/><h3>No referrals yet.</h3><p>Share your invite link — the moment a friend signs up and reviews videos, their milestones land in your referral wallet, stored for real.</p><Button size="sm" variant="outline" onClick={() => s.advanceReferral('')}><Zap/> Simulate a referral — saved to your ledger</Button></div> : <div className="data-table"><div className="table-row table-header"><span>FRIEND</span><span>STAGE</span><span>YOUR REWARD</span><span>{s.authed ? 'SIMULATE' : 'PREVIEW'}</span></div>{s.friends.map(f => <div className="table-row" key={f.name || f.id}><strong>{f.name}</strong><span className={f.stage ? 'text-primary' : 'muted'}>{STAGES[f.stage]}</span><span className="text-gold">{f.earned} Tcoins</span><Button size="sm" variant="outline" onClick={() => s.advanceReferral(f.name)}><Zap/> {f.stage === 0 ? 'Simulate first video' : f.stage === 1 ? 'Simulate first cashout' : 'Simulate task'}</Button></div>)}</div>}</>; }
/** Studio gate — the code is asked EVERY time you enter (no persistence; moving between pages re-prompts). */
export function CreatorPage() {
  const [ok, setOk] = useState(false);
  const [code, setCode] = useState(() => typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('tc_studio_code') ?? '' : '');
  const [error, setError] = useState('');
  const unlock = () => {
    if (!/^\d{4}$/.test(code)) return setError('Enter the 4-digit studio code.');
    if (code !== STUDIO_CODE) { setCode(''); return setError('Wrong code.'); }
    sessionStorage.setItem('tc_studio_code', code);
    setOk(true);
  };
  if (ok) return <CreatorStudio />;
  return <div className="auth-screen" style={{ minHeight: 'calc(100vh - 78px)' }}>
    <div className="auth-card" style={{ maxWidth: 360, margin: 'auto' }}>
      <div className="auth-brand"><span className="brand-mark">T</span><h1>Creator studio</h1><p>Admin-only space. Enter your studio code.</p></div>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); unlock(); }}>
        <label className="form-label"><Lock size={13} /> Studio code
          <span className="pin-wrap">
            <input value={code} inputMode="numeric" autoComplete="off" maxLength={4} placeholder="" onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </span>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" className="auth-cta">Unlock studio <ArrowRight size={15} /></Button>
      </form>
    </div>
  </div>;
}
const STUDIO_CODE = '2050';

function CreatorStudio() {
  const s = useTcoins(); const listFn = useServerFn(listCampaigns);
  const [open, setOpen] = useState(false); const [tab, setTab] = useState('Campaigns');
  const [rows, setRows] = useState<(CampaignRow & { active: boolean })[]>([]); const [loading, setLoading] = useState(true); const [editRow, setEditRow] = useState<(CampaignRow & { active: boolean }) | null>(null);
  const adminCode = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('tc_studio_code') ?? '' : '';
  const refresh = async () => {
    setLoading(true);
    try { const r = await listFn({ data: { adminCode } }); if (r.ok) setRows(r.rows); else { setRows([]); toast.error(`Couldn't load campaigns (${r.error}).`); } } catch (e) { toast.error(`Couldn't load campaigns: ${String((e as Error)?.message ?? e).slice(0, 80)}`); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (!open) void refresh(); }, [open]); // re-pull the table after every launch
  const campaigns = rows.map(rowToCampaign);
  const act = rows.filter(c => c.active && c.completed < c.slots).length;
  const doneEng = rows.reduce((a, r) => a + r.completed, 0);
  const remaining = rows.reduce((a, r) => a + (Number(r.budget_ksh) - r.completed * Number(r.payout_ksh)), 0);
  return <><PageHeading eyebrow="MAKE YOUR NEXT VIDEO COUNT" title="Creator studio" subtitle="Admin control center — every campaign, every budget, every requirement."><Button onClick={() => setOpen(true)}><Plus/> Launch campaign</Button></PageHeading><div className="referral-stats"><section><Megaphone/><strong>{act}</strong><span>Active campaigns</span></section><section><CheckCheck/><strong>{doneEng.toLocaleString()}</strong><span>Completed engagements</span></section><section><Wallet/><strong>KSH {remaining.toFixed(0)}</strong><span>Remaining campaign budget</span></section></div><div className="filter-tabs studio-tabs">{['Campaigns','Activity ledger','Withdrawals'].map(t => <Button variant="ghost" className={tab === t ? 'filter-active' : ''} key={t} onClick={() => setTab(t)}>{t}</Button>)}</div>{tab === 'Campaigns' ? <div className="campaign-list">{loading ? <p className="muted">Loading the table…</p> : campaigns.map((c, i) => { const row = rows[i]; const status = !row.active ? 'Paused' : c.completed >= c.slots ? 'Completed' : 'Active'; return <article key={c.id} className="campaign-row"><img src={c.thumbnail} alt={c.title}/><div><span className="creator-line"><PlatformMark platform={c.platform}/>{c.platform}</span><h3>{c.title}</h3><p>{c.creator} · code <strong>{c.accessCode}</strong></p><p>KSH {c.payout} / task · KSH {c.budget} budget</p></div><div className="campaign-meter"><span>{c.completed} / {c.slots} slots</span><progress value={c.completed} max={c.slots}/><small>KSH {(c.budget - c.completed * c.payout).toFixed(2)} remaining</small></div><div className="campaign-admin"><span className={status === 'Active' ? 'status-active' : 'status-closed'}>{status}</span><Button size="sm" variant="secondary" onClick={() => setEditRow(rows[i])}><Settings/> Edit</Button></div></article>; })}{!loading && !rows.length && <div className="empty-state"><Megaphone/><h3>No campaigns yet.</h3><p>Launch the first one.</p></div>}</div>
    : tab === 'Activity ledger' ? <ActivityList/> : <div className="activity-list">{s.entries.filter(e => e.kind === 'withdrawal').map(e => <div key={e.id} className="activity-row"><ArrowUpRight/><div className="activity-text"><strong>{e.label}</strong><span>{e.time}</span></div><span className="text-primary">{e.coins} Tcoins</span></div>)}</div>}
  {editRow && <EditCampaignDialog row={editRow} close={() => setEditRow(null)} onSaved={() => void refresh()}/>}
  <AppModal modal={open ? 'campaign' : null} close={() => setOpen(false)}/></>;
}

/** Edit any part of a live campaign — including the access code, requirements, budget, payout, slots, and pool visibility. */
function EditCampaignDialog({ row, close, onSaved }: { row: CampaignRow & { active: boolean }; close: () => void; onSaved: () => void }) {
  const s = useTcoins(); const updFn = useServerFn(updateCampaign);
  const c = rowToCampaign(row);
  const [form, setForm] = useState({ title: c.title, url: c.url, platform: c.platform as Platform, thumbnail: row.thumbnail, budget: String(c.budget), payout: String(c.payout), accessCode: c.accessCode, instruction: c.instruction });
  const [active, setActive] = useState(row.active);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm(w => ({ ...w, [k]: v }));
  const adminCode = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('tc_studio_code') ?? '' : '';
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await updFn({ data: {
        adminCode, id: row.id, title: form.title.trim(), url: form.url.trim(), platform: form.platform, thumbnail: form.thumbnail.trim(),
        budget: Number(form.budget), payout: Number(form.payout), accessCode: form.accessCode.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
        instruction: form.instruction.trim(), active,
      } });
      if (!r.ok) { setError(r.error === 'unauthorized_studio' ? 'Studio code rejected — unlock the studio again.' : `Save failed (${r.error}).`); setBusy(false); return; }
      s.addCampaign(r.campaign); // keeps the user-facing pool in sync locally too
      toast.success('Campaign updated — changes are live.');
      onSaved(); close();
    } catch (err) { setError(`Save failed: ${String((err as Error)?.message ?? err).slice(0, 140)}`); setBusy(false); }
  };
  const slotsNum = Math.max(1, Math.floor(Number(form.budget) / Math.max(0.1, Number(form.payout))) || 1);
  return <Dialog open onOpenChange={o => { if (!o && !busy) close(); }}><DialogContent className="app-dialog">
    <DialogTitle>Edit campaign</DialogTitle>
    <DialogDescription>{active ? 'Live in every user’s task pool' : 'Paused — not shown to users'} · {c.completed}/{c.slots} completed</DialogDescription>
    <form className="auth-form" onSubmit={save}>
      <label className="form-label">Campaign title<input required maxLength={100} value={form.title} onChange={e => set('title', e.target.value)}/></label>
      <div className="form-columns">
        <label className="form-label">Platform<select value={form.platform} onChange={e => set('platform', e.target.value as Platform)}><option>YouTube</option><option>TikTok</option><option>Instagram</option></select></label>
        <label className="form-label">Access code<input required maxLength={20} value={form.accessCode} onChange={e => set('accessCode', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}/></label>
      </div>
      <label className="form-label">Video URL<input required type="url" maxLength={500} value={form.url} onChange={e => set('url', e.target.value)}/></label>
      <label className="form-label">Thumbnail URL<input type="url" maxLength={500} value={form.thumbnail} onChange={e => set('thumbnail', e.target.value)}/></label>
      <div className="form-columns">
        <label className="form-label">Total budget (KSH)<input type="number" required min={1} max={1000000} value={form.budget} onChange={e => set('budget', e.target.value)}/></label>
        <label className="form-label">Payout per task (KSH)<input type="number" required min={0.1} step={0.1} max={10000} value={form.payout} onChange={e => set('payout', e.target.value)}/></label>
      </div>
      <label className="form-label">Completion slots (budget ÷ payout)<div className="slots-stepper"><Button type="button" variant="secondary" size="sm" onClick={() => set('budget', String(Math.max(1, Number(form.payout) * (Math.max(1, slotsNum - 5)))))}>−5</Button><Button type="button" variant="secondary" size="sm" onClick={() => set('budget', String(Math.max(1, Number(form.payout) * (Math.max(1, slotsNum - 1)))))}>−1</Button><input type="number" required min={1} max={500000} value={slotsNum} onChange={e => set('budget', String(Math.max(1, Number(form.payout) * Math.max(1, Math.round(Number(e.target.value) || 1)))))}/><Button type="button" variant="secondary" size="sm" onClick={() => set('budget', String(Math.max(1, Number(form.payout) * (slotsNum + 1))))}>+1</Button><Button type="button" variant="secondary" size="sm" onClick={() => set('budget', String(Math.max(1, Number(form.payout) * (slotsNum + 5))))}>+5</Button></div><small className="muted">{c.completed} already completed — changing slots adjusts the budget ({Number(form.payout)} KSH per task).</small></label>
      <label className="form-label">Instructions for viewers<textarea maxLength={200} value={form.instruction} onChange={e => set('instruction', e.target.value)}/></label>
      <label className="checkbox-label"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}/> Live in the task pool</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? <Loader2 className="spin"/> : <><Check/> Save changes</>}</Button>
    </form>
  </DialogContent></Dialog>;
}
export function AccountPage() { const s = useTcoins(); const [open,setOpen] = useState<Modal>(null); const signOut = async () => { await supabase.auth.signOut(); }; return <><PageHeading eyebrow="ALL ABOUT YOU" title="Your account" subtitle="Keep your profile and social accounts up to date."/><section className="account-band"><span className="avatar large-avatar">{s.profile.name[0]}</span><div><h2>{s.profile.name}</h2><p>{s.profile.phone} · {s.tier} account · {s.lifetimeTasks} lifetime tasks</p><span className="text-primary">{s.onboarded ? 'Profile set up' : 'Demo profile'}</span></div><Button onClick={() => setOpen('profile')}>Set up / edit profile <ArrowRight/></Button></section><h2 className="section-heading">Linked social accounts</h2><div className="social-accounts">{(['YouTube','TikTok','Instagram'] as const).map(platform => <section key={platform}><PlatformMark platform={platform}/><h3>{platform}</h3><p>{s.profile[platform.toLowerCase() as 'youtube' | 'tiktok' | 'instagram']?.[0] || 'Not linked yet'}</p>{(s.profile[platform.toLowerCase() as 'youtube' | 'tiktok' | 'instagram'] ?? []).length ? <span className="text-primary"><Check size={13}/> Ready to earn</span> : <span className="muted">{platform === 'YouTube' ? 'Required for tasks' : 'Extra earnings when linked'}</span>}</section>)}</div><section className="pro-banner"><Crown className="text-gold"/><div><h3>{s.tier === 'Free' ? 'Free today. Pro when you’re ready.' : `You’re on Tcoins ${s.tier}.`}</h3><p>Pro unlocks at 60 lifetime tasks (16 payouts), Premium at 120 — or activate now.</p></div><Button variant="secondary" onClick={() => setOpen('pro')}>See badges <ArrowUpRight/></Button></section><section className="pro-banner"><Settings/><div><h3>Session</h3><p>Log out of Tcoins on this device. Your balance, tasks and referral progress stay on your account.</p></div><Button variant="secondary" onClick={signOut}><LogOut/> Log out <ArrowUpRight/></Button></section><AppModal modal={open} close={() => setOpen(null)}/></>; }

function AppModal({ modal, close }: { modal: Modal; close: () => void }) { return <Dialog open={!!modal} onOpenChange={open => { if (!open) close(); }}><DialogContent className={`app-dialog ${modal === 'cashout' ? 'cashout-drawer' : ''}`}>{modal === 'cashout' ? <CashoutForm close={close}/> : modal === 'profile' ? <ProfileForm close={close}/> : modal === 'campaign' ? <CampaignForm close={close}/> : modal === 'pro' ? <ProPanel close={close}/> : modal === 'notifications' ? <><DialogTitle>You’re in the loop.</DialogTitle><DialogDescription>Your latest updates</DialogDescription><div className="notice"><Gift/><div><h3>Fresh rewards are ready</h3><p>Your daily tasks are waiting. They reset at 00:00 UTC.</p></div></div><div className="notice"><ShieldCheck/><div><h3>This is your Tcoins preview</h3><p>Rewards and transactions are simulated.</p></div></div></> : <><DialogTitle>A little help, a lot of clarity.</DialogTitle><DialogDescription>Tcoins preview support</DialogDescription><h3>How do rewards work?</h3><p>Open a task, wait 45 seconds, and submit a natural comment with your linked handle. This preview simulates verification.</p><h3>Can I receive money now?</h3><p>No. Cashouts produce simulated receipts only. Real payments and social verification are not connected.</p><h3>What’s a Tcoin worth?</h3><p>10 Tcoins = 1 KSH. Your first cashout from 100 Tcoins (KSh 10), then from 300 Tcoins (KSh 30). Payouts go only to your registered Safaricom M-Pesa number.</p></>}</DialogContent></Dialog>; }
function CashoutForm({ close }: { close: () => void }) { const s = useTcoins(); const [method,setMethod] = useState('M-Pesa Cash'); const [network,setNetwork] = useState('Safaricom'); const [amount,setAmount] = useState(String(s.minWithdrawal)); const [phone,setPhone] = useState(s.profile.phone); const [error,setError] = useState(''); const [status,setStatus] = useState('idle'); const [receipt,setReceipt] = useState(''); const lock = useRef(false); const confirm = async () => { if (lock.current) return; const invalid = validateCashout(Number(amount),s.withdrawable,phone,{ min: s.minWithdrawal, accountPhone: s.profile.phone }); if (invalid) return setError(invalid); lock.current = true; setError(''); setStatus('processing'); const code = 'TC' + crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase(); await new Promise(r => setTimeout(r,1600)); s.withdraw(Number(amount),method === 'Airtime' ? `${network} Airtime` : method,code); setReceipt(code); setStatus('success'); }; return <><DialogTitle>{status === 'success' ? 'Your cashout is complete.' : 'A little hustle. Instant cash.'}</DialogTitle><DialogDescription>Simulated cashout · No real money is sent.</DialogDescription>{status === 'success' ? <div className="receipt-state"><span className="success-check"><Check/></span><h2>KSH {(Number(amount) / 10).toFixed(2)}</h2><p>{method} to {phone}</p><div className="receipt-code"><span>TRANSACTION RECEIPT</span><strong>{receipt}</strong><small>Simulated · Completed just now</small></div><Button onClick={close}>Done <Check/></Button></div> : status === 'processing' ? <div className="processing-state"><Loader2 className="spin"/><h2>Processing your cashout…</h2><p>Preparing your simulated receipt.</p></div> : <><div className="cashout-balance"><span>Withdrawable balance</span><strong>{s.withdrawable} Tcoins <small>≈ KSH {(s.withdrawable / 10).toFixed(2)}</small></strong></div><div className="segmented-control">{['M-Pesa Cash','Airtime'].map(m => <Button key={m} variant={method === m ? 'default' : 'ghost'} onClick={() => setMethod(m)}>{m === 'M-Pesa Cash' ? <Wallet/> : <Zap/>}{m}</Button>)}</div>{method === 'Airtime' && <label className="form-label">Network<select value={network} onChange={e => setNetwork(e.target.value)}><option>Safaricom</option><option>Airtel</option></select></label>}<label className="form-label">Amount in Tcoins<div className="amount-input"><input type="number" min={s.minWithdrawal} max={s.withdrawable} step={1} value={amount} onChange={e => setAmount(e.target.value)}/><Button variant="ghost" onClick={() => setAmount(String(s.withdrawable))}>Max</Button></div><small>≈ KSH {(Number(amount || 0) / 10).toFixed(2)} · Minimum {s.minWithdrawal} Tcoins{!s.hasWithdrawn && ' (first withdrawal)'}</small></label><label className="form-label">Confirm your phone number<input value={phone} maxLength={13} onChange={e => setPhone(e.target.value)}/></label>{error && <p role="alert" className="form-error">{error}</p>}<div className="cashout-breakdown"><span>Cashout fee <strong>KSH 0.00</strong></span><span>You receive <strong className="text-gold">KSH {(Number(amount || 0) / 10).toFixed(2)}</strong></span></div><Button onClick={confirm}><Zap/> Withdraw now <ArrowRight/></Button><p className="muted text-center text-xs">100% instant in preview. No real payment is processed.</p></>}</>; }
function ProPanel({ close }: { close: () => void }) { const s = useTcoins(); const [error,setError] = useState(''); const buy = (t: Tier, m: 'mpesa' | 'coins') => { const e = s.buyTier(t, m); if (e) setError(e); else close(); }; return <><DialogTitle>Everything about the Pro badge.</DialogTitle><DialogDescription>What unlocks when you go Pro — purchase below, activation is instant.</DialogDescription><section className="pro-benefits"><Crown/><div><strong>TCOINS PRO</strong><ul><li><strong>120 Tcoins per day</strong> — doubled from 60 (KSh 12 every day)</li><li><strong>6–7 tasks daily</strong> — a bigger, richer daily batch</li><li><strong>5 referral milestone credits per day</strong> — up from 2 on Free</li><li><strong>Weekly potential: over KSh 250</strong> — daily batches plus referral commissions</li><li><strong>First in line</strong> — your tasks fill from the freshest campaigns</li><li><strong>Golden crown on your account</strong> — visible on every page</li></ul></div></section><div className="tier-list">{(['Free','Pro','Premium'] as Tier[]).map(t => { const c = TIERS[t]; const owned = tierRank(t) <= tierRank(s.tier); return <section key={t} className={`tier-card ${s.tier === t ? 'tier-current' : ''}`}><div><h3>{t === 'Free' ? t : <><Crown size={15}/> {t} badge</>}</h3><p>{t === 'Free' ? 'Daily rewards' : `Higher daily rewards · KSH ${c.priceKsh} or ${c.priceCoins.toLocaleString()} Tcoins`}</p>{t !== 'Free' && <><small>Free unlock at {c.unlockTasks} lifetime tasks (any days): {Math.min(s.lifetimeTasks, c.unlockTasks)}/{c.unlockTasks}</small><progress value={Math.min(s.lifetimeTasks, c.unlockTasks)} max={c.unlockTasks}/></>}</div>{owned ? <span className="text-primary"><Check size={14}/> {s.tier === t ? 'Current' : 'Included'}</span> : <div className="tier-actions"><Button size="sm" onClick={() => buy(t,'mpesa')}>M-Pesa KSH {c.priceKsh}</Button><Button size="sm" variant="outline" disabled={s.balance < c.priceCoins} onClick={() => buy(t,'coins')}>{c.priceCoins.toLocaleString()} Tcoins</Button></div>}</section>; })}</div>{error && <p role="alert" className="form-error">{error}</p>}<p className="muted text-xs">Badge changes apply to your next daily batch. M-Pesa payments are simulated.</p></>; }