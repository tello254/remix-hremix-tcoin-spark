-- ============ Tier earned by video Tcoins (replaces the 16-payout / 60-task journey) ============
-- Why: the old organic Pro rule assumed every user could work 3-4 videos a day and reach 60
-- lifetime tasks in 16 payouts. Users who cannot link all three handles immediately (fresh
-- TikTok/IG/YouTube accounts cannot comment right away) earn less per day, so "days" and
-- "payouts" are not a fair yardstick.
--
-- New rule: a tier is earned by the Tcoins a user has ACTUALLY been paid by daily batches.
--   · Pro     at 1,000 video Tcoins
--   · reset   then Premium at 1,000 + 2,400 = 3,400 video Tcoins
-- Referral milestones/commissions, the welcome bonus, badge purchases and withdrawals are
-- excluded: only wallet_ledger rows with kind = 'daily_batch' count.
-- Batch sizes follow the same tier: Free 3-4 (60) · Pro 6-7 (120) · Premium 10-12 (199+).

-- the parameter names change (lifetime tasks → video coins); CREATE OR REPLACE cannot rename
-- input parameters, so the three tier helpers are recreated from scratch
drop view if exists public.v_badge_progress;
drop function if exists public.effective_tier(varchar, int);
drop function if exists public.journey_batch_size(int, varchar, int);
drop function if exists public.fn_daily_budget(int, varchar, int);

create or replace function public.effective_tier(p_bought_badge varchar, p_video_coins int)
returns varchar(20) language sql immutable as $$
  select case
    when p_bought_badge = 'premium' or p_video_coins >= 3400 then 'premium'
    when p_bought_badge = 'pro' or p_video_coins >= 1000 then 'pro'
    else 'free' end
$$;

