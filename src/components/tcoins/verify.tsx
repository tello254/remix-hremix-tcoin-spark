import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { ArrowRight, ArrowUpRight, Check, Clock3, Gift, Loader2, Megaphone, Play, Search, ShieldCheck, Target, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTcoins, type Campaign, type Platform } from './state';
import { campaignSchema, campaignSlots, commentSchema, profileSchema } from '@/lib/rewards';
import { searchAccounts, verifyTask } from '@/lib/social.functions';
import coinImage from '@/assets/tcoins.png';

type Account = { handle: string; name: string; avatar: string; followers?: string };
const at = (h: string) => '@' + h.trim().replace(/^@/, '');
function Mark({ platform }: { platform: Platform }) { return <span className={`platform-mark platform-${platform.toLowerCase()}`}>{platform === 'YouTube' ? <Play size={12} fill="currentColor"/> : platform === 'TikTok' ? '♪' : '◎'}</span>; }

/** Live account search with avatars; lets the user link up to 3 handles. */
function HandlePicker({ platform, value, onChange }: { platform: 'YouTube' | 'TikTok'; value: string[]; onChange: (v: string[]) => void }) {
  const search = useServerFn(searchAccounts);
  const [query, setQuery] = useState(''); const [results, setResults] = useState<Account[]>([]); const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false);
  useEffect(() => {
    const q = query.trim().replace(/^@/, ''); setSearched(false);
    if (q.length < 2) { setResults([]); return; }
    let live = true; setLoading(true);
    const t = setTimeout(async () => { try { const r = await search({ data: { platform, query: q } }); if (live) setResults(r); } catch { if (live) setResults([]); } finally { if (live) { setLoading(false); setSearched(true); } } }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [query, platform]);
  const add = (h: string) => { const handle = at(h); if (!value.some(v => v.toLowerCase() === handle.toLowerCase()) && value.length < 3) onChange([...value, handle]); setQuery(''); setResults([]); };
  return <div className="form-label handle-picker"><span><Mark platform={platform}/> {platform} accounts <small className="muted">({value.length}/3)</small></span>
    {value.length > 0 && <div className="handle-chips">{value.map(h => <span key={h} className="handle-chip">{h}<button type="button" aria-label={`Remove ${h}`} onClick={() => onChange(value.filter(v => v !== h))}><X size={12}/></button></span>)}</div>}
    {value.length < 3 && <div className="handle-search"><Search size={14}/><input value={query} maxLength={42} placeholder={value.length ? 'Add another account…' : `Search your ${platform} handle, e.g. @yourname`} onChange={e => setQuery(e.target.value)}/>{loading && <Loader2 size={14} className="spin"/>}
      {(results.length > 0 || (searched && query.trim().length >= 2)) && <div className="handle-dropdown">{results.map(a => <button type="button" key={a.handle} onClick={() => add(a.handle)}>{a.avatar ? <img src={a.avatar} alt="" referrerPolicy="no-referrer"/> : <span className="avatar">{a.name[0]}</span>}<span><strong>{a.name}</strong><small>{at(a.handle)}{a.followers ? ` · ${a.followers}` : ''}</small></span><Check size={14}/></button>)}{!results.length && <p className="muted">No account found. Check the spelling of your handle.</p>}</div>}
    </div>}
  </div>;
}

export function ProfileForm({ close }: { close: () => void }) {
  const s = useTcoins(); const [form, setForm] = useState(s.profile); const [error, setError] = useState('');
  return <><DialogTitle>Make Tcoins yours.</DialogTitle><DialogDescription>Search and select your real accounts so we can find your comments.</DialogDescription>
    <form className="stack-form" onSubmit={e => { e.preventDefault(); const result = profileSchema.safeParse(form); if (!result.success) return setError(result.error.issues[0]?.message ?? 'Check your details and try again.'); s.setProfile(result.data); s.setOnboarded(true); close(); }}>
      <label className="form-label">Your name<input required value={form.name} maxLength={60} onChange={e => setForm(v => ({ ...v, name: e.target.value }))}/></label>
      <label className="form-label">Kenyan phone number<input required value={form.phone} maxLength={13} onChange={e => setForm(v => ({ ...v, phone: e.target.value }))}/></label>
      <HandlePicker platform="YouTube" value={form.youtube} onChange={youtube => setForm(v => ({ ...v, youtube }))}/>
      <HandlePicker platform="TikTok" value={form.tiktok} onChange={tiktok => setForm(v => ({ ...v, tiktok }))}/>
      <label className="form-label">Instagram handle (optional)<input value={form.instagram[0] ?? ''} maxLength={42} placeholder="@yourname" onChange={e => setForm(v => ({ ...v, instagram: e.target.value.trim() ? [e.target.value.trim()] : [] }))}/></label>
      {error && <p className="form-error" role="alert">{error}</p>}<Button type="submit">Save profile <Check/></Button>
    </form></>;
}

export function CampaignForm({ close }: { close: () => void }) {
  const s = useTcoins(); const [form, setForm] = useState({ title: '', url: '', platform: 'YouTube' as Platform, thumbnail: '', budget: 1000, payout: 2, accessCode: '', instruction: 'Like the video and leave a comment of 3+ words.' }); const [error, setError] = useState('');
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));
  return <><DialogTitle>Give your video a head start.</DialogTitle><DialogDescription>Launch a campaign with a hard budget cap and a secret access code.</DialogDescription>
    <form className="stack-form" onSubmit={e => { e.preventDefault(); const result = campaignSchema.safeParse(form); if (!result.success) return setError(result.error.issues[0]?.message ?? 'Check your details and try again.'); s.addCampaign({ ...result.data, accessCode: result.data.accessCode.toUpperCase() }); close(); }}>
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

