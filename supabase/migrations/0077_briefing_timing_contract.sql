-- nyuz -- the briefing timing contract
--
-- A reader who picks 07:30 Asia/Tokyo is naming a *delivery deadline*, not the
-- moment the expensive work is allowed to start. Those were the same instant
-- before this migration, so every failure downstream of 07:30 moved the
-- briefing instead of degrading it:
--
--   * a model 429 pushed the whole briefing fifteen minutes (`aiCapacityRetryAt`),
--   * an exhausted monthly budget pushed it to the first of the *next month*,
--   * a delivery claim from a worker that died held it a further fifteen.
--
-- Production shows all three. Between 3 and 11 September the 22:30Z slot was
-- generated at +0m, +1m, +15m, +31m, +1h56m and +3h20m, one slot was deferred
-- to 2026-10-01 and never sent at all, and the one briefing generated on time
-- had its push sit twenty minutes behind a dead claim.
--
-- The columns below are what turns that from something inferred off a
-- quantized delay into something measured. The rule they record: `scheduled_for`
-- is written once, at scheduling, and a retry never moves it.

begin;

-- ---------------------------------------------------------------------------
-- Generation: allowed to start early, recorded separately from the deadline
-- ---------------------------------------------------------------------------

alter table public.digests
  add column if not exists generation_started_at     timestamptz,
  add column if not exists generation_attempts       smallint not null default 0,
  add column if not exists generation_failure_reason text;

comment on column public.digests.generation_started_at is
  'When a worker claimed this digest. Deliberately may precede scheduled_for: generation runs ahead of the delivery deadline so a retryable failure has room to retry before the reader is owed anything.';
comment on column public.digests.generation_attempts is
  'Claims made against this digest. A retry keeps its scheduled_for, so this column is where the retrying is visible at all.';
comment on column public.digests.generation_failure_reason is
  'Why the last attempt did not produce a briefing. Null once one does.';

-- Briefings deferred under the old policy are released. The one row in
-- production carrying 2026-10-01 was a daily briefing parked for three weeks by
-- a monthly budget ceiling; nothing about a reader's 07:30 should ever have
-- been expressible as a date in another month. Releasing it does not re-send
-- it: digest.ts expires a briefing that is past its own slot by more than
-- MAX_LATENESS_MINUTES and records that as the reason, and the stories it
-- would have carried keep `briefed_at` unset and roll into the next briefing.
update public.digests
   set generation_deferred_until = null
 where kind = 'briefing'
   and generation_deferred_until is not null;

-- ---------------------------------------------------------------------------
-- Delivery: the attempt timeline lateness is measured against
-- ---------------------------------------------------------------------------

alter table public.deliveries
  add column if not exists claimed_at       timestamptz,
  add column if not exists first_attempt_at timestamptz,
  add column if not exists last_attempt_at  timestamptz;

comment on column public.deliveries.claimed_at is
  'Most recent claim, kept for the record. processing_started_at holds the same instant but is the live lease and is cleared on release, so it cannot answer "when was this claimed" after the fact.';

comment on column public.deliveries.first_attempt_at is
  'First time a provider send was actually begun. Lateness against the briefing deadline starts here, not at created_at. Distinct from processing_started_at, which is only the claim.';
comment on column public.deliveries.last_attempt_at is
  'Most recent provider send begun. With first_attempt_at this separates "tried once, late" from "tried repeatedly".';

-- `claim_delivery` records the claim and nothing else. The lease is still the
-- caller's to choose — digest.ts now asks for a short one on the scheduled
-- path, because a dead worker holding a briefing for fifteen minutes is
-- indistinguishable to the reader from the briefing simply being late.
--
-- Claiming is deliberately NOT an attempt. A worker that claims a row and dies
-- before it reaches Resend has done nothing to the reader; one that dies after
-- may have sent a briefing nobody recorded. Stamping both at claim time made
-- those two identical in the timing view, so the attempt stamps moved to
-- `mark_delivery_attempt`, called immediately before the provider call.
-- `claimed_at` is the claim, `first/last_attempt_at` is the send, and a row
-- with the first set and the second null is a worker that died in between.
--
-- Re-sending after a lease expires is safe in the way that matters: the email
-- carries `Idempotency-Key: digest:<id>:email` and the push carries the digest
-- id as its `tag`, so a duplicate attempt is collapsed by the provider and by
-- the reader's own notification centre rather than arriving twice.
create or replace function public.claim_delivery(
  p_id uuid,
  p_lease_minutes integer default 10
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  changed integer;
begin
  update public.deliveries
     set processing_started_at = now(),
         claimed_at            = now()
   where id = p_id
     and status = 'queued'
     and (
       processing_started_at is null
       or processing_started_at < now() - make_interval(mins => greatest(1, p_lease_minutes))
     );
  get diagnostics changed = row_count;
  return changed = 1;
end;
$fn$;

revoke all on function public.claim_delivery(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_delivery(uuid, integer) to service_role;

-- The other half of the claim: the moment the send itself begins. Separate
-- statement because it has to land *before* the provider call, and the claim
-- happens before we know whether we will get that far.
create or replace function public.mark_delivery_attempt(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.deliveries
     set first_attempt_at = coalesce(first_attempt_at, now()),
         last_attempt_at  = now()
   where id = p_id;
$fn$;

revoke all on function public.mark_delivery_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_delivery_attempt(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The contract, readable in one query
-- ---------------------------------------------------------------------------

-- Read-only operational view; service role only. One row per briefing per
-- channel, carrying the promise (local time and zone the reader picked), the
-- instant it converted to, every step between, and the number the contract is
-- actually judged on: how many seconds after the deadline the reader got it.
create or replace view public.briefing_timing as
select
  d.digest_id,
  d.user_id,
  np.timezone                                            as scheduled_timezone,
  to_char(d.scheduled_for at time zone np.timezone,
          'YYYY-MM-DD HH24:MI')                          as scheduled_local,
  d.scheduled_for                                        as scheduled_utc,
  d.generation_started_at,
  d.generated_at                                         as generation_completed_at,
  d.generation_attempts,
  d.status                                               as digest_status,
  d.item_count,
  d.generation_failure_reason,
  dl.channel,
  dl.claimed_at                                          as delivery_claimed_at,
  dl.first_attempt_at                                    as delivery_first_attempt_at,
  dl.last_attempt_at                                     as delivery_last_attempt_at,
  dl.attempts                                            as delivery_attempts,
  dl.status                                              as delivery_status,
  dl.delivered_at,
  dl.last_error                                          as delivery_last_error,
  extract(epoch from (dl.delivered_at - d.scheduled_for))::bigint as lateness_seconds
from public.digests d
join public.notification_preferences np on np.user_id = d.user_id
left join public.deliveries dl on dl.digest_id = d.digest_id
where d.kind = 'briefing';

revoke all on public.briefing_timing from public, anon, authenticated;
grant select on public.briefing_timing to service_role;

commit;