-- ============ helper: Tcoins earned from daily batches only ============
-- The tier yardstick. Referral milestones/commissions, the welcome bonus, badge purchases and
-- withdrawals never enter this number: a user's tier can only be earned by watching videos.
create or replace function public.fn_video_coins(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int
    from public.wallet_ledger
   where user_id = p_user and kind = 'daily_batch'
$$;

-- ============ helper: journey batch size ============
-- Day 1 = 5 videos / 75 Tcoins. After that the size follows the TIER, and the tier follows the
-- Tcoins actually paid out by daily batches — so a user with one handle simply earns a smaller
-- daily amount and takes longer, instead of having a "day count" assumption imposed on them.
-- Free 3-4 (60) · Pro 6-7 (120) · Premium 10-12 (199+).
create or replace function public.journey_batch_size(p_video_coins int, p_bought_badge varchar, p_payouts_done int)
returns int language plpgsql as $$
declare
  v_tier varchar(20) := public.effective_tier(p_bought_badge, p_video_coins);
begin
  -- Day 1 onboarding (or a user who skipped every earlier day): 5 videos / 75 Tcoins
  if p_video_coins = 0 and p_payouts_done = 0 then
    return 5;
  end if;
  if v_tier = 'premium' then return 10 + floor(random() * 3)::int; end if;
  if v_tier = 'pro' then return 6 + floor(random() * 2)::int; end if;
  return 3 + floor(random() * 2)::int;              -- free: 3 or 4 videos
end $$;

create or replace function public.fn_video_coins(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int
    from public.wallet_ledger
   where user_id = p_user and kind = 'daily_batch'
$$;

-- ============ helper: journey batch size ============
-- Day 1 = 5 videos / 75 Tcoins. After that the size follows the TIER, and the tier follows the
-- Tcoins actually paid out by daily batches — so a user with one handle simply earns a smaller
-- daily amount and takes longer, instead of having a "day count" assumption imposed on them.
-- Free 3-4 (60) · Pro 6-7 (120) · Premium 10-12 (199+).
create or replace function public.journey_batch_size(p_video_coins int, p_bought_badge varchar, p_payouts_done int)
returns int language plpgsql as $$
declare
  v_tier varchar(20) := public.effective_tier(p_bought_badge, p_video_coins);
begin
  -- Day 1 onboarding (or a user who skipped every earlier day): 5 videos / 75 Tcoins
  if p_video_coins = 0 and p_payouts_done = 0 then
    return 5;
  end if;
  if v_tier = 'premium' then return 10 + floor(random() * 3)::int; end if;
  if v_tier = 'pro' then return 6 + floor(random() * 2)::int; end if;
  return 3 + floor(random() * 2)::int;              -- free: 3 or 4 videos
end $$;

create or replace function public.journey_batch_size(p_video_coins int, p_bought_badge varchar, p_payouts_done int)
returns int language plpgsql as $$
declare
  v_tier varchar(20) := public.effective_tier(p_bought_badge, p_video_coins);
begin
  -- Day 1 onboarding (or a user who skipped every earlier day): 5 videos / 75 Tcoins
  if p_video_coins = 0 and p_payouts_done = 0 then
    return 5;
  end if;
  if v_tier = 'premium' then return 10 + floor(random() * 3)::int; end if;
  if v_tier = 'pro' then return 6 + floor(random() * 2)::int; end if;
  return 3 + floor(random() * 2)::int;              -- free: 3 or 4 videos
end $$;

create or replace function public.fn_daily_budget(p_video_coins int, p_bought_badge varchar, p_payouts_done int)
returns int
language plpgsql as $$
begin
  if p_video_coins = 0 and p_payouts_done = 0 then return 75; end if;
  case effective_tier(p_bought_badge, p_video_coins)
    when 'premium' then return 199 + floor(random() * 9)::int;
    when 'pro' then return 120;
    else return 60;
  end case;
  return 60;   -- unreachable; keeps the parser happy
end $$;

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
  v_base int;
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
    v_size := journey_batch_size(public.fn_video_coins(p_user), ctx.bought_badge, v_payouts);
    v_base := fn_daily_budget(public.fn_video_coins(p_user), ctx.bought_badge, v_payouts);
    v_elig := fn_eligible_pool(p_user);
    insert into public.daily_batches
        (user_id, date_utc, tier_at_batch, video_count, daily_reward, plan_video_count, plan_reward)
      values (p_user, today_utc(),
              effective_tier(ctx.bought_badge, public.fn_video_coins(p_user)),
              least(v_size, v_elig),
              case when v_elig <= 0 then 0
                   else greatest(floor(v_base::numeric * least(v_size, v_elig) / v_size)::int, 1) end,
              v_size, v_base)          -- minted allocation, frozen for the life of this batch
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
  v_target int;
  v_reward int;
  v_grew boolean := false;
begin
  select * into ctx from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_batch from public.daily_batches
    where user_id = p_user and date_utc = today_utc() for update;
  if found then
    -- Live fair-share realignment of the open day (see supabase/delta-expand.sql header):
    -- the open day always reflects the videos that are actually workable right now, capped at the
    -- allocation the batch was MINTED with; floored at completed_tasks; claimed batches never move.
    -- The minted allocation is frozen in plan_video_count/plan_reward, so the user's own progress
    -- can never move the target: finishing a video banks it (greyed on the dashboard) but never
    -- resizes the day. Only paused/removed campaigns the batch has not consumed yet can pull the
    -- quota down; newly launched campaigns grow it back up, never past the minted plan.
    if not v_batch.is_claimed then
      v_size := v_batch.plan_video_count;
      v_base := v_batch.plan_reward;
      v_elig := fn_eligible_pool(p_user) + (
        select count(*)::int from public.task_completions where batch_id = v_batch.id
      );                                                                  -- the batch's own finished work stays counted
      v_target := greatest(least(v_size, v_elig), v_batch.completed_tasks);  -- finished work always counts
      if v_target <> v_batch.video_count then
        v_reward := case when v_target <= 0 then 0
                         else greatest(floor(v_base::numeric * v_target / nullif(v_size, 0))::int, 1) end;
        update public.daily_batches
          set video_count = v_target,
              daily_reward = v_reward
          where id = v_batch.id
          returning * into v_batch;
        v_grew := true;
      end if;
    end if;
    return jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'already_existed', true,
                              'realigned', v_grew,
                              'video_count', v_batch.video_count, 'reward', v_batch.daily_reward,
                              'completed_tasks', v_batch.completed_tasks, 'is_claimed', v_batch.is_claimed);
  end if;

  -- referral coins are earned for keeps now: anything 24h+ old auto-transfers to the main wallet
  select public.fn_sweep_referral_vault(p_user) into v_exp;

  select count(*) into v_payouts
    from public.daily_batches where user_id = p_user and is_claimed and date_utc < today_utc();

  v_tier := effective_tier(ctx.bought_badge, public.fn_video_coins(p_user));
  v_size := journey_batch_size(public.fn_video_coins(p_user), ctx.bought_badge, v_payouts);
  v_base := fn_daily_budget(public.fn_video_coins(p_user), ctx.bought_badge, v_payouts);
  v_elig := fn_eligible_pool(p_user);
  insert into public.daily_batches
      (user_id, date_utc, tier_at_batch, video_count, daily_reward, plan_video_count, plan_reward)
    values (p_user, today_utc(), v_tier,
            least(v_size, v_elig),                     -- only as many tasks as linked platforms allow
            case when v_elig <= 0 then 0                 -- nothing reachable: an empty, honest day
                 else greatest(floor(v_base::numeric * least(v_size, v_elig) / v_size)::int, 1) end,
            v_size, v_base)                            -- minted allocation, frozen for the day
    returning * into v_batch;

  return jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'already_existed', false,
                            'expired_vault_entries', v_exp,
                            'video_count', v_batch.video_count, 'reward', v_batch.daily_reward);
