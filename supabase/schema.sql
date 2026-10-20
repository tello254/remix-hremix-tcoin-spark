-- ==========================================================================
--  TCOINS — MASTER DATABASE SCHEMA v2 (spec: MasterDatabaseArchitecture)
--  Rate: 10 Tcoins = KSh 1. Day reset: 00:00 UTC (current_date; Supabase runs UTC).
--  Auth: Phone + PIN (no Google OAuth, no email-only logins).
--  Financial & anti-fraud rules enforced at PostgreSQL level.
--  Documented deviations from the master spec (gaps it left):
--   • campaigns table          — spec references campaign_id but omits the table
--   • lifetime_tasks increment — done inside fn_complete_task, else organic tiers never unlock
--   • wallet_ledger.seq        — bigserial tie-break, unambiguous balance ordering
--   • vault reason 'smart_link'— exempted from the Free 2-milestone daily cap (spec §3C)
--   • per-user row locks       — FOR UPDATE on profiles inside every money RPC
--   • vault expiry             — locked entries expire when a new day's batch generates
-- ==========================================================================

drop table if exists public.referral_pending_vault,
  public.withdrawals, public.wallet_ledger, public.referrals,
  public.task_completions, public.daily_batches,
  public.campaigns, public.social_handles, public.profiles cascade;

-- ============ Table 1: profiles ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username varchar(30) unique not null,
  phone_number varchar(15) unique check (phone_number ~ '^(?:\+254|254|0)?7(?:[0129]\d|4[0-8]|5[7-9]|6[89])\d{6}$|^(?:\+254|254|0)?11[0-5]\d{6}$'),
  phone_locked boolean not null default true,   -- ⚠️ bound to account forever (SIM-swap safeguard)
  bought_badge varchar(20) not null default 'none' check (bought_badge in ('none','pro','premium')),
  lifetime_tasks integer not null default 0,
  has_withdrawn boolean not null default false,
  is_flagged boolean not null default false,
  flag_reason text,
  device_id varchar(128),
  created_at timestamptz not null default now()
  -- tier is NEVER stored: effective_tier() computes from bought_badge + lifetime_tasks
);
create index profiles_lifetime_tasks_idx on public.profiles(lifetime_tasks);

-- ============ Table 2: social_handles ============
create table public.social_handles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform varchar(20) not null check (platform in ('youtube','tiktok','instagram')),
  handle varchar(60) not null,
  is_locked boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, platform, handle)   -- per-user level dedupe
);
create unique index social_handles_platform_handle_key
  on public.social_handles (platform, lower(handle));   -- anti-fraud §4.1: one owner per public handle (case-insensitive);
create index social_handles_user_idx on public.social_handles(user_id);

-- ============ Table 3 (added): campaigns ============
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.profiles(id) on delete set null,
  title text not null check (char_length(title) between 3 and 100),
  url text not null,
  platform varchar(20) not null check (platform in ('youtube','tiktok','instagram')),
  thumbnail text default '',
  budget_ksh numeric(12,2) not null check (budget_ksh > 0),
  payout_ksh numeric(10,2) not null check (payout_ksh >= 0.1),
  access_code text not null,
  instruction text not null default '',
  duration text default '',
  creator_name text not null default '',
  slots integer generated always as (floor(budget_ksh / payout_ksh)) stored not null,
  completed integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index campaigns_active_idx on public.campaigns(active, platform);

-- ============ Table 4: daily_batches (frozen at generation) ============
create table public.daily_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date_utc date not null,
  tier_at_batch varchar(20) not null check (tier_at_batch in ('free','pro','premium')),
  video_count int not null check (video_count >= 0),
  daily_reward int not null check (daily_reward >= 0),
  completed_tasks int not null default 0,
  is_claimed boolean not null default false,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, date_utc)           -- exactly one frozen batch per user per UTC day
);
create index daily_batches_user_date_idx on public.daily_batches(user_id, date_utc desc);

-- ============ Table 5: task_completions ============
create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.daily_batches(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  platform varchar(20) not null,
  handle_used varchar(60) not null,
  comment_preview text,
  created_at timestamptz not null default now(),
  unique (user_id, campaign_id)        -- anti-fraud §4.2: no double-claim, ever
);
create index task_completions_batch_idx on public.task_completions(batch_id);
create index task_completions_campaign_idx on public.task_completions(campaign_id);

-- ============ Table 6: referrals (1 level only) ============
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referee_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code varchar(30) not null default '',
  stage smallint not null default 0 check (stage between 0 and 3),
  stage1_paid boolean not null default false,
  stage2_paid boolean not null default false,
  tasks_completed int not null default 0,
  total_earned_from_referee int not null default 0,
  created_at timestamptz not null default now(),
  check (referrer_id <> referee_id)
);
create index referrals_referrer_idx on public.referrals(referrer_id);

