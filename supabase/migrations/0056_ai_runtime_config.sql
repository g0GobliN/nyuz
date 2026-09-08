-- nyuz -- DB-backed AI runtime configuration
--
-- ---------------------------------------------------------------------------
-- What this fixes
-- ---------------------------------------------------------------------------
--
-- 0003 made provider, model and per-capability token ceilings a database edit
-- (`ai_providers`, `ai_model_routes`). The numbers that actually stop the
-- pipeline were never moved:
--
--   AI_MONTHLY_COST_USD      env only, read in reserve path + 3 console reads
--   AI_MONTHLY_TOKEN_BUDGET  env only, same
--   ANALYSE_MAX_TOKENS       hard-coded const in src/lib/pipeline/analyse.ts
--   digest ceiling           hard-coded literal 8192 in digest.ts
--   ASK_MAX_TOKENS           hard-coded const in src/lib/plans.ts
--   analysis batch size      hard-coded `const BATCH = 8` in analyse.ts
--   provider fallback        not configurable at all
--   reasoning effort         never sent to the provider
--
-- So raising a budget meant editing `.env` for `npm run pipeline` AND a
-- Cloudflare variable for the Worker, and the two silently disagreed whenever
-- one was forgotten. Raising an analysis ceiling meant a deploy. This table is
-- the single place both runtimes read, so one edit moves both.
--
-- ---------------------------------------------------------------------------
-- Precedence
-- ---------------------------------------------------------------------------
--
--   this table  ->  environment variable  ->  safe code default
--
-- Env stays as bootstrap: a brand-new deployment with an empty table still
-- behaves exactly as it did before this migration, which is what makes rolling
-- this out safe. Once a row exists it wins, in both runtimes.
--
-- ---------------------------------------------------------------------------
-- Why free-form jsonb rather than typed columns
-- ---------------------------------------------------------------------------
--
-- The bounds that make a value safe (a $50 ceiling on the monthly budget, a
-- 1024-token floor under every completion ceiling) live in
-- src/lib/ai/runtime-config.ts, next to the code that explains WHY each bound
-- is where it is. Restating them as CHECK constraints would put the same number
-- in two places with no mechanism keeping them equal, and the SQL copy would
-- carry none of the reasoning. The resolver clamps on read, so a row written
-- around the console -- by hand, by psql, by a future script -- still cannot
-- push the pipeline past a code ceiling.
--
-- The key is NOT constrained to the known set for the same reason: an unknown
-- key is inert (nothing reads it) and refused by the console's validator, so
-- the constraint would only make rolling a setting back out of the registry a
-- migration instead of a delete.

create table public.ai_runtime_config (
  key        text        primary key,
  -- Always the shape {"value": <scalar>}, matching the `site_settings`
  -- convention 0053 established for `ai.daily_*_cap_microusd`. The wrapper
  -- looks redundant on a scalar and is not: it leaves room to add per-setting
  -- metadata later without rewriting every row's shape.
  value      jsonb       not null,
  -- Who last moved this number, and when. The console shows both, because the
  -- question asked of a budget change at 3am is always "who, and when".
  changed_by uuid        references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  -- Free-text reason, set by the console on dangerous changes.
  note        text        not null default ''
);

comment on table public.ai_runtime_config is
  'Operator-tunable AI runtime settings. Read by both the local pipeline and the Cloudflare Worker; wins over the matching env var. Bounds are enforced in src/lib/ai/runtime-config.ts, not here.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- RLS on with no policy at all: service_role bypasses RLS, everyone else gets
-- nothing. Deliberately unlike `site_settings`, which is world-readable because
-- it holds marketing copy the signed-out landing page renders. This table holds
-- what the operator is willing to spend and whether the kill switch logic can
-- be reached -- reconnaissance for anyone holding the anon key, which ships in
-- the browser bundle by design. The console reaches it through the
-- service-role client in `resolveActor()`, so admins lose nothing.
--
-- Belt and braces alongside RLS, for the same reason as 0036: a future
-- `grant ... to authenticated` on a schema-wide sweep would otherwise silently
-- re-expose this.
alter table public.ai_runtime_config enable row level security;
revoke all on table public.ai_runtime_config from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_runtime_config to service_role;
