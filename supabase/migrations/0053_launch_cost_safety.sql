-- nyuz -- launch cost-safety: per-feature ledger tagging, daily model caps,
-- kill switch, and per-feature control of the paid AI call sites.
--
-- The launch cost audit found ~$5 of pre-launch spend over a few days, almost
-- all of it system burn (cluster/analyse) rather than a runaway loop, but with
-- several drivers the launch configuration was paying for that it does not
-- need to pay for.
--
-- This migration does FIVE things, each backwards-compatible for callers:
--
--   1. Adds a `feature` column to `ai_usage_ledger` so every row records WHY it
--      spent, in addition to `capability` (the model tier). Allowed values are
--      the six call sites, plus 'unknown' for rows whose provenance we cannot
--      honestly map. New writes set `feature` at reservation time and again at
--      settlement; existing rows default to 'unknown' rather than being guessed.
--
--   2. Adds per-model daily spend caps, checked inside `reserve_ai_tokens`
--      BEFORE a reservation is authorised, under the same advisory lock that
--      already protects the monthly ceilings. The monthly ceilings themselves
--      are unchanged.
--
--   3. Adds the `ai_kill_switch` flag, default off. Off means AI allowed under
--      normal rules; on means every reservation is refused with no provider
--      call and no token spend.
--
--   4. Adds THREE further feature flags, all default off, and TWO site
--      settings. To be exact about what is new here, because the launch report
--      got this wrong once:
--
--        NEW FLAGS (four in total, all default off):
--          - ai_kill_switch
--          - ask_nyuz_enabled
--          - story_translation_enabled
--          - enrichment_pass_enabled
--
--        NEW SITE SETTINGS (two):
--          - ai.daily_flash_cap_microusd  (default $1.00/day)
--          - ai.daily_pro_cap_microusd    (default $5.00/day)
--
--        EXISTING FLAGS THIS MIGRATION DOES NOT TOUCH:
--          - pre_analysis_demand_gate     (0031)
--          - deterministic_cluster_v2     (0022, enabled in 0027)
--          - deterministic_cluster_skip   (0034, still OFF)
--          - deep_explain                 (earlier)
--
--      `deterministic_cluster_skip` staying off is deliberate and load-bearing:
--      with it off the deterministic clusterer is shadow-only and the Flash
--      model decides every clustering call, including the ones the
--      deterministic layer was confident about. No cost estimate in this
--      migration or its report may assume otherwise.
--
--   5. Adds `admin_cost_breakdown()` — the by-feature spend aggregation the
--      audit asked for, over TODAY / 7 DAYS / 30 DAYS in one query — and
--      `admin_cost_by_model(days)` for the Flash / Pro roll-up. Disabled
--      features still appear with 0 calls / 0 tokens / $0: a disabled feature
--      suddenly showing cost is the signal that something is wrong.

-------------------------------------------------------------------------------
-- 1. `feature` on the ledger.
-------------------------------------------------------------------------------

alter table public.ai_usage_ledger
  add column if not exists feature text;

-- Old rows are 'unknown' rather than guessed. Only writes after this migration
-- know which feature they belong to, and that is the only honest answer.
update public.ai_usage_ledger
   set feature = 'unknown'
 where feature is null;

alter table public.ai_usage_ledger
  alter column feature set default 'unknown',
  alter column feature set not null;

-- Every allowed value is in the constraint; rows with a value outside this
-- list cannot exist. `'unknown'` is here on purpose — see above.
alter table public.ai_usage_ledger
  drop constraint if exists ai_usage_ledger_feature_check;
alter table public.ai_usage_ledger
  add constraint ai_usage_ledger_feature_check
  check (feature in (
    'cluster', 'analyse', 'enrich', 'translate', 'impact', 'ask', 'unknown'
  ));

create index if not exists ai_usage_ledger_feature_created_idx
  on public.ai_usage_ledger (feature, created_at desc);

-------------------------------------------------------------------------------
-- 2. Daily model caps enforced inside reserve_ai_tokens.
-------------------------------------------------------------------------------

-- The older overloads are DROPPED, not left beside the new one.
--
-- `reserve_ai_tokens` has been redefined three times (0017/0043 six args,
-- 0044/0047 eight). Postgres keeps each distinct argument list as a separate
-- function, so adding a wider one with defaults would leave two candidates
-- that both match the eight named arguments the app sends, and PostgREST would
-- get `function ... is not unique` on every single reservation. Dropping first
-- is what makes the new signature the only one there is.
drop function if exists public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer
);
drop function if exists public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint
);

