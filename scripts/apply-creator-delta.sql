-- Delta: creator studio gives campaigns a displayable creator name.
alter table public.campaigns add column if not exists creator_name text not null default '';
