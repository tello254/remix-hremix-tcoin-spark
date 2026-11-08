-- ============ E2E test campaigns must be invisible to real users (delta) ============
-- The verify suite creates throwaway campaigns while it runs (budgets don't touch real money,
-- and every probe account is cascade-deleted afterwards). But for the ~minute a run is live,
-- those rows were a platform like any other: they appeared on real dashboards and counted
-- toward real users' daily batches. This parks every test campaign on a platform NO real
-- account can ever link, so:
--   · fn_eligible_pool never matches them (no social_handle can hold platform 'e2etest')
--   · daily batches never size from them
--   · the dashboard pool filters to the three real platforms, so the card itself never renders
-- The studio still gate-checks 'youtube'/'tiktok'/'instagram' through its zod schema — the
-- 'e2etest' value exists only for the suite's inserts.
alter table public.campaigns drop constraint campaigns_platform_check;
alter table public.campaigns add constraint campaigns_platform_check
  check (platform in ('youtube', 'tiktok', 'instagram', 'e2etest'));