create function public.reserve_ai_tokens(
  p_user_id uuid,
  p_capability text,
  p_model text,
  p_reserve integer,
  p_user_monthly_cap integer,
  p_global_monthly_cap integer,
  p_estimated_cost_microusd bigint default null,
  p_global_monthly_cost_microusd bigint default null,
  p_daily_flash_cap_microusd bigint default 1000000,
  p_daily_pro_cap_microusd bigint default 5000000,
  p_feature text default 'unknown'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  global_used bigint;
  user_used bigint;
  spent bigint;
  day_spent bigint;
  reservation_id uuid;
  user_plan plan_tier;
  month_start timestamptz := date_trunc('month', now());
  -- Deliberately UTC, not the session's time zone.
  --
  -- The cron runs in UTC, the ledger is timestamptz, and the console reads the
  -- same expression in `admin_cost_breakdown` below, so "today" means the same
  -- 24 hours to the cap and to the operator watching it. A session with a
  -- different TimeZone would otherwise get a different day boundary and a
  -- different answer about whether the cap was reached.
  day_start timestamptz := (date_trunc('day', (now() at time zone 'UTC')) at time zone 'UTC');
  stale_before timestamptz := now() - interval '1 hour';
  day_cap bigint;
  model_prefix text;
  -- Not named `feature`: a plpgsql variable sharing a column name is the kind
  -- of ambiguity that resolves differently than it reads.
  resolved_feature text := case
    when p_feature in ('cluster','analyse','enrich','translate','impact','ask') then p_feature
    else 'unknown'
  end;
begin
  if p_reserve <= 0 or p_global_monthly_cap <= 0 then
    return null;
  end if;

  -- Both cost arguments are refused when null, and refused here rather than
  -- further down, because every ceiling below is arithmetic on
  -- `p_estimated_cost_microusd`: `null > cap` is null, which is not true, which
  -- would wave the call through every cap in this function at once.
  if p_global_monthly_cost_microusd is null or p_estimated_cost_microusd is null then
    return null;
  end if;

  -- Everything that reads a budget and the insert that spends against it happen
  -- under one lock, held to commit.
  --
  -- This is what makes the caps safe against concurrency rather than merely
  -- usually right: a second worker asking the same question blocks here, and by
  -- the time it reads, the first worker's reservation row is committed and
  -- counted. Any check performed before this line — the daily caps were, in the
  -- first draft of this migration — is a check two callers can both pass.
  perform pg_advisory_xact_lock(18295, 1);

  -- Daily per-model caps.
  --
  -- Only the two production tiers are capped by day. A future model matches
  -- neither prefix and is bounded by the monthly ceilings alone, which is the
  -- same protection every unconfigured capability already gets.
  if p_model like 'deepseek-v4-flash%' then
    model_prefix := 'deepseek-v4-flash%';
    day_cap := p_daily_flash_cap_microusd;
  elsif p_model like 'deepseek-v4-pro%' then
    model_prefix := 'deepseek-v4-pro%';
    day_cap := p_daily_pro_cap_microusd;
  else
    model_prefix := null;
    day_cap := null;
  end if;

  if model_prefix is not null and day_cap is not null and day_cap > 0 then
    -- Settled cost where the call has settled, the authorised estimate where it
    -- is still in flight — the same `coalesce(actual, estimate, 0)` the monthly
    -- ceiling uses, so an in-flight call counts at its ceiling and at its true
    -- cost the moment it settles. Abandoned reservations (0047) are excluded by
    -- the same predicate the monthly ceiling excludes them by, so a provider
    -- outage cannot spend the day's budget on calls that never happened.
    select coalesce(sum(coalesce(cost_microusd, estimated_cost_microusd, 0)), 0)
      into day_spent
      from public.ai_usage_ledger
     where created_at >= day_start
       and model like model_prefix
       and not (
         reserved_tokens > 0
         and cost_microusd is null
         and prompt_tokens = 0
         and completion_tokens = 0
         and created_at < stale_before
       );
    if day_spent + p_estimated_cost_microusd > day_cap then
      return null;
    end if;
  end if;

  select coalesce(sum(greatest(reserved_tokens, prompt_tokens + completion_tokens)), 0)
    into global_used
    from public.ai_usage_ledger
   where created_at >= month_start
     and not (
       reserved_tokens > 0
       and cost_microusd is null
       and prompt_tokens = 0
       and completion_tokens = 0
       and created_at < stale_before
     );
  if global_used + p_reserve > p_global_monthly_cap then
    return null;
  end if;

  select coalesce(sum(coalesce(cost_microusd, estimated_cost_microusd, 0)), 0)
    into spent
    from public.ai_usage_ledger
   where created_at >= month_start
     and not (
       reserved_tokens > 0
       and cost_microusd is null
       and prompt_tokens = 0
       and completion_tokens = 0
       and created_at < stale_before
     );
  if spent + p_estimated_cost_microusd > p_global_monthly_cost_microusd then
    return null;
  end if;

  if p_user_id is not null then
    select plan into user_plan
      from public.subscriptions
     where user_id = p_user_id;
  end if;

  if p_user_id is not null and p_user_monthly_cap > 0 then
    select coalesce(sum(greatest(reserved_tokens, prompt_tokens + completion_tokens)), 0)
      into user_used
      from public.ai_usage_ledger
     where user_id = p_user_id
       and created_at >= month_start
       and not (
         reserved_tokens > 0
         and cost_microusd is null
         and prompt_tokens = 0
         and completion_tokens = 0
         and created_at < stale_before
       );
    if user_used + p_reserve > p_user_monthly_cap then
      return null;
    end if;
  end if;

  -- Tagged at reservation, not only at settlement. A call that never settles —
  -- a crash, a dropped connection, a provider outage — is exactly the spend an
  -- operator most needs attributed, and `settle_ai_tokens` would never run to
  -- attribute it.
  insert into public.ai_usage_ledger (
    user_id, plan, capability, model, reserved_tokens, estimated_cost_microusd,
    feature
  )
  values (
    p_user_id, user_plan, p_capability, p_model, p_reserve,
    greatest(0, p_estimated_cost_microusd),
    resolved_feature
  )
  returning id into reservation_id;
  return reservation_id;
end;
$fn$;

revoke all on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint, bigint, bigint, text
) to service_role;