const reasons: Record<string, string> = {
  code: 'That access code is not right. Check the video or the creator’s pinned comment.',
  'no-comment': 'We couldn’t find a comment from this account yet. Comments can take a minute to appear — try again shortly.',
  short: 'Your comment is too short. Edit it to at least 3 words, then try again.',
  unavailable: 'We couldn’t read the comments on this video right now. Please try again in a moment.',
};

export function TaskDialog({ task, close }: { task: Campaign | null; close: () => void }) {
  const s = useTcoins(); const verifyFn = useServerFn(verifyTask);
  const [started, setStarted] = useState<number | null>(null); const [remaining, setRemaining] = useState(45);
  const [handle, setHandle] = useState(''); const [code, setCode] = useState(''); const [comment, setComment] = useState(''); const [liked, setLiked] = useState(false);
  const [error, setError] = useState(''); const [status, setStatus] = useState<'idle' | 'checking' | 'success'>('idle'); const [quote, setQuote] = useState(''); const lock = useRef(false);
  const accounts = task ? s.profile[task.platform.toLowerCase() as 'youtube' | 'tiktok' | 'instagram'] : [];
  useEffect(() => { setStarted(null); setRemaining(45); setCode(''); setComment(''); setLiked(false); setError(''); setStatus('idle'); setQuote(''); lock.current = false; setHandle(accounts[0] ?? ''); }, [task?.id]);
  useEffect(() => { if (!started) return; const i = window.setInterval(() => setRemaining(Math.max(0, 45 - Math.floor((Date.now() - started) / 1000))), 250); return () => clearInterval(i); }, [started]);
  const live = task?.platform === 'YouTube' || task?.platform === 'TikTok';
  const verify = async () => {
    if (!task || lock.current) return;
    if (!started || remaining > 0) return setError('Watch the video for 45 seconds first.');
    if (Date.now() - started > 600000) return setError('Your task reservation expired. Reopen this task to try again.');
    if (!handle) return setError(`Link your ${task.platform} account in your profile first.`);
    if (!code.trim()) return setError('Enter the access code from the video.');
    if (!liked) return setError('Confirm you liked the video.');
    lock.current = true; setError(''); setStatus('checking');
    let found = '';
    if (live) {
      try {
        const r = await verifyFn({ data: { platform: task.platform as 'YouTube' | 'TikTok', url: task.url, handle, code: code.trim(), expectedCode: task.accessCode } });
        if (!r.ok) { setError(reasons[r.reason] ?? 'Verification failed.'); setStatus('idle'); lock.current = false; return; }
        found = r.quote;
      } catch { setError(reasons['unavailable'] ?? 'Please try again.'); setStatus('idle'); lock.current = false; return; }
    } else {
      if (code.trim().toUpperCase() !== task.accessCode.toUpperCase()) { setError(reasons['code'] ?? 'Check your access code.'); setStatus('idle'); lock.current = false; return; }
      const p = commentSchema.safeParse(comment); if (!p.success) { setError(p.error.issues[0]?.message ?? 'Check your comment.'); setStatus('idle'); lock.current = false; return; }
      found = p.data;
    }
    if (s.completeTask(task.id, true, handle)) { setQuote(found); setStatus('success'); }
    else { setError('This task is already completed or no longer available.'); setStatus('idle'); lock.current = false; }
  };
  const doneCount = s.done.length;
  return <Dialog open={!!task} onOpenChange={o => { if (!o && status !== 'checking') close(); }}><DialogContent className="app-dialog">
    <DialogTitle>{status === 'success' ? 'Verified. Nice work!' : 'Watch. Engage. Get rewarded.'}</DialogTitle>
    <DialogDescription>{live ? 'We check the real comments on this video.' : 'Instagram checks are simulated in this preview.'}</DialogDescription>
    {task && (status === 'success' ? <div className="success-state"><img src={coinImage} width={1024} height={1024} alt="Gold Tcoins"/>
      <p className="verified-quote"><ShieldCheck size={14}/> Verified from {at(handle)}: <q>{quote}</q></p>
      <h2>{doneCount}/{s.dailyLimit} tasks done today</h2>
      <progress value={doneCount} max={s.dailyLimit}/>
      <p>{doneCount >= s.dailyLimit ? `Daily quota complete — collect your ${s.pendingReward} Tcoins from your wallet.` : `Finish ${s.dailyLimit - doneCount} more to unlock your daily reward.`}</p>
      <Button onClick={close}>Keep the good going <ArrowRight/></Button></div>
    : <><div className="task-dialog-preview"><img src={task.thumbnail} alt={task.title}/><div><Mark platform={task.platform}/><h3>{task.title}</h3><p>{task.creator}</p></div></div>
      <p className="task-instruction"><Clock3 size={14}/> {task.instruction}</p>
      <Button asChild onClick={() => { if (!started) setStarted(Date.now()); }}><a href={task.url} target="_blank" rel="noopener noreferrer">{started ? 'Reopen video' : 'Open video & start timer'} <ArrowUpRight/></a></Button>
      <div className="timer-state"><Clock3/><strong>{started ? `${remaining}s` : '45s'}</strong><span>{remaining === 0 ? 'Viewing time complete' : 'Required viewing time'}</span></div>
      {accounts.length === 0 ? <p className="form-error">No {task.platform} account linked. Add one in your profile first.</p>
        : accounts.length === 1 ? <p className="muted">Commenting as <strong>{accounts[0]}</strong></p>
        : <div className="form-label">Which account did you comment from?<div className="account-switch">{accounts.map(a => <Button type="button" key={a} variant={a === handle ? 'default' : 'secondary'} size="sm" onClick={() => setHandle(a)}>{a}</Button>)}</div></div>}
      <label className="form-label">Access code<input value={code} maxLength={40} placeholder="Code from the video or pinned comment" onChange={e => setCode(e.target.value.toUpperCase())}/></label>
      {!live && <label className="form-label">Your comment<textarea placeholder="Paste the comment you left" value={comment} maxLength={1000} onChange={e => setComment(e.target.value)}/></label>}
      <label className="checkbox-label"><input type="checkbox" checked={liked} onChange={e => setLiked(e.target.checked)}/> I liked the video</label>
      <p className="like-warning"><TriangleAlert size={13}/> Falsely checking this will void your payouts.</p>
      <div className="prize-banner"><Gift size={15}/> Verified likes enter the weekly <strong>2,500 Tcoins</strong> and monthly <strong>10,000 Tcoins</strong> prize draws.</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button disabled={remaining > 0 || !started || status === 'checking' || !handle} onClick={verify}>{status === 'checking' ? <><Loader2 className="spin"/> Checking the comments…</> : <><ShieldCheck/> Verify my task</>}</Button></>)}
  </DialogContent></Dialog>;
}
