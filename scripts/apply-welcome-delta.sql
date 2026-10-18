-- Delta: welcome bonus moves behind fn_claim_welcome (balance starts at 0 until claimed).
-- Safe to run with live users (create or replace; no table drops).
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
