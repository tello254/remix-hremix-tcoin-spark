import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useServerFn } from '@tanstack/react-start';
import { ArrowRight, ArrowUpRight, Check, Clock3, Gift, Loader2, Megaphone, Play, Search, ShieldCheck, Target, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTcoins, type Campaign, type Platform } from './state';
import { campaignSchema, campaignSlots, profileSchema } from '@/lib/rewards';
import { searchAccounts, verifyTask, videoSeconds } from '@/lib/social.functions';
import { createCampaign } from '@/lib/creator.functions';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import coinImage from '@/assets/tcoins.png';

type Account = { handle: string; name: string; avatar: string; followers?: string };
const at = (h: string) => '@' + h.trim().replace(/^@/, '');
function Mark({ platform }: { platform: Platform }) { return <span className={`platform-mark platform-${platform.toLowerCase()}`}>{platform === 'YouTube' ? <Play size={12} fill="currentColor"/> : platform === 'TikTok' ? '♪' : '◎'}</span>; }

/** Live account search with avatars; lets the user link up to 3 handles. A handle owned by
 *  ANOTHER Tcoins account is refused the moment it is picked — red result, red toast, never added. */
function HandlePicker({ platform, value, onChange, name }: { platform: 'YouTube' | 'TikTok' | 'Instagram'; value: string[]; onChange: (v: string[]) => void; name: string }) {
  const search = useServerFn(searchAccounts);
  const [query, setQuery] = useState(''); const [results, setResults] = useState<(Account & { taken?: boolean })[]>([]); const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false); const [takenFlash, setTakenFlash] = useState(false);
  useEffect(() => {
    const q = query.trim().replace(/^@/, ''); setSearched(false);
    if (q.length < 2) { setResults([]); return; }
    let live = true; setLoading(true);
    const run = async () => {
      try {
        const r = await search({ data: { platform, query: q } });
        let decorated: (Account & { taken?: boolean })[] = r.map(a => ({ ...a }));
        if (r.length) {
          // fn_handle_taken: security-definer pre-check (own handles never block re-adding)
          const { data: { user } } = await supabase.auth.getUser();
          const marks = await Promise.all(r.map(async a => ((await supabase.rpc('fn_handle_taken', { p_platform: platform.toLowerCase(), p_handle: a.handle, p_owner: user?.id ?? null })).data as boolean) === true));
          decorated = r.map((a, i) => ({ ...a, taken: marks[i] }));
        }
        if (live) setResults(decorated);
      } catch { if (live) setResults([]); } finally { if (live) { setLoading(false); setSearched(true); } }
    };
    const t = setTimeout(run, 450);
    return () => { live = false; clearTimeout(t); };
  }, [query, platform]);
  const refuse = () => {
    setTakenFlash(true);
    setTimeout(() => setTakenFlash(false), 2400);
    toast.error(`Dear ${name}, your ${platform} handle is already in use, please use your own handle to avoid task verification hiccups.`, {
      duration: 7000,
      style: {
        background: 'color-mix(in oklab, var(--destructive) 10%, var(--background))',
        border: '1px solid var(--destructive)',
        color: 'var(--destructive)',
      },
    });
  };
  const add = async (a: Account & { taken?: boolean }) => {
    // belt & braces: even if the dropdown metadata missed it, verify owner-wise before accepting
    if (!a.taken) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: takenNow } = await supabase.rpc('fn_handle_taken', { p_platform: platform.toLowerCase(), p_handle: a.handle, p_owner: user?.id ?? null });
      if (takenNow === true) { refuse(); return; }
    }
    if (a.taken) { refuse(); return; }   // never accepted — refused right at the pick
    const handle = at(a.handle);
    if (!value.some(v => v.toLowerCase() === handle.toLowerCase()) && value.length < 3) onChange([...value, handle]);
    setQuery(''); setResults([]);
  };
  const takenInView = results.some(r => r.taken);
  return <div className="form-label handle-picker"><span><Mark platform={platform}/> {platform} accounts <small className="muted">({value.length}/3)</small></span>
    {value.length > 0 && <div className="handle-chips">{value.map(h => <span key={h} className="handle-chip">{h}<button type="button" aria-label={`Remove ${h}`} onClick={() => onChange(value.filter(v => v !== h))}><X size={12}/></button></span>)}</div>}
    {value.length < 3 && <div className={`handle-search ${(takenInView || takenFlash) ? 'dd-flash' : ''}`}><Search size={14}/><input value={query} maxLength={42} placeholder={value.length ? 'Add another account…' : `Search your ${platform} handle, e.g. @yourname`} onChange={e => setQuery(e.target.value)}/>{loading && <Loader2 size={14} className="spin"/>}
      {(results.length > 0 || (searched && query.trim().length >= 2)) && <div className="handle-dropdown">{results.map(a => <button type="button" key={a.handle} className={a.taken ? 'dd-taken' : ''} aria-disabled={a.taken} tabIndex={a.taken ? -1 : 0} onClick={() => { void add(a); }} onPointerDown={e => { if (a.taken) e.preventDefault(); }}>{a.avatar ? <img src={a.avatar} alt="" referrerPolicy="no-referrer"/> : <span className="avatar">{a.name[0]}</span>}<span><strong>{a.name}</strong><small>{at(a.handle)}{a.followers ? ` · ${a.followers}` : ''}</small></span>{a.taken ? <span className="dd-taken-tag">Taken</span> : <Check size={14}/>}</button>)}{!results.length && <p className="muted">No account found. Check the spelling of your handle.</p>}</div>}
    </div>}
  </div>;
}

