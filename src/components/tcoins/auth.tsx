import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, AtSign, Check, Eye, EyeOff, Loader2, Lock, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTcoins } from './state';
import { supabase } from '@/lib/supabase';
import { checkAvailability, forgotReset, forgotVerify, signUpUser } from '@/lib/auth.functions';
import { isSafaricom, isUsername, normalizePhone, PIN_LENGTH } from '@/lib/auth.shared';
import { searchAccounts } from '@/lib/social.functions';
import coinImage from '@/assets/tcoins.png';

/**
 * Auth gate — the ONLY doors to the app. No session → signup / login / forgot password.
 * No SMS provider anywhere (Cost = KSh 0): signup proves the phone via two forced
 * full-screen confirmations; every cashout is bound to that same locked number.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const s = useTcoins();
  const navigate = useNavigate();   // every fresh sign-in lands on the homepage (Daily tasks)
  const [session, setSession] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [tasking, setTasking] = useState(false);
  const started = useRef(false);
  useEffect(() => supabase.auth.onAuthStateChange((e, sess) => {
    if (e === 'SIGNED_OUT') { started.current = false; setTasking(false); }
    if (e === 'SIGNED_IN' && sess?.user) void navigate({ to: '/' });
    setSession(sess?.user?.id ?? null);
  }).data.subscription.unsubscribe, [navigate]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session?.user?.id ?? null); setBooting(false); });
  }, []);
  /** After every login/signup the dashboard assigns videos for 3–5 seconds ("Loading Tasks"). */
  useEffect(() => {
    if (!session || started.current) return;
    started.current = true;
    const t0 = Date.now();
    const min = 3000 + Math.floor(Math.random() * 2000);
    setTasking(true);
    s.assignTasks().finally(() => {
      const wait = Math.max(0, min - (Date.now() - t0));
      setTimeout(() => setTasking(false), wait);
    });
  }, [session]);
  if (booting) return <Splash label="Starting up" />;
  if (!session) return <AuthScreen />;
  if (tasking || !s.hydrated) return <Splash label="Loading Tasks" coin />;
  return <>{children}</>;
}

function Scenery() {
  return <>
    <span className="auth-orb auth-orb-1" /><span className="auth-orb auth-orb-2" />
    <img className="auth-coin-big auth-coin-big-1" src={coinImage} alt="" />
    <img className="auth-coin-big auth-coin-big-2" src={coinImage} alt="" />
  </>;
}

function Splash({ label, coin = false }: { label: string; coin?: boolean }) {
  return <div className="auth-screen"><Scenery /><div className="auth-splash"><span className="brand-mark brand-mark-lg">T</span>{coin && <Loader2 className="spin" size={22} />}<strong>{label}…</strong><small>{coin ? 'Assigning your videos for today' : 'Tcoins — your everyday, rewarded'}</small></div></div>;
}

type Screen = 'signup' | 'login' | 'forgot';

function AuthScreen() {
  const [screen, setScreen] = useState<Screen>('signup');
  const switcher: Record<Screen, { to: Screen; label: string }> = {
    signup: { to: 'login', label: 'Already have an account? Log in' },
    login: { to: 'signup', label: 'New to Tcoins? Create account' },
    forgot: { to: 'login', label: 'Back to login' },
  };
  return <div className="auth-screen">
    <Scenery />
    <div className="auth-card">
      <div className="auth-brand"><span className="brand-mark">T</span><h1>Tcoins.</h1><p>Watch. Engage. Earn. · 10 Tcoins = KSh 1</p></div>
      <div className="auth-tabs">
        {screen === 'forgot'
          ? <Button variant="ghost" className="filter-active" onClick={() => setScreen('login')}>Back to login</Button>
          : <Button variant="ghost" className="filter-active">{screen === 'signup' ? 'Sign up' : 'Log in'}</Button>}
      </div>
      {screen === 'forgot' ? <ForgotScreen done={() => setScreen('login')} />
        : screen === 'login' ? <LoginScreen toForgot={() => setScreen('forgot')} /> : <SignupScreen />}
      {screen !== 'forgot' && <Button type="button" variant="link" className="auth-link" onClick={() => setScreen(switcher[screen].to)}>{switcher[screen].label}</Button>}
    </div>
  </div>;
}

