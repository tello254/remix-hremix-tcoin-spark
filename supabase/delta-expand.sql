-- ============ Live fair-share allocation (delta-expand v2) ============
-- SUPERSEDED by delta-batch-plan-freeze.sql: the v2 realignment re-derived the day-1 5/75 plan
-- from live profile counters, so completing a task shrank the open day to 4/60. The plan is now
-- frozen on the batch row (plan_video_count/plan_reward). Kept for history only.
-- Requirement (daily video allocation):
--   a user's open day always equals the number of eligible videos that exist RIGHT NOW,
--   capped at their required daily allocation:
--     · handles linked, 4+ eligible videos  → full allocation (day-1 5 · free 4 · pro 7 · premium 12)
--     · only 2 available                    → 0/2
--     · only 1 available                    → 0/1
--     · zero handles                        → honest 0/0 day
--   …across ALL linked platforms, updated the same day as eligibility moves:
--     a handle linked after the batch was minted unlocks its videos immediately; a video
--     deleted or exhausted mid-day re-allocates immediately. No waiting for 00:00 UTC.
-- Guards preserved exactly:
--   · same daily_batches row — progress/never reset (explicit: never counted out below work done)
--   · finished work always counts: video_count never falls BELOW completed_tasks
--   · a claimed batch is closed — it never re-opens, grows or shrinks
--   · tier_at_batch untouched (tiers change only from the next batch)
--   · reward follows the same per-video allocation rule (floor(base × count / allocation))
--   · no new money paths: completion still needs fn_complete_task (unique per campaign),
--     claim still needs fn_claim_daily_batch (one per day) — duplicate earnings impossible
--   · idempotent: an unchanged pool is a strict no-op, so hydrates can't drift the numbers
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
    -- LIVE fair-share realignment of the open day (see header comment).
    if not v_batch.is_claimed then
      select count(*) into v_payouts
        from public.daily_batches where user_id = p_user and is_claimed and date_utc < today_utc();
      -- the day's required allocation belongs to the tier it was minted under;
      -- only the day-1 onboarding plan keys off the profile state
      v_size := case
        when ctx.lifetime_tasks = 0 and v_payouts = 0 then 5               -- day-1 plan 5/75
        when v_batch.tier_at_batch = 'premium' then 12                      -- family max of 10-12
        when v_batch.tier_at_batch = 'pro' then 7                           -- family max of 6-7
        else 4 end;                                                         -- free journey max (3-4)
      v_base := case
        when v_batch.tier_at_batch = 'premium' then 199                     -- deterministic min of 199-207
        when v_batch.tier_at_batch = 'pro' then 120
        when ctx.lifetime_tasks = 0 and v_payouts = 0 then 75               -- day-1 budget
        else 60 end;
      v_elig := fn_eligible_pool(p_user);
      v_target := greatest(least(v_size, v_elig), v_batch.completed_tasks);  -- finished work always counts
      if v_target <> v_batch.video_count then
        v_reward := case when v_target <= 0 then 0
                         else greatest(floor(v_base::numeric * v_target / v_size)::int, 1) end;
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