export function ProfileForm({ close }: { close: () => void }) {
  const s = useTcoins(); const [form, setForm] = useState(s.profile); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  // Saving with a missing TikTok/Instagram costs real money (fewer tasks that day) — warn first.
  const [warn, setWarn] = useState<string[] | null>(null);
  const missingPlatforms = (p: typeof form) => (['TikTok', 'Instagram'] as const).filter(pl => (p[pl.toLowerCase() as 'tiktok' | 'instagram'] ?? []).length === 0);
  // Handles are PERSISTED in the DB (social_handles) against the user — not just this device.
  const persist = async (p: (typeof profileSchema)['_type']) => {
    setBusy(true); setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: curRows } = await supabase.from('social_handles').select('id, platform, handle').eq('user_id', user.id);
        const cur = curRows ?? [];
        const key = (platform: string, h: string) => platform + ':' + h.trim().toLowerCase();
        const wanted = new Set<string>(); const rows: { user_id: string; platform: string; handle: string }[] = [];
        (['youtube', 'tiktok', 'instagram'] as const).forEach(platform => p[platform].forEach(h => { wanted.add(key(platform, h)); rows.push({ user_id: user.id, platform, handle: h.trim() }); }));
        const delIds = cur.filter(r => !wanted.has(key(r.platform, r.handle))).map(r => r.id);
        const adds = rows.filter(r => !cur.some(c => key(c.platform, c.handle) === key(r.platform, r.handle)));
        if (delIds.length) await supabase.from('social_handles').delete().in('id', delIds);
        if (adds.length) {
          // insert one-by-one so a duplicate names its EXACT platform — told in plain language, 4s toast
          for (const a of adds) {
            const { error: oneErr } = await supabase.from('social_handles').insert([a]);
            if (oneErr) {
              setBusy(false);
              if (oneErr.code === '23505' || /unique constraint/i.test(oneErr.message)) {
                const label = a.platform.charAt(0).toUpperCase() + a.platform.slice(1);
                toast.error(`Dear ${p.name}, your ${label} handle is already in use, please use your own handle to avoid task verification hiccups.`, { duration: 7000 });
                return;   // stay on the form so the user can fix the handle
              }
              return setError(`Couldn't link your handles: ${String(oneErr.message).slice(0, 120)}`);
            }
          }
        }
        await supabase.from('profiles').update({ username: p.name.trim() }).eq('id', user.id); // non-critical
      }
      s.setProfile(p); s.setOnboarded(true); close();
    } catch (err) { setBusy(false); return setError(`Couldn't save: ${String((err as Error)?.message ?? err).slice(0, 120)}`); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const missing = missingPlatforms(form);
    const result = profileSchema.safeParse(form);
    if (!result.success) return setError(result.error.issues[0]?.message ?? 'Check your details and try again.');
    if (missing.length > 0 && !warn) { setWarn(missing); return; }   // show the money-you-miss popup first
    setWarn(null);
    persist(result.data);
  };
  const videos = Math.max(1, s.dailyLimit || 5); const reward = s.dailyReward || 75; const per = Math.round(reward / videos);
  const warnReachable = Math.max(0, videos - (warn?.length ?? 0));
  return <><DialogTitle>Make Tcoins yours.</DialogTitle><DialogDescription>Search and select your real accounts so we can find your comments. Saved against your account, not this device.</DialogDescription>
    {warn && <div className="save-warning" role="alertdialog" aria-live="assertive">
      <h3><ShieldCheck size={15}/> You’re leaving money on the table!</h3>
      <p>Tasks exist for YouTube, TikTok and Instagram. Save now and you’ll only receive the {warnReachable} video{warnReachable === 1 ? '' : 's'} your {3 - warn.length} connected platform{warn.length === 2 ? 's are' : ' is'} eligible for — the rest stay out of reach until you link the missing account{warn.length > 1 ? 's' : ''}.</p>
      <div className="warn-money">
        <div><small>FULL QUOTA</small><strong>{videos} videos · {reward} Tcoins</strong></div>
        <div><small>WHAT YOU’D GET INSTEAD</small><strong>{warnReachable} videos · {Math.floor((reward * warnReachable) / videos)} Tcoins</strong></div>
      </div>
      <p>When you reach 100%, the missing task would have carried <strong className="text-gold">{Math.floor((reward * warnReachable) / videos) === reward ? 0 : Math.max(0, reward - Math.floor((reward * warnReachable) / videos))} Tcoins</strong> you now leave behind — but claiming still needs every video you DO receive.</p>
      <div className="warn-actions">
        <Button type="button" variant="outline" size="sm" onClick={() => setWarn(null)}>Connect all first</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => { const result = profileSchema.safeParse(form); if (result.success) persist(result.data); }}>Save anyway — top up later</Button>
      </div>
      <small className="muted">You can connect the remaining accounts any time. It applies from your next daily batch.</small>
    </div>}
    <form className="stack-form" onSubmit={save}>
      <label className="form-label">Your name<input required value={form.name} maxLength={60} onChange={e => setForm(v => ({ ...v, name: e.target.value }))}/></label>
      <label className="form-label">Kenyan phone number <small className="muted">(locked to your account — payouts and identity; cannot be changed here)</small><input required value={form.phone} maxLength={13} readOnly disabled={typeof form.phone === 'string' && form.phone.includes('•')} className={form.phone.includes('•') ? 'muted' : ''} style={{ opacity: .75, cursor: 'not-allowed' }}/></label>
      <HandlePicker platform="YouTube" name={form.name} value={form.youtube} onChange={youtube => setForm(v => ({ ...v, youtube }))}/>
      <HandlePicker platform="TikTok" name={form.name} value={form.tiktok} onChange={tiktok => setForm(v => ({ ...v, tiktok }))}/>
      <HandlePicker platform="Instagram" name={form.name} value={form.instagram} onChange={instagram => setForm(v => ({ ...v, instagram }))}/>
      {error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy ? <Loader2 className="spin"/> : <>Save profile <Check/></>}</Button>
    </form></>;
}

