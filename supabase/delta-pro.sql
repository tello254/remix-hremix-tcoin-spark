-- ============================================================
-- TCOINS PRO DELTA (2026-10-19b)
-- Pro daily reward = 120 Tcoins; referral milestone caps per tier:
--   none(free) = 2/day, pro = 5/day, premium = 99 (effectively unlimited).
-- ============================================================

-- fn_complete_task: reward + caps
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
                   when effective_tier(ctx.bought_badge, ctx.lifetime_tasks) = 'pro' then 120
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
      if v_milestones < (case v_upline_badge when 'premium' then 99 when 'pro' then 5 else 2 end) or p_smart_link then
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
      if v_milestones < (case v_upline_badge when 'premium' then 99 when 'pro' then 5 else 2 end) or p_smart_link then
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

-- fn_generate_batch: Pro reward 120
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
                 when v_tier = 'pro' then 120
                 else 60 end)
    returning * into v_batch;

  return jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'already_existed', false,
                            'expired_vault_entries', v_exp,
                            'video_count', v_batch.video_count, 'reward', v_batch.daily_reward);
end $$;
