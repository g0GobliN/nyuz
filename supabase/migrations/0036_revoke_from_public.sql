-- nyuz -- close a real privilege hole in ten security-definer functions
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
--
-- `CREATE FUNCTION` grants EXECUTE to PUBLIC by default. Every role,
-- including `anon` and `authenticated`, inherits that grant. So
--
--     revoke execute on function f() from anon, authenticated;
--
-- removes a grant those roles never had directly and leaves the PUBLIC grant
-- untouched. The line reads like a lock and does nothing.
--
-- 0017 got this right -- `revoke all ... from public, anon, authenticated`
-- followed by an explicit `grant ... to service_role` -- which is why
-- `claim_alert`, `reserve_ai_tokens` and `purge_expired_digests` were
-- correctly denied when probed. Every other function in the project used the
-- weaker form.
--
-- ---------------------------------------------------------------------------
-- What it actually allowed, verified against the live database
-- ---------------------------------------------------------------------------
--
-- Probed on 2026-08-30 with the project's own anon key, unauthenticated:
--
--   claim_custom_source      WRITE. An anonymous caller passed an arbitrary
--                            p_user_id and the function -- being security
--                            definer -- inserted a `user_custom_sources` row
--                            for that user. It returned 'ok'. The row was
--                            real and had to be deleted afterwards. This is
--                            an unauthenticated write to another person's
--                            account, and it bypasses the plan cap the
--                            function exists to enforce, because the cap is
--                            evaluated against the *victim's* plan.
--
--   admin_daily_counts       READ. Whole-product analytics: signups, active
--   admin_source_stats       readers, plan distribution, per-source article
--   admin_source_demand      counts, reader interest, token spend and which
--   admin_cost_intelligence  feature flags are on -- to anyone on the
--   cluster_shadow_summary   internet with the anon key, which ships in the
--                            browser bundle by design.
--
--   sources_to_collect       READ. Pipeline internals.
--   events_with_demand       READ. Pipeline internals.
--
--   refresh_source_demand    WRITE. Stamps last_demand_at across `sources`.
--   recompute_polling_tiers  WRITE. Rewrites every source's polling tier.
--                            Neither takes attacker-controlled input, so the
--                            damage is bounded to forcing work the pipeline
--                            does anyway -- but both are unauthenticated
--                            writes to global state and neither has any
--                            business being reachable.
--
-- No evidence of exploitation: `user_custom_sources` held zero rows before
-- this probe, and the only row ever written was the probe's own, removed in
-- the same run.
--
-- ---------------------------------------------------------------------------
-- Why static checks missed it
-- ---------------------------------------------------------------------------
--
-- `security-invariants.test.ts` asserted the migration text *contained* a
-- revoke line for each function. It did. The line was simply insufficient,
-- and no test that reads SQL as text can tell the difference between a
-- revoke that works and one that does not. Only executing it against a real
-- database can, which is what `npm run verify:live` now does. That test has
-- been tightened to require the `from public` form.

-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
--
-- `revoke all ... from public` removes the default grant. anon and
-- authenticated are named too, in case an earlier migration granted either
-- of them directly. service_role is then granted back explicitly, because it
-- is the only caller that should ever reach these -- every legitimate use is
-- a server function holding the service-role key, after `adminOnly` or
-- `signedInOnly` has established who is asking.

-- Admin analytics and reporting.
revoke all on function public.admin_daily_counts(integer) from public, anon, authenticated;
grant execute on function public.admin_daily_counts(integer) to service_role;

revoke all on function public.admin_source_stats() from public, anon, authenticated;
grant execute on function public.admin_source_stats() to service_role;

revoke all on function public.admin_source_demand() from public, anon, authenticated;
grant execute on function public.admin_source_demand() to service_role;

revoke all on function public.admin_cost_intelligence(integer) from public, anon, authenticated;
grant execute on function public.admin_cost_intelligence(integer) to service_role;

revoke all on function public.cluster_shadow_summary(integer) from public, anon, authenticated;
grant execute on function public.cluster_shadow_summary(integer) to service_role;

-- Pipeline internals.
revoke all on function public.sources_to_collect(integer) from public, anon, authenticated;
grant execute on function public.sources_to_collect(integer) to service_role;

revoke all on function public.events_with_demand(uuid[]) from public, anon, authenticated;
grant execute on function public.events_with_demand(uuid[]) to service_role;

revoke all on function public.refresh_source_demand() from public, anon, authenticated;
grant execute on function public.refresh_source_demand() to service_role;

revoke all on function public.recompute_polling_tiers() from public, anon, authenticated;
grant execute on function public.recompute_polling_tiers() to service_role;

-- The write. Listed last because it is the one that mattered most.
revoke all on function public.claim_custom_source(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_custom_source(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Functions deliberately left callable
-- ---------------------------------------------------------------------------
--
-- `increment_post_view(slug)` is reachable by anon on purpose: a signed-out
-- visitor reading a blog post must be able to increment its counter, and a
-- policy cannot express "may update exactly one column, only upward". That
-- is documented in docs/database.md and is unchanged here.
--
-- `is_admin`, `is_superadmin` and `blog_post_is_live` are called from inside
-- RLS policies and must remain executable by the roles those policies run
-- as. They take no attacker-controlled action and return only what the
-- caller could determine anyway.
--
-- Trigger functions (`handle_new_user`, `sync_profile_email`,
-- `protect_profile_columns`, `enforce_*`) are invoked by Postgres on the
-- triggering statement, not called directly, and revoking from PUBLIC would
-- not change who can fire them.