comment on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint, bigint, bigint, text
) is
  'Authorises one paid AI call and records the reservation. Refuses on the kill '
  'switch (applied by the caller), the per-model daily cap, the monthly token '
  'ceiling, the monthly cost ceiling, or the caller''s plan cap. Every check and '
  'the insert run under one advisory transaction lock, so two concurrent callers '
  'cannot both pass a cap. Days are UTC days.';

-------------------------------------------------------------------------------
-- 3. Kill switch and the three other launch feature flags.
--
-- Four new rows, all default off. Nothing here touches deterministic_cluster_v2
-- or deterministic_cluster_skip.
-------------------------------------------------------------------------------

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  (
    'ai_kill_switch',
    'AI kill switch',
    'Global kill switch for all paid AI provider calls. Off = AI allowed subject '
    'to budgets. On = every reservation is refused with no provider call and no '
    'token spend. Fetching, ingestion and deterministic work continue either way.',
    false,
    100
  ),
  (
    'ask_nyuz_enabled',
    'Ask nyuz',
    'The per-story "Ask nyuz" panel and backend model call. Off for launch. The '
    'implementation, ask_log table and plan cap remain, so this can be switched '
    'on later without a deploy.',
    false,
    100
  ),
  (
    'story_translation_enabled',
    'AI story translation',
    'Lazy AI translation of story content into a reader''s chosen reading '
    'language. Off for launch. Normal i18n of the app UI is unaffected.',
    false,
    100
  ),
  (
    'enrichment_pass_enabled',
    'Material-enrichment pass',
    'A second Pro analysis of an analysed event whose early coverage was thin '
    'and has since grown substantially. Off for launch.',
    false,
    100
  )
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  rollout_percent = excluded.rollout_percent;

-------------------------------------------------------------------------------
-- 4. Daily model caps as site settings, so the operator can change them
--    without a deploy and without a migration.
--
-- `reserve_ai_tokens` carries the same two numbers as argument defaults. A
-- caller that passes neither gets the defaults below; the app passes an
-- override only when one is configured in the environment.
-------------------------------------------------------------------------------

insert into public.site_settings (key, value, updated_by) values
  ('ai.daily_flash_cap_microusd', jsonb_build_object('value', 1000000), null),
  ('ai.daily_pro_cap_microusd',   jsonb_build_object('value', 5000000), null)
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- 5. Cost breakdown by feature, with TODAY / 7d / 30d windows.
--
-- No `days` argument on purpose. The three windows are the question the audit
-- asked, and an argument that silently did not change any of them — the first
-- draft of this function took a `p_days` it never read — is worse than no
-- argument at all.
-------------------------------------------------------------------------------

drop function if exists public.admin_cost_breakdown(integer);

