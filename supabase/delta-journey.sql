-- ============================================================
-- TCOINS JOURNEY DELTA (2026-10-19)
-- Free journey: Day 1 = 5 tasks/75 Tcoins, then 16 Tcoins payouts total.
-- Days 2-16 grant 3 or 4 tasks (randomized but constrained) so the 16th payout
-- lands exactly on 60 lifetime tasks -> Pro badge awarded automatically.
-- Organic tier thresholds move with it: Pro = 60 lifetime, Premium = 120.
-- Identity never changes: task_completions is keyed by profiles.id (phone account).
-- ============================================================

-- 1) effective tier: organic unlock thresholds (60 -> pro, 120 -> premium)
create or replace function public.effective_tier(p_bought_badge varchar, p_lifetime_tasks int)
returns varchar(20) language sql immutable as $$
  select case
    when p_bought_badge = 'premium' or p_lifetime_tasks >= 120 then 'premium'
    when p_bought_badge = 'pro' or p_lifetime_tasks >= 60 then 'pro'
    else 'free' end
$$;

-- 2) journey batch size — server-side rule so the schedule cannot be faked.
--    p_payouts_done = claimed daily batches BEFORE the batch being created.
--    Day 1 (nothing earned yet): 5. Tiered users: tier sizes.
--    Free journey: remaining/feasibility so payout #16 is the last one.
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

-- 3) fn_generate_batch — rewritten with the journey rule
create or replace function public.fn_generate_batch(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ctx public.profiles%ROWTYPE;
  v_batch public.daily_batches%ROWTYPE;
  v_exp int;
  v_tier varchar(20);
  v_payouts int;
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

  -- locked referral coins don't survive the day unclaimed (blueprint: next day fresh)
  update public.referral_pending_vault set status = 'expired'
    where user_id = p_user and status = 'locked' and date_credited < today_utc();
  get diagnostics v_exp = row_count;

  select count(*) into v_payouts
    from public.daily_batches where user_id = p_user and is_claimed and date_utc < today_utc();

  v_tier := effective_tier(ctx.bought_badge, ctx.lifetime_tasks);
  insert into public.daily_batches (user_id, date_utc, tier_at_batch, video_count, daily_reward)
    values (p_user, today_utc(), v_tier,
            journey_batch_size(ctx.lifetime_tasks, ctx.bought_badge, v_payouts),
            case when ctx.lifetime_tasks = 0 and v_payouts = 0 then 75
                 when v_tier = 'premium' then 199 + floor(random() * 9)::int
                 when v_tier = 'pro' then 99 + floor(random() * 8)::int
                 else 60 end)
    returning * into v_batch;

  return jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'already_existed', false,
                            'expired_vault_entries', v_exp,
                            'video_count', v_batch.video_count, 'reward', v_batch.daily_reward);
end $$;

