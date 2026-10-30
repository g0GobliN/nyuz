-- Two briefing slots a day: 09:30 and 16:30, in the reader's own zone, every day.
--
-- Owner ruling, 2026-10-30: "change 7:30 to 9:30 and 20:30 to 16:30 thats all
-- permanently everyday." Until this migration the database held one slot per
-- reader and enforced one briefing per reader per local day; both of those
-- facts are wrong for a product that delivers a morning and an evening edition.
--
-- Three things change, and nothing else in the schema moves:
--
--   1. `standard_delivery_time()` is 09:30. It is what a reader on a plan
--      without `customDeliveryTime` stores, and what
--      `enforce_launch_preferences` compares against. `0081` is generated
--      history and now carries the same value; this file is what applies it to
--      a project that already ran 0081.
--   2. `enforce_daily_briefing` becomes one briefing per *slot* per local day
--      (before noon / from noon) instead of one per local day, so the 16:30
--      row is insertable on a day that already has a 09:30 row. It still drops
--      a second morning briefing, which is the duplicate it was written for.
--   3. Data: readers whose stored time is the retired 07:30 default move to
--      09:30, the old Mon–Fri default widens to seven days, and every future
--      `scheduled` briefing moves to the 09:30 slot of its own local day with a
--      16:30 row added beside it. No reader gets two briefings in one slot and
--      none loses a row.
--
-- `launch_plan`'s `briefingsPerDay` becomes 2 as well -- the plan's own
-- statement of the same ruling, and the scheduler and the plan table would
-- otherwise disagree about how many briefings a day a reader gets.

begin;

create or replace function public.launch_plan(p_plan text)
returns jsonb language sql immutable set search_path = public as $fn$
  select coalesce('{"uno":{"monthly":0,"annual":0,"topics":3,"prioritySources":3,"customSources":0,"storiesPerBriefing":5,"briefingsPerDay":2,"customDeliveryTime":false,"alertDailyCap":1,"devices":1,"retentionDays":7,"email":true,"push":true,"telegram":false,"notificationControl":"basic","topicKeywords":4},"plura":{"monthly":14.99,"annual":149.9,"topics":15,"prioritySources":15,"customSources":8,"storiesPerBriefing":15,"briefingsPerDay":2,"customDeliveryTime":true,"alertDailyCap":5,"devices":3,"retentionDays":90,"email":true,"push":true,"telegram":true,"notificationControl":"standard","topicKeywords":50},"omni":{"monthly":29.99,"annual":299.9,"topics":30,"prioritySources":30,"customSources":20,"storiesPerBriefing":25,"briefingsPerDay":2,"customDeliveryTime":true,"alertDailyCap":12,"devices":10,"retentionDays":365,"email":true,"push":true,"telegram":true,"notificationControl":"advanced","topicKeywords":100}}'::jsonb -> p_plan,
    '{"monthly":0,"annual":0,"topics":3,"prioritySources":3,"customSources":0,"storiesPerBriefing":5,"briefingsPerDay":2,"customDeliveryTime":false,"alertDailyCap":1,"devices":1,"retentionDays":7,"email":true,"push":true,"telegram":false,"notificationControl":"basic","topicKeywords":4}'::jsonb);
$fn$;

create or replace function public.standard_delivery_time()
returns time language sql immutable as $fn$ select '09:30'::time; $fn$;

create or replace function public.plan_topic_cap(p_plan text)
returns integer language sql immutable as $fn$ select (public.launch_plan(p_plan)->>'topics')::integer; $fn$;

create or replace function public.plan_priority_source_cap(p_plan text)
returns integer language sql immutable as $fn$ select (public.launch_plan(p_plan)->>'prioritySources')::integer; $fn$;

/*
 * One briefing per slot, per reader, per local day.
 *
 * Unchanged from 0082 except for the two slot lines: the local-day comparison
 * is now paired with "is this the morning or the evening", so two editions a
 * day coexist while a second briefing in the same slot is still dropped rather
 * than sent. `time '12:00'` is the split because the slots are 09:30 and 16:30
 * and no reader can have a slot on both sides of noon and share a day.
 */