export function CampaignForm({ close }: { close: () => void }) {
  const s = useTcoins(); const createFn = useServerFn(createCampaign); const [form, setForm] = useState({ title: '', url: '', platform: 'YouTube' as Platform, thumbnail: '', budget: 1000, payout: 2, accessCode: '', instruction: 'Like the video and leave a comment of 3+ words.' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));
  return <><DialogTitle>Give your video a head start.</DialogTitle><DialogDescription>Launch a campaign with a hard budget cap and a secret access code.</DialogDescription>
    <form className="stack-form" onSubmit={e => { e.preventDefault(); (async () => {
      const result = campaignSchema.safeParse(form);
      if (!result.success) return setError(result.error.issues[0]?.message ?? 'Check your details and try again.');
      setError(''); setBusy(true);
      if (s.authed) {
        // Real launch: a live row in `campaigns` → enters every signed-in user's task pool.
        const { data: { user } } = await supabase.auth.getUser();
        const r = await createFn({ data: { ...result.data, accessCode: result.data.accessCode.toUpperCase(), creatorName: s.profile.name, creatorId: user?.id, adminCode: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('tc_studio_code') ?? '' : '' } });
        setBusy(false);
        if (r.ok) { s.addCampaign(r.campaign); toast.success('Campaign is live — it’s in the task pool now.'); }
        else { setError(r.error === 'unauthorized_studio' ? 'Studio code rejected — unlock the studio first.' : `Launch failed (${r.error}).`); return; }
      } else {
        s.addCampaign({ ...result.data, accessCode: result.data.accessCode.toUpperCase() });
        toast.success('Campaign launched (preview mode).');
      }
      close();
    })().catch(err => { setBusy(false); setError(`Launch failed: ${String(err?.message ?? err).slice(0, 140) || 'unknown error'}`); }); }}>
      <label className="form-label">Campaign title<input required maxLength={100} value={form.title} onChange={e => set('title', e.target.value)}/></label>
      <label className="form-label">Platform<select value={form.platform} onChange={e => set('platform', e.target.value as Platform)}><option>YouTube</option><option>TikTok</option><option>Instagram</option></select></label>
      <label className="form-label">Video URL<input required type="url" maxLength={500} placeholder="https://www.youtube.com/watch?v=…" value={form.url} onChange={e => set('url', e.target.value)}/></label>
      <label className="form-label">Thumbnail URL (optional)<input type="url" maxLength={500} placeholder="https://…" value={form.thumbnail} onChange={e => set('thumbnail', e.target.value)}/></label>
      <div className="form-columns"><label className="form-label">Total budget (KSH)<input type="number" required min={1} max={1000000} value={form.budget} onChange={e => set('budget', Number(e.target.value))}/></label><label className="form-label">Payout per task (KSH)<input type="number" required min={0.1} step={0.1} max={10000} value={form.payout} onChange={e => set('payout', Number(e.target.value))}/></label></div>
      <label className="form-label">Secret access code<input required maxLength={20} placeholder="e.g. GROW24" value={form.accessCode} onChange={e => set('accessCode', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}/><small className="muted">Say it in the video or put it in your pinned comment. Viewers must enter it to get paid.</small></label>
      <label className="form-label">Instructions for viewers<textarea maxLength={200} placeholder="e.g. The code appears at minute 1:30" value={form.instruction} onChange={e => set('instruction', e.target.value)}/></label>
      <div className="slots-preview"><Target/><div><strong>{campaignSlots(form.budget, form.payout)} completion slots</strong><small>Campaign closes automatically when slots are filled.</small></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}<Button type="submit"><Megaphone/> Launch campaign</Button>
    </form></>;
}