-- 4) fn_complete_task — same journey rule in the auto-create branch
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
begin
  -- serialize progress + money for this user
  select * into ctx from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ctx.is_flagged then
    return jsonb_build_object('ok', false, 'error', 'account_flagged');
  end if;

  -- handle must belong to this user on this platform (identity itself is the phone-backed profile)
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

  -- today's batch (auto-create; Journey rule: Day 1 = 5/75, then 16 payouts to 60 tasks -> Pro)
  select * into v_batch from public.daily_batches
    where user_id = p_user and date_utc = today_utc() for update;
  if not found then
    select count(*) into v_payouts
      from public.daily_batches where user_id = p_user and is_claimed and date_utc < today_utc();
    insert into public.daily_batches (user_id, date_utc, tier_at_batch, video_count, daily_reward)
      values (p_user, today_utc(),
              effective_tier(ctx.bought_badge, ctx.lifetime_tasks),
              journey_batch_size(ctx.lifetime_tasks, ctx.bought_badge, v_payouts),
              case when ctx.lifetime_tasks = 0 and v_payouts = 0 then 75
                   when effective_tier(ctx.bought_badge, ctx.lifetime_tasks) = 'premium' then 199 + floor(random() * 9)::int
                   when effective_tier(ctx.bought_badge, ctx.lifetime_tasks) = 'pro' then 99 + floor(random() * 8)::int
                   else 60 end)
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

  -- referral side: +25 first-review milestone or +2 task commission, both vaulted
  select * into v_ref from public.referrals where referee_id = p_user for update;
  if found then
    select coalesce(bought_badge, 'none') into v_upline_badge
      from public.profiles where id = v_ref.referrer_id;
    if v_ref.stage = 0 and not v_ref.stage1_paid then
      update public.referrals set stage = 1, stage1_paid = true, tasks_completed = 1,
                 total_earned_from_referee = total_earned_from_referee + 25
        where id = v_ref.id;
      select count(*) into v_milestones
        from public.referral_pending_vault
        where user_id = v_ref.referrer_id and date_credited = today_utc() and reason <> 'smart_link';
      if v_upline_badge <> 'none' or v_milestones < 2 or p_smart_link then
        insert into public.referral_pending_vault (user_id, source_referee_id, coins_locked, reason)
          values (v_ref.referrer_id, p_user, 25, case when p_smart_link then 'smart_link' else 'first_task' end);
      end if;
    else
      update public.referrals set tasks_completed = tasks_completed + 1,
                 total_earned_from_referee = total_earned_from_referee + 2
        where id = v_ref.id;
      select count(*) into v_milestones
        from public.referral_pending_vault
        where user_id = v_ref.referrer_id and date_credited = today_utc() and reason <> 'smart_link';
      if v_upline_badge <> 'none' or v_milestones < 2 or p_smart_link then
        insert into public.referral_pending_vault (user_id, source_referee_id, coins_locked, reason)
          values (v_ref.referrer_id, p_user, 2, case when p_smart_link then 'smart_link' else 'task_commission' end);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'completed_tasks', v_batch.completed_tasks + 1,
    'video_count', v_batch.video_count,
    'daily_complete', (v_batch.completed_tasks + 1) >= v_batch.video_count);
end $$;

-- 5) fn_claim_daily_batch — the 16th Tcoins payout completes the journey -> Pro badge
create or replace function public.fn_claim_daily_batch(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ctx public.profiles%ROWTYPE;
  v_batch public.daily_batches%ROWTYPE;
  v_bal int;
  v_vault int;
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

  v_bal := current_balance(p_user);
  insert into public.wallet_ledger (user_id, kind, amount, balance_after, reference_id, description)
    values (p_user, 'daily_batch', v_batch.daily_reward, v_bal + v_batch.daily_reward, v_batch.id::text,
            v_batch.video_count::text || ' verified tasks · daily batch');

  -- anti-leech unlock: pay out the whole vault as one aggregate entry
  select coalesce(sum(coins_locked), 0) into v_vault
    from public.referral_pending_vault where user_id = p_user and status = 'locked';
  if v_vault > 0 then
    insert into public.wallet_ledger (user_id, kind, amount, balance_after, description)
      values (p_user, 'referral_claim', v_vault, v_bal + v_batch.daily_reward + v_vault,
              'Referral rewards unlocked');
    update public.referral_pending_vault set status = 'claimed' where user_id = p_user and status = 'locked';
  end if;

  return jsonb_build_object('ok', true, 'coins_paid', v_batch.daily_reward + v_vault,
                            'referral_unlocked', v_vault,
                            'balance_after', v_bal + v_batch.daily_reward + v_vault,
                            'pro_awarded', v_pro);
end $$;

-- 6) badge progress view follows the new thresholds
create or replace view public.v_badge_progress as
  select id as user_id, lifetime_tasks,
         case when lifetime_tasks < 60 then 60 - lifetime_tasks
              when lifetime_tasks < 120 then 120 - lifetime_tasks else 0 end as tasks_to_next_badge,
         case when lifetime_tasks < 60 then 'pro'
              when lifetime_tasks < 120 then 'premium' else 'max_tier' end as next_badge_target
    from public.profiles;