-- ============ Table 7: referral_pending_vault — the anti-leech lock ============
create table public.referral_pending_vault (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,      -- referrer
  source_referee_id uuid references public.profiles(id) on delete cascade,    -- the friend
  coins_locked int not null check (coins_locked > 0),
  reason varchar(40) not null check (reason in ('first_task','first_withdraw','task_commission','smart_link')),
  status varchar(20) not null default 'locked' check (status in ('locked','claimed','expired')),
  date_credited date not null default current_date,
  created_at timestamptz not null default now()
);
create index vault_status_idx on public.referral_pending_vault(user_id, status);

-- ============ Table 8: wallet_ledger — immutable single source of truth ============
create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind varchar(30) not null check (kind in ('welcome_bonus','daily_batch','referral_claim','badge_purchase','withdrawal','withdrawal_refund','referral_task','referral_milestone')),
  amount int not null check (amount <> 0),          -- signed: + credit, − debit
  balance_after int not null check (balance_after >= 0),
  reference_id varchar(64),
  description text not null default '',
  seq bigint generated always as identity not null, -- gap fix: unambiguous ordering
  created_at timestamptz not null default now()
);
create index ledger_user_seq_idx on public.wallet_ledger(user_id, seq desc);

-- ============ Table 9: withdrawals ============
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_tcoins int not null check (amount_tcoins > 0),
  amount_ksh numeric(10,2) generated always as (amount_tcoins / 10.0) stored,
  phone_number varchar(15) not null,
  status varchar(20) not null default 'pending' check (status in ('pending','processing','completed','failed','flagged')),
  mpesa_receipt varchar(30),
  recipient_name varchar(100),          -- Daraja B2C name → multi-SIM detection
  failure_reason text,
  created_at timestamptz not null default now(),
  disbursed_at timestamptz
);
create index withdrawals_user_idx on public.withdrawals(user_id, created_at desc);

-- ============ helper: running balance ============
create or replace function public.current_balance(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select balance_after from public.wallet_ledger
                   where user_id = p_user order by seq desc limit 1), 0)
$$;