/** Platform-accurate failure text — never names the wrong platform again. */
const reasonText = (reason: string, platform: string) => ({
  code: 'That access code is not right. Check the video or the creator’s pinned comment.',
  'no-comment': `We couldn’t find a public comment from your linked ${platform} account yet. If you just posted it, ${platform} may be holding it for review — a natural sentence with the code inside usually passes. Try again shortly.`,
  short: 'Your comment is too short. Edit it to at least 3 words, then try again.',
  'comments-disabled': `Comments aren’t readable from outside YouTube on this video — comments are turned off, or the video is age-restricted (18+). Turn comments on and remove any 18+ restriction in YouTube Studio, then try again.`,
  unavailable: `We couldn’t read the ${platform} comments on this video right now. Please try again in a moment.`,
}[reason] ?? 'Verification failed.');

export function TaskDialog({ task, close }: { task: Campaign | null; close: () => void }) {
  const s = useTcoins(); const verifyFn = useServerFn(verifyTask); const secsFn = useServerFn(videoSeconds);
  // Viewing gate: click "Open the video" → window stays CLOSED for the exact video length →
  // access code opens for 2 minutes → then the window shuts until the video is opened again.
  const [watchEnd, setWatchEnd] = useState(0); const [readyEnd, setReadyEnd] = useState(0); const [secs, setSecs] = useState<number | null>(null); const [, setTick] = useState(Date.now());
  const [code, setCode] = useState(''); const [liked, setLiked] = useState(false); const [likedWarn, setLikedWarn] = useState(false); const [likedClosing, setLikedClosing] = useState(false);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Brief self-dismissing penalty warning when the like checkbox is ticked — no confirmation buttons.
  const fireWarn = () => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    setLikedWarn(true); setLikedClosing(false);
    warnTimer.current = setTimeout(() => {
      setLikedClosing(true);
      warnTimer.current = setTimeout(() => { setLikedWarn(false); setLikedClosing(false); }, 240);
    }, 1760);
  };
  const [error, setError] = useState(''); const [status, setStatus] = useState<'idle' | 'checking' | 'found' | 'success'>('idle'); const [quote, setQuote] = useState(''); const lock = useRef(false);
  // The commenting handles come from ALL the user's linked accounts on that platform
  // (1–3 of them) — TikTok tasks check every linked TikTok handle, etc. Never typed here.
  const handles = task ? s.profile[task.platform.toLowerCase() as 'youtube' | 'tiktok' | 'instagram'] : [];
  useEffect(() => { setWatchEnd(0); setReadyEnd(0); setSecs(null); setCode(''); setLiked(false); setLikedWarn(false); setLikedClosing(false); setError(''); setStatus('idle'); setQuote(''); lock.current = false; if (warnTimer.current) clearTimeout(warnTimer.current); }, [task?.id]);
  useEffect(() => () => { if (warnTimer.current) clearTimeout(warnTimer.current); }, []);
  useEffect(() => { if (!watchEnd) return; const i = window.setInterval(() => setTick(Date.now()), 500); return () => clearInterval(i); }, [watchEnd]);
  const phase = !watchEnd ? 'idle' : Date.now() < watchEnd ? 'watching' : Date.now() >= readyEnd ? 'expired' : 'ready';
  // Elapsing countdowns: how long until the code opens, then how long the code window stays open.
  const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
  const watchLeft = Math.ceil((watchEnd - Date.now()) / 1000); const readyLeft = Math.ceil((readyEnd - Date.now()) / 1000);
  const openVideo = async () => {
    if (!task || status === 'checking') return;
    // The gate MUST start on click — if the duration lookup fails, fall back to 45s.
    const total = secs ?? await (async () => {
      try {
        const v = await secsFn({ data: { platform: task.platform, url: task.url } });
        return Number.isFinite(v) && v > 0 ? Math.max(10, Math.min(v, 3600)) : 45;
      } catch { return 45; }
    })();
    setSecs(total);
    const end = Date.now() + total * 1000;
    setWatchEnd(end); setReadyEnd(end + 120000); setError('');
  };
  const live = task?.platform === 'YouTube' || task?.platform === 'TikTok';
  // Step 1 — enter the access code, fetch the REAL comment, show it to the user.
  const findComment = async () => {
    if (!task || lock.current) return;
    if (phase === 'idle' || phase === 'watching') return setError('Viewing time not matured — open the video and finish watching first.');
    if (phase === 'expired') return setError('The submission window closed — open the video again to continue.');
    if (!handles.length) return setError(`Link your ${task.platform} account in your profile first.`);
    if (!code.trim()) return setError('Enter the access code from the video.');
    lock.current = true; setError(''); setStatus('checking');
    let found = '';
    if (live) {
      try {
        const r = await verifyFn({ data: { platform: task.platform as 'YouTube' | 'TikTok', url: task.url, handles, code: code.trim(), expectedCode: task.accessCode } });
        if (!r.ok) { setError(reasonText(r.reason, task.platform)); setStatus('idle'); lock.current = false; return; }
        found = r.quote;
      } catch { setError(reasonText('unavailable', task.platform)); setStatus('idle'); lock.current = false; return; }
    } else {
      if (code.trim().toUpperCase() !== task.accessCode.toUpperCase()) { setError(reasonText('code', task.platform)); setStatus('idle'); lock.current = false; return; }
      found = 'Access code confirmed — Instagram comment checks are simulated in this preview.';
    }
    setQuote(found); setStatus('found'); lock.current = false;
  };
  // Step 2 — the reward button is always visible; confirming the like is honor-guarded by the
  // penalty pop. The completion IS the DB ledger (fn_complete_task): quota, campaign counter,
  // lifetime tasks, referrals — so progress actually survives reloads.
  const claim = async () => {
    if (!task || lock.current) return;
    if (status !== 'found') return setError('Verify the access code first — your comment needs to be confirmed before the reward unlocks.');
    lock.current = true; setError('');
    if (s.authed) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: j } = await supabase.rpc('fn_complete_task', { p_user: user.id, p_campaign: task.id, p_platform: task.platform.toLowerCase(), p_handle: handles[0] ?? '', p_comment: quote });
          const r = j as { ok?: boolean; error?: string } | null;
          if (r && r.ok === false) {
            setStatus('idle'); setQuote(''); lock.current = false;
            if (r.error === 'handle_not_linked') return setError('The commenting account is not linked to this profile — add it in your profile, then try again.');
            if (r.error === 'already_completed' || r.error === 'daily_batch_closed') return setError('This task is already completed for today.');
            if (r.error === 'campaign_exhausted') return setError('This campaign just filled its last slot — the pool updates on your next session.');
            return setError('Could not record this task right now — try again.');
          }
        }
      } catch { /* keep local flow so the user is never dead-ended mid-claim */ }
    }
    if (s.completeTask(task.id, true, handles[0] ?? '')) { setStatus('success'); lock.current = false; }
    else { setError('This task is already completed or no longer available.'); setStatus('idle'); setQuote(''); lock.current = false; }
  };
  const doneCount = s.done.length;
  return <Dialog open={!!task} onOpenChange={o => { if (!o && status !== 'checking') close(); }}><DialogContent className="app-dialog">
    <DialogTitle>{status === 'success' ? 'Verified. Nice work!' : status === 'found' ? 'We found your comment.' : 'Watch. Engage. Get rewarded.'}</DialogTitle>
    <DialogDescription>{live ? 'We check the real comments on this video.' : 'Instagram checks are simulated in this preview.'}</DialogDescription>
    {task && (status === 'success' ? <div className="success-state"><img src={coinImage} width={1024} height={1024} alt="Gold Tcoins"/>
      <p className="verified-quote"><ShieldCheck size={14}/> Verified — your comment: <q>{quote}</q></p>
      <h2>{doneCount}/{s.dailyLimit} tasks done today</h2>
      <progress value={doneCount} max={s.dailyLimit}/>
      <p>{doneCount >= s.dailyLimit ? `Daily quota complete — collect your ${s.pendingReward} Tcoins from your wallet.` : `Finish ${s.dailyLimit - doneCount} more to unlock your daily reward.`}</p>
      <Button onClick={close}>Keep the good going <ArrowRight/></Button></div>
    : <><div className="task-dialog-preview"><img src={task.thumbnail} alt={task.title}/><div><Mark platform={task.platform}/><h3>{task.title}</h3><p>{task.creator}</p></div></div>
      <p className="task-instruction"><Clock3 size={14}/> {task.instruction}</p>
      <Button asChild onClick={() => { void openVideo(); }}><a href={task.url} target="_blank" rel="noopener noreferrer">{phase === 'expired' ? 'Open the video again' : watchEnd ? 'Reopen video' : 'Open the video'} <ArrowUpRight/></a></Button>
      <div className="timer-state"><Clock3/><strong>{phase === 'watching' ? mmss(watchLeft) : phase === 'ready' ? mmss(readyLeft) : phase === 'expired' ? 'Closed' : 'Open first'}</strong><span>{phase === 'watching' ? 'elapsing until the access code opens' : phase === 'ready' ? 'elapsing until the access code window closes' : phase === 'expired' ? 'Window closed — open the video again' : 'Opening the video starts the required viewing time'}</span></div>
      {!handles.length && <p className="form-error">No {task.platform} account linked — add one in your profile first.</p>}
      <label className="form-label">Access code<input value={code} maxLength={40} placeholder="Code from the video or pinned comment" disabled={phase !== 'ready' || status === 'found'} onChange={e => setCode(e.target.value.toUpperCase())}/></label>
      <div className="verify-row"><Button variant="secondary" className="verify-btn" size="sm" disabled={phase !== 'ready' || status === 'checking' || status === 'found' || !handles.length} onClick={findComment}>{status === 'checking' ? <><Loader2 className="spin"/> Verifying…</> : status === 'found' ? <><Check/> Verified</> : <><ShieldCheck/> Verify <ArrowRight size={13}/></>}</Button></div>
      {status === 'found' ? <div className="found-comment"><span className="found-label"><ShieldCheck size={13}/> Your comment</span><q>{quote}</q></div>
        : null}
      {status === 'found' ? <label className="checkbox-label"><input type="checkbox" checked={liked} onChange={e => { setLiked(e.target.checked); if (e.target.checked) fireWarn(); }}/> I liked the video</label> : null}
      <div className="prize-banner"><Gift size={15}/> Verified likes enter the weekly <strong>2,500 Tcoins</strong> and monthly <strong>10,000 Tcoins</strong> prize draws.</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button disabled={status !== 'found'} onClick={claim}>{status === 'checking' ? <><Loader2 className="spin"/> Verifying…</> : status === 'found' ? <><Check/> Claim my reward</> : <><Target/> Claim my reward</>}</Button></>)}
    {likedWarn && task && status !== 'success' && createPortal(<div className={`warn-overlay ${likedClosing ? 'closing' : ''}`} role="alertdialog">
      <div className="warn-card warn-red">
        <strong>Falsely checking the liked video checkbox without actually liking the video will lead to a permanent account ban.</strong>
      </div>
    </div>, document.body)}
  </DialogContent></Dialog>;
}