create function public.admin_cost_breakdown()
returns table (
  window_key text,
  feature text,
  calls bigint,
  prompt_tokens bigint,
  completion_tokens bigint,
  tokens bigint,
  spent_microusd bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  with live as (
    select *
      from public.ai_usage_ledger
     where not (
       reserved_tokens > 0
       and cost_microusd is null
       and prompt_tokens = 0
       and completion_tokens = 0
       and created_at < now() - interval '1 hour'
     )
  ),
  windows as (
    select * from (values
          -- The same UTC day boundary `reserve_ai_tokens` caps against, so the
          -- console's TODAY number is the number the daily cap is measured on.
          (1,  'today'::text, (date_trunc('day', (now() at time zone 'UTC')) at time zone 'UTC')),
          (7,  '7_days',      now() - interval '7 days'),
          (30, '30_days',     now() - interval '30 days')
        ) as w(ord, key, since)
  )
  select
    w.key as window_key,
    f.feature,
    -- count(l.id), never count(*): this is a left join from the window list, so
    -- a window with no spend still produces one row, and count(*) would report
    -- that empty window as having made one call. Counting a column from the
    -- joined side is what makes an empty window read as the zero it is.
    count(l.id)::bigint as calls,
    coalesce(sum(l.prompt_tokens), 0)::bigint as prompt_tokens,
    coalesce(sum(l.completion_tokens), 0)::bigint as completion_tokens,
    coalesce(sum(greatest(l.prompt_tokens + l.completion_tokens, 0)), 0)::bigint as tokens,
    coalesce(sum(coalesce(l.cost_microusd, l.estimated_cost_microusd, 0)), 0)::bigint as spent_microusd
  from windows w
  cross join (values
    ('cluster'), ('analyse'), ('enrich'), ('translate'), ('impact'), ('ask'), ('unknown')
  ) as f(feature)
  left join live l
    on l.created_at >= w.since
   and l.feature = f.feature
  group by w.ord, w.key, f.feature
  order by w.ord, f.feature;
$fn$;

revoke all on function public.admin_cost_breakdown()
  from public, anon, authenticated;
grant execute on function public.admin_cost_breakdown() to service_role;

comment on function public.admin_cost_breakdown() is
  'Spend by feature over today (UTC), 7 days and 30 days. Every feature appears '
  'in every window, so a feature that is switched off reads as an explicit zero '
  'rather than a missing row.';

-------------------------------------------------------------------------------
-- Settled tokens/cost by model, for the Flash / Pro roll-up.
-------------------------------------------------------------------------------

create or replace function public.admin_cost_by_model(p_days integer default 30)
returns table (
  model text,
  calls bigint,
  tokens bigint,
  spent_microusd bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    coalesce(nullif(l.model, ''), 'unknown') as model,
    count(*)::bigint as calls,
    coalesce(sum(greatest(l.prompt_tokens + l.completion_tokens, 0)), 0)::bigint as tokens,
    coalesce(sum(coalesce(l.cost_microusd, l.estimated_cost_microusd, 0)), 0)::bigint as spent_microusd
  from public.ai_usage_ledger l
 where l.created_at > now() - make_interval(days => greatest(1, coalesce(p_days, 30)))
   and not (
     l.reserved_tokens > 0
     and l.cost_microusd is null
     and l.prompt_tokens = 0
     and l.completion_tokens = 0
     and l.created_at < now() - interval '1 hour'
   )
 group by 1
 order by 4 desc;
$fn$;

revoke all on function public.admin_cost_by_model(integer)
  from public, anon, authenticated;
grant execute on function public.admin_cost_by_model(integer) to service_role;

-------------------------------------------------------------------------------
-- `settle_ai_tokens` also stamps the feature.
--
-- Dropped and recreated for the same reason as `reserve_ai_tokens`: a sixth
-- argument makes a new function rather than replacing the five-argument one
-- from 0043, and two candidates matching the same call is an outage.
--
-- The clamps from 0043 are kept exactly: a negative token count from a provider
-- is a bug in the provider, not a credit, and cached tokens cannot exceed the
-- prompt they were cached from.
-------------------------------------------------------------------------------

drop function if exists public.settle_ai_tokens(uuid, integer, integer, integer, bigint);

create function public.settle_ai_tokens(
  p_id uuid,
  p_prompt_tokens integer,
  p_cached_prompt_tokens integer,
  p_completion_tokens integer,
  p_cost_microusd bigint,
  p_feature text default null
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.ai_usage_ledger
     set prompt_tokens = greatest(0, p_prompt_tokens),
         cached_prompt_tokens = greatest(0, least(p_prompt_tokens, p_cached_prompt_tokens)),
         completion_tokens = greatest(0, p_completion_tokens),
         cost_microusd = case
           when p_cost_microusd is null then null
           else greatest(0, p_cost_microusd)
         end,
         reserved_tokens = 0,
         -- An unrecognised feature leaves the reserved value in place rather
         -- than raising: settlement is accounting for money already spent, and
         -- failing it over a bad label would lose the real number.
         feature = case
           when p_feature in
             ('cluster','analyse','enrich','translate','impact','ask','unknown')
           then p_feature
           else feature
         end
   where id = p_id;
$fn$;

revoke all on function public.settle_ai_tokens(uuid, integer, integer, integer, bigint, text)
  from public, anon, authenticated;
grant execute on function public.settle_ai_tokens(uuid, integer, integer, integer, bigint, text)
  to service_role;