-- ============ helper: effective tier (never stored) ============
-- Organic journey: Pro unlocks at 60 lifetime tasks (payout #16), Premium at 120.
create or replace function public.effective_tier(p_bought_badge varchar, p_lifetime_tasks int)
returns varchar(20) language sql immutable as $$
  select case
    when p_bought_badge = 'premium' or p_lifetime_tasks >= 120 then 'premium'
    when p_bought_badge = 'pro' or p_lifetime_tasks >= 60 then 'pro'
    else 'free' end
$$;

-- ============ helper: journey batch size ============
-- Day 1 = 5 videos. Free journey: 16 Tcoins payouts land exactly on 60 lifetime
-- tasks (random 3/4 days, constrained so payout #16 is always the last).
create or replace function public.journey_batch_size(p_lifetime_tasks int, p_bought_badge varchar, p_payouts_done int)
returns int language plpgsql as $$
declare
  v_tier varchar(20) := public.effective_tier(p_bought_badge, p_lifetime_tasks);
  v_remaining int := 60 - p_lifetime_tasks;
  v_grants_after int := 16 - p_payouts_done - 1;   -- grants still to come after the batch being created
  v_s3 int; v_s4 int;
begin
  -- Day 1 onboarding (or a user who skipped every earlier day): 5 videos / 75 Tcoins
  if p_lifetime_tasks = 0 and p_payouts_done = 0 then
    return 5;
  end if;
  -- acquired tiers keep their sizes (Pro 6-7, Premium 10-12)
  if v_tier = 'premium' then return 10 + floor(random() * 3)::int; end if;
  if v_tier = 'pro' then return 6 + floor(random() * 2)::int; end if;
  -- free journey (organic only): 16 payouts land exactly on 60 lifetime tasks
  if v_remaining <= 0 then return 3; end if;
  if v_grants_after <= 0 then
    return least(greatest(v_remaining, 3), 4);     -- final grant: whatever is left (3 or 4 by design)
  end if;
  -- feasible sizes keep the rest of the schedule solvable: leftovers must fit grants_after x [3,4]
  v_s3 := case when v_remaining - 3 between 3 * v_grants_after and 4 * v_grants_after then 1 else 0 end;
  v_s4 := case when v_remaining - 4 between 3 * v_grants_after and 4 * v_grants_after then 1 else 0 end;
  return case
    when v_s4 = 1 and (v_s3 = 0 or random() < 0.5) then 4
    when v_s3 = 1 then 3
    else least(greatest(v_remaining, 3), 4) end;
end $$;

-- ============ helper: today's UTC date (Supabase server runs UTC) ============
create or replace function public.today_utc()
returns date language sql stable as $$ select current_date $$;

-- ============ fn_complete_task ============
create or replace function public.fn_complete_task(
  p_user uuid, p_campaign uuid, p_platform varchar,
  p_handle varchar, p_comment text default null, p_smart_link boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ctx public.profiles%ROWTYPE;
  v_handle varchar(60);
  v_camp public.campaigns%ROWTYPE;
  v_batch public.daily_batches%ROWTYPE;
  v_ref public.referrals%ROWTYPE;
  v_upline_badge varchar(20);
  v_milestones int;
  v_payouts int;
  v_bal int;
  v_size int;
  v_elig int;
begin
  -- serialize progress + money for this user
  select * into ctx from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ctx.is_flagged then
    return jsonb_build_object('ok', false, 'error', 'account_flagged');
  end if;

  -- handle must belong to this user on this platform
  select handle into v_handle from public.social_handles
    where user_id = p_user and platform = p_platform and lower(handle) = lower(p_handle)
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'handle_not_linked');
  end if;

  select * into v_camp from public.campaigns where id = p_campaign for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'campaign_not_found');
  end if;
  if not v_camp.active or v_camp.completed >= v_camp.slots then
    return jsonb_build_object('ok', false, 'error', 'campaign_exhausted');
  end if;

  -- today's batch (auto-create; Journey rule: Day 1 = 5/75, then 16 payouts to 60 tasks -> Pro).
  -- Same linked-platform eligibility + pay-by-the-video reward as fn_generate_batch.
  select * into v_batch from public.daily_batches
    where user_id = p_user and date_utc = today_utc() for update;
  if not found then
    select count(*) into v_payouts
      from public.daily_batches where user_id = p_user and is_claimed and date_utc < today_utc();
    v_size := journey_batch_size(ctx.lifetime_tasks, ctx.bought_badge, v_payouts);
    v_elig := fn_eligible_pool(p_user);
    insert into public.daily_batches (user_id, date_utc, tier_at_batch, video_count, daily_reward)
      values (p_user, today_utc(),
              effective_tier(ctx.bought_badge, ctx.lifetime_tasks),
              least(v_size, v_elig),
              case when v_elig <= 0 then 0
                   else greatest(floor(fn_daily_budget(ctx.lifetime_tasks, ctx.bought_badge, v_payouts)::numeric
                              * least(v_size, v_elig) / v_size)::int, 1) end)
      on conflict (user_id, date_utc) do update set user_id = excluded.user_id
      returning * into v_batch;
  end if;

  -- all-or-nothing quota: nothing counts after the claim (or beyond the target)
  if v_batch.is_claimed or v_batch.completed_tasks >= v_batch.video_count then
    return jsonb_build_object('ok', false, 'error', 'daily_batch_closed');
  end if;

  begin
    insert into public.task_completions (batch_id, user_id, campaign_id, platform, handle_used, comment_preview)
      values (v_batch.id, p_user, p_campaign, p_platform, v_handle, p_comment);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_completed');
  end;

  update public.campaigns
    set completed = v_camp.completed + 1,
        active = (v_camp.completed + 1 < v_camp.slots)     -- budget cap auto-close
    where id = p_campaign;

  update public.daily_batches set completed_tasks = v_batch.completed_tasks + 1 where id = v_batch.id;

  -- master-spec gap fix: advance lifetime tasks (drives organic tiers)
  update public.profiles set lifetime_tasks = ctx.lifetime_tasks + 1 where id = p_user;

  -- referral money: +25 first-video MILESTONE → referral wallet (transferable / 24h auto);
  -- +2 per further downline task → straight into the upline's MAIN balance. Both are written to the ledger.
  select * into v_ref from public.referrals where referee_id = p_user for update;
  if found then
    select coalesce(bought_badge, 'none') into v_upline_badge
      from public.profiles where id = v_ref.referrer_id;
    select count(*) into v_milestones
      from public.referral_pending_vault
      where user_id = v_ref.referrer_id and date_credited = today_utc() and reason <> 'smart_link';
    if v_ref.stage = 0 and not v_ref.stage1_paid
       and v_milestones < (case v_upline_badge when 'premium' then 99 when 'pro' then 5 else 2 end) then
      update public.referrals set stage = 1, stage1_paid = true, tasks_completed = tasks_completed + 1,
                 total_earned_from_referee = total_earned_from_referee + 25
        where id = v_ref.id;
      insert into public.referral_pending_vault (user_id, source_referee_id, coins_locked, reason)
        values (v_ref.referrer_id, p_user, 25, 'first_task');
      v_bal := current_balance(v_ref.referrer_id);
      insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
        values (v_ref.referrer_id, 'referral_milestone', 25, v_bal,
                'Milestone: downline first video (+25 referral wallet)');
    else
      update public.referrals set tasks_completed = tasks_completed + 1,
                 total_earned_from_referee = total_earned_from_referee + 2
        where id = v_ref.id;
      v_bal := current_balance(v_ref.referrer_id);
      insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
        values (v_ref.referrer_id, 'referral_task', 2, v_bal + 2,
                'Commission: downline task (+2 main balance)');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'completed_tasks', v_batch.completed_tasks + 1,
    'video_count', v_batch.video_count,
    'daily_complete', (v_batch.completed_tasks + 1) >= v_batch.video_count);