end $$;

create or replace function public.fn_claim_daily_batch(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ctx public.profiles%ROWTYPE;
  v_batch public.daily_batches%ROWTYPE;
  v_bal int;
  v_coins int;
  v_pro boolean := false;
  v_premium boolean := false;
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

  perform public.fn_sweep_referral_vault(p_user);   -- anything 24h+ in the vault has auto-landed before this claim

  v_bal := current_balance(p_user);
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, reference_id, description)
    values (p_user, 'daily_batch', v_batch.daily_reward, v_bal + v_batch.daily_reward, v_batch.id::text,
            v_batch.video_count::text || ' verified tasks · daily batch');

  -- Tier milestones are measured ONLY by Tcoins this user has actually been paid by daily batches
  -- (the row just inserted included). Referral money never counts: Pro at 1,000, then the counter
  -- resets and Premium unlocks 2,400 later (3,400 cumulative).
  v_coins := public.fn_video_coins(p_user);
  if v_coins >= 3400 and ctx.bought_badge <> 'premium' then
    update public.profiles set bought_badge = 'premium' where id = p_user;
    v_premium := true;
  elsif v_coins >= 1000 and ctx.bought_badge = 'none' then
    update public.profiles set bought_badge = 'pro' where id = p_user;
    v_pro := true;
  end if;

  -- referral coins live in their own wallet now: manual "Transfer to main wallet" or the 24h auto-sweep
  return jsonb_build_object('ok', true, 'coins_paid', v_batch.daily_reward,
                            'balance_after', v_bal + v_batch.daily_reward,
                            'video_coins', v_coins,
                            'pro_awarded', v_pro, 'premium_awarded', v_premium);
end $$;

-- the tier-progress view changes shape (tasks → coins), so it is recreated
create or replace view public.v_badge_progress as
  select p.id as user_id, p.lifetime_tasks,
         public.fn_video_coins(p.id) as video_coins,
         greatest(0, (case when public.fn_video_coins(p.id) < 1000 then 1000
                          when public.fn_video_coins(p.id) < 3400 then 3400
                          else public.fn_video_coins(p.id) end) - public.fn_video_coins(p.id)) as coins_to_next_badge,
         case when public.fn_video_coins(p.id) < 1000 then 'pro'
              when public.fn_video_coins(p.id) < 3400 then 'premium' else 'max_tier' end as next_badge_target
    from public.profiles p;