create or replace function public.enforce_daily_briefing()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare zone text;
begin
  if new.kind <> 'briefing' then return new; end if;
  if tg_op = 'UPDATE' and new.status <> 'generating' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('briefing:' || new.user_id::text,0));
  select timezone into zone from notification_preferences where user_id=new.user_id;
  zone := coalesce(zone,'UTC');
  if exists(select 1 from digests d where d.user_id=new.user_id and d.kind='briefing'
    and d.digest_id <> new.digest_id
    and not (d.status='failed' and d.generation_started_at is null)
    and (d.scheduled_for at time zone zone)::date = (new.scheduled_for at time zone zone)::date
    and ((d.scheduled_for at time zone zone)::time < time '12:00')
        = ((new.scheduled_for at time zone zone)::time < time '12:00')
    and (tg_op='INSERT' or d.status in ('generating','ready','sent','skipped'))) then
    return null;
  end if;
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

-- The retired default. `enforce_launch_preferences` allows this write on every
-- plan: 09:30 is exactly what `standard_delivery_time()` now returns.
update notification_preferences
set send_at = '09:30:00'
where send_at = '07:30:00';

-- The column defaults move with the ruling. A row inserted without a time would
-- otherwise be stamped 07:30 and rejected by `enforce_launch_preferences` for
-- every reader on a plan without `customDeliveryTime` -- the default would be a
-- value the product refuses to store.
alter table notification_preferences alter column send_at set default '09:30:00';
alter table notification_preferences alter column days set default '{1,2,3,4,5,6,7}'::smallint[];

-- The old Mon–Fri default becomes seven days. A reader who picked their own
-- set of days keeps it -- only the exact old default is widened.
update notification_preferences
set days = '{1,2,3,4,5,6,7}'::smallint[]
where days = '{1,2,3,4,5}'::smallint[];

/*
 * Every future scheduled briefing moves to the 09:30 slot of its own local day,
 * and gets a 16:30 row beside it.
 *
 * `local_day` comes from the reader's `notification_preferences.timezone`, not
 * from UTC: the whole point is that the reader's day is where the slots are.
 * The update is skipped when the computed morning instant has already passed
 * (the row is about to be built anyway, and moving it into the past would make
 * the pipeline treat a live edition as late) and when another row already
 * occupies that instant (the unique index on `(user_id, scheduled_for)` would
 * reject it).
 */
with target as (
  select d.digest_id, d.user_id, d.scheduled_for,
         (d.scheduled_for at time zone coalesce(np.timezone, 'UTC'))::date as local_day,
         coalesce(np.timezone, 'UTC') as zone
  from digests d
  left join notification_preferences np on np.user_id = d.user_id
  where d.kind = 'briefing' and d.status = 'scheduled' and d.scheduled_for > now()
),
slotted as (
  select t.digest_id, t.user_id, t.zone, t.local_day,
         (t.local_day::timestamp + public.standard_delivery_time()) at time zone t.zone as morning_at,
         (t.local_day::timestamp + time '16:30') at time zone t.zone as evening_at
  from target t
)
update digests d
set scheduled_for = s.morning_at
from slotted s
where d.digest_id = s.digest_id
  and s.morning_at > now()
  and not exists (
    select 1 from digests o
    where o.user_id = d.user_id
      and o.scheduled_for = s.morning_at
      and o.digest_id <> d.digest_id
  );

with target as (
  select d.digest_id, d.user_id, d.scheduled_for,
         (d.scheduled_for at time zone coalesce(np.timezone, 'UTC'))::date as local_day,
         coalesce(np.timezone, 'UTC') as zone
  from digests d
  left join notification_preferences np on np.user_id = d.user_id
  where d.kind = 'briefing' and d.status = 'scheduled' and d.scheduled_for > now()
),
slotted as (
  select t.user_id, t.zone, t.local_day,
         (t.local_day::timestamp + time '16:30') at time zone t.zone as evening_at
  from target t
)
insert into digests (user_id, kind, status, scheduled_for)
select s.user_id, 'briefing', 'scheduled', s.evening_at
from slotted s
where s.evening_at > now()
on conflict (user_id, scheduled_for) do nothing;

commit;