end $$;

-- ============ fn_sweep_referral_vault — referral coins auto-transfer to the main wallet 24h after they're earned ============
-- Money rule: a user can hold referral coins in their own wallet for 24 hours; after that the sweep
-- moves them into the available balance automatically (no quota needed — protecting the hustle is
-- only about the first 24 hours, not forever).
create or replace function public.fn_sweep_referral_vault(p_user uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_sweep int;
  v_bal int;
begin
  if auth.uid() is null or p_user <> auth.uid() then
    return 0;
  end if;
  select coalesce(sum(coins_locked), 0) into v_sweep
    from public.referral_pending_vault
    where user_id = p_user and status = 'locked' and created_at < now() - interval '24 hours';
  if coalesce(v_sweep, 0) <= 0 then
    return 0;
  end if;
  v_bal := current_balance(p_user);
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
    values (p_user, 'referral_claim', v_sweep, v_bal + v_sweep,
            'Referral rewards auto-transferred after 24 hours');
  update public.referral_pending_vault set status = 'claimed'
    where user_id = p_user and status = 'locked' and created_at < now() - interval '24 hours';
  return v_sweep;
end $$;

-- ============ fn_claim_daily_batch — all-or-nothing (referral coins stay in their own wallet now) ============
create or replace function public.fn_claim_daily_batch(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ctx public.profiles%ROWTYPE;
  v_batch public.daily_batches%ROWTYPE;
  v_bal int;
  v_payouts int;
  v_pro boolean := false;
begin
  select * into ctx from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ctx.is_flagged then
    return jsonb_build_object('ok', false, 'error', 'account_flagged');
  end if;

  select * into v_batch from public.daily_batches
    where user_id = p_user and date_utc = today_utc() for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_batch_today');
  end if;
  if v_batch.completed_tasks < v_batch.video_count then
    return jsonb_build_object('ok', false, 'error', 'batch_incomplete',
                              'completed_tasks', v_batch.completed_tasks, 'video_count', v_batch.video_count);
  end if;
  if v_batch.is_claimed then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;
  if v_batch.daily_reward <= 0 then
    return jsonb_build_object('ok', false, 'error', 'nothing_to_claim');
  end if;

  update public.daily_batches set is_claimed = true, claimed_at = now() where id = v_batch.id;

  -- journey milestone: 16 payouts earned and 60+ lifetime tasks -> organic Pro badge
  if ctx.bought_badge = 'none' then
    select count(*) into v_payouts
      from public.daily_batches where user_id = p_user and is_claimed;
    if v_payouts >= 16 and ctx.lifetime_tasks >= 60 then
      update public.profiles set bought_badge = 'pro' where id = p_user;
      v_pro := true;
    end if;
  end if;

  perform public.fn_sweep_referral_vault(p_user);   -- anything 24h+ in the vault has auto-landed before this claim

  v_bal := current_balance(p_user);
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, reference_id, description)
    values (p_user, 'daily_batch', v_batch.daily_reward, v_bal + v_batch.daily_reward, v_batch.id::text,
            v_batch.video_count::text || ' verified tasks · daily batch');

  -- referral coins live in their own wallet now: manual "Transfer to main wallet" or the 24h auto-sweep
  return jsonb_build_object('ok', true, 'coins_paid', v_batch.daily_reward,
                            'balance_after', v_bal + v_batch.daily_reward,
                            'pro_awarded', v_pro);
end $$;

-- ============ fn_transfer_referral_vault — move the referral wallet into the main wallet (quota-gated) ============
create or replace function public.fn_transfer_referral_vault(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_bal int;
  v_batch public.daily_batches%ROWTYPE;
begin
  if auth.uid() is null or p_user <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform public.fn_sweep_referral_vault(p_user);
  select coalesce(sum(coins_locked), 0) into v_total
    from public.referral_pending_vault where user_id = p_user and status = 'locked';
  if coalesce(v_total, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_vault');
  end if;
  -- the transfer privilege is earned by finishing today's tasks
  select * into v_batch from public.daily_batches
    where user_id = p_user and date_utc = today_utc() for update;
  if not found or v_batch.completed_tasks < v_batch.video_count then
    return jsonb_build_object('ok', false, 'error', 'quota_incomplete');
  end if;
  v_bal := current_balance(p_user);
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
    values (p_user, 'referral_claim', v_total, v_bal + v_total,
            'Referral rewards transferred to main wallet');
  update public.referral_pending_vault set status = 'claimed' where user_id = p_user and status = 'locked';
  return jsonb_build_object('ok', true, 'coins', v_total, 'balance_after', v_bal + v_total);
end $$;

-- ============ fn_referral_vault — the referral wallet's balance card (total + what's 24h-late) ============
create or replace function public.fn_referral_vault(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_auto int;
begin
  if auth.uid() is null or p_user <> auth.uid() then
    return jsonb_build_object('total', 0, 'auto', 0);
  end if;
  select coalesce(sum(coins_locked), 0), coalesce(sum(case when created_at < now() - interval '24 hours' then coins_locked else 0 end), 0)
    into v_total, v_auto
    from public.referral_pending_vault where user_id = p_user and status = 'locked';
  return jsonb_build_object('total', v_total, 'auto', v_auto);
end $$;

-- ============ fn_my_referrals — the upline's real referral list (username via security definer) ============
create or replace function public.fn_my_referrals(p_user uuid)
returns table(referral_id uuid, referee_name varchar, stage int, tasks_completed int, total_earned int)
language sql security definer set search_path = public stable as $$
  select r.id, coalesce(p.username, 'New member'), r.stage, r.tasks_completed, r.total_earned_from_referee
    from public.referrals r
    left join public.profiles p on p.id = r.referee_id
   where r.referrer_id = p_user
   order by r.created_at
$$;

-- ============ fn_handle_taken — instant pre-check for the profile dialog ============
-- Lets the handle picker refuse a handle THE MOMENT it is selected (red toast) instead of
-- failing at save. Case-insensitive to match the anti-fraud unique index; the owner's own
-- rows never block re-adding their own handle.
create or replace function public.fn_handle_taken(p_platform text, p_handle text, p_owner uuid default null)
returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.social_handles
     where platform = lower(p_platform)
       and lower(handle) = lower(p_handle)
       and (p_owner is null or user_id <> p_owner)
  )
$$;
grant execute on function public.fn_handle_taken(text, text, uuid) to anon, authenticated;

-- ============ fn_simulate_referral — a REAL referral event through the real money rules (stored) ============
-- Money rules it enforces (identical to the live path):
--   milestone 1st video  → +25 to the REFERRAL WALLET (vault), registered in the ledger
--   milestone 1st payout → +25 to the REFERRAL WALLET (vault), registered in the ledger
--   every later task     → +2 straight into the MAIN BALANCE, registered in the ledger
-- A one-time simulated downline friend (clearly named) is created if none exists; daily caps apply
-- to milestones exactly like the real flow. This exists so the flow can be demoed end-to-end.
create or replace function public.fn_simulate_referral(p_user uuid, p_referral_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ref public.referrals%ROWTYPE;
  v_kind text;
  v_bal int;
  v_milestones int;
  v_sim_id uuid;
  v_phone text;
  v_dname text;
  v_salt int := 0;
begin
  if auth.uid() is null or p_user <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if (select is_flagged from public.profiles where id = p_user) then
    return jsonb_build_object('ok', false, 'error', 'account_flagged');
  end if;

  if p_referral_id is null then
    -- no referral yet: reuse the upline's first, or create a one-time simulated downline friend
    select * into v_ref from public.referrals where referrer_id = p_user order by created_at limit 1 for update;
    if not found then
      loop
        v_sim_id := gen_random_uuid();
        v_phone := '254711' || lpad((abs(hashtext(p_user::text) + v_salt) % 1000000)::text, 6, '0');
        v_dname := 'Sim Friend ' || substr(md5(v_sim_id::text), 1, 6);
        begin
          insert into auth.users (id, aud, role, phone, phone_confirmed_at, encrypted_password, created_at, updated_at)
            values (v_sim_id, 'authenticated', 'authenticated', v_phone, now(), 'sim—not a login', now(), now());
          -- the handle_new_user trigger already created the profile row; rename it to the clearly-simulated name
          update public.profiles set username = v_dname where id = v_sim_id;
          insert into public.referrals (referrer_id, referee_id, referral_code) values (p_user, v_sim_id, 'SIM');
          exit;
        exception when unique_violation then
          v_salt := v_salt + 1;
          if v_salt > 5 then
            return jsonb_build_object('ok', false, 'error', 'sim_slot_collision');
          end if;
        end;
      end loop;
      select * into v_ref from public.referrals where referrer_id = p_user order by created_at limit 1 for update;
    end if;
  else
    select * into v_ref from public.referrals where id = p_referral_id and referrer_id = p_user for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  -- the kind follows the referral's own stage: milestone 1, milestone 2, then unlimited +2 commissions
  if not v_ref.stage1_paid then
    v_kind := 'first_task';
  elsif not v_ref.stage2_paid then
    v_kind := 'first_withdraw';
  else
    v_kind := 'task';
  end if;

  if v_kind <> 'task' then
    select count(*) into v_milestones
      from public.referral_pending_vault
      where user_id = p_user and date_credited = today_utc() and reason <> 'smart_link';
    if v_milestones >= (select case coalesce(bought_badge, 'none') when 'premium' then 99 when 'pro' then 5 else 2 end
                          from public.profiles where id = p_user) then
      return jsonb_build_object('ok', false, 'error', 'cap_reached');
    end if;
  end if;

  if v_kind = 'first_task' then
    update public.referrals set stage = 1, stage1_paid = true, tasks_completed = tasks_completed + 1,
               total_earned_from_referee = total_earned_from_referee + 25
      where id = v_ref.id;
    insert into public.referral_pending_vault (user_id, source_referee_id, coins_locked, reason)
      values (p_user, v_ref.referee_id, 25, 'first_task');
    v_bal := current_balance(p_user);
    insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
      values (p_user, 'referral_milestone', 25, v_bal, 'Simulated: first video milestone (+25 referral wallet)');
  elsif v_kind = 'first_withdraw' then
    update public.referrals set stage = 2, stage2_paid = true,
               total_earned_from_referee = total_earned_from_referee + 25
      where id = v_ref.id;
    insert into public.referral_pending_vault (user_id, source_referee_id, coins_locked, reason)
      values (p_user, v_ref.referee_id, 25, 'first_withdraw');
    v_bal := current_balance(p_user);
    insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
      values (p_user, 'referral_milestone', 25, v_bal, 'Simulated: first cashout milestone (+25 referral wallet)');
  else
    update public.referrals set tasks_completed = tasks_completed + 1,
               total_earned_from_referee = total_earned_from_referee + 2
      where id = v_ref.id;
    v_bal := current_balance(p_user);
    insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
      values (p_user, 'referral_task', 2, v_bal + 2, 'Simulated: downline task commission (+2 main balance)');
  end if;

  select * into v_ref from public.referrals where id = v_ref.id;
  return jsonb_build_object('ok', true, 'kind', v_kind,
    'referral_id', v_ref.id, 'referee_name', (select coalesce(username, 'Sim Friend') from public.profiles where id = v_ref.referee_id),
    'stage', v_ref.stage, 'tasks_completed', v_ref.tasks_completed, 'total_earned', v_ref.total_earned_from_referee,
    'balance_after', current_balance(p_user), 'vault_total',
    (select coalesce(sum(coins_locked), 0) from public.referral_pending_vault
      where user_id = p_user and status = 'locked'));
end $$;

-- ============ fn_request_withdrawal — anti-double-spend ============
create or replace function public.fn_request_withdrawal(p_user uuid, p_amount int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_u public.profiles%ROWTYPE;
  v_bal int;
  v_min int;
  v_w public.withdrawals%ROWTYPE;
  v_ref public.referrals%ROWTYPE;
  v_upline_badge varchar(20);
  v_milestones int;
begin
  select * into v_u from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_u.is_flagged then
    return jsonb_build_object('ok', false, 'error', 'account_flagged');
  end if;

  perform public.fn_sweep_referral_vault(v_u.id);   -- 24h+ referral coins have auto-landed before any cashout math
  v_min := case when v_u.has_withdrawn then 300 else 100 end;   -- first cashout at 100 (KSh 10), then 300 (KSh 30)
  if p_amount < v_min then
    return jsonb_build_object('ok', false, 'error', 'below_minimum', 'minimum', v_min);
  end if;

  v_bal := current_balance(p_user);
  if p_amount > v_bal then
    return jsonb_build_object('ok', false, 'error', 'balance_too_low', 'balance', v_bal);
  end if;

  -- debit immediately → those Tcoins cannot be double-spent while B2C is in flight
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
    values (p_user, 'withdrawal', -p_amount, v_bal - p_amount, 'Withdrawal request');

  insert into public.withdrawals (user_id, amount_tcoins, phone_number)
    values (p_user, p_amount, v_u.phone_number)
    returning * into v_w;

  update public.profiles set has_withdrawn = true where id = p_user;

  -- referral milestone: referee's first cashout pays the upline +25 (vaulted, Free-capped)
  select * into v_ref from public.referrals where referee_id = p_user for update;
  if found and v_ref.stage = 1 and not v_ref.stage2_paid then
    select coalesce(bought_badge, 'none') into v_upline_badge from public.profiles where id = v_ref.referrer_id;
    update public.referrals set stage = 2, stage2_paid = true,
               total_earned_from_referee = total_earned_from_referee + 25
      where id = v_ref.id;
    select count(*) into v_milestones
      from public.referral_pending_vault
      where user_id = v_ref.referrer_id and date_credited = today_utc() and reason <> 'smart_link';
    if v_upline_badge <> 'none' or v_milestones < 2 then
      insert into public.referral_pending_vault (user_id, source_referee_id, coins_locked, reason)
        values (v_ref.referrer_id, p_user, 25, 'first_withdraw');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'withdrawal_id', v_w.id, 'balance_after', v_bal - p_amount);
end $$;

-- ============ fn_refund_withdrawal — Daraja failure safety net ============
create or replace function public.fn_refund_withdrawal(p_withdrawal uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w public.withdrawals%ROWTYPE;
  v_bal int;
begin
  select * into v_w from public.withdrawals where id = p_withdrawal for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_w.status not in ('pending','processing') then
    return jsonb_build_object('ok', false, 'error', 'already_final', 'status', v_w.status);
  end if;

  update public.withdrawals
    set status = 'failed', failure_reason = p_reason, disbursed_at = now()
    where id = p_withdrawal;

  v_bal := current_balance(v_w.user_id);
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, reference_id, description)
    values (v_w.user_id, 'withdrawal_refund', v_w.amount_tcoins, v_bal + v_w.amount_tcoins, v_w.id::text,
            'Withdrawal failed — Tcoins refunded: ' || coalesce(p_reason, ''));

  return jsonb_build_object('ok', true, 'balance_after', v_bal + v_w.amount_tcoins);
end $$;

-- ============ Linked-platform helpers (shared by every batch generation site) ============
-- fn_eligible_pool: active campaigns the user can actually WORK — the device handles they
-- linked decide it. No TikTok handle → TikTok tasks never generate; same for Instagram.
-- The campaign does not become "theirs"; it just never enters their unavailable pool.
create or replace function public.fn_eligible_pool(p_user uuid)
returns int
language sql security definer set search_path = public stable as $$
  select count(*)::int
    from public.campaigns c
    where c.active
      and exists (select 1 from public.social_handles h where h.user_id = p_user and h.platform = c.platform)
      and not exists (select 1 from public.task_completions t where t.user_id = p_user and t.campaign_id = c.id)
$$;

-- fn_daily_budget: the day's gross budget by journey position (70/75 day-one, tier rewards).
-- Rewards are PAID BY THE VIDEO: 60 over 4 videos = 15 each, so 3 reachable videos pay 45.
create or replace function public.fn_daily_budget(p_lifetime_tasks int, p_bought_badge varchar, p_payouts_done int)
returns int
language plpgsql as $$
begin
  if p_lifetime_tasks = 0 and p_payouts_done = 0 then return 75; end if;
  case effective_tier(p_bought_badge, p_lifetime_tasks)
    when 'premium' then return 199 + floor(random() * 9)::int;
    when 'pro' then return 120;
    else return 60;
  end case;
  return 60;   -- unreachable; keeps the parser happy
end $$;

-- ============ fn_generate_batch — day rollover (00:00 UTC) ============
-- Explicit batch generation; the RP (state wiring) calls it once per user per day.
-- Referral coins are earned for keeps: the 24h auto-transfer sweep runs here on every fresh day.
create or replace function public.fn_generate_batch(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ctx public.profiles%ROWTYPE;
  v_batch public.daily_batches%ROWTYPE;
  v_exp int;
  v_payouts int;
  v_tier varchar(20);
  v_size int;
  v_base int;
  v_elig int;
begin
  select * into ctx from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_batch from public.daily_batches
    where user_id = p_user and date_utc = today_utc() for update;
  if found then
    return jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'already_existed', true,
                              'video_count', v_batch.video_count, 'reward', v_batch.daily_reward,
                              'completed_tasks', v_batch.completed_tasks, 'is_claimed', v_batch.is_claimed);
  end if;

  -- referral coins are earned for keeps now: anything 24h+ old auto-transfers to the main wallet
  select public.fn_sweep_referral_vault(p_user) into v_exp;

  select count(*) into v_payouts
    from public.daily_batches where user_id = p_user and is_claimed and date_utc < today_utc();

  v_tier := effective_tier(ctx.bought_badge, ctx.lifetime_tasks);
  v_size := journey_batch_size(ctx.lifetime_tasks, ctx.bought_badge, v_payouts);
  v_base := fn_daily_budget(ctx.lifetime_tasks, ctx.bought_badge, v_payouts);
  v_elig := fn_eligible_pool(p_user);
  insert into public.daily_batches (user_id, date_utc, tier_at_batch, video_count, daily_reward)
    values (p_user, today_utc(), v_tier,
            least(v_size, v_elig),                     -- only as many tasks as linked platforms allow
            case when v_elig <= 0 then 0                 -- nothing reachable: an empty, honest day
                 else greatest(floor(v_base::numeric * least(v_size, v_elig) / v_size)::int, 1) end)
    returning * into v_batch;

  return jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'already_existed', false,
                            'expired_vault_entries', v_exp,
                            'video_count', v_batch.video_count, 'reward', v_batch.daily_reward);
end $$;

-- ============ Statistics views (master §3 — no extra tables) ============
create view public.v_withdrawn_totals as
  select user_id, coalesce(sum(amount_ksh), 0) as total_withdrawn_ksh
    from public.withdrawals where status = 'completed' group by user_id;

create view public.v_badge_progress as
  select id as user_id, lifetime_tasks,
         case when lifetime_tasks < 60 then 60 - lifetime_tasks
              when lifetime_tasks < 120 then 120 - lifetime_tasks else 0 end as tasks_to_next_badge,
         case when lifetime_tasks < 60 then 'pro'
              when lifetime_tasks < 120 then 'premium' else 'max_tier' end as next_badge_target
    from public.profiles;

create view public.v_today_goal as
  select user_id, video_count as daily_goal_videos, completed_tasks as current_videos_completed,
         daily_reward as potential_reward_tcoins, is_claimed as reward_claimed
    from public.daily_batches where date_utc = today_utc();

create view public.v_week_summary as
  select user_id, date(created_at) as day,
         sum(case when amount > 0 then amount else 0 end) as tcoins_earned
    from public.wallet_ledger
    where created_at >= now() - interval '7 days'
    group by user_id, date(created_at) order by date(created_at);

-- ============ Trigger: signup → profile + welcome bonus (instant trust) ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, phone_number)
    values (new.id,
            coalesce(new.phone, 'user_' || left(new.id::text, 8)),
            new.phone)                       -- stays NULL for email-alias identities; stamped by signUpUser
    on conflict (id) do nothing;
  -- welcome bonus is NOT credited here: it lives behind fn_claim_welcome until the
  -- user claims it from the dashboard banner (balance shows 0 until then).
  return new;
end $$;

-- Claim the 25-Tcoin welcome bonus (one-shot; enforced by the ledger, not a flag).
create or replace function public.fn_claim_welcome(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bal int;
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (select 1 from public.wallet_ledger where user_id = p_user and kind = 'welcome_bonus') then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;
  v_bal := current_balance(p_user);
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
    values (p_user, 'welcome_bonus', 25, v_bal + 25, 'Welcome bonus — claimed');
  return jsonb_build_object('ok', true, 'balance_after', v_bal + 25);
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Row Level Security ============
alter table public.profiles enable row level security;
alter table public.social_handles enable row level security;
alter table public.campaigns enable row level security;
alter table public.daily_batches enable row level security;
alter table public.task_completions enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_pending_vault enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.withdrawals enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles select own') then
    create policy "profiles select own" on public.profiles for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles update own') then
    create policy "profiles update own" on public.profiles for update using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='social_handles' and policyname='handles all own') then
    create policy "handles all own" on public.social_handles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaigns' and policyname='campaigns read') then
    create policy "campaigns read" on public.campaigns for select using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='campaigns' and policyname='campaigns insert own') then
    create policy "campaigns insert own" on public.campaigns for insert with check (creator_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='daily_batches' and policyname='batches all own') then
    create policy "batches all own" on public.daily_batches for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='task_completions' and policyname='completions all own') then
    create policy "completions all own" on public.task_completions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='referrals' and policyname='referrals read own') then
    create policy "referrals read own" on public.referrals for select using (auth.uid() = referrer_id or auth.uid() = referee_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='referral_pending_vault' and policyname='vault all own') then
    create policy "vault all own" on public.referral_pending_vault for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='wallet_ledger' and policyname='ledger select own') then
    create policy "ledger select own" on public.wallet_ledger for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='withdrawals' and policyname='withdrawals all own') then
    create policy "withdrawals all own" on public.withdrawals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