const FRIENDLY: Record<string, string> = {
  username_taken: 'Username taken — pick another.',
  phone_taken: 'This number already has a Tcoins account. Log in instead.',
  phone: 'Enter a valid Safaricom number (07… / 2547… / 2541…).',
  username: 'Use 3–30 characters: lowercase letters, numbers, underscores.',
  pin: `Your PIN must be exactly ${PIN_LENGTH} digits.`,
  signup_failed: 'Could not create the account. Try again in a moment.',
};

const noAvatar = (e: { currentTarget: { style: { display: string } } }) => { e.currentTarget.style.display = 'none'; };

/** PIN input shared by every screen — dots by default, eye toggle to reveal. */
function PinField({ label, value, onChange, autoComplete = 'current-password' }: { label: string; value: string; onChange: (v: string) => void; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return <label className="form-label"><Lock size={13} /> {label}
    <span className="pin-wrap">
      <input value={value} inputMode="numeric" type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder="" maxLength={6} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      <Button type="button" variant="ghost" size="icon" aria-label={show ? 'Hide PIN' : 'Show PIN'} onClick={() => setShow(v => !v)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</Button>
    </span>
  </label>;
}

/** SIGN UP — username → Safaricom number → two full-screen confirmations → 6-digit PIN. */
function SignupScreen() {
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [avail, setAvail] = useState<'idle' | 'ok' | 'taken'>('idle');
  const [phoneAvail, setPhoneAvail] = useState<'idle' | 'ok' | 'taken'>('idle');
  const [warn, setWarn] = useState<0 | 1 | 2>(0);          // 0 done · 1 first overlay · 2 second
  const [warningsDone, setWarningsDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameOk = isUsername(username);
  const phoneOk = isSafaricom(phone);
  const valid = nameOk && avail === 'ok' && phoneOk && phoneAvail === 'ok' && warningsDone && pin.length === PIN_LENGTH && pin2 === pin;

  useEffect(() => {
    const v = username.trim().toLowerCase();
    if (!isUsername(v)) { setAvail('idle'); return; }
    setAvail('idle');
    const t = setTimeout(async () => {
      const r = await checkAvailability({ data: { kind: 'username', value: v } });
      setAvail(r.valid && r.available ? 'ok' : 'taken');
    }, 450);
    return () => clearTimeout(t);
  }, [username]);

  // Number check runs while typing — taken numbers are refused BEFORE any confirmation popup.
  useEffect(() => {
    if (!isSafaricom(phone)) { setPhoneAvail('idle'); return; }
    setPhoneAvail('idle');
    const t = setTimeout(async () => {
      const r = await checkAvailability({ data: { kind: 'phone', value: normalizePhone(phone) } });
      setPhoneAvail(r.valid && r.available ? 'ok' : 'taken');
    }, 450);
    return () => clearTimeout(t);
  }, [phone]);

  // Only a free, valid Safaricom number unlocks the confirmation overlays.
  useEffect(() => {
    if (phoneOk && phoneAvail === 'ok' && !warningsDone && warn === 0) setWarn(1);
  }, [phoneOk, phoneAvail]);   // eslint-disable-line react-hooks/exhaustive-deps

  const signUp = async () => {
    if (!valid || busy) return;
    setBusy(true); setError('');
    const r = await signUpUser({ data: { username, phone, pin } });
    if (!r.ok) { setBusy(false); setError(FRIENDLY[r.error] || r.error); return; }
    const { error: e } = await supabase.auth.signInWithPassword({ phone: normalizePhone(phone), password: pin });
    if (e) { setBusy(false); setError('Account created, but sign-in failed. Try logging in.'); return; }
    setBusy(false); // session event swaps us to the dashboard + task assignment
  };

  return <form className="auth-form" onSubmit={e => { e.preventDefault(); signUp(); }}>
    <label className="form-label"><UserRound size={13} /> Username
      <input value={username} maxLength={30} placeholder="e.g. brian_ke" className={avail === 'taken' ? 'auth-input-taken' : ''} onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} />
      <small className={`auth-hint ${avail === 'taken' ? 'form-error' : avail === 'ok' ? 'text-primary' : ''}`}>
        {avail === 'taken' ? <><Check size={12} /> Username taken</> : avail === 'ok' ? <><Check size={12} /> Available</> : '\u00A0'}
      </small>
    </label>
    <label className="form-label"><Phone size={13} /> Safaricom number
      <input value={phone} inputMode="tel" autoComplete="tel" placeholder="07xx xxx xxx" className={phoneAvail === 'taken' ? 'auth-input-taken' : ''} onChange={e => setPhone(e.target.value.replace(/[^\d+\s-]/g, ''))} />
      {phoneAvail === 'taken' ? <small className="auth-hint form-error"><Check size={12} /> Number already taken</small>
        : phoneOk && phoneAvail === 'ok' ? <small className="auth-hint text-primary"><Check size={12} /> Confirmed</small> : null}
    </label>
    {pin.length < PIN_LENGTH
      ? <PinField label={`Set your PIN (${PIN_LENGTH} digits)`} value={pin} onChange={setPin} autoComplete="new-password" />
      : <>
        <div className="pin-reveal"><PinField label="Confirm your PIN" value={pin2} onChange={setPin2} autoComplete="new-password" /></div>
        {pin2 && pin2 === pin && <div className="pin-ok"><Check size={14} /></div>}
      </>}
    {pin2 && pin2 !== pin && <p className="form-error">PINs do not match.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <Button type="submit" disabled={!valid || busy} className="auth-cta">{busy ? <Loader2 className="spin" size={16} /> : <>Create account & start earning <ArrowRight size={15} /></>}</Button>

    {warn > 0 && <WarnOverlay key={warn} index={warn as 1 | 2} onDone={() => {
      const next = (warn === 1 ? 2 : 0) as 0 | 1 | 2;
      setWarn(next);
      if (next === 0) setWarningsDone(true);
    }} />}
  </form>;
}

/** LOGIN — phone + PIN. */
function LoginScreen({ toForgot }: { toForgot: () => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (busy || !isSafaricom(phone) || pin.length !== PIN_LENGTH) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.auth.signInWithPassword({ phone: normalizePhone(phone), password: pin });
    setBusy(false);
    if (e) setError('Wrong number or PIN.');
  };
  return <form className="auth-form" onSubmit={e => { e.preventDefault(); go(); }}>
    <label className="form-label"><Phone size={13} /> Phone number
      <input value={phone} inputMode="tel" autoComplete="tel" placeholder="07xx xxx xxx" onChange={e => setPhone(e.target.value.replace(/[^\d+\s-]/g, ''))} />
    </label>
    <PinField label="PIN" value={pin} onChange={setPin} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <Button type="submit" disabled={!isSafaricom(phone) || pin.length !== PIN_LENGTH || busy} className="auth-cta">{busy ? <Loader2 className="spin" size={16} /> : <>Log in <ArrowRight size={15} /></>}</Button>
    <Button type="button" variant="link" className="auth-link" onClick={toForgot}>Forgot your PIN?</Button>
  </form>;
}

const PLATFORMS = ['YouTube', 'TikTok', 'Instagram'] as const;

/** FORGOT PIN — 3 identity proofs (phone → username → a linked social handle), then a new PIN. */
function ForgotScreen({ done }: { done: () => void }) {
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>('YouTube');
  const [handle, setHandle] = useState('');
  const [sugs, setSugs] = useState<{ handle: string; name: string }[]>([]);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinOk = pin.length === PIN_LENGTH && pin2 === pin;

  const ok = async () => (await forgotVerify({ data: { step, phone, username, platform, handle } })).ok;

  const suggest = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    setSugs([]);
    const t = setTimeout(async () => {
      const list = await searchAccounts({ data: { platform, query: v.trim().replace(/^@/, '') } }).catch(() => []);
      setSugs([...(list as { handle: string; name: string }[] || [])]);
    }, 500);
    timer.current = t;
  };

  const next = async () => {
    setBusy(true); setError('');
    if (step === 1) {
      if (await ok()) { setStep(2); setBusy(false); return; }
      setError('No Tcoins account on this number.');
    } else if (step === 2) {
      if (await ok()) { setStep(3); setBusy(false); return; }
      setError('That username does not belong to this number.');
    } else if (step === 3) {
      if (await ok()) { setStep(4); setBusy(false); return; }
      setError(`That ${platform} handle is not linked to this account.`);
    } else {
      const r = await forgotReset({ data: { step: 3, phone, username, platform, handle, pin } });
      if (!r.ok) { setBusy(false); setError('Reset failed — verify the details and try again.'); return; }
      await supabase.auth.signInWithPassword({ phone: normalizePhone(phone), password: pin });
      setBusy(false);
      done();  // password IS reset; if sign-in failed the login screen takes over
      return;
    }
    setBusy(false);
  };

  return <div className="auth-form">
    <div className="auth-steps">{[1, 2, 3, 4].map(n => <span key={n} className={n <= step ? 'auth-step-on auth-step' : 'auth-step'}>{n}</span>)}</div>
    {step === 1 && <>
      <label className="form-label"><Phone size={13} /> Enter the phone number used to open this account
        <input value={phone} inputMode="tel" placeholder="07xx xxx xxx" onChange={e => setPhone(e.target.value.replace(/[^\d+\s-]/g, ''))} />
      </label>
      <Button variant="secondary" disabled={!isSafaricom(phone) || busy} onClick={next}>Next <ArrowRight size={14} /></Button>
    </>}
    {step === 2 && <>
      <label className="form-label"><UserRound size={13} /> Enter your username
        <input value={username} maxLength={30} placeholder="e.g. brian_ke" onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} />
      </label>
      <Button variant="secondary" disabled={!isUsername(username) || busy} onClick={next}>Next <ArrowRight size={14} /></Button>
    </>}
    {step === 3 && <>
      <label className="form-label"><ShieldCheck size={13} /> Choose a platform you linked
        <div className="auth-platforms">{PLATFORMS.map(p => <Button key={p} type="button" variant="ghost" className={platform === p ? 'filter-active' : ''} onClick={() => setPlatform(p)}>{p}</Button>)}</div>
      </label>
      <label className="form-label"><AtSign size={13} /> Enter that platform handle
        <input value={handle} maxLength={40} placeholder={platform === 'YouTube' ? 'channel name' : 'username'} onChange={e => { setHandle(e.target.value.toLowerCase()); suggest(e.target.value); }} />
      </label>
      <div className="handle-suggestions">{sugs.map(s => <Button key={s.handle} type="button" variant="ghost" className="handle-suggestion" onClick={() => setHandle(s.handle.toLowerCase())}>
        <img src={coinImage} alt="" referrerPolicy="no-referrer" onError={noAvatar} />
        <span>{s.name || s.handle}<small>{s.handle}</small></span>
      </Button>)}</div>
      <Button variant="secondary" disabled={!handle || busy} onClick={next}>Next <ArrowRight size={14} /></Button>
    </>}
    {step === 4 && <div className="pin-row">
      <PinField label="New PIN" value={pin} onChange={setPin} />
      <PinField label="Confirm new PIN" value={pin2} onChange={setPin2} />
    </div>}
    {step === 4 && pin2 && pin2 !== pin && <p className="form-error">PINs do not match.</p>}
    {step === 4 && <Button variant="secondary" disabled={!pinOk || busy} onClick={next}>{busy ? <Loader2 className="spin" size={15} /> : <>Continue — change PIN <ArrowRight size={14} /></>}</Button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

/** Full-screen, sequential, translucent+blurred, white text, green checkbox, 1.5s confirm load. */
function WarnOverlay({ index, onDone }: { index: 1 | 2; onDone: () => void }) {
  const [ticked, setTicked] = useState(false);
  const [phase, setPhase] = useState<'ask' | 'confirming' | 'closing'>('ask');
  const accept = () => {
    if (phase !== 'ask' || !ticked) return;
    setPhase('confirming');
    setTimeout(() => setPhase('closing'), 1500);            // deliberate confirm beat
    setTimeout(() => onDone(), 1500 + 230);                  // …then pop-out and advance
  };
  return <div className={`warn-overlay ${phase === 'closing' ? 'closing' : ''}`} role="alertdialog">
    <div className="warn-card">
      {index === 1
        ? <strong>This phone number is permanently connected to this account upon confirmation and cannot be edited, transferred, or reset later.</strong>
        : <strong>Ensure this is your active Safaricom line registered to your M-Pesa. Instant withdrawals disburse automatically to this number.</strong>}
      {phase === 'confirming'
        ? <div className="warn-confirm"><Loader2 className="spin" size={16} /> Confirming…</div>
        : phase === 'ask' && <>
          <label className="warn-check"><input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} /> Check the box to continue</label>
          <Button type="button" className="auth-cta" disabled={!ticked} onClick={accept}>{index === 1 ? 'I understand — continue' : 'Confirm — this is my M-Pesa line'} <ArrowRight size={15} /></Button>
        </>}
    </div>
  </div>;
}
